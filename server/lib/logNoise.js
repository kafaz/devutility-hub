const RISK_SIGNAL_RE = /timeout|timed out|超时|refused|拒绝|panic|fatal|exception|异常|failed|失败|error|reset|segfault|readonly|read-only|unreachable|i\/o|oom/i;

const BUILTIN_NOISE_MODE_META = {
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

const BUILTIN_NOISE_LEVELS = {
  off: [],
  info: ['info'],
  focus: ['info', 'debug', 'trace'],
};

const BUILTIN_LOG_NOISE_RULES = [
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

const LOW_SIGNAL_SESSION_LOG_TYPES = {
  session_opened: '会话建立事件',
  session_reused: '复用已连接会话',
  session_closed: '会话关闭事件',
  command_started: '命令开始事件',
};

const STRUCTURED_LOG_BOUNDARY_RE = /^(?:\[[^\]\n]+\]\s*)*(?:trace|debug|info|warn|warning|error|fatal)\b/i;
const TIMESTAMPED_LOG_BOUNDARY_RE = /^(?:\d{4}[-/]\d{2}[-/]\d{2}[ t]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|[a-z]\d{4}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?|time="[^"\n]+")/i;
const PREPARE_LOG_BOUNDARY_RE = /^(?:READY|WINDOW|TOOLS_READY|\[context\]|\[tool\]|\[log\])\b/i;

function normalizeNoiseKeyword(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNoiseKeywords(values = []) {
  return Array.from(new Set(values.map(normalizeNoiseKeyword).filter(Boolean)));
}

function normalizeBuiltinNoiseMode(value) {
  if (value === 'off' || value === 'focus') return value;
  return 'info';
}

function resolveNoiseOptions(options) {
  if (Array.isArray(options)) {
    return {
      builtinMode: 'info',
      customKeywords: normalizeNoiseKeywords(options),
    };
  }

  return {
    builtinMode: normalizeBuiltinNoiseMode(options && options.builtinMode),
    customKeywords: normalizeNoiseKeywords((options && options.customKeywords) || []),
  };
}

function getBuiltinNoiseRules(mode = 'info') {
  const activeLevels = new Set(BUILTIN_NOISE_LEVELS[normalizeBuiltinNoiseMode(mode)]);
  if (activeLevels.size === 0) return [];
  return BUILTIN_LOG_NOISE_RULES.filter((rule) => activeLevels.has(rule.level));
}

function matchLogNoise(text, options = []) {
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

function shouldSuppressLogLine(text, options = []) {
  return Boolean(matchLogNoise(text, options));
}

function looksLikeStandaloneLogBoundary(text, options = []) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return false;
  if (shouldSuppressLogLine(normalizedText, options)) return true;
  if (RISK_SIGNAL_RE.test(normalizedText)) return true;
  return STRUCTURED_LOG_BOUNDARY_RE.test(normalizedText)
    || TIMESTAMPED_LOG_BOUNDARY_RE.test(normalizedText)
    || PREPARE_LOG_BOUNDARY_RE.test(normalizedText);
}

function isNoiseContinuationLine(text, options = []) {
  const rawText = String(text || '');
  if (!rawText.trim()) return false;
  if (!/^\s+/.test(rawText)) return false;
  const normalizedText = rawText.trim();
  if (RISK_SIGNAL_RE.test(normalizedText)) return false;
  return !looksLikeStandaloneLogBoundary(normalizedText, options);
}

function inspectNoiseText(text, options = []) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
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

function filterNoiseText(text, options = []) {
  const inspection = inspectNoiseText(text, options);
  return {
    text: inspection.text,
    suppressedCount: inspection.suppressedCount,
  };
}

function buildSessionLogCombinedText(log) {
  return [log.type, log.eventTitle, log.message, log.content, log.stdout, log.stderr, log.cmd]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function clipNoiseSampleText(text, maxLen = 160) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
}

function getSessionLogSuppressionInfo(log, options = []) {
  if (typeof (log && log.exitCode) === 'number' && log.exitCode !== 0) return null;
  if (log && (log.level === 'warning' || log.level === 'error')) return null;

  const combined = buildSessionLogCombinedText(log || {});
  if (!combined) return null;
  if (RISK_SIGNAL_RE.test(combined)) return null;

  const logType = String((log && log.type) || '').trim().toLowerCase();
  if (LOW_SIGNAL_SESSION_LOG_TYPES[logType]) {
    return {
      kind: 'builtin',
      id: `session-type:${logType}`,
      label: LOW_SIGNAL_SESSION_LOG_TYPES[logType],
    };
  }

  if (logType === 'session_evt' && LOW_SIGNAL_SESSION_EVENT_TITLES.has(String((log && log.eventTitle) || '').trim())) {
    return {
      kind: 'builtin',
      id: `session-event:${log.eventTitle}`,
      label: '会话生命周期事件',
    };
  }

  if (
    logType === 'command_result'
    && typeof (log && log.exitCode) === 'number'
    && log.exitCode === 0
    && !String((log && log.stdout) || '').trim()
    && !String((log && log.stderr) || '').trim()
  ) {
    return {
      kind: 'builtin',
      id: 'session-type:command-result-empty',
      label: '命令完成且无输出',
    };
  }

  const streamBlocks = [log && log.stdout, log && log.stderr].filter((value) => Boolean(value && value.trim()));
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

  return matchLogNoise(combined, options);
}

function shouldSuppressSessionLog(log, options = []) {
  return Boolean(getSessionLogSuppressionInfo(log, options));
}

function foldSessionLogs(logs = [], options = []) {
  const visibleLogs = [];
  const foldedNoiseStats = new Map();
  let foldedNoiseCount = 0;

  for (const log of Array.isArray(logs) ? logs : []) {
    const suppressionInfo = getSessionLogSuppressionInfo(log, options);
    if (!suppressionInfo) {
      visibleLogs.push(log);
      continue;
    }

    foldedNoiseCount += 1;
    const statsId = `${suppressionInfo.kind}:${suppressionInfo.id}`;
    const current = foldedNoiseStats.get(statsId);
    foldedNoiseStats.set(statsId, {
      id: statsId,
      kind: suppressionInfo.kind,
      label: suppressionInfo.label,
      count: (current && current.count ? current.count : 0) + 1,
      sampleText: (current && current.sampleText) || clipNoiseSampleText(buildSessionLogCombinedText(log)),
    });
  }

  return {
    logs: visibleLogs,
    foldedNoiseCount,
    foldedNoiseStats: Array.from(foldedNoiseStats.values()).sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return String(left.label || '').localeCompare(String(right.label || ''));
    }),
  };
}

module.exports = {
  BUILTIN_LOG_NOISE_RULES,
  BUILTIN_NOISE_MODE_META,
  LOW_SIGNAL_SESSION_LOG_TYPES,
  RISK_SIGNAL_RE,
  filterNoiseText,
  foldSessionLogs,
  getBuiltinNoiseRules,
  getSessionLogSuppressionInfo,
  inspectNoiseText,
  matchLogNoise,
  normalizeBuiltinNoiseMode,
  normalizeNoiseKeyword,
  normalizeNoiseKeywords,
  shouldSuppressLogLine,
  shouldSuppressSessionLog,
};
