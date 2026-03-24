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

const FILE_HINT_PATTERN = /(?:^|[\s`'"])([A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|mjs|cjs|json|md|ya?ml|css|scss|html|sh|py|go|rs|java|kt|swift))(?:$|[\s`'"])/g;
const CONTINUATION_PATTERN = /\b(ti[eế]p|ti[eế]p\s*t[uụ]c|l[uú]c\s*n[aà]y|v[uừ]a\s*r[ồo]i|[ơo]\s*tr[eê]n|b[eê]n\s*tr[eê]n|nh[uư]\s*c[uũ]|same|continue|previous|earlier|above|that|it)\b/i;
const CODE_ACTION_PATTERN = /\b(fix|debug|refactor|implement|add|update|change|edit|write|review|inspect|check|analyze|read|open|search|find|trace|investigate|s[uử]a|th[eê]m|vi[eế]t|c[ậa]p\s*nh[ậa]t|ki[eể]m\s*tra|xem|m[ởo]|t[ìi]m|ph[aâ]n\s*t[ií]ch|review|debug)\b/i;
const CODE_SCOPE_PATTERN = /\b(file|files|code|repo|repository|module|function|class|component|service|script|api|test|readme|cli|project|source|workspace|codebase|folder|directory|h[aà]m|module|m[aã]\s*ngu[oồ]n|file|th[uư]?\s*m[uụ]c|d[ựu]\s*[áa]n)\b/i;
const EXPLICIT_SCAN_PATTERN = /\b(scan|map|tree|structure|overview|whole project|entire project|full project|full repo|entire repo|whole repo|codebase|workspace|qu[eé]t|to[aà]n\s*b[oộ]\s*d[ựu]\s*[áa]n|to[aà]n\s*repo|c[aấ]u\s*tr[uú]c|t[oổ]ng\s*quan)\b/i;
const SCAN_BEHAVIOR_PATTERN = /\b(hay|đang|b[iị]|tự|auto|automatic|tự\s*động)\b.{0,20}\b(scan|map|qu[eé]t)\b|\b(scan|map|qu[eé]t)\b.{0,20}\b(hay|đang|b[iị]|tự|auto|automatic|tự\s*động)\b/i;
const TRIVIAL_PATTERN = /^(hi|hello|hey|ok|oke|thanks|thank you|xin ch[aà]o|ch[aà]o|c[aả]m\s*[ơo]n|test)\b/i;
const REPO_WIDE_PATTERN = /\b(architecture|system|design|codebase|workspace|repo|repository|project|lu[oồ]ng|ki[eế]n\s*tr[uú]c|to[aà]n\s*b[oộ]|t[oổ]ng\s*th[eể]|end-to-end)\b/i;
const IMPLEMENTATION_PATTERN = /\b(fix|debug|implement|add|update|change|edit|write|refactor|s[uử]a|th[eê]m|vi[eế]t|c[ậa]p\s*nh[ậa]t)\b/i;
const REVIEW_PATTERN = /\b(review|inspect|audit|analyze|trace|investigate|ki[eể]m\s*tra|ph[aâ]n\s*t[ií]ch|truy\s*v[eế]t)\b/i;

const estimateTokens = (str) => Math.ceil(str.length / 4);

const getActiveProfileName = () => {
    try {
        if (!fs.existsSync(paths.codexDir)) return null;
        if (!fs.lstatSync(paths.codexDir).isSymbolicLink()) return null;
        return path.basename(fs.readlinkSync(paths.codexDir));
    } catch {
        return null;
    }
};

const extractFileHints = (prompt) => {
    const matches = new Set();
    for (const match of prompt.matchAll(FILE_HINT_PATTERN)) {
        matches.add(match[1].trim());
    }
    return [...matches].slice(0, 4);
};

const buildContextPlan = ({ userPrompt, noMap, noMemory, focus, lowToken, writeModeEnabled }) => {
    const trimmedPrompt = userPrompt.trim();
    const fileHints = extractFileHints(trimmedPrompt);
    const wantsContinuation = CONTINUATION_PATTERN.test(trimmedPrompt);
    const needsCodeActionContext = CODE_ACTION_PATTERN.test(trimmedPrompt) && CODE_SCOPE_PATTERN.test(trimmedPrompt);
    const explicitlyRequestsScan = EXPLICIT_SCAN_PATTERN.test(trimmedPrompt) && !SCAN_BEHAVIOR_PATTERN.test(trimmedPrompt);
    const isTrivialPrompt = TRIVIAL_PATTERN.test(trimmedPrompt) && trimmedPrompt.length < 80;
    const autoFocus = focus || (fileHints.length > 0 ? fileHints.join(',') : null);
    const repoWideIntent = explicitlyRequestsScan
        || (REPO_WIDE_PATTERN.test(trimmedPrompt) && (REVIEW_PATTERN.test(trimmedPrompt) || trimmedPrompt.length > 120));
    const targetedCodeIntent = fileHints.length > 0
        || (needsCodeActionContext && !repoWideIntent)
        || (IMPLEMENTATION_PATTERN.test(trimmedPrompt) && writeModeEnabled);
    const includeMap = !noMap && (Boolean(autoFocus) || repoWideIntent);
    const includeMemory = !noMemory && (wantsContinuation || (trimmedPrompt.length >= 24 && !isTrivialPrompt));
    const useMinimalRules = !includeMap && !includeMemory && isTrivialPrompt;
    const baseRules = useMinimalRules ? rules.minimal : rules.global;
    const mapMode = autoFocus ? 'focused' : (repoWideIntent ? 'expanded' : 'concise');
    const strategy = repoWideIntent
        ? 'Start with architecture-level context, then narrow to the files that actually matter.'
        : targetedCodeIntent
            ? 'Inspect only directly relevant files first. Expand scope only if a blocker appears.'
            : 'Answer directly without assuming repository-wide context.';

    return {
        includeMap,
        includeMemory,
        autoFocus,
        mapMode,
        baseRules: lowToken ? `${baseRules}\n${rules.modes.lowToken}` : baseRules,
        fileHints,
        wantsContinuation,
        useMinimalRules,
        strategy
    };
};

export const runCodex = async (args, silent = false, writeMode = false) => {
    const noLog = args.includes('--no-log') || silent;
    const noMap = args.includes('--no-map');
    const noMemory = args.includes('--no-memory');
    const lowTokenEnabled = args.includes('--low-token');
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
    
    if (!getActiveProfileName()) { error('No active profile.'); return 1; }
    
    const contextPlan = buildContextPlan({
        userPrompt,
        noMap,
        noMemory,
        focus,
        lowToken: lowTokenEnabled,
        writeModeEnabled
    });

    // --- Smart Context Injection ---
    if (contextPlan.includeMap) projectMap.ensure();
    let hCtx = contextPlan.includeMemory ? memoryManager.getRelevantSerialized(userPrompt) : "";
    let mCtx = contextPlan.includeMap ? projectMap.getSummary(contextPlan.autoFocus, contextPlan.mapMode) : "";
    let uP = userPrompt;
    let sCtx = `${contextPlan.baseRules}\n\nExecution mode:\n- ${contextPlan.strategy}`;

    // Truncate individual components if they cross a reasonable threshold
    const MAX_HISTORY_TOKENS = lowTokenEnabled ? 300 : 600;
    const MAX_MAP_TOKENS = contextPlan.mapMode === 'expanded' ? 900 : 500;
    const MAX_USER_TOKENS = 4000;

    if (estimateTokens(hCtx) > MAX_HISTORY_TOKENS) hCtx = hCtx.substring(hCtx.length - (MAX_HISTORY_TOKENS * 4));
    if (estimateTokens(mCtx) > MAX_MAP_TOKENS) mCtx = mCtx.substring(0, MAX_MAP_TOKENS * 4);
    if (estimateTokens(uP) > MAX_USER_TOKENS) uP = uP.substring(0, MAX_USER_TOKENS * 4);

    const buildPrompt = (mapCtx, historyCtx, request) =>
        `${sCtx}\n\n${mapCtx}\n${historyCtx}\n--- NEW REQUEST ---\n${request}`;

    let finalPrompt = buildPrompt(mCtx, hCtx, uP);

    const MAX_PROMPT_SIZE = 64 * 1024; // 64KB safe limit for modern systems
    if (finalPrompt.length > MAX_PROMPT_SIZE) {
        if (!silent) log(`${C.yellow}Warning: Total prompt too large (${finalPrompt.length}). Truncating...${C.reset}`);

        // Preserve system instructions and the latest user request first.
        const basePrompt = buildPrompt('', '', uP);
        if (basePrompt.length >= MAX_PROMPT_SIZE) {
            const reservedHeader = `${sCtx}\n\n--- NEW REQUEST ---\n`;
            const remainingForUser = Math.max(0, MAX_PROMPT_SIZE - reservedHeader.length);
            finalPrompt = `${reservedHeader}${uP.substring(uP.length - remainingForUser)}`;
        } else {
            const remainingForContext = MAX_PROMPT_SIZE - basePrompt.length;
            const combinedContext = `${mCtx}\n${hCtx}`.trim();
            const trimmedContext = combinedContext
                ? combinedContext.substring(Math.max(0, combinedContext.length - remainingForContext))
                : '';
            finalPrompt = buildPrompt(trimmedContext, '', uP);
        }
    }

    if (!silent) {
        const tokens = estimateTokens(finalPrompt);
        const mode = [
            contextPlan.includeMap ? `Map:${contextPlan.mapMode}${contextPlan.autoFocus ? `:${contextPlan.autoFocus}` : ''}` : 'Map:off',
            hCtx ? `Hist:${contextPlan.wantsContinuation ? 'follow-up' : 'relevant'}` : 'Hist:off',
            contextPlan.useMinimalRules ? 'Rules:min' : 'Rules:full'
        ].join(' | ');
        log(`${C.dim}[Context: ${mode}]${C.reset}`);
        log(`${C.dim}[Tokens: ~${tokens} | Map=${estimateTokens(mCtx)}, Hist=${estimateTokens(hCtx)}, User=${estimateTokens(uP)}]${C.reset}`);
    }

    const execute = async (retries = 0) => {
        const profiles = listProfiles();
        const curName = getActiveProfileName();
        if (!curName) {
            error('No active profile.');
            return 1;
        }
        
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

    const renderHeader = () => {
        const curr = getActiveProfileName() || 'No Profile';
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

    log(`\n${C.bold}${C.green}--- Codex-Pro v7.3 Stealth Chat ---${C.reset}`);
    log(`${C.dim}Tip: Type / and press Tab for command suggestions. /help for more.${C.reset}\n`);
    promptNext();
};
