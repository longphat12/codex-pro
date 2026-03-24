import { spawnSync } from 'node:child_process';

/**
 * Health Check for Codex-Pro Profiles
 * Detects shadow bans, quota issues, and connection problems.
 */
class HealthCheck {
    /**
     * Run a basic health check query.
     * @param {string} profileName 
     * @returns {Promise<Object>} Status object
     */
    async check(profileName) {
        const testQuery = "echo 'Hello, health check.'";
        
        try {
            const start = Date.now();
            const child = spawnSync('codex', [testQuery], { 
                stdio: 'pipe', 
                encoding: 'utf8',
                timeout: 30000 // 30s timeout
            });
            const duration = Date.now() - start;

            if (child.status !== 0) {
                return { status: 'Error', message: `Exit code ${child.status}`, duration };
            }

            const output = child.stdout.toLowerCase();
            
            // Heuristics for detection
            if (output.includes('rate limit') || output.includes('too many requests')) {
                return { status: 'RateLimited', message: 'Rate limit detected', duration };
            }

            if (output.includes('unauthorized') || output.includes('login required')) {
                return { status: 'Unauthorized', message: 'Session expired', duration };
            }

            if (output.length < 5) {
                return { status: 'Suspicious', message: 'Empty or too short response', duration };
            }

            if (duration > 20000) {
                return { status: 'Degraded', message: 'Response too slow', duration };
            }

            return { status: 'Healthy', message: 'All systems go', duration };
        } catch (err) {
            return { status: 'Failed', message: err.message };
        }
    }
}

export const healthCheck = new HealthCheck();
