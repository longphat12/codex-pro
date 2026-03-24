/**
 * Fingerprint Generator for Codex-Pro
 * Provides randomized User-Agents and browser-like headers.
 */
class FingerprintGenerator {
    constructor() {
        this.userAgents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (iPad; CPU OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0"
        ];
    }

    /**
     * Get a random User-Agent.
     * @returns {string}
     */
    getUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    /**
     * Get randomized headers for a request.
     * @returns {Object}
     */
    getHeaders() {
        const ua = this.getUserAgent();
        const headers = {
            "User-Agent": ua,
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-CH-UA": this.getSecChUa(ua),
            "Sec-CH-UA-Mobile": ua.includes('Mobile') ? '?1' : '?0',
            "Sec-CH-UA-Platform": this.getPlatform(ua),
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
        };
        return headers;
    }

    getSecChUa(ua) {
        if (ua.includes('Chrome')) return '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"';
        if (ua.includes('Firefox')) return '"Firefox";v="123"';
        return '"Not A;Brand";v="99"';
    }

    getPlatform(ua) {
        if (ua.includes('Windows')) return '"Windows"';
        if (ua.includes('Macintosh')) return '"macOS"';
        if (ua.includes('Linux')) return '"Linux"';
        return '"Unknown"';
    }
}

export const fingerprint = new FingerprintGenerator();
