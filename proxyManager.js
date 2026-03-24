import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_FILE = path.join(__dirname, 'proxies.txt');

/**
 * Proxy Manager for Codex-Pro
 * Handles loading, rotating, and health-checking proxies.
 */
class ProxyManager {
    constructor() {
        this.proxies = [];
        this.currentIndex = 0;
        this.loadProxies();
    }

    loadProxies() {
        if (fs.existsSync(PROXY_FILE)) {
            this.proxies = fs.readFileSync(PROXY_FILE, 'utf8')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
        }
    }

    /**
     * Get a proxy based on strategy.
     * @param {string} strategy 'round-robin' | 'random'
     * @returns {string|null} Proxy string or null
     */
    getProxy(strategy = 'random') {
        if (this.proxies.length === 0) return null;

        if (strategy === 'random') {
            const idx = Math.floor(Math.random() * this.proxies.length);
            return this.proxies[idx];
        }

        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
    }

    /**
     * Check if proxy is alive and anonymous.
     * @param {string} proxy 
     * @returns {Promise<boolean>}
     */
    async checkHealth(proxy) {
        try {
            const out = execSync(`curl -s --connect-timeout 5 -x ${proxy} ifconfig.me`, { stdio: 'pipe' }).toString().trim();
            return !!out;
        } catch (err) {
            return false;
        }
    }

    /**
     * Add a proxy to the pool.
     */
    addProxy(proxy) {
        if (!this.proxies.includes(proxy)) {
            this.proxies.push(proxy);
            fs.appendFileSync(PROXY_FILE, `${proxy}\n`);
        }
    }
}

export const proxyManager = new ProxyManager();
