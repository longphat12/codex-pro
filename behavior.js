/**
 * Behavioral Engine for Codex-Pro
 * Simulates human-like delays, usage patterns, and account warm-up.
 */
class BehavioralEngine {
    constructor() {
        this.minDelay = 2000;  // 2s
        this.maxDelay = 15000; // 15s
    }

    /**
     * Get a random delay between requests.
     * Uses a normal-ish distribution (tends towards middle).
     * @returns {number} Delay in ms
     */
    getDelay() {
        const rand = Math.random() + Math.random() + Math.random(); // Approx normal
        const normalized = rand / 3;
        return Math.floor(this.minDelay + normalized * (this.maxDelay - this.minDelay));
    }

    /**
     * Check if a profile should rotate based on success count or time.
     * @param {Object} profile Metadata object
     * @returns {boolean}
     */
    shouldRotate(profile) {
        if (!profile.usageCount) return false;
        
        // Randomly rotate after 5-12 successful uses to avoid patterns
        const threshold = Math.floor(Math.random() * 8) + 5;
        if (profile.usageCount >= threshold && profile.usageCount % threshold === 0) {
            return true;
        }

        // Logic for "warm-up" could go here (e.g., restrict usage for new accounts)
        return false;
    }

    /**
     * Simulate "thinking" or "typing" time.
     */
    async sleep() {
        const ms = this.getDelay();
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if it's "natural" to work right now (e.g., avoid 24/7 activity).
     * @returns {boolean}
     */
    isNaturalTime() {
        const hour = new Date().getHours();
        // Assume "natural" hours are 7 AM to 11 PM
        return hour >= 7 && hour <= 23;
    }
}

export const behavior = new BehavioralEngine();
