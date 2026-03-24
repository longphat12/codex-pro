#!/usr/bin/env node

/**
 * Codex-Pro CLI Tool (Zero-Dep Edition)
 * Version: 7.2 "Project-Aware Brain"
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { proxyManager } from './proxyManager.js';
import { behavior } from './behavior.js';
import { healthCheck } from './healthCheck.js';
import { fingerprint } from './fingerprint.js';
import { memoryManager } from './memoryManager.js';
import { projectMap } from './projectMap.js';
import { rules } from './rules.js';
import { askQuestion, confirmAction } from './cliPrompts.js';
import { runCodex, handleChat } from './chatService.js';
import { C, error, log, renderMenu, success } from './terminalUI.js';
import {
  formatQuotaDetails,
  formatQuotaSummary,
  getActiveProfileName,
  getLatestQuotaSnapshot,
  getProfileData,
  listProfiles,
  paths,
  printQuotaReport,
  refreshQuotaSnapshot,
  saveProfileData,
  switchProfile
} from './profileManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const SCRIPT_PATH = process.argv[1];

const ensureUtf8Locale = () => {
  const utf8Locale = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
  if (!process.env.LANG || !/utf-8/i.test(process.env.LANG)) process.env.LANG = utf8Locale;
  if (!process.env.LC_CTYPE || !/utf-8/i.test(process.env.LC_CTYPE)) process.env.LC_CTYPE = utf8Locale;
  if (!process.env.LC_ALL || !/utf-8/i.test(process.env.LC_ALL)) process.env.LC_ALL = utf8Locale;
};

// --- Manual Dotenv Loader ---
const loadEnv = () => {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        if (line && !line.startsWith('#') && line.includes('=')) {
          const [key, ...val] = line.split('=');
          process.env[key.trim()] = val.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch (err) {
      // Ignore EPERM/access errors if we can't read .env natively
    }
  }
};
loadEnv();
ensureUtf8Locale();

const handleMenu = async () => {
    const profiles = listProfiles().map((profile) => ({
        ...profile,
        rateLimits: getLatestQuotaSnapshot(profile.name)
    }));
    if (profiles.length === 0) { log('No profiles. Run cpl to add.'); return; }
    
    let activeName = '';
    try { activeName = path.basename(fs.readlinkSync(paths.codexDir)); } catch {}
    
    let index = 0;
    process.stdout.write('\x1Bc'); // Initial clear
    let blinkOn = true;
    renderMenu({ profiles, index, activeName, blinkOn, formatQuotaSummary, formatQuotaDetails });

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let onData;
    const cleanup = () => {
        if (onData) process.stdin.off('data', onData);
        clearInterval(blinkTimer);
        process.stdin.setRawMode(false);
        process.stdin.pause();
    };
    const getSelectedProfile = () => profiles[index];
    const activateSelectedProfile = () => {
        const selectedProfile = getSelectedProfile();
        cleanup();
        switchProfile(selectedProfile.name);
        success(`Activated: ${selectedProfile.name}`);
    };
    const openChat = async () => {
        cleanup();
        process.stdout.write('\n');
        await handleChat();
    };
    const checkIp = () => {
        cleanup();
        process.stdout.write('\n');
        spawnSync('node', [SCRIPT_PATH, 'check-ip'], { stdio: 'inherit', cwd: __dirname });
    };
    const confirmDeleteSelectedProfile = async () => {
        const selectedProfile = getSelectedProfile();
        cleanup();
        process.stdout.write('\n');
        const confirmed = await confirmAction(`Confirm delete [${selectedProfile.name}]? (y/n): `);
        if (confirmed) execSync(`rm -rf "${path.join(paths.profilesDir, selectedProfile.name)}"`);
    };
    const blinkTimer = setInterval(() => {
        blinkOn = !blinkOn;
        renderMenu({ profiles, index, activeName, blinkOn, formatQuotaSummary, formatQuotaDetails });
    }, 500);

    return new Promise((resolve) => {
        onData = async (key) => {
            if (key === '\u001b[A') { index = (index - 1 + profiles.length) % profiles.length; renderMenu({ profiles, index, activeName, blinkOn, formatQuotaSummary, formatQuotaDetails }); }
            else if (key === '\u001b[B') { index = (index + 1) % profiles.length; renderMenu({ profiles, index, activeName, blinkOn, formatQuotaSummary, formatQuotaDetails }); }
            else if (key === '\r') { activateSelectedProfile(); resolve(); }
            else if (key === 'q' || key === '\u0003') { cleanup(); resolve(); }
            else if (key === 'c') { await openChat(); resolve(); }
            else if (key === 'i') { checkIp(); resolve(); }
            else if (key === 'd') { await confirmDeleteSelectedProfile(); resolve(); }
        };
        process.stdin.on('data', onData);
    });
};

// -> Chat logic moved to chatService.js

// --- CLI ENTRY ---
const args = process.argv.slice(2);
const command = args[0] || 'menu';

switch (command) {
  case 'run': await runCodex(args.slice(1), false, true); break;
  case 'chat': await handleChat(); break;
  case 'menu': await handleMenu(); break;
  case 'quota':
    if (args[1] === '--all') {
        const profiles = listProfiles();
        if (profiles.length === 0) {
            error('No profiles found.');
            break;
        }
        profiles.forEach((profile) => {
            printQuotaReport(profile.name, getLatestQuotaSnapshot(profile.name));
        });
        break;
    }

    {
        const target = args[1] || getActiveProfileName();
        if (!target) {
            error('No active profile.');
            break;
        }
        let snapshot = getLatestQuotaSnapshot(target);
        if (!snapshot) {
            log(`${C.dim}No cached quota snapshot for [${target}]. Refreshing once...${C.reset}`);
            snapshot = await refreshQuotaSnapshot(target, true);
        }
        printQuotaReport(target, snapshot);
    }
    break;
  case 'login': {
    if (fs.existsSync(paths.codexDir) && fs.lstatSync(paths.codexDir).isSymbolicLink()) fs.unlinkSync(paths.codexDir);
    try {
        if (fs.lstatSync(paths.homeCodex).isSymbolicLink()) fs.unlinkSync(paths.homeCodex);
    } catch {}
    spawnSync('codex', ['login'], { stdio: 'inherit', cwd: __dirname });
    
    const rawName = await askQuestion(`Name to save: `);
    const name = rawName.trim();
    if (!name) break;
    
    if (!fs.existsSync(paths.profilesDir)) fs.mkdirSync(paths.profilesDir, { recursive: true });
    
    const targetPath = path.join(paths.profilesDir, name);
    try {
        if (fs.lstatSync(targetPath)) {
            success(`Profile [${name}] already exists or is a placeholder. Backing up...`);
            fs.renameSync(targetPath, `${targetPath}.bak-${Date.now()}`);
        }
    } catch {}
    
    // Check both potential locations for the new .codex
    let source = null;
    if (fs.existsSync(paths.codexDir) && !fs.lstatSync(paths.codexDir).isSymbolicLink()) source = paths.codexDir;
    else if (fs.existsSync(paths.homeCodex) && !fs.lstatSync(paths.homeCodex).isSymbolicLink()) source = paths.homeCodex;

    if (source) {
        fs.renameSync(source, targetPath);
        switchProfile(name); // This will link both as symlinks
        saveProfileData(name, { usageCount: 0 });
        success(`Saved [${name}] from ${source}.`);
        log(`${C.dim}Refreshing quota snapshot for [${name}]...${C.reset}`);
        const snapshot = await refreshQuotaSnapshot(name, true);
        printQuotaReport(name, snapshot);
    } else {
        error(`No new .codex directory found in project or home after login.`);
    }
    break;
  }
  case 'check-ip':
    try {
        const link = fs.readlinkSync(paths.codexDir);
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
    log(`Codex-Pro v7.2 | run, menu, chat, quota, login, set-proxy, health, init, memory`);
    log(`Options: --no-log, --no-map, --no-memory, --focus <keyword>`);
}
