import { spawnSync } from 'node:child_process';

const normalizeOutput = (value) => (typeof value === 'string' ? value.trim() : '');
const QUOTA_PATTERN = /\b(rate limit(?:ed)?|quota|usage limit|too many requests|insufficient quota|resource exhausted|429|credits?\b|billing\b|upgrade to plus)\b/i;
const UNAUTHORIZED_PATTERN = /\b(unauthorized|login required|authentication failed|invalid api key|session expired)\b/i;

const extractFailureDetail = (stdout, stderr) => {
    const combined = [normalizeOutput(stderr), normalizeOutput(stdout)].filter(Boolean).join('\n');
    if (!combined) return '';

    const lines = combined
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const errorLine = [...lines].reverse().find((line) => /^ERROR:/i.test(line));
    if (errorLine) return errorLine;

    const usefulLine = [...lines].reverse().find((line) => {
        const lower = line.toLowerCase();
        return !(
            lower.startsWith('openai codex v')
            || lower === '--------'
            || lower.startsWith('workdir:')
            || lower.startsWith('model:')
            || lower.startsWith('provider:')
            || lower.startsWith('approval:')
            || lower.startsWith('sandbox:')
            || lower.startsWith('reasoning effort:')
            || lower.startsWith('reasoning summaries:')
            || lower.startsWith('session id:')
            || lower.startsWith('mcp startup:')
            || lower === 'user'
        );
    });

    return usefulLine || lines[lines.length - 1];
};

class HealthCheck {
    async check(profileName) {
        const testQuery = 'Reply with exactly: OK';
        
        try {
            const start = Date.now();
            const child = spawnSync('codex', ['exec', '--skip-git-repo-check', testQuery], {
                stdio: 'pipe', 
                encoding: 'utf8',
                env: process.env,
                cwd: process.cwd(),
                timeout: 10000 // 10s timeout to fast-fail
            });
            const duration = Date.now() - start;
            const stdout = normalizeOutput(child.stdout);
            const stderr = normalizeOutput(child.stderr);
            const output = `${stdout}\n${stderr}`.toLowerCase();

            if (child.status !== 0) {
                if (QUOTA_PATTERN.test(output)) {
                    return { status: 'QuotaExceeded', message: extractFailureDetail(stdout, stderr), duration };
                }

                if (UNAUTHORIZED_PATTERN.test(output)) {
                    return { status: 'Unauthorized', message: extractFailureDetail(stdout, stderr), duration };
                }

                const detail = extractFailureDetail(stdout, stderr);
                const message = detail ? `Exit code ${child.status}: ${detail}` : `Exit code ${child.status}`;
                return { status: 'Error', message, duration };
            }
            
            // Heuristics for detection
            if (QUOTA_PATTERN.test(output)) {
                return { status: 'RateLimited', message: 'Rate limit detected', duration };
            }

            if (UNAUTHORIZED_PATTERN.test(output)) {
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
