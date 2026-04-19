const fs = require('fs');
const path = require('path');
const { getServerDataDir } = require('./storePaths');

const STORE_DIR = getServerDataDir();
const STORE_FILE = path.join(STORE_DIR, 'command-policy.json');

const DEFAULT_ALLOWED_BASE_COMMANDS = [
  'echo', 'printf', 'pwd', 'cd', 'ls', 'cat', 'tail', 'head',
  'grep', 'egrep', 'fgrep', 'awk', 'sed', 'cut', 'sort', 'uniq', 'wc', 'tr',
  'date', 'hostname', 'uptime', 'whoami', 'id', 'uname', 'env', 'printenv',
  'ps', 'pstree', 'top', 'free', 'df', 'du', 'vmstat', 'iostat', 'sar', 'mpstat', 'pidstat',
  'ss', 'netstat', 'lsof', 'journalctl', 'dmesg', 'systemctl', 'service',
  'curl', 'ping', 'telnet', 'nc', 'nslookup', 'dig', 'traceroute',
  'ip', 'ifconfig', 'route', 'find', 'stat', 'file', 'blkid', 'lsblk', 'fdisk',
  'mysql', 'psql', 'redis-cli',
  'python', 'python3',
];

const BLOCKED_RULES = [
  { id: 'rm_rf', re: /rm\s+-rf/i, reason: '禁止删除文件或目录' },
  { id: 'mkfs', re: /mkfs/i, reason: '禁止格式化磁盘' },
  { id: 'dd_if', re: /dd\s+if=/i, reason: '禁止直接写盘或镜像覆盖' },
  { id: 'reboot', re: /\b(reboot|shutdown|poweroff)\b/i, reason: '禁止重启或关机' },
  { id: 'init_06', re: /\b(init\s+[06])\b/i, reason: '禁止切换运行级别' },
  { id: 'fork_bomb', re: /:(\s*)\{\s*\|\|\s*:\s*\&\s*\}\s*;\s*:/, reason: '禁止 fork bomb' },
  { id: 'redirect', re: /(^|[^0-9])>>?|<<|<(?!=)/, reason: '禁止输入输出重定向' },
  { id: 'subshell', re: /`[^`]*`|\$\(/, reason: '禁止命令替换' },
  { id: 'permission_mutation', re: /\b(chmod|chown|chgrp|useradd|userdel|groupadd|groupdel|passwd|su)\b/i, reason: '禁止账户或权限修改' },
  { id: 'fs_mutation', re: /\b(mv|cp|install|ln|mkdir|rmdir|touch|truncate)\b/i, reason: '禁止文件系统修改' },
  { id: 'kill_process', re: /\b(kill|pkill|killall)\b/i, reason: '禁止结束进程' },
  { id: 'mount_change', re: /\b(mount|umount)\b/i, reason: '禁止挂载或卸载设备' },
  { id: 'file_transfer', re: /\b(scp|rsync|sftp)\b/i, reason: '禁止文件传输' },
  { id: 'tee_write', re: /\btee\b/i, reason: '禁止写入输出到文件' },
];

let policyState = null;

function normalizeCommandName(input) {
  const value = path.basename(String(input || '').trim()).toLowerCase();
  if (!value) throw new Error('命令名不能为空');
  if (!/^[a-z0-9][a-z0-9+._-]*$/.test(value)) {
    throw new Error(`非法命令名: ${input}`);
  }
  return value;
}

function uniqueCommands(values) {
  const deduped = new Set();
  for (const value of values || []) {
    deduped.add(normalizeCommandName(value));
  }
  return Array.from(deduped).sort();
}

function buildDefaultPolicy() {
  return {
    allowedBaseCommands: uniqueCommands(DEFAULT_ALLOWED_BASE_COMMANDS),
  };
}

function ensureStore() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(buildDefaultPolicy(), null, 2), 'utf8');
  }
}

function loadPolicyFromDisk() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      allowedBaseCommands: Array.isArray(parsed.allowedBaseCommands) && parsed.allowedBaseCommands.length > 0
        ? uniqueCommands(parsed.allowedBaseCommands)
        : buildDefaultPolicy().allowedBaseCommands,
    };
  } catch {
    return buildDefaultPolicy();
  }
}

function getPolicyState() {
  if (!policyState) {
    policyState = loadPolicyFromDisk();
  }
  return policyState;
}

function persistPolicy(nextPolicy) {
  policyState = {
    allowedBaseCommands: uniqueCommands(nextPolicy.allowedBaseCommands),
  };
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(policyState, null, 2), 'utf8');
  return policyState;
}

function splitOutsideQuotes(input) {
  const segments = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === '\'') {
      current += ch;
      quote = ch;
      continue;
    }

    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i += 1;
      continue;
    }

    if (ch === '|' || ch === ';' || ch === '\n') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function tokenizeShell(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function extractCommandInfo(segment) {
  const tokens = tokenizeShell(segment);
  let index = 0;

  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
    index += 1;
  }

  if (tokens[index] === 'sudo') {
    index += 1;
    while (index < tokens.length && tokens[index].startsWith('-')) {
      const opt = tokens[index];
      index += 1;
      if (['-u', '-g', '-h', '-p'].includes(opt) && index < tokens.length) {
        index += 1;
      }
    }
  }

  const binaryToken = tokens[index] || '';
  const binary = path.basename(binaryToken).toLowerCase();
  return { tokens, binary, binaryToken, index };
}

function validateSpecialCases(info, rawSegment) {
  const lowerSegment = rawSegment.toLowerCase();

  if (!info.binary) {
    return { ok: false, reason: '无法识别命令入口' };
  }

  if (info.binary === 'sed' && info.tokens.includes('-i')) {
    return { ok: false, reason: 'sed -i 会修改文件，不在白名单内' };
  }

  if (info.binary === 'find' && info.tokens.some((token) => token === '-exec' || token === '-delete')) {
    return { ok: false, reason: 'find -exec/-delete 可能执行或删除内容，不在白名单内' };
  }

  if (info.binary === 'top' && !info.tokens.some((token) => token.includes('b'))) {
    return { ok: false, reason: 'top 仅允许批处理模式，例如 top -bn1' };
  }

  if (info.binary === 'systemctl') {
    const allowedSubs = new Set(['status', 'show', 'list-units', 'list-sockets', 'is-active', 'cat']);
    const sub = info.tokens[info.index + 1] || '';
    if (!allowedSubs.has(sub)) {
      return { ok: false, reason: `systemctl 仅允许 ${Array.from(allowedSubs).join(', ')}` };
    }
  }

  if (info.binary === 'service') {
    const sub = info.tokens[info.index + 2] || '';
    if (sub && sub !== 'status') {
      return { ok: false, reason: 'service 仅允许 status 查询' };
    }
  }

  if (info.binary === 'curl') {
    if (/\s(-X|--request)\s+(POST|PUT|PATCH|DELETE)\b/i.test(rawSegment)) {
      return { ok: false, reason: 'curl 仅允许只读请求，禁止写操作方法' };
    }
    if (/\s(-d|--data|--data-binary|--form|--upload-file|-T)\b/i.test(rawSegment)) {
      return { ok: false, reason: 'curl 禁止发送写入型请求体' };
    }
    if (/\s(-o|--output|-O|--remote-name)\b/i.test(rawSegment)) {
      return { ok: false, reason: 'curl 禁止将结果写入文件' };
    }
  }

  if (info.binary === 'python' || info.binary === 'python3') {
    if (!/\s-m\s+json\.tool\b/i.test(` ${rawSegment}`)) {
      return { ok: false, reason: 'python/python3 仅允许 -m json.tool 只读格式化用法' };
    }
  }

  if (info.binary === 'mysql') {
    if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(lowerSegment)) {
      return { ok: false, reason: 'mysql 仅允许只读查询，禁止写操作 SQL' };
    }
  }

  if (info.binary === 'psql') {
    if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(lowerSegment)) {
      return { ok: false, reason: 'psql 仅允许只读查询，禁止写操作 SQL' };
    }
  }

  return { ok: true };
}

function validateCommandPolicy(command, context = 'service') {
  const raw = String(command || '').trim();
  if (!raw) {
    return { ok: false, reason: '命令不能为空', context };
  }

  for (const blocked of BLOCKED_RULES) {
    if (blocked.re.test(raw)) {
      return { ok: false, reason: blocked.reason, context, blockedRuleId: blocked.id };
    }
  }

  const segments = splitOutsideQuotes(raw);
  if (!segments.length) {
    return { ok: false, reason: '未解析到可执行命令段', context };
  }

  const allowedCommands = new Set(getPolicyState().allowedBaseCommands);

  for (const segment of segments) {
    const info = extractCommandInfo(segment);
    if (!allowedCommands.has(info.binary)) {
      return {
        ok: false,
        reason: `命令 "${info.binary || segment}" 不在服务端白名单内`,
        context,
        segment,
      };
    }

    const special = validateSpecialCases(info, segment);
    if (!special.ok) {
      return {
        ok: false,
        reason: special.reason,
        context,
        segment,
      };
    }
  }

  return { ok: true, context, segments };
}

function assertCommandAllowed(command, context = 'service') {
  const result = validateCommandPolicy(command, context);
  if (!result.ok) {
    const err = new Error(`[Command Policy Block] ${result.reason}: ${command}`);
    err.code = 'COMMAND_POLICY_BLOCKED';
    err.details = result;
    throw err;
  }
  return result;
}

function getCommandPolicySnapshot() {
  const current = getPolicyState();
  const defaults = buildDefaultPolicy();
  const currentSet = new Set(current.allowedBaseCommands);
  const defaultSet = new Set(defaults.allowedBaseCommands);

  return {
    storeFile: STORE_FILE,
    allowedBaseCommands: [...current.allowedBaseCommands],
    defaultAllowedBaseCommands: [...defaults.allowedBaseCommands],
    customAddedCommands: current.allowedBaseCommands.filter((cmd) => !defaultSet.has(cmd)),
    customRemovedCommands: defaults.allowedBaseCommands.filter((cmd) => !currentSet.has(cmd)),
    blockedRules: BLOCKED_RULES.map((rule) => ({ id: rule.id, reason: rule.reason })),
  };
}

function replaceAllowedBaseCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('allowedBaseCommands 不能为空数组');
  }
  persistPolicy({ allowedBaseCommands: commands });
  return getCommandPolicySnapshot();
}

function addAllowedBaseCommand(command) {
  const normalized = normalizeCommandName(command);
  const current = getPolicyState();
  if (!current.allowedBaseCommands.includes(normalized)) {
    persistPolicy({
      allowedBaseCommands: [...current.allowedBaseCommands, normalized],
    });
  }
  return getCommandPolicySnapshot();
}

function removeAllowedBaseCommand(command) {
  const normalized = normalizeCommandName(command);
  const current = getPolicyState();
  const next = current.allowedBaseCommands.filter((item) => item !== normalized);
  if (next.length === current.allowedBaseCommands.length) {
    throw new Error(`命令 "${normalized}" 不存在于白名单中`);
  }
  if (next.length === 0) {
    throw new Error('白名单不能为空');
  }
  persistPolicy({ allowedBaseCommands: next });
  return getCommandPolicySnapshot();
}

function resetCommandPolicy() {
  persistPolicy(buildDefaultPolicy());
  return getCommandPolicySnapshot();
}

module.exports = {
  STORE_FILE,
  addAllowedBaseCommand,
  assertCommandAllowed,
  getCommandPolicySnapshot,
  removeAllowedBaseCommand,
  replaceAllowedBaseCommands,
  resetCommandPolicy,
  validateCommandPolicy,
};
