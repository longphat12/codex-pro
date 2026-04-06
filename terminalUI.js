import readline from 'node:readline';

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bgBlue: '\x1b[44m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Ultimate 256-color palette
  pBg: '\x1b[48;5;234m',    // Darker gray background for prompt
  pTxt: '\x1b[38;5;255m',   // Pure white text
  pDim: '\x1b[38;5;244m',   // Muted gray for footer
  kw: '\x1b[38;5;75m',      // Keyword (Blueish)
  str: '\x1b[38;5;114m',    // String (Greenish)
  num: '\x1b[38;5;176m',    // Number (Purplish)
  com: '\x1b[38;5;244m',    // Comment (Gray)
  func: '\x1b[38;5;221m',   // Function (Yellowish)
  ln: '\x1b[38;5;239m',     // Line number (Subtle gray)
  lb: '\x1b[38;5;250m',     // Language label (Bright gray)
  sbBg: '\x1b[48;5;235m',   // Status bar background
  sbTxt: '\x1b[38;5;75m'    // Status bar primary text
};

export const log = (msg) => process.stdout.write(`${msg}\n`);
export const stripAnsi = (value = '') => String(value).replace(/\x1b\[[0-9;]*m/g, '');
export const visibleWidth = (value = '') => stripAnsi(value).length;
export const error = (msg) => process.stdout.write(`${C.red}Error: ${msg}${C.reset}\n`);
export const success = (msg) => process.stdout.write(`${C.green}✔ ${msg}${C.reset}\n`);

const padCell = (value, width, align = 'left') => {
  const text = String(value ?? '');
  const padding = Math.max(0, width - visibleWidth(text));
  if (align === 'right') return `${' '.repeat(padding)}${text}`;
  if (align === 'center') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
  }
  return `${text}${' '.repeat(padding)}`;
};

const drawTableBorder = (left, mid, right, widths) =>
  `${left}${widths.map((width) => '─'.repeat(width + 2)).join(mid)}${right}`;

const buildTableRow = (cells, widths) =>
  `│ ${cells.map((cell, idx) => padCell(cell, widths[idx])).join(' │ ')} │`;

const formatShortcut = (key, label) =>
  `${C.bold}${C.cyan}[${key}]${C.reset} ${label}`;

export const formatBrand = (blinkOn) =>
  blinkOn
    ? `${C.bold}${C.cyan}Codex-Pro${C.reset}`
    : `${C.bold}${C.dim}Codex-Pro${C.reset}`;

export const renderMenu = ({
  profiles,
  index,
  activeName,
  blinkOn = true,
  formatQuotaSummary,
  formatQuotaDetails
}) => {
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  const rows = profiles.map((profile) => {
    const isActive = profile.name === activeName;
    return {
      state: isActive ? `${C.green}ACTIVE${C.reset}` : `${C.dim}READY${C.reset}`,
      profile: profile.name,
      usage: String(profile.usageCount ?? 0),
      proxy: profile.proxy ? `${C.cyan}ON${C.reset}` : `${C.dim}OFF${C.reset}`,
      quota: formatQuotaSummary(profile.rateLimits)
    };
  });

  const widths = [
    Math.max('State'.length, ...rows.map((row) => visibleWidth(row.state))),
    Math.max('Profile'.length, ...rows.map((row) => visibleWidth(row.profile))),
    Math.max('Usage'.length, ...rows.map((row) => visibleWidth(row.usage))),
    Math.max('Proxy'.length, ...rows.map((row) => visibleWidth(row.proxy))),
    Math.max('Quota'.length, ...rows.map((row) => visibleWidth(row.quota)))
  ];

  const topBorder = drawTableBorder('┌', '┬', '┐', widths);
  const midBorder = drawTableBorder('├', '┼', '┤', widths);
  const bottomBorder = drawTableBorder('└', '┴', '┘', widths);

  const navigationLine = [
    formatShortcut('↑/↓', 'Move'),
    formatShortcut('Enter', 'Activate')
  ].join(` ${C.dim}|${C.reset} `);

  const actionLine = [
    formatShortcut('c', 'Chat'),
    formatShortcut('i', 'Check IP'),
    formatShortcut('l', 'Login'),
    formatShortcut('d', 'Delete'),
    formatShortcut('q', 'Quit')
  ].join(` ${C.dim}|${C.reset} `);

  process.stdout.write(`\n ${formatBrand(blinkOn)} ${C.dim}Profile Manager${C.reset}\n`);
  process.stdout.write(` ${C.bold}Navigation${C.reset} ${C.dim}→${C.reset} ${navigationLine}\n`);
  process.stdout.write(` ${C.bold}Actions${C.reset}    ${C.dim}→${C.reset} ${actionLine}\n\n`);
  process.stdout.write(` ${topBorder}\n`);
  process.stdout.write(` ${buildTableRow([`${C.bold}State${C.reset}`, `${C.bold}Profile${C.reset}`, `${C.bold}Usage${C.reset}`, `${C.bold}Proxy${C.reset}`, `${C.bold}Quota${C.reset}`], widths)}\n`);
  process.stdout.write(` ${midBorder}\n`);

  profiles.forEach((profile, rowIndex) => {
    const isSelected = rowIndex === index;
    const row = rows[rowIndex];
    const prefix = isSelected ? `${C.cyan}${C.bold}▶${C.reset}` : ' ';
    const line = buildTableRow([row.state, row.profile, row.usage, row.proxy, row.quota], widths);
    if (isSelected) {
      process.stdout.write(`${prefix}${C.bgBlue}${C.white}${C.bold}${line}${C.reset}\n`);
    } else {
      process.stdout.write(`${prefix}${line}\n`);
    }
  });

  const selected = profiles[index];
  process.stdout.write(` ${bottomBorder}\n`);
  process.stdout.write(`\n ${C.cyan}${C.bold}Selected:${C.reset} ${selected?.name || '-'}  ${C.green}${C.bold}Active:${C.reset} ${activeName || 'None'}\n`);
  process.stdout.write(` ${C.dim}${formatQuotaDetails(selected?.rateLimits)}${C.reset}\n`);
  process.stdout.write(` ${C.dim}Legend: ACTIVE = linked profile, highlighted row = current selection.${C.reset}\n`);
};
