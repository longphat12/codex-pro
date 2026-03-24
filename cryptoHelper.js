import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DEFAULT_KEY = Buffer.alloc(32, 'codex-pro-secret-key-padding-32b');

/**
 * Get the encryption key from environment or default.
 * @returns {Buffer} 32-byte key
 */
const getKey = () => {
    const keyStr = process.env.CODEX_KEY || '';
    if (keyStr.length >= 32) return Buffer.from(keyStr.slice(0, 32));
    if (keyStr.length > 0) return Buffer.concat([Buffer.from(keyStr), Buffer.alloc(32 - keyStr.length, 0)]);
    return DEFAULT_KEY;
};

/**
 * Encrypt text using AES-256-GCM.
 * @param {string} text Plain text to encrypt
 * @returns {string} Base64 encoded: iv:authTag:encryptedData
 */
export const encrypt = (text) => {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
};

/**
 * Decrypt text using AES-256-GCM.
 * @param {string} data Encrypted data in iv:authTag:encryptedData format
 * @returns {string} Decrypted plain text
 */
export const decrypt = (data) => {
    try {
        const [ivHex, tagHex, encryptedHex] = data.split(':');
        if (!ivHex || !tagHex || !encryptedHex) throw new Error('Invalid encrypted format');

        const key = getKey();
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (err) {
        throw new Error(`Decryption failed: ${err.message}`);
    }
};
