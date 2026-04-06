import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { behavior } from './behavior.js';
import { fingerprint } from './fingerprint.js';
import { memoryManager } from './memoryManager.js';
import { projectMap } from './projectMap.js';
import { proxyManager } from './proxyManager.js';
import { rules } from './rules.js';
import { C, error, log } from './terminalUI.js';
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
const QUOTA_ERROR_PATTERN = /\b(rate limit(?:ed)?|quota|usage limit|too many requests|exceeded|limit reached|insufficient quota|resource exhausted|capacity|429|credits?\b|billing\b)\b/i;

const estimateTokens = (str) => Math.ceil(str.length / 4);

const isQuotaLikeFailure = (text = '') => QUOTA_ERROR_PATTERN.test(String(text).toLowerCase());
const createChatTranscriptPath = () => path.join(
  tmpdir(),
  `codex-pro-chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.log`
);

export const getActiveProfileName = () => {
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
    wantsContinuation,
    useMinimalRules,
    strategy
  };
};

const extractFinalResponse = (stdoutBuffer) => {
  const startMarker = 'codex\n';
  const startIndex = stdoutBuffer.indexOf(startMarker);
  let cleanOutput = startIndex !== -1 ? stdoutBuffer.substring(startIndex + startMarker.length) : stdoutBuffer;

  const endMarker = '\ntokens used';
  const endIndex = cleanOutput.indexOf(endMarker);
  if (endIndex !== -1) cleanOutput = cleanOutput.substring(0, endIndex);

  return cleanOutput.trim();
};

const highlightCode = (text, lang = 'CODE') => {
  const lines = text.split(/\r?\n/);
  const regex = /(\/\/.+)|(["'`].*?["'`])|\b(const|let|var|function|class|if|else|return|import|export|from|switch|case|break|continue|try|catch|finally|async|await|static|private|public|protected|new|throw|extends|implements|namespace|use)\b|\b([a-zA-Z0-9_]+)(?=\()|\b(\d+)\b/g;

  const highlightedLines = lines.map((line, index) => {
    const coloredText = line.replace(regex, (match, comment, str, keyword, func, num) => {
      if (comment) return `${C.com}${match}${C.reset}`;
      if (str) return `${C.str}${match}${C.reset}`;
      if (keyword) return `${C.kw}${match}${C.reset}`;
      if (func) return `${C.func}${match}${C.reset}`;
      if (num) return `${C.num}${match}${C.reset}`;
      return match;
    });

    const lineNumber = String(index + 1).padStart(3, ' ');
    return ` ${C.ln}${lineNumber}${C.reset} │ ${coloredText}`;
  });

  return `\n${C.pBg}${C.lb} [${lang.toUpperCase()}] ${C.reset}\n${C.pBg}${highlightedLines.join(`\n${C.pBg}`)}${C.reset}\n`;
};

const streamResponse = async (text) => {
  const lines = text.split('\n');
  for (const line of lines) {
    for (const char of line) {
      process.stdout.write(char);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    process.stdout.write('\n');
  }
};

const renderCliResponse = async (response) => {
  process.stdout.write(`\n${C.white}•${C.reset} `);
  const parts = response.split(/(```[\s\S]*?```)/g);

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('```')) {
      const match = part.match(/```(\w+)?([\s\S]*?)```/);
      const lang = match?.[1] || 'CODE';
      const content = match?.[2]?.trim() || '';
      process.stdout.write(highlightCode(content, lang));
    } else if (part.trim()) {
      await streamResponse(part.trim());
    }
  }

  process.stdout.write('\n');
};

export const runCodex = async (args, silent = false, writeMode = false, options = {}) => {
  const {
    onStatus,
    onResponse,
    onError,
    onRotate,
    onContext,
    returnDetails = false,
    suppressOutput = false
  } = options;

  const noLog = args.includes('--no-log') || silent;
  const noMap = args.includes('--no-map');
  const noMemory = args.includes('--no-memory');
  const lowTokenEnabled = args.includes('--low-token');
  const writeModeEnabled = writeMode || args.includes('--write');

  let focus = null;
  const focusIndex = args.indexOf('--focus');
  if (focusIndex !== -1 && args[focusIndex + 1]) {
    focus = args[focusIndex + 1];
  }

  const cleanArgs = args.filter((arg, index) => {
    if (['--no-log', '--no-map', '--no-memory', '--focus', '--no-rules', '--low-token', '--write'].includes(arg)) return false;
    if (index > 0 && args[index - 1] === '--focus') return false;
    return true;
  });

  const userPrompt = cleanArgs.join(' ');

  if (!getActiveProfileName()) {
    if (!suppressOutput) error('No active profile.');
    return returnDetails ? { code: 1, response: '', stderr: 'No active profile.' } : 1;
  }

  const contextPlan = buildContextPlan({
    userPrompt,
    noMap,
    noMemory,
    focus,
    lowToken: lowTokenEnabled,
    writeModeEnabled
  });

  if (contextPlan.includeMap) projectMap.ensure();

  let historyContext = contextPlan.includeMemory ? memoryManager.getRelevantSerialized(userPrompt) : '';
  let mapContext = contextPlan.includeMap ? projectMap.getSummary(contextPlan.autoFocus, contextPlan.mapMode) : '';
  let nextPrompt = userPrompt;
  const systemContext = `${contextPlan.baseRules}\n\nExecution mode:\n- ${contextPlan.strategy}`;

  const maxHistoryTokens = lowTokenEnabled ? 300 : 600;
  const maxMapTokens = contextPlan.mapMode === 'expanded' ? 900 : 500;
  const maxUserTokens = 4000;

  if (estimateTokens(historyContext) > maxHistoryTokens) {
    historyContext = historyContext.substring(historyContext.length - (maxHistoryTokens * 4));
  }
  if (estimateTokens(mapContext) > maxMapTokens) {
    mapContext = mapContext.substring(0, maxMapTokens * 4);
  }
  if (estimateTokens(nextPrompt) > maxUserTokens) {
    nextPrompt = nextPrompt.substring(0, maxUserTokens * 4);
  }

  const buildPrompt = (mapCtx, historyCtx, request) =>
    `${systemContext}\n\n${mapCtx}\n${historyCtx}\n--- NEW REQUEST ---\n${request}`;

  let finalPrompt = buildPrompt(mapContext, historyContext, nextPrompt);
  const maxPromptSize = 64 * 1024;

  if (finalPrompt.length > maxPromptSize) {
    if (!silent && !suppressOutput) {
      log(`${C.yellow}Warning: Total prompt too large (${finalPrompt.length}). Truncating...${C.reset}`);
    }

    const basePrompt = buildPrompt('', '', nextPrompt);
    if (basePrompt.length >= maxPromptSize) {
      const reservedHeader = `${systemContext}\n\n--- NEW REQUEST ---\n`;
      const remainingForUser = Math.max(0, maxPromptSize - reservedHeader.length);
      finalPrompt = `${reservedHeader}${nextPrompt.substring(nextPrompt.length - remainingForUser)}`;
    } else {
      const remainingForContext = maxPromptSize - basePrompt.length;
      const combinedContext = `${mapContext}\n${historyContext}`.trim();
      const trimmedContext = combinedContext
        ? combinedContext.substring(Math.max(0, combinedContext.length - remainingForContext))
        : '';
      finalPrompt = buildPrompt(trimmedContext, '', nextPrompt);
    }
  }

  const contextSummary = {
    mode: [
      contextPlan.includeMap ? `Map:${contextPlan.mapMode}${contextPlan.autoFocus ? `:${contextPlan.autoFocus}` : ''}` : 'Map:off',
      historyContext ? `Hist:${contextPlan.wantsContinuation ? 'follow-up' : 'relevant'}` : 'Hist:off',
      contextPlan.useMinimalRules ? 'Rules:min' : 'Rules:full'
    ].join(' | '),
    tokens: estimateTokens(finalPrompt),
    mapTokens: estimateTokens(mapContext),
    historyTokens: estimateTokens(historyContext),
    userTokens: estimateTokens(nextPrompt)
  };

  if (!silent && !suppressOutput) {
    log(`${C.dim}[Context: ${contextSummary.mode}]${C.reset}`);
    log(`${C.dim}[Tokens: ~${contextSummary.tokens} | Map=${contextSummary.mapTokens}, Hist=${contextSummary.historyTokens}, User=${contextSummary.userTokens}]${C.reset}`);
  }
  onContext?.(contextSummary);

  const execute = async (retries = 0) => {
    const profiles = listProfiles();
    const currentProfile = getActiveProfileName();

    if (!currentProfile) {
      if (!suppressOutput) error('No active profile.');
      return { code: 1, response: '', stderr: 'No active profile.' };
    }

    if (noLog) {
      process.env.HISTSIZE = '0';
      process.env.HISTFILE = '/dev/null';
    }

    const headers = fingerprint.getHeaders();
    process.env.USER_AGENT = headers['User-Agent'];

    const profileData = getProfileData(currentProfile);
    const proxy = proxyManager.getProxy() || profileData.proxy;
    if (proxy && proxy !== profileData.lastProxy) {
      const message = `Proxy changed: ${proxy}. Session may need refresh.`;
      if (!silent && !suppressOutput) log(`${C.yellow}${message}${C.reset}`);
      onStatus?.(message);
      profileData.lastProxy = proxy;
      saveProfileData(currentProfile, profileData);
    }

    if (!silent) await behavior.sleep();

    if (!noLog && !suppressOutput) {
      log(`${C.dim}--- [${C.blue}${currentProfile}${C.reset}${C.dim}] ---${C.reset}`);
    }

    onStatus?.(`Running with profile ${currentProfile}...`);

    return new Promise((resolve) => {
      const codexArgs = ['exec', '--skip-git-repo-check'];
      if (writeModeEnabled) {
        codexArgs.push('-c', 'sandbox_mode="danger-full-access"');
        codexArgs.push('-c', 'approval_policy="never"');
      }
      codexArgs.push(finalPrompt);

      const child = spawn('codex', codexArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let spinnerFrame = 0;

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
      });

      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk;
      });

      child.stdin.end();

      const spinnerTimer = !suppressOutput
        ? setInterval(() => {
            const dots = '.'.repeat(spinnerFrame % 4).padEnd(4, ' ');
            process.stdout.write(`\r${C.cyan}•${C.reset} Thinking${dots}`);
            spinnerFrame += 1;
          }, 200)
        : null;

      const statusTimer = suppressOutput
        ? setInterval(() => {
            onStatus?.(`Thinking${'.'.repeat(spinnerFrame % 4)}`);
            spinnerFrame += 1;
          }, 400)
        : null;

      const timer = setTimeout(() => {
        if (spinnerTimer) clearInterval(spinnerTimer);
        if (statusTimer) clearInterval(statusTimer);
        child.kill();
        const timeoutMessage = 'Command timed out (5min)';
        if (!noLog && !suppressOutput) error(timeoutMessage);
        onError?.(timeoutMessage);
        resolve({ code: 124, response: '', stderr: timeoutMessage });
      }, 300000);

      child.on('close', async (code) => {
        if (spinnerTimer) {
          clearInterval(spinnerTimer);
          process.stdout.write('\r\x1b[K');
        }
        if (statusTimer) clearInterval(statusTimer);
        clearTimeout(timer);

        if (code === 0) {
          const finalResponse = extractFinalResponse(stdoutBuffer);

          if (finalResponse) {
            if (!suppressOutput) {
              await renderCliResponse(finalResponse);
            }
            await onResponse?.(finalResponse);
          }

          memoryManager.addExchange(userPrompt, '[Success]');
          projectMap.logChange(currentProfile, 'use');

          const nextProfileData = getProfileData(currentProfile);
          nextProfileData.usageCount++;
          saveProfileData(currentProfile, nextProfileData);

          resolve({ code: 0, response: finalResponse, stderr: stderrBuffer });
          return;
        }

        if (code !== 130 && retries < profiles.length - 1) {
          const index = profiles.findIndex((profile) => profile.name === currentProfile);
          const nextProfile = profiles[(index + 1) % profiles.length].name;
          const jitter = behavior.getDelay();
          const rotateMessage = `Rotating to [${nextProfile}] in ${jitter / 1000}s...`;

          if (!suppressOutput) log(`\n${C.yellow}${rotateMessage}${C.reset}`);
          onRotate?.({ from: currentProfile, to: nextProfile, delayMs: jitter, stderr: stderrBuffer });
          await new Promise((resolveDelay) => setTimeout(resolveDelay, jitter));
          switchProfile(nextProfile);
          resolve(await execute(retries + 1));
          return;
        }

        if (stderrBuffer && !noLog && !suppressOutput) {
          process.stderr.write(`${C.red}${stderrBuffer}${C.reset}`);
        }

        onError?.(stderrBuffer || `Command failed with exit code ${code}`);
        resolve({ code, response: extractFinalResponse(stdoutBuffer), stderr: stderrBuffer });
      });
    });
  };

  const result = await execute();
  return returnDetails ? result : result.code;
};

export const handleChat = async () => {
  const initialProfile = getActiveProfileName();

  if (!initialProfile) {
    error('No active profile.');
    return;
  }

  const profiles = listProfiles().map((profile) => profile.name);
  const startIndex = Math.max(0, profiles.indexOf(initialProfile));
  const orderedProfiles = [
    ...profiles.slice(startIndex),
    ...profiles.slice(0, startIndex)
  ];

  let currentIndex = 0;

  while (currentIndex < orderedProfiles.length) {
    const currentProfile = orderedProfiles[currentIndex];
    switchProfile(currentProfile);

    const headers = fingerprint.getHeaders();
    process.env.USER_AGENT = headers['User-Agent'];

    const profileData = getProfileData(currentProfile);
    const proxy = profileData.proxy || proxyManager.getProxy() || '';
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
    process.env.ALL_PROXY = proxy;

    const proxyLabel = proxy ? 'proxy:on' : 'proxy:off';
    log(`${C.dim}Launching native Codex CLI [profile:${currentProfile} ${proxyLabel}]...${C.reset}`);

    const result = await new Promise((resolve) => {
      const transcriptPath = createChatTranscriptPath();
      const child = spawn('script', ['-q', transcriptPath, 'codex'], {
        stdio: 'inherit',
        env: process.env,
        cwd: process.cwd()
      });

      child.on('close', (code, signal) => {
        let transcript = '';
        try {
          transcript = fs.readFileSync(transcriptPath, 'utf8');
          fs.rmSync(transcriptPath, { force: true });
        } catch {}
        resolve({ code, signal, transcript });
      });

      child.on('error', (err) => {
        error(`Failed to launch Codex CLI: ${err.message}`);
        resolve({ code: 1, signal: null, transcript: err.message, launchError: true });
      });
    });

    if (result.signal) {
      log(`${C.dim}Codex CLI exited via signal ${result.signal}.${C.reset}`);
      return;
    }

    if (result.launchError) return;

    if (result.code === 0 || result.code === 130) {
      log(`${C.dim}Returned from native Codex CLI.${C.reset}`);
      return;
    }

    const quotaLikeError = isQuotaLikeFailure(result.transcript || '');
    const hasNextProfile = currentIndex < orderedProfiles.length - 1;

    if (quotaLikeError && hasNextProfile) {
      const nextProfile = orderedProfiles[currentIndex + 1];
      log(`${C.yellow}Quota/rate-limit detected. Rotating from [${currentProfile}] to [${nextProfile}]...${C.reset}`);
      currentIndex += 1;
      continue;
    }

    error(`Codex CLI exited with code ${result.code}.`);
    return;
  }

  error('No remaining profile available after quota/rate-limit rotation.');
};
