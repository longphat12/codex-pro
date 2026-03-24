import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './cryptoHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, '.codex_memory.json');
const MAX_HISTORY = 5;

/**
 * Memory Manager for Codex-Pro
 * Handles short-term conversation context persistence.
 */
class MemoryManager {
    constructor() {
        this.history = [];
        this.load();
    }

    load() {
        if (fs.existsSync(MEMORY_FILE)) {
            try {
                const encrypted = fs.readFileSync(MEMORY_FILE, 'utf8');
                const decrypted = decrypt(encrypted);
                this.history = JSON.parse(decrypted);
            } catch (err) {
                this.history = [];
            }
        }
    }

    save() {
        const data = JSON.stringify(this.history, null, 2);
        const encrypted = encrypt(data);
        fs.writeFileSync(MEMORY_FILE, encrypted);
    }

    /**
     * Add a message exchange to history.
     */
    addExchange(prompt, response) {
        this.history.push({
            timestamp: new Date().toISOString(),
            prompt: prompt.trim().substring(0, 2048),
            response: response.trim().substring(0, 2048)
        });

        if (this.history.length > MAX_HISTORY) {
            this.history.shift();
        }
        this.save();
    }

    /**
     * Get history formatted for prompt injection.
     */
    getSerialized() {
        if (this.history.length === 0) return "";
        let context = "\n--- RECENT HISTORY (Last 3) ---\n";
        // Only take last 3 exchanges to save tokens
        const recent = this.history.slice(-3);
        recent.forEach((ex, i) => {
            // Further truncate history responses to 200 chars
            context += `U: ${ex.prompt.substring(0, 500)}\nA: ${ex.response.substring(0, 200)}${ex.response.length > 200 ? '...' : ''}\n`;
        });
        return context;
    }

    clear() {
        this.history = [];
        if (fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
    }
}

export const memoryManager = new MemoryManager();
