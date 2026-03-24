import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { createPromptInterface } from './cliPrompts.js';
import { behavior } from './behavior.js';
import { fingerprint } from './fingerprint.js';
import { memoryManager } from './memoryManager.js';
import { projectMap } from './projectMap.js';
import { proxyManager } from './proxyManager.js';
import { rules } from './rules.js';
import { C, error, log, success } from './terminalUI.js';
import {
  paths,
  getProfileData,
  listProfiles,
  saveProfileData,
  switchProfile
} from './profileManager.js';

export const runCodex = async (args, silent = false, writeMode = false) => {
    const noLog = args.includes('--no-log') || silent;
    const noMap = args.includes('--no-map');
    const noMemory = args.includes('--no-memory');
    const writeModeEnabled = writeMode || args.includes('--write');
    
    let focus = null;
    const focusIdx = args.indexOf('--focus');
    if (focusIdx !== -1 && args[focusIdx + 1]) {
        focus = args[focusIdx + 1];
    }

    const cleanArgs = args.filter((a, i) => {
        if (['--no-log', '--no-map', '--no-memory', '--focus', '--no-rules', '--low-token', '--write'].includes(a)) return false;
        if (i > 0 && args[i-1] === '--focus') return false;
        return true;
    });
    const userPrompt = cleanArgs.join(' ');
    
    if (!fs.existsSync(paths.codexDir)) { error('No active profile.'); return 1; }
    const currentName = path.basename(fs.readlinkSync(paths.codexDir));
    
    // --- Token-Optimized Context Injection ---
    if (!noMap) projectMap.init(); 
    let hCtx = noMemory ? "" : memoryManager.getSerialized();
    let mCtx = noMap ? "" : projectMap.getSummary(focus);
    let uP = userPrompt;
    let sCtx = rules.global;

    if (args.includes('--low-token')) {
        sCtx += `\n${rules.modes.lowToken}`;
    }

    // Heuristic token estimator (approx 4 chars per token)
    const estimateTokens = (str) => Math.ceil(str.length / 4);

    // Truncate individual components if they cross a reasonable threshold
    const MAX_HISTORY_TOKENS = 1000;
    const MAX_MAP_TOKENS = 1000;
    const MAX_USER_TOKENS = 4000;

    if (estimateTokens(hCtx) > MAX_HISTORY_TOKENS) hCtx = hCtx.substring(hCtx.length - (MAX_HISTORY_TOKENS * 4));
    if (estimateTokens(mCtx) > MAX_MAP_TOKENS) mCtx = mCtx.substring(0, MAX_MAP_TOKENS * 4);
    if (estimateTokens(uP) > MAX_USER_TOKENS) uP = uP.substring(0, MAX_USER_TOKENS * 4);

    let finalPrompt = `${sCtx}\n\n${mCtx}\n${hCtx}\n--- NEW REQUEST ---\n${uP}`;

    const MAX_PROMPT_SIZE = 64 * 1024; // 64KB safe limit for modern systems
    if (finalPrompt.length > MAX_PROMPT_SIZE) {
        if (!silent) log(`${C.yellow}Warning: Total prompt too large (${finalPrompt.length}). Truncating...${C.reset}`);
        finalPrompt = finalPrompt.substring(finalPrompt.length - MAX_PROMPT_SIZE);
    }

    if (!silent) {
        const tokens = estimateTokens(finalPrompt);
        log(`${C.dim}[Tokens: ~${tokens} | Map=${estimateTokens(mCtx)}, Hist=${estimateTokens(hCtx)}, User=${estimateTokens(uP)}]${C.reset}`);
    }

    const execute = async (retries = 0) => {
        const profiles = listProfiles();
        const curName = path.basename(fs.readlinkSync(paths.codexDir));
        
        if (noLog) { process.env.HISTSIZE = '0'; process.env.HISTFILE = '/dev/null'; }

        const headers = fingerprint.getHeaders();
        process.env.USER_AGENT = headers['User-Agent'];

        const d = getProfileData(curName);
        const proxy = proxyManager.getProxy() || d.proxy;
        if (proxy && proxy !== d.lastProxy) {
            if (!silent) log(`${C.yellow}Proxy changed: ${proxy}. Session may need refresh.${C.reset}`);
            d.lastProxy = proxy; saveProfileData(curName, d);
        }

        if (!silent) await behavior.sleep();
        if (!noLog) log(`${C.dim}--- [${C.blue}${curName}${C.reset}${C.dim}] ---${C.reset}`);

        return new Promise((resolve) => {
            const codexArgs = ['exec', '--skip-git-repo-check'];
            if (writeModeEnabled) {
                codexArgs.push('-c', 'sandbox_mode="danger-full-access"');
                codexArgs.push('-c', 'approval_policy="never"');
            }
            codexArgs.push(finalPrompt);
            
            const child = spawn('codex', codexArgs, { stdio: ['pipe', 'inherit', 'inherit'], env: process.env });
            child.stdin.end(); // IMPORTANT: close stdin so codex knows no more input is coming and exits
            const timer = setTimeout(() => {
                child.kill();
                if (!noLog) error(`Command timed out (5min)`);
                resolve(124);
            }, 300000);

            child.on('close', async (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    memoryManager.addExchange(userPrompt, "[Success]");
                    projectMap.logChange(curName, 'use');
                    const data = getProfileData(curName);
                    data.usageCount++;
                    saveProfileData(curName, data);
                    resolve(0);
                } else if (code !== 130 && retries < profiles.length - 1) {
                    const idx = profiles.findIndex(p => p.name === curName);
                    const next = profiles[(idx + 1) % profiles.length].name;
                    const jitter = behavior.getDelay();
                    log(`\n${C.yellow}Rotating to [${next}] in ${jitter/1000}s...${C.reset}`);
                    await new Promise(r => setTimeout(r, jitter));
                    switchProfile(next);
                    resolve(await execute(retries + 1));
                } else {
                    resolve(code);
                }
            });
        });
    };
    return await execute();
};

export const handleChat = async () => {
    let focus = null;
    let noMap = false;
    let noMemory = false;
    
    const commands = ['/focus', '/no-map', '/no-memory', '/help', '/exit', '/quit'];
    const completer = (line) => {
        const hits = commands.filter((c) => c.startsWith(line));
        return [hits.length ? hits : commands, line];
    };

    const isHome = process.cwd() === homedir();
    const getCurrentProfile = () => {
        let curr = 'No Profile';
        try {
            if (fs.existsSync(paths.codexDir) && fs.lstatSync(paths.codexDir).isSymbolicLink()) {
                curr = path.basename(fs.readlinkSync(paths.codexDir));
            }
        } catch {}
        return curr;
    };

    const renderHeader = () => {
        const curr = getCurrentProfile();
        const scopeLabel = focus || (isHome ? 'Home-Warning' : 'Full Scan');
        const statusLine = `${C.dim}[${scopeLabel}]${noMap?' [No Map]':''}${noMemory?' [No Hist]':''} [Free] [Write]${C.reset}`;
        process.stdout.write(`\n${C.bold}${C.cyan}Chat [${curr}]${C.reset} ${statusLine}\n`);
        if (isHome && !focus && !noMap) {
            log(`${C.yellow}Warning: Scanning Home Directory. Use /focus to save tokens.${C.reset}`);
        }
        rl.setPrompt(`Chat [${curr}] > `);
    };

    const rl = createPromptInterface({
        terminal: true,
        historySize: 200,
        removeHistoryDuplicates: true,
        escapeCodeTimeout: 500,
        completer: completer
    });

    const promptNext = () => {
        renderHeader();
        rl.prompt();
    };

    rl.on('SIGINT', () => {
        process.stdout.write('\n');
        rl.close();
    });

    rl.on('close', () => {
        process.stdout.write('\n');
    });

    rl.on('line', async (input) => {
        const raw = input.trim();
        if (!raw) {
            promptNext();
            return;
        }

        const lower = raw.toLowerCase();
        if (['exit', 'q', 'quit', '/exit', '/quit'].includes(lower)) {
            rl.close();
            return;
        }

        if (raw.startsWith('/')) {
            const [cmd, ...args] = raw.substring(1).split(' ');
            if (cmd === 'focus') {
                focus = args[0] || null;
                const msg = focus ? `Focus set to: ${focus.split(',').join(' & ')}` : 'Focus reset to Full Scan';
                success(msg);
            } else if (cmd === 'no-map') {
                noMap = !noMap;
                success(`Project Map: ${noMap ? 'OFF' : 'ON'}`);
            } else if (cmd === 'no-memory') {
                noMemory = !noMemory;
                success(`Chat History: ${noMemory ? 'OFF' : 'ON'}`);
            } else if (cmd === 'help') {
                log(`${C.yellow}Chat Commands: /focus <kd>, /no-map, /no-memory, /help, /exit${C.reset}`);
            } else {
                error(`Unknown command: ${cmd}`);
            }
            promptNext();
            return;
        }

        const flags = [];
        if (noMap) flags.push('--no-map');
        if (noMemory) flags.push('--no-memory');
        if (focus) {
            flags.push('--focus');
            flags.push(focus);
        }

        rl.pause();
        process.stdin.pause();
        try {
            await runCodex([...flags, raw], true, true);
        } finally {
            process.stdin.resume();
            rl.resume();
            promptNext();
        }
    });

    log(`\n${C.bold}${C.green}--- Codex-Pro v7.2 Stealth Chat ---${C.reset}`);
    log(`${C.dim}Tip: Type / and press Tab for command suggestions. /help for more.${C.reset}\n`);
    promptNext();
};
