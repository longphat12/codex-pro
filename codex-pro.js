#!/usr/bin/env node

/**
 * Codex-Pro CLI Tool (Zero-Dep Edition)
 * Version: 7.2 "Project-Aware Brain"
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './cryptoHelper.js';
import { proxyManager } from './proxyManager.js';
import { behavior } from './behavior.js';
import { healthCheck } from './healthCheck.js';
import { fingerprint } from './fingerprint.js';
import { memoryManager } from './memoryManager.js';
import { projectMap } from './projectMap.js';
import { rules } from './rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const CODEX_DIR = path.join(__dirname, '.codex');
const HOME_CODEX = path.join(HOME, '.codex');
const PROFILES_DIR = path.join(__dirname, '.codex_profiles');
const SCRIPT_PATH = process.argv[1];

// --- Manual Dotenv Loader ---
const loadEnv = () => {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (line && !line.startsWith('#') && line.includes('=')) {
        const [key, ...val] = line.split('=');
        process.env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
};
loadEnv();

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', dim: '\x1b[2m',
  bgBlue: '\x1b[44m', white: '\x1b[37m'
};

const log = (msg) => process.stdout.write(msg + '\n');
const error = (msg) => process.stdout.write(`${C.red}Error: ${msg}${C.reset}\n`);
const success = (msg) => process.stdout.write(`${C.green}✔ ${msg}${C.reset}\n`);

// --- Profile Data Management ---
const saveProfileData = (name, data) => {
  const pPath = path.join(PROFILES_DIR, name);
  try {
    if (!fs.existsSync(pPath)) fs.mkdirSync(pPath, { recursive: true });
    // Verify it's a directory
    if (!fs.statSync(pPath).isDirectory()) {
        error(`${pPath} exists but is not a directory.`);
        return;
    }
    const encrypted = encrypt(JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(pPath, 'metadata.json'), encrypted);
  } catch (err) {
    error(`Failed to save profile data for ${name}: ${err.message}`);
  }
};

const getProfileData = (name) => {
  const pPath = path.join(PROFILES_DIR, name);
  const dataPath = path.join(pPath, 'metadata.json');
  if (fs.existsSync(dataPath)) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    try {
      // Try decrypting
      const decrypted = decrypt(raw);
      return JSON.parse(decrypted);
    } catch (err) {
      if (raw.startsWith('{')) {
        // Migration from plain JSON
        try {
          const data = JSON.parse(raw);
          saveProfileData(name, data);
          return data;
        } catch (jsonErr) {
          error(`Corrupted metadata for ${name}: ${jsonErr.message}`);
        }
      } else {
        error(`Decryption failed for ${name} (possible wrong key): ${err.message}`);
      }
    }
  }
  return { usageCount: 0, quota: '???', status: 'Ready', proxy: null, lastProxy: null };
};

const listProfiles = () => {
    if (!fs.existsSync(PROFILES_DIR)) return [];
    return fs.readdirSync(PROFILES_DIR)
      .filter(f => {
          try {
              const fullPath = path.join(PROFILES_DIR, f);
              return fs.statSync(fullPath).isDirectory();
          } catch {
              return false; // Skip broken links/files
          }
      })
      .map(name => ({ name, ...getProfileData(name) }));
};

const getSessionFiles = (dir) => {
    const files = [];
    if (!fs.existsSync(dir)) return files;

    const walk = (current) => {
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                files.push(fullPath);
            }
        }
    };

    walk(dir);
    return files;
};

const getLatestQuotaSnapshot = (name) => {
    const sessionsDir = path.join(PROFILES_DIR, name, 'sessions');
    const sessionFiles = getSessionFiles(sessionsDir)
      .sort((a, b) => {
          try {
              return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch {
              return 0;
          }
      });

    for (const file of sessionFiles) {
        try {
            const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
                const parsed = JSON.parse(lines[i]);
                const rateLimits = parsed?.payload?.rate_limits;
                if (rateLimits?.primary || rateLimits?.secondary) {
                    return rateLimits;
                }
            }
        } catch {}
    }

    return null;
};

const getRemainingPercent = (limit) => {
    if (!limit || typeof limit.used_percent !== 'number') return null;
    return Math.max(0, Math.min(100, Math.round(100 - limit.used_percent)));
};

const formatWindowLabel = (minutes) => {
    if (minutes === 300) return '5h';
    if (minutes === 10080) return '7d';
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
};

const formatTimeUntilReset = (unixSeconds) => {
    if (!unixSeconds) return 'unknown';
    const diffMs = (unixSeconds * 1000) - Date.now();
    if (diffMs <= 0) return 'now';

    const totalMinutes = Math.ceil(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

const formatQuotaItem = (label, limit) => {
    if (!limit) return `${label}:--`;
    const remaining = getRemainingPercent(limit);
    if (remaining === null) return `${label}:--`;
    return `${label}:${String(remaining).padStart(2, ' ')}%`;
};

const formatQuotaSummary = (rateLimits) => {
    if (!rateLimits) return 'No data';
    const primaryLabel = formatWindowLabel(rateLimits.primary?.window_minutes);
    const secondaryLabel = formatWindowLabel(rateLimits.secondary?.window_minutes);
    const parts = [formatQuotaItem(primaryLabel, rateLimits.primary)];
    if (rateLimits.secondary) parts.push(formatQuotaItem(secondaryLabel, rateLimits.secondary));
    return parts.join(' ');
};

const formatQuotaDetails = (rateLimits) => {
    if (!rateLimits) return 'Quota: No recent data';

    const details = [];
    if (rateLimits.primary) {
        details.push(
          `${formatWindowLabel(rateLimits.primary.window_minutes)} còn ${getRemainingPercent(rateLimits.primary)}% · reset sau ${formatTimeUntilReset(rateLimits.primary.resets_at)}`
        );
    }
    if (rateLimits.secondary) {
        details.push(
          `${formatWindowLabel(rateLimits.secondary.window_minutes)} còn ${getRemainingPercent(rateLimits.secondary)}% · reset sau ${formatTimeUntilReset(rateLimits.secondary.resets_at)}`
        );
    }

    const plan = rateLimits.plan_type ? `Plan: ${rateLimits.plan_type}` : 'Plan: unknown';
    return `Quota: ${details.join(' | ')} | ${plan}`;
};

const switchProfile = (name) => {
    const profilePath = path.join(PROFILES_DIR, name);
    try {
        if (fs.lstatSync(CODEX_DIR)) fs.unlinkSync(CODEX_DIR);
    } catch {}
    try {
        const stats = fs.lstatSync(HOME_CODEX);
        if (stats.isSymbolicLink()) {
            fs.unlinkSync(HOME_CODEX);
        } else if (stats.isDirectory()) {
            // Safe migration: move real directory to a special profile
            const recoveredName = `recovered_session_${Date.now()}`;
            const recoveredPath = path.join(PROFILES_DIR, recoveredName);
            if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
            fs.renameSync(HOME_CODEX, recoveredPath);
            saveProfileData(recoveredName, { usageCount: 0, status: 'Recovered' });
            success(`Migrated existing ~/.codex to profile [${recoveredName}]`);
        }
    } catch {}
    
    fs.symlinkSync(profilePath, CODEX_DIR, 'dir');
    if (!fs.existsSync(HOME_CODEX)) {
        try { fs.symlinkSync(profilePath, HOME_CODEX, 'dir'); } catch {}
    }
    const d = getProfileData(name);
    process.env.HTTP_PROXY = d.proxy || ''; process.env.HTTPS_PROXY = d.proxy || ''; process.env.ALL_PROXY = d.proxy || '';
    return true;
};

// --- TUI RENDERER (Flicker-Free) ---
const renderMenu = (profiles, index, activeName) => {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    
    process.stdout.write(`\n ${C.bold}${C.cyan}--- Codex-Pro v7.2 (Project-Aware Brain) ---${C.reset}\n`);
    process.stdout.write(` ${C.dim}Arrows: Move | Enter: Select | q: Quit${C.reset}\n\n`);
    process.stdout.write(`   ${C.dim}${'Profile'.padEnd(16)} ${'Usage'.padEnd(8)} ${'Proxy'.padEnd(6)} Quota${C.reset}\n`);
    
    profiles.forEach((p, i) => {
        const isSelected = i === index;
        const isActive = p.name === activeName;
        const prefix = isSelected ? `${C.cyan}${C.bold} > ${C.reset}` : '   ';
        let line = `${p.name.padEnd(16)} ${String(p.usageCount).padEnd(8)} ${String(p.proxy ? 'Yes' : 'No').padEnd(6)} ${formatQuotaSummary(p.rateLimits)}`;
        if (isActive) line = `${C.green}${line} (Active)${C.reset}`;
        if (isSelected) process.stdout.write(`${prefix}${C.bgBlue}${C.white}${C.bold} ${line} ${C.reset}\n`);
        else process.stdout.write(`${prefix}${line}\n`);
    });

    const selected = profiles[index];
    process.stdout.write(`\n ${C.dim}${formatQuotaDetails(selected?.rateLimits)}${C.reset}\n`);
    process.stdout.write(`\n ${C.bold}c)${C.reset} Chat  ${C.bold}i)${C.reset} Check IP  ${C.bold}d)${C.reset} Delete  ${C.bold}q)${C.reset} Quit\n`);
};

const handleMenu = async () => {
    const profiles = listProfiles().map((profile) => ({
        ...profile,
        rateLimits: getLatestQuotaSnapshot(profile.name)
    }));
    if (profiles.length === 0) { log('No profiles. Run cpl to add.'); return; }
    
    let activeName = '';
    try { activeName = path.basename(fs.readlinkSync(CODEX_DIR)); } catch {}
    
    let index = 0;
    process.stdout.write('\x1Bc'); // Initial clear
    renderMenu(profiles, index, activeName);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup = () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
    };

    return new Promise((resolve) => {
        process.stdin.on('data', async (key) => {
            if (key === '\u001b[A') { index = (index - 1 + profiles.length) % profiles.length; renderMenu(profiles, index, activeName); }
            else if (key === '\u001b[B') { index = (index + 1) % profiles.length; renderMenu(profiles, index, activeName); }
            else if (key === '\r') { cleanup(); switchProfile(profiles[index].name); success(`Activated: ${profiles[index].name}`); resolve(); }
            else if (key === 'q' || key === '\u0003') { cleanup(); resolve(); }
            else if (key === 'c') { cleanup(); process.stdout.write('\n'); await handleChat(); resolve(); }
            else if (key === 'i') { cleanup(); process.stdout.write('\n'); spawnSync('node', [SCRIPT_PATH, 'check-ip'], { stdio: 'inherit', cwd: __dirname }); resolve(); }
            else if (key === 'd') {
                cleanup();
                process.stdout.write('\n');
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                rl.question(`Confirm delete [${profiles[index].name}]? (y/n): `, (ans) => {
                    if (ans.toLowerCase() === 'y') execSync(`rm -rf "${path.join(PROFILES_DIR, profiles[index].name)}"`);
                    rl.close(); resolve();
                });
            }
        });
    });
};

const runCodex = async (args, silent = false, writeMode = false) => {
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
    
    if (!fs.existsSync(CODEX_DIR)) { error('No active profile.'); return 1; }
    const currentName = path.basename(fs.readlinkSync(CODEX_DIR));
    
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
    // Using 4096 tokens (approx 16KB) as a safe context window for many models
    const MAX_HISTORY_TOKENS = 1000;
    const MAX_MAP_TOKENS = 1000;
    const MAX_USER_TOKENS = 4000;

    if (estimateTokens(hCtx) > MAX_HISTORY_TOKENS) hCtx = hCtx.substring(hCtx.length - (MAX_HISTORY_TOKENS * 4));
    if (estimateTokens(mCtx) > MAX_MAP_TOKENS) mCtx = mCtx.substring(0, MAX_MAP_TOKENS * 4);
    if (estimateTokens(uP) > MAX_USER_TOKENS) uP = uP.substring(0, MAX_USER_TOKENS * 4);

    let finalPrompt = `${sCtx}\n\n${mCtx}\n${hCtx}\n--- NEW REQUEST ---\n${uP}`;

    // Final OS limit safeguard (E2BIG prevention)
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
        const curName = path.basename(fs.readlinkSync(CODEX_DIR));
        
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

const handleChat = async () => {
    let focus = null;
    let noMap = false;
    let noMemory = false;
    
    const commands = ['/focus', '/no-map', '/no-memory', '/help', '/exit', '/quit'];
    const completer = (line) => {
        const hits = commands.filter((c) => c.startsWith(line));
        return [hits.length ? hits : commands, line];
    };

    const rl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout,
        completer: completer 
    });

    const isHome = process.cwd() === homedir();

    const ask = () => {
        let curr = "No Profile";
        try {
            if (fs.existsSync(CODEX_DIR) && fs.lstatSync(CODEX_DIR).isSymbolicLink()) {
                curr = path.basename(fs.readlinkSync(CODEX_DIR));
            }
        } catch {}

        let statusLine = `${C.dim}[${focus || (isHome ? 'Home-Warning ⚠️' : 'Full Scan')}]${noMap?' [No Map]':''}${noMemory?' [No Hist]':''} [Free] [Write]${C.reset}`;
        if (isHome && !focus && !noMap) {
            log(`${C.yellow}⚠️ Warning: Scanning Home Directory. Use /focus to save tokens.${C.reset}`);
        }
        process.stdout.write('\n');
        rl.question(`${C.bold}${C.cyan}Chat [${curr}] ${statusLine} > ${C.reset}`, async (input) => {
            const raw = input.trim();
            if (!raw) { ask(); return; }
            const lower = raw.toLowerCase();
            
            if (['exit', 'q', 'quit'].includes(lower)) { rl.close(); return; }
            
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
                ask();
                return;
            }

            const flags = [];
            if (noMap) flags.push('--no-map');
            if (noMemory) flags.push('--no-memory');
            if (focus) { flags.push('--focus'); flags.push(focus); }

            rl.pause(); // Pause readline while spawned process runs
            await runCodex([...flags, raw], true, true); 
            rl.resume();
            ask();
        });
    };

    log(`\n${C.bold}${C.green}--- Codex-Pro v7.2 Stealth Chat ---${C.reset}`);
    log(`${C.dim}Tip: Type / and press Tab for command suggestions. /help for more.${C.reset}\n`);
    ask();
};

// --- CLI ENTRY ---
const args = process.argv.slice(2);
const command = args[0] || 'menu';

switch (command) {
  case 'run': await runCodex(args.slice(1), false, true); break;
  case 'chat': await handleChat(); break;
  case 'menu': await handleMenu(); break;
  case 'login':
    if (fs.existsSync(CODEX_DIR) && fs.lstatSync(CODEX_DIR).isSymbolicLink()) fs.unlinkSync(CODEX_DIR);
    try {
        if (fs.lstatSync(HOME_CODEX).isSymbolicLink()) fs.unlinkSync(HOME_CODEX);
    } catch {}
    spawnSync('codex', ['login'], { stdio: 'inherit', cwd: __dirname });
    const rlL = readline.createInterface({ input: process.stdin, output: process.stdout });
    rlL.question(`Name to save: `, (n) => {
        const name = n.trim();
        if (!name) { rlL.close(); return; }
        if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
        
        const targetPath = path.join(PROFILES_DIR, name);
        try {
            if (fs.lstatSync(targetPath)) {
                success(`Profile [${name}] already exists or is a placeholder. Backing up...`);
                fs.renameSync(targetPath, `${targetPath}.bak-${Date.now()}`);
            }
        } catch {}
        
        // Check both potential locations for the new .codex
        let source = null;
        if (fs.existsSync(CODEX_DIR) && !fs.lstatSync(CODEX_DIR).isSymbolicLink()) source = CODEX_DIR;
        else if (fs.existsSync(HOME_CODEX) && !fs.lstatSync(HOME_CODEX).isSymbolicLink()) source = HOME_CODEX;

        if (source) {
            fs.renameSync(source, targetPath);
            switchProfile(name); // This will link both as symlinks
            saveProfileData(name, { usageCount: 0 });
            success(`Saved [${name}] from ${source}.`);
        } else {
            error(`No new .codex directory found in project or home after login.`);
        }
        rlL.close();
    });
    break;
  case 'check-ip':
    try {
        const link = fs.readlinkSync(CODEX_DIR);
        const cur = path.basename(link);
        const d = getProfileData(cur);
        log(`Checking [${cur}]...`);
        const pFlag = d.proxy ? `-x ${d.proxy}` : '';
        const out = execSync(`curl -s --connect-timeout 5 ${pFlag} ifconfig.me`).toString().trim();
        success(`IP: ${C.bold}${out}`);
    } catch { error('IP check failed.'); }
    break;
  case 'set-proxy':
    const pN = args[1]; const pU = args[2];
    const pD = getProfileData(pN); pD.proxy = pU; saveProfileData(pN, pD);
    success(`Proxy updated.`); break;
  case 'health':
    const target = args[1];
    if (target) {
        log(`Checking health of [${target}]...`);
        switchProfile(target);
        const result = await healthCheck.check(target);
        if (result.status === 'Healthy') success(`${result.status}: ${result.message} (${result.duration}ms)`);
        else error(`${result.status}: ${result.message} (${result.duration}ms)`);
    } else {
        const pS = listProfiles();
        for (const p of pS) {
            log(`Checking [${p.name}]...`);
            switchProfile(p.name);
            const res = await healthCheck.check(p.name);
            if (res.status === 'Healthy') success(`${p.name}: ${res.status}`);
            else error(`${p.name}: ${res.status} - ${res.message}`);
            await behavior.sleep();
        }
    }
    break;

  case 'init':
    log(`Initializing Project Map...`);
    const mapPath = projectMap.init();
    success(`Project Map created at ${mapPath}`);
    break;

  case 'memory':
    if (args[1] === '--clear') {
        memoryManager.clear();
        success("Memory cleared.");
    } else {
        log(memoryManager.getSerialized() || "Memory is empty.");
    }
    break;

  default:
    log(`Codex-Pro v7.2 | run, menu, chat, login, set-proxy, health, init, memory`);
    log(`Options: --no-log, --no-map, --no-memory, --focus <keyword>`);
}
