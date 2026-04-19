export interface BuiltinLogNoiseRule {
  id: string;
  label: string;
  pattern: RegExp;
}

export const RISK_SIGNAL_RE = /timeout|timed out|超时|refused|拒绝|panic|fatal|exception|异常|failed|失败|error|reset|segfault|readonly|read-only|unreachable|i\/o|oom/i;

export const BUILTIN_LOG_NOISE_RULES: BuiltinLogNoiseRule[] = [
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

export interface NoiseMatch {
  kind: 'builtin' | 'custom';
  id: string;
  label: string;
}

export function normalizeNoiseKeyword(value: string) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeNoiseKeywords(values: string[] = []) {
  return Array.from(new Set(values.map(normalizeNoiseKeyword).filter(Boolean)));
}

export function matchLogNoise(text: string, customKeywords: string[] = []): NoiseMatch | null {
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

export function shouldSuppressLogLine(text: string, customKeywords: string[] = []) {
  return Boolean(matchLogNoise(text, customKeywords));
}

export function filterNoiseText(text: string, customKeywords: string[] = []) {
  const lines = String(text || '').split(/\r?\n/);
  const kept: string[] = [];
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

export function shouldSuppressSessionLog(
  log: { level?: string; exitCode?: number; type?: string; message?: string; stdout?: string; stderr?: string },
  customKeywords: string[] = []
) {
  if (typeof log.exitCode === 'number' && log.exitCode !== 0) return false;
  if (log.level === 'warning' || log.level === 'error') return false;

  const combined = [log.type, log.message, log.stdout, log.stderr].filter(Boolean).join('\n');
  return shouldSuppressLogLine(combined, customKeywords);
}
