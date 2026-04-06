import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './cryptoHelper.js';
import { error, log, success } from './terminalUI.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = homedir();

export const paths = {
  rootDir: __dirname,
  codexDir: path.join(__dirname, '.codex'),
  homeCodex: path.join(HOME, '.codex'),
  profilesDir: path.join(__dirname, '.codex_profiles')
};

export const saveProfileData = (name, data) => {
  const profilePath = path.join(paths.profilesDir, name);
  try {
    if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath, { recursive: true });
    if (!fs.statSync(profilePath).isDirectory()) {
      error(`${profilePath} exists but is not a directory.`);
      return;
    }
    fs.writeFileSync(path.join(profilePath, 'metadata.json'), encrypt(JSON.stringify(data, null, 2)));
  } catch (err) {
    error(`Failed to save profile data for ${name}: ${err.message}`);
  }
};

export const getProfileData = (name) => {
  const profilePath = path.join(paths.profilesDir, name);
  const dataPath = path.join(profilePath, 'metadata.json');
  if (fs.existsSync(dataPath)) {
    const raw = fs.readFileSync(dataPath, 'utf8');
    try {
      return JSON.parse(decrypt(raw));
    } catch (err) {
      if (raw.startsWith('{')) {
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
  return { usageCount: 0, status: 'Ready', proxy: null, lastProxy: null };
};

export const listProfiles = () => {
  if (!fs.existsSync(paths.profilesDir)) return [];
  return fs.readdirSync(paths.profilesDir)
    .filter((entry) => {
      if (entry.includes('.bak-')) return false;
      try {
        return fs.statSync(path.join(paths.profilesDir, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((name) => ({ name, ...getProfileData(name) }));
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
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
    }
  };

  walk(dir);
  return files;
};

export const getLatestQuotaSnapshot = (name) => {
  const sessionsDir = path.join(paths.profilesDir, name, 'sessions');
  const sessionFiles = getSessionFiles(sessionsDir).sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });

  for (const file of sessionFiles) {
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index--) {
        const parsed = JSON.parse(lines[index]);
        const rateLimits = parsed?.payload?.rate_limits;
        if (rateLimits?.primary || rateLimits?.secondary) return rateLimits;
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

export const formatQuotaSummary = (rateLimits) => {
  if (!rateLimits) return 'No data';
  const primaryLabel = formatWindowLabel(rateLimits.primary?.window_minutes);
  const secondaryLabel = formatWindowLabel(rateLimits.secondary?.window_minutes);
  const parts = [formatQuotaItem(primaryLabel, rateLimits.primary)];
  if (rateLimits.secondary) parts.push(formatQuotaItem(secondaryLabel, rateLimits.secondary));
  return parts.join(' ');
};

export const formatQuotaDetails = (rateLimits) => {
  if (!rateLimits) return 'Quota: No recent data';

  const details = [];
  if (rateLimits.primary) {
    details.push(
      `${formatWindowLabel(rateLimits.primary.window_minutes)} ${getRemainingPercent(rateLimits.primary)}% left · resets in ${formatTimeUntilReset(rateLimits.primary.resets_at)}`
    );
  }
  if (rateLimits.secondary) {
    details.push(
      `${formatWindowLabel(rateLimits.secondary.window_minutes)} ${getRemainingPercent(rateLimits.secondary)}% left · resets in ${formatTimeUntilReset(rateLimits.secondary.resets_at)}`
    );
  }

  const plan = rateLimits.plan_type ? `Plan: ${rateLimits.plan_type}` : 'Plan: unknown';
  return `Quota: ${details.join(' | ')} | ${plan}`;
};

export const getActiveProfileName = () => {
  for (const linkPath of [paths.codexDir, paths.homeCodex]) {
    try {
      const stats = fs.lstatSync(linkPath);
      if (!stats.isSymbolicLink()) continue;
      return path.basename(fs.readlinkSync(linkPath));
    } catch {}
  }
  return null;
};

const syncProfileLink = (linkPath, profilePath) => {
  let stats = null;

  try {
    stats = fs.lstatSync(linkPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (stats?.isSymbolicLink()) {
    const currentTarget = fs.readlinkSync(linkPath);
    if (path.resolve(path.dirname(linkPath), currentTarget) === path.resolve(profilePath)) return;
    fs.unlinkSync(linkPath);
  } else if (stats?.isDirectory()) {
    if (linkPath === paths.homeCodex) {
      const recoveredName = `recovered_session_${Date.now()}`;
      const recoveredPath = path.join(paths.profilesDir, recoveredName);
      if (!fs.existsSync(paths.profilesDir)) fs.mkdirSync(paths.profilesDir, { recursive: true });
      fs.renameSync(linkPath, recoveredPath);
      saveProfileData(recoveredName, { usageCount: 0, status: 'Recovered' });
      success(`Migrated existing ~/.codex to profile [${recoveredName}]`);
    } else {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  } else if (stats) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }

  try {
    fs.symlinkSync(profilePath, linkPath, 'dir');
  } catch (err) {
    if (err.code === 'EEXIST') {
      const currentStats = fs.lstatSync(linkPath);
      if (currentStats.isSymbolicLink()) {
        const currentTarget = fs.readlinkSync(linkPath);
        if (path.resolve(path.dirname(linkPath), currentTarget) === path.resolve(profilePath)) return;
      }
    }
    throw err;
  }
};

export const switchProfile = (name) => {
  const profilePath = path.join(paths.profilesDir, name);
  syncProfileLink(paths.codexDir, profilePath);
  syncProfileLink(paths.homeCodex, profilePath);
  const profileData = getProfileData(name);
  process.env.HTTP_PROXY = profileData.proxy || '';
  process.env.HTTPS_PROXY = profileData.proxy || '';
  process.env.ALL_PROXY = profileData.proxy || '';
  return true;
};

export const printQuotaReport = (name, rateLimits) => {
  const title = name ? `[${name}] ` : '';
  if (!rateLimits) {
    log(`${title}Quota: No recent data`);
    return;
  }
  log(`${title}${formatQuotaDetails(rateLimits)}`);
};

export const refreshQuotaSnapshot = async (name, silent = false) => {
  if (!name) return null;

  const previousActive = getActiveProfileName();
  try {
    switchProfile(name);
  } catch (err) {
    if (!silent) error(`Failed to switch profile for quota refresh: ${err.message}`);
    return getLatestQuotaSnapshot(name);
  }

  try {
    const child = spawnSync(
      'codex',
      ['exec', '--skip-git-repo-check', 'Reply with exactly: OK'],
      {
        stdio: silent ? 'ignore' : 'inherit',
        env: process.env,
        cwd: paths.rootDir,
        timeout: 45000
      }
    );

    if (child.error && !silent) error(`Quota refresh failed: ${child.error.message}`);
  } finally {
    if (previousActive && previousActive !== name) {
      try {
        switchProfile(previousActive);
      } catch {}
    }
  }

  return getLatestQuotaSnapshot(name);
};
