import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_FILE = path.join(process.cwd(), '.project-map.md');

/**
 * Project Map Manager for Codex-Pro
 * Manages the long-term project state and tree structure.
 */
class ProjectMap {
    /**
     * Initialize the map by scanning the project.
     */
    init(silent = true) {
        if (!silent) log(`Initializing Project Map...`);
        const projectName = path.basename(process.cwd());
        const tree = this.generateTree(process.cwd());
        const content = `# Project State: [${projectName}]
## Last Update: ${new Date().toLocaleString()}

## 📂 Current Tree Structure
\`\`\`text
${tree}
\`\`\`

## 🧠 Memory Context
- Database: Not detected
- Auth: Not detected
- Framework: Not detected
`;
        fs.writeFileSync(MAP_FILE, content);
        return MAP_FILE;
    }

    /**
     * Simple recursive tree generation with filtering support.
     */
    generateTree(dir, prefix = '', filter = null, depth = 0) {
        const MAX_DEPTH = 1; // Default depth limit for full scan
        const IGNORE = [
            'node_modules', 'vendor', 'assets', 'dist', 'build',
            'runtime', 'temp', 'tmp', '.DS_Store', '.Trash', 
            'Library', 'Pictures', 'Music', 'Movies', 'Public', 
            'Applications', 'Desktop', 'Documents', 'Downloads'
        ];
        let out = '';
        let files = [];
        try {
            files = fs.readdirSync(dir);
        } catch (err) {
            return '';
        }
        
        // Filter out dot-files/folders and IGNORE list
        const filteredFiles = files.filter(f => !IGNORE.includes(f) && !f.startsWith('.'));
        const filters = filter ? filter.split(',').map(f => f.trim().toLowerCase()) : null;

        filteredFiles.forEach((file, index) => {
            const absolute = path.join(dir, file);
            let isDir = false;
            try {
                isDir = fs.statSync(absolute).isDirectory();
            } catch {
                return; // Skip if we can't stat the file
            }
            
            const isLast = index === filteredFiles.length - 1;

            if (filters) {
                const matches = filters.some(f => file.toLowerCase().includes(f));
                if (isDir) {
                    const sub = this.generateTree(absolute, prefix + (isLast ? '    ' : '│   '), filter, depth + 1);
                    if (sub || matches) {
                        out += `${prefix}${isLast ? '└── ' : '├── '}${file}/\n${sub}`;
                    }
                } else if (matches) {
                    out += `${prefix}${isLast ? '└── ' : '├── '}${file}\n`;
                }
            } else {
                if (depth >= MAX_DEPTH) return; // Stop recursion if too deep
                out += `${prefix}${isLast ? '└── ' : '├── '}${file}${isDir ? '/' : ''}\n`;
                if (isDir) {
                    out += this.generateTree(absolute, prefix + (isLast ? '    ' : '│   '), null, depth + 1);
                }
            }
        });
        return out;
    }

    /**
     * Read map for prompt injection.
     */
    getSummary(focus = null) {
        if (focus) {
            const tree = this.generateTree(process.cwd(), '', focus, 0);
            return `\n--- PROJECT CONTEXT (Focus: ${focus}) ---\n${tree || "No matches found."}\n`;
        }
        if (fs.existsSync(MAP_FILE)) {
            const tree = this.generateTree(process.cwd(), '', null, 0); // Always use latest concise tree
            return `\n--- PROJECT CONTEXT (Concise) ---\n${tree}\n`;
        }
        return "";
    }

    /**
     * Update map based on file changes.
     */
    async logChange(file, type = '*') {
        if (!fs.existsSync(MAP_FILE)) return;
        let content = fs.readFileSync(MAP_FILE, 'utf8');
        const timestamp = new Date().toLocaleString();
        content = content.replace(/## Last Update: .*/, `## Last Update: ${timestamp}`);
        
        fs.writeFileSync(MAP_FILE, content);
    }
}

export const projectMap = new ProjectMap();
