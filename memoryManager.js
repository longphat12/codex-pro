import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './cryptoHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, '.codex_memory.json');
const MAX_HISTORY = 5;
const CONTINUATION_PATTERN = /\b(ti[eế]p|ti[eế]p\s*t[uụ]c|l[uú]c\s*n[aà]y|v[uừ]a\s*r[ồo]i|[ơo]\s*tr[eê]n|b[eê]n\s*tr[eê]n|nh[uư]\s*c[uũ]|same|continue|previous|earlier|above|that|it)\b/i;
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'cho', 'co', 'cua', 'da',
    'de', 'di', 'do', 'for', 'from', 'giup', 'hay', 'i', 'in', 'is', 'it', 'la', 'lam',
    'loi', 'me', 'nao', 'nay', 'neu', 'nhu', 'nhe', 'nhung', 'no', 'of', 'on', 'or',
    'please', 'roi', 'sao', 'sua', 'sung', 'tai', 'tao', 'that', 'the', 'them', 'thi',
    'this', 'to', 'toi', 'trong', 'user', 've', 'viec', 'vui', 'voi', 'with'
]);

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
        return this.getRelevantSerialized('');
    }

    tokenize(text) {
        return new Set(
            (text || '')
                .toLowerCase()
                .replace(/[^a-z0-9_\-./\s]/gi, ' ')
                .split(/\s+/)
                .filter(token => token.length >= 3 && !STOP_WORDS.has(token))
        );
    }

    getRelevantSerialized(prompt = '') {
        if (this.history.length === 0) return "";
        const wantsContinuation = CONTINUATION_PATTERN.test(prompt);
        const promptTokens = this.tokenize(prompt);
        const scored = this.history.map((ex, index) => {
            const exchangeTokens = this.tokenize(`${ex.prompt} ${ex.response}`);
            const overlap = [...promptTokens].filter(token => exchangeTokens.has(token)).length;
            const recencyScore = index / Math.max(this.history.length, 1);
            const score = overlap * 3 + recencyScore + (wantsContinuation && index >= this.history.length - 2 ? 2 : 0);
            return { ex, index, score };
        });

        let selected = [];
        if (wantsContinuation) {
            selected = this.history.slice(-2).map((ex, index) => ({ ex, index, score: 1 }));
        } else {
            selected = scored
                .filter(item => item.score >= 3)
                .sort((a, b) => b.score - a.score || b.index - a.index)
                .slice(0, 2)
                .sort((a, b) => a.index - b.index);
        }

        if (selected.length === 0) return "";

        let context = `\n--- RECENT HISTORY (${wantsContinuation ? 'Follow-up' : 'Relevant'}) ---\n`;
        selected.forEach(({ ex }) => {
            context += `- Earlier request: ${ex.prompt.substring(0, 220)}${ex.prompt.length > 220 ? '...' : ''}\n`;
            if (ex.response && ex.response !== '[Success]') {
                context += `  Outcome: ${ex.response.substring(0, 120)}${ex.response.length > 120 ? '...' : ''}\n`;
            }
        });
        return context;
    }

    clear() {
        this.history = [];
        if (fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
    }
}

export const memoryManager = new MemoryManager();
