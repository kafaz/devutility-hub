export type BuiltinNoiseLevel = 'info' | 'debug' | 'trace';
export type BuiltinNoiseMode = 'off' | 'info' | 'focus';

export interface BuiltinLogNoiseRule {
  id: string;
  label: string;
  level: BuiltinNoiseLevel;
  pattern: RegExp;
}

export interface NoiseMatch {
  kind: 'builtin' | 'custom';
  id: string;
  label: string;
}

export type SessionLogSuppressionInfo = NoiseMatch;

export interface LogNoiseOptions {
  builtinMode?: BuiltinNoiseMode;
  customKeywords?: string[];
}

export interface NoiseTextInspection {
  text: string;
  suppressedCount: number;
  visibleLineCount: number;
}

export const RISK_SIGNAL_RE = /timeout|timed out|超时|refused|拒绝|panic|fatal|exception|异常|failed|失败|error|reset|segfault|readonly|read-only|unreachable|i\/o|oom/i;

export const BUILTIN_NOISE_MODE_META: Record<BuiltinNoiseMode, { label: string; description: string }> = {
  off: {
    label: '关闭内建降噪',
    description: '保留全部日志，只应用手动忽略词。',
  },
  info: {
    label: '隐藏 INFO',
    description: '默认过滤 INFO 级日志，保留 error/timeout 等风险信号。',
  },
  focus: {
    label: '聚焦异常',
    description: '过滤 INFO/DEBUG/TRACE 级常见噪音，优先保留异常线索。',
  },
};

const BUILTIN_NOISE_LEVELS: Record<BuiltinNoiseMode, BuiltinNoiseLevel[]> = {
  off: [],
  info: ['info'],
  focus: ['info', 'debug', 'trace'],
};

export const BUILTIN_LOG_NOISE_RULES: BuiltinLogNoiseRule[] = [
  {
    id: 'bracket-info-prefix',
    label: '[INFO] 前缀',
    level: 'info',
    pattern: /^\s*(?:\[[^\]\n]+\]\s*)*\[info\](?=\s|:|-|\||$)/i,
  },
  {
    id: 'plain-info-prefix',
    label: 'INFO 前缀',
    level: 'info',
    pattern: /^\s*(?:\d{4}[-/]\d{2}[-/]\d{2}[ t]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+)?info(?=\s|:|-|\||$)/i,
  },
  {
    id: 'bracketed-info-prefix',
    label: '[ts] INFO 前缀',
    level: 'info',
    pattern: /^\s*(?:\[[^\]\n]+\]\s*)+info(?=\s|:|-|\||$)/i,
  },
  {
    id: 'info-level-pair',
    label: 'level=info',
    level: 'info',
    pattern: /\b(?:level|lvl|severity)\s*[:=]\s*["']?info["']?\b/i,
  },
  {
    id: 'json-info-level',
    label: 'JSON info level',
    level: 'info',
    pattern: /"(?:level|lvl|severity)"\s*:\s*"info"/i,
  },
  {
    id: 'logrus-info-prefix',
    label: 'time=... level=info',
    level: 'info',
    pattern: /^\s*time="[^"\n]+"\s+level=info\b/i,
  },
  {
    id: 'klog-info-prefix',
    label: 'I0420 风格 INFO',
    level: 'info',
    pattern: /^\s*i\d{4}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/i,
  },
  {
    id: 'last-login-banner',
    label: 'Last login 提示',
    level: 'info',
    pattern: /^\s*last login:\s.+$/i,
  },
  {
    id: 'shell-welcome-banner',
    label: 'Welcome 横幅',
    level: 'info',
    pattern: /^\s*welcome to .+$/i,
  },
  {
    id: 'shell-motd-link',
    label: 'MOTD 链接提示',
    level: 'info',
    pattern: /^\s*\*\s+(?:documentation|management|support|landscape|ubuntu pro|canonical livepatch|web console)\s*:/i,
  },
  {
    id: 'shell-motd-system-info',
    label: 'MOTD 系统信息',
    level: 'info',
    pattern: /^\s*(?:system information as of|system load:|usage of \S+:|memory usage:|swap usage:|processes:|users logged in:|ipv4 address(?:es)? for \S+:|ipv6 address(?:es)? for \S+:).*/i,
  },
  {
    id: 'shell-motd-updates',
    label: 'MOTD 更新提示',
    level: 'info',
    pattern: /^\s*\d+\s+updates can be applied immediately\.\s*$/i,
  },
  {
    id: 'prepare-ready-line',
    label: 'READY 上下文',
    level: 'info',
    pattern: /^\s*READY\s+user=\S+\s+host=\S+\s+pwd=.+$/i,
  },
  {
    id: 'prepare-context-line',
    label: '上下文探测输出',
    level: 'info',
    pattern: /^\s*\[context\]\s+(?:user|host|pwd|shell)=/i,
  },
  {
    id: 'bracket-debug-prefix',
    label: '[DEBUG] 前缀',
    level: 'debug',
    pattern: /^\s*(?:\[[^\]\n]+\]\s*)*\[debug\](?=\s|:|-|\||$)/i,
  },
  {
    id: 'plain-debug-prefix',
    label: 'DEBUG 前缀',
    level: 'debug',
    pattern: /^\s*(?:\d{4}[-/]\d{2}[-/]\d{2}[ t]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+)?debug(?=\s|:|-|\||$)/i,
  },
  {
    id: 'debug-level-pair',
    label: 'level=debug',
    level: 'debug',
    pattern: /\b(?:level|lvl|severity)\s*[:=]\s*["']?debug["']?\b/i,
  },
  {
    id: 'json-debug-level',
    label: 'JSON debug level',
    level: 'debug',
    pattern: /"(?:level|lvl|severity)"\s*:\s*"debug"/i,
  },
  {
    id: 'bracket-trace-prefix',
    label: '[TRACE] 前缀',
    level: 'trace',
    pattern: /^\s*(?:\[[^\]\n]+\]\s*)*\[trace\](?=\s|:|-|\||$)/i,
  },
  {
    id: 'plain-trace-prefix',
    label: 'TRACE 前缀',
    level: 'trace',
    pattern: /^\s*(?:\d{4}[-/]\d{2}[-/]\d{2}[ t]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+)?trace(?=\s|:|-|\||$)/i,
  },
  {
    id: 'trace-level-pair',
    label: 'level=trace',
    level: 'trace',
    pattern: /\b(?:level|lvl|severity)\s*[:=]\s*["']?trace["']?\b/i,
  },
  {
    id: 'json-trace-level',
    label: 'JSON trace level',
    level: 'trace',
    pattern: /"(?:level|lvl|severity)"\s*:\s*"trace"/i,
  },
  {
    id: 'prepare-tools-ready',
    label: '工具预热清单',
    level: 'info',
    pattern: /^\s*TOOLS_READY(?:\s|$)/i,
  },
  {
    id: 'prepare-tool-path',
    label: '工具路径探测',
    level: 'info',
    pattern: /^\s*\[tool\]\s+[a-z0-9._-]+=.+$/i,
  },
  {
    id: 'prepare-window',
    label: '运行窗口快照',
    level: 'info',
    pattern: /^\s*WINDOW\s+ts=.*\bshell=.*$/i,
  },
  {
    id: 'prepare-log-hotspot',
    label: '日志目录探测',
    level: 'trace',
    pattern: /^\s*\[log\]\s+\S+/i,
  },
];

const LOW_SIGNAL_SESSION_EVENT_TITLES = new Set([
  '连接已建立',
  '连接已关闭',
  '用户主动断开',
]);

const LOW_SIGNAL_SESSION_LOG_TYPES: Record<string, string> = {
  session_opened: '会话建立事件',
  session_reused: '复用已连接会话',
  session_closed: '会话关闭事件',
  command_started: '命令开始事件',
};

const STRUCTURED_LOG_BOUNDARY_RE = /^(?:\[[^\]\n]+\]\s*)*(?:trace|debug|info|warn|warning|error|fatal)\b/i;
const TIMESTAMPED_LOG_BOUNDARY_RE = /^(?:\d{4}[-/]\d{2}[-/]\d{2}[ t]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|[a-z]\d{4}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?|time="[^"\n]+")/i;
const PREPARE_LOG_BOUNDARY_RE = /^(?:READY|WINDOW|TOOLS_READY|\[context\]|\[tool\]|\[log\])\b/i;

export function normalizeNoiseKeyword(value: string) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeNoiseKeywords(values: string[] = []) {
  return Array.from(new Set(values.map(normalizeNoiseKeyword).filter(Boolean)));
}

export function normalizeBuiltinNoiseMode(value?: string | null): BuiltinNoiseMode {
  if (value === 'off' || value === 'focus') return value;
  return 'info';
}

function resolveNoiseOptions(options: LogNoiseOptions | string[] | undefined) {
  if (Array.isArray(options)) {
    return {
      builtinMode: 'info' as BuiltinNoiseMode,
      customKeywords: normalizeNoiseKeywords(options),
    };
  }

  return {
    builtinMode: normalizeBuiltinNoiseMode(options?.builtinMode),
    customKeywords: normalizeNoiseKeywords(options?.customKeywords || []),
  };
}

export function getBuiltinNoiseRules(mode: BuiltinNoiseMode = 'info') {
  const activeLevels = new Set(BUILTIN_NOISE_LEVELS[normalizeBuiltinNoiseMode(mode)]);
  if (activeLevels.size === 0) return [] as BuiltinLogNoiseRule[];
  return BUILTIN_LOG_NOISE_RULES.filter((rule) => activeLevels.has(rule.level));
}

export function matchLogNoise(text: string, options: LogNoiseOptions | string[] = []): NoiseMatch | null {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return null;
  if (RISK_SIGNAL_RE.test(normalizedText)) return null;

  const resolved = resolveNoiseOptions(options);

  for (const rule of getBuiltinNoiseRules(resolved.builtinMode)) {
    if (rule.pattern.test(normalizedText)) {
      return {
        kind: 'builtin',
        id: rule.id,
        label: rule.label,
      };
    }
  }

  const lowered = normalizedText.toLowerCase();
  const keyword = resolved.customKeywords.find((item) => lowered.includes(item));
  if (!keyword) return null;

  return {
    kind: 'custom',
    id: `custom:${keyword}`,
    label: keyword,
  };
}

export function shouldSuppressLogLine(text: string, options: LogNoiseOptions | string[] = []) {
  return Boolean(matchLogNoise(text, options));
}

function looksLikeStandaloneLogBoundary(text: string, options: LogNoiseOptions | string[] = []) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return false;
  if (shouldSuppressLogLine(normalizedText, options)) return true;
  if (RISK_SIGNAL_RE.test(normalizedText)) return true;
  return STRUCTURED_LOG_BOUNDARY_RE.test(normalizedText)
    || TIMESTAMPED_LOG_BOUNDARY_RE.test(normalizedText)
    || PREPARE_LOG_BOUNDARY_RE.test(normalizedText);
}

function isNoiseContinuationLine(text: string, options: LogNoiseOptions | string[] = []) {
  const rawText = String(text || '');
  if (!rawText.trim()) return false;
  if (!/^\s+/.test(rawText)) return false;
  const normalizedText = rawText.trim();
  if (RISK_SIGNAL_RE.test(normalizedText)) return false;
  return !looksLikeStandaloneLogBoundary(normalizedText, options);
}

export function inspectNoiseText(text: string, options: LogNoiseOptions | string[] = []): NoiseTextInspection {
  const lines = String(text || '').split(/\r?\n/);
  const kept: string[] = [];
  let suppressedCount = 0;
  let visibleLineCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      kept.push(line);
      continue;
    }

    if (shouldSuppressLogLine(line, options)) {
      suppressedCount += 1;
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) break;
        if (shouldSuppressLogLine(nextLine, options) || isNoiseContinuationLine(nextLine, options)) {
          suppressedCount += 1;
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    kept.push(line);
    visibleLineCount += 1;
  }

  return {
    text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    suppressedCount,
    visibleLineCount,
  };
}

export function filterNoiseText(text: string, options: LogNoiseOptions | string[] = []) {
  const inspection = inspectNoiseText(text, options);
  return {
    text: inspection.text,
    suppressedCount: inspection.suppressedCount,
  };
}

function buildSessionLogCombinedText(
  log: {
    type?: string;
    message?: string;
    stdout?: string;
    stderr?: string;
    cmd?: string;
    eventTitle?: string;
    content?: string;
  }
) {
  return [log.type, log.eventTitle, log.message, log.content, log.stdout, log.stderr, log.cmd]
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function getSessionLogSuppressionInfo(
  log: {
    level?: string;
    exitCode?: number;
    type?: string;
    message?: string;
    stdout?: string;
    stderr?: string;
    cmd?: string;
    eventTitle?: string;
    content?: string;
  },
  options: LogNoiseOptions | string[] = []
): SessionLogSuppressionInfo | null {
  if (typeof log.exitCode === 'number' && log.exitCode !== 0) return null;
  if (log.level === 'warning' || log.level === 'error') return null;

  const combined = buildSessionLogCombinedText(log);
  if (!combined) return null;
  if (RISK_SIGNAL_RE.test(combined)) return null;

  const logType = String(log.type || '').trim().toLowerCase();
  if (LOW_SIGNAL_SESSION_LOG_TYPES[logType]) {
    return {
      kind: 'builtin',
      id: `session-type:${logType}`,
      label: LOW_SIGNAL_SESSION_LOG_TYPES[logType],
    };
  }

  if (logType === 'session_evt' && LOW_SIGNAL_SESSION_EVENT_TITLES.has(String(log.eventTitle || '').trim())) {
    return {
      kind: 'builtin',
      id: `session-event:${log.eventTitle}`,
      label: '会话生命周期事件',
    };
  }

  if (
    logType === 'command_result'
    && typeof log.exitCode === 'number'
    && log.exitCode === 0
    && !String(log.stdout || '').trim()
    && !String(log.stderr || '').trim()
  ) {
    return {
      kind: 'builtin',
      id: 'session-type:command-result-empty',
      label: '命令完成且无输出',
    };
  }

  const streamBlocks = [log.stdout, log.stderr].filter((value): value is string => Boolean(value && value.trim()));
  if (streamBlocks.length > 0) {
    const inspections = streamBlocks.map((block) => inspectNoiseText(block, options));
    const suppressedCount = inspections.reduce((total, item) => total + item.suppressedCount, 0);
    const visibleLineCount = inspections.reduce((total, item) => total + item.visibleLineCount, 0);
    if (suppressedCount > 0 && visibleLineCount === 0) {
      return {
        kind: 'builtin',
        id: 'session-output-noise',
        label: '输出仅包含低价值日志',
      };
    }
  }

  const noiseMatch = matchLogNoise(combined, options);
  if (noiseMatch) return noiseMatch;

  return null;
}

export function shouldSuppressSessionLog(
  log: {
    level?: string;
    exitCode?: number;
    type?: string;
    message?: string;
    stdout?: string;
    stderr?: string;
    cmd?: string;
    eventTitle?: string;
    content?: string;
  },
  options: LogNoiseOptions | string[] = []
) {
  return Boolean(getSessionLogSuppressionInfo(log, options));
}
