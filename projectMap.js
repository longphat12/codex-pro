import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_FILE = path.join(process.cwd(), '.project-map.md');
const IGNORE = new Set([
    'node_modules', 'vendor', 'assets', 'dist', 'build',
    'runtime', 'temp', 'tmp', '.DS_Store', '.Trash',
    'Library', 'Pictures', 'Music', 'Movies', 'Public',
    'Applications', 'Desktop', 'Documents', 'Downloads'
]);

class ProjectMap {
    init(silent = true) {
        if (!silent) {
            // Reserved for future terminal logging.
        }
        this.writeSnapshot();
        return MAP_FILE;
    }

    ensure() {
        if (!fs.existsSync(MAP_FILE)) {
            this.writeSnapshot();
        }
        return MAP_FILE;
    }

    writeSnapshot() {
        const projectName = path.basename(process.cwd());
        const tree = this.generateTree(process.cwd(), {
            maxDepth: 2,
            maxEntriesPerDir: 20,
            maxTotalLines: 80
        });
        const content = `# Project State: [${projectName}]
## Last Update: ${new Date().toLocaleString()}

## Current Tree Structure
\`\`\`text
${tree}
\`\`\`

## Memory Context
- Scope: Compact snapshot for prompt injection
- Strategy: Expand only when repo-wide context is required
`;
        fs.writeFileSync(MAP_FILE, content);
    }

    generateTree(rootDir, options = {}) {
        const state = { lines: 0, truncated: false };
        return this.walk(rootDir, options, '', 0, state);
    }

    walk(dir, options, prefix, depth, state) {
        const {
            filter = null,
            maxDepth = 1,
            maxEntriesPerDir = 12,
            maxTotalLines = 80
        } = options;

        if (state.lines >= maxTotalLines) {
            state.truncated = true;
            return '';
        }

        let entries = [];
        try {
            entries = fs.readdirSync(dir)
                .filter((name) => !IGNORE.has(name) && !name.startsWith('.'))
                .map((name) => {
                    const absolute = path.join(dir, name);
                    try {
                        return {
                            name,
                            absolute,
                            isDir: fs.statSync(absolute).isDirectory()
                        };
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean)
                .sort((a, b) => {
                    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
        } catch {
            return '';
        }

        const filters = filter
            ? filter.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
            : null;
        const limitedEntries = entries.slice(0, maxEntriesPerDir);
        let out = '';

        limitedEntries.forEach((entry, index) => {
            if (state.lines >= maxTotalLines) {
                state.truncated = true;
                return;
            }

            const isLast = index === limitedEntries.length - 1;
            const nextPrefix = prefix + (isLast ? '    ' : '│   ');
            const matches = !filters || filters.some((value) => entry.name.toLowerCase().includes(value));
            let childOutput = '';

            if (entry.isDir && depth < maxDepth) {
                childOutput = this.walk(entry.absolute, options, nextPrefix, depth + 1, state);
            }

            if (filters && !matches && !childOutput) {
                return;
            }

            out += `${prefix}${isLast ? '└── ' : '├── '}${entry.name}${entry.isDir ? '/' : ''}\n`;
            state.lines += 1;

            if (state.lines >= maxTotalLines) {
                state.truncated = true;
                return;
            }

            if (childOutput) {
                out += childOutput;
            }
        });

        if (entries.length > maxEntriesPerDir && !filters && state.lines < maxTotalLines) {
            out += `${prefix}${limitedEntries.length > 0 ? '├──' : '└──'} ...\n`;
            state.lines += 1;
            state.truncated = true;
        }

        if (depth === 0 && state.truncated && state.lines < maxTotalLines) {
            out += '... truncated ...\n';
            state.lines += 1;
        }

        return out;
    }

    getSummary(focus = null, mode = 'concise') {
        if (focus) {
            const tree = this.generateTree(process.cwd(), {
                filter: focus,
                maxDepth: 4,
                maxEntriesPerDir: 20,
                maxTotalLines: 120
            });
            return `\n--- PROJECT CONTEXT (Focus: ${focus}) ---\n${tree || 'No matches found.'}\n`;
        }

        const tree = this.generateTree(process.cwd(), {
            maxDepth: mode === 'expanded' ? 3 : 2,
            maxEntriesPerDir: mode === 'expanded' ? 24 : 20,
            maxTotalLines: mode === 'expanded' ? 120 : 70
        });

        if (tree) {
            return `\n--- PROJECT CONTEXT (${mode === 'expanded' ? 'Expanded' : 'Concise'}) ---\n${tree}\n`;
        }

        if (fs.existsSync(MAP_FILE)) {
            const content = fs.readFileSync(MAP_FILE, 'utf8');
            const match = content.match(/```text\n([\s\S]*?)\n```/);
            if (match?.[1]) {
                return `\n--- PROJECT CONTEXT (Cached) ---\n${match[1]}\n`;
            }
        }

        return '';
    }

    async logChange(file, type = '*') {
        if (!fs.existsSync(MAP_FILE)) return;
        let content = fs.readFileSync(MAP_FILE, 'utf8');
        const timestamp = new Date().toLocaleString();
        content = content.replace(/## Last Update: .*/, `## Last Update: ${timestamp}`);
        fs.writeFileSync(MAP_FILE, content);
    }
}

export const projectMap = new ProjectMap();
