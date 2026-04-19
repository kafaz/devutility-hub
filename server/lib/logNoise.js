const RISK_SIGNAL_RE = /timeout|timed out|超时|refused|拒绝|panic|fatal|exception|异常|failed|失败|error|reset|segfault|readonly|read-only|unreachable|i\/o|oom/i;

const BUILTIN_LOG_NOISE_RULES = [
  {
    id: 'bracket-info-prefix',
    label: '[INFO] 前缀',
    pattern: /^\s*\[info\](?=\s|:|-|$)/i,
  },
  {
    id: 'plain-info-prefix',
    label: 'INFO 前缀',
    pattern: /^\s*(?:\d{4}[-/]\d{2}[-/]\d{2}[ t]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+)?info(?=\s|:|-|$)/i,
  },
  {
    id: 'info-level-pair',
    label: 'level=info',
    pattern: /\b(?:level|lvl|severity)\s*=\s*info\b/i,
  },
];

const LOW_SIGNAL_SESSION_LOG_TYPES = new Set([
  'command_started',
  'session_opened',
  'session_reused',
  'session_closed',
]);

function normalizeNoiseKeyword(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNoiseKeywords(values = []) {
  return Array.from(new Set(values.map(normalizeNoiseKeyword).filter(Boolean)));
}

function matchLogNoise(text, customKeywords = []) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return null;
  if (RISK_SIGNAL_RE.test(normalizedText)) return null;

  for (const rule of BUILTIN_LOG_NOISE_RULES) {
    if (rule.pattern.test(normalizedText)) {
      return {
        kind: 'builtin',
        id: rule.id,
        label: rule.label,
      };
    }
  }

  const lowered = normalizedText.toLowerCase();
  const keyword = normalizeNoiseKeywords(customKeywords).find((item) => lowered.includes(item));
  if (!keyword) return null;

  return {
    kind: 'custom',
    id: `custom:${keyword}`,
    label: keyword,
  };
}

function shouldSuppressLogLine(text, customKeywords = []) {
  return Boolean(matchLogNoise(text, customKeywords));
}

function filterNoiseText(text, customKeywords = []) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let suppressedCount = 0;

  lines.forEach((line) => {
    if (!line.trim()) {
      kept.push(line);
      return;
    }
    if (shouldSuppressLogLine(line, customKeywords)) {
      suppressedCount += 1;
      return;
    }
    kept.push(line);
  });

  return {
    text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    suppressedCount,
  };
}

function shouldSuppressSessionLog(log, customKeywords = []) {
  if (typeof log?.exitCode === 'number' && log.exitCode !== 0) return false;
  if (log?.level === 'warning' || log?.level === 'error') return false;
  if (LOW_SIGNAL_SESSION_LOG_TYPES.has(String(log?.type || ''))) return true;

  const combined = [log?.message, log?.stdout, log?.stderr].filter(Boolean).join('\n');
  if (!combined.trim()) {
    return log?.level === 'info';
  }

  return shouldSuppressLogLine(combined, customKeywords);
}

module.exports = {
  BUILTIN_LOG_NOISE_RULES,
  LOW_SIGNAL_SESSION_LOG_TYPES,
  RISK_SIGNAL_RE,
  filterNoiseText,
  matchLogNoise,
  normalizeNoiseKeyword,
  normalizeNoiseKeywords,
  shouldSuppressLogLine,
  shouldSuppressSessionLog,
};
