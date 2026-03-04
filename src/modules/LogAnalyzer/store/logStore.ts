import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParseRule, ParseResult, CFormatField, GrepGroup } from '../../../types';
import { generateId, cFormatToRegex, parseGrepCOutput } from '../../../utils';

interface LogStore {
  rules: ParseRule[];
  activeRuleId: string | null;
  logText: string;
  parseResults: ParseResult[];
  grepGroups: GrepGroup[];    // grep -C 模式的分组结果
  grepCMode: boolean;         // 是否启用 grep -C 聚合模式
  isParsing: boolean;

  setLogText: (text: string) => void;
  setActiveRule: (id: string | null) => void;
  setGrepCMode: (enabled: boolean) => void;

  addRegexRule: (
    data: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt' | 'mode'>
  ) => string;
  addCFormatRule: (
    name: string,
    patternSource: string,
    fields: CFormatField[]
  ) => string;
  updateRule: (id: string, data: Partial<ParseRule>) => void;
  deleteRule: (id: string) => void;

  runParse: () => void;
  clearResults: () => void;
}

// 用规则解析单行，返回字段映射
function parseSingleLine(
  line: string,
  regex: RegExp,
  mappings: Array<{ groupIndex: number; fieldName: string; fieldType?: string }>
): { matched: boolean; fields: Record<string, string | number> } {
  const m = regex.exec(line);
  if (!m) return { matched: false, fields: {} };

  const fields: Record<string, string | number> = {};
  mappings.forEach((mapping) => {
    const raw = m[mapping.groupIndex] ?? '';
    if (
      mapping.fieldType === 'number' ||
      mapping.fieldType === 'float' ||
      mapping.fieldType === 'hex'
    ) {
      const num = parseFloat(raw);
      fields[mapping.fieldName] = isNaN(num) ? raw : num;
    } else {
      fields[mapping.fieldName] = raw;
    }
  });
  return { matched: true, fields };
}

// 普通逐行解析
function parseLogLines(lines: string[], rule: ParseRule): ParseResult[] {
  let regex: RegExp;
  let mappings: Array<{ groupIndex: number; fieldName: string; fieldType?: string }> = [];

  try {
    if (rule.mode === 'REGEX') {
      regex = new RegExp(rule.pattern || '');
      mappings = rule.fieldMappings?.map((m) => ({
        groupIndex: m.groupIndex,
        fieldName: m.fieldName,
        fieldType: m.fieldType,
      })) ?? [];
    } else {
      regex = new RegExp(rule.patternCompiled || '');
      mappings = rule.fields?.map((f) => ({
        groupIndex: f.index,
        fieldName: f.name || `field${f.index}`,
        fieldType: f.type,
      })) ?? [];
    }
  } catch {
    return lines.map((line, i) => ({
      lineIndex: i,
      rawLine: line,
      matched: false,
      fields: {},
    }));
  }

  return lines.map((line, i) => {
    const { matched, fields } = parseSingleLine(line, regex, mappings);
    return { lineIndex: i, rawLine: line, matched, fields };
  });
}

// grep -C 模式：对每个分组找到"主匹配行"并解析字段
function parseGrepGroups(groups: GrepGroup[], rule: ParseRule): GrepGroup[] {
  let regex: RegExp;
  let mappings: Array<{ groupIndex: number; fieldName: string; fieldType?: string }> = [];

  try {
    if (rule.mode === 'REGEX') {
      regex = new RegExp(rule.pattern || '');
      mappings = rule.fieldMappings?.map((m) => ({
        groupIndex: m.groupIndex,
        fieldName: m.fieldName,
        fieldType: m.fieldType,
      })) ?? [];
    } else {
      regex = new RegExp(rule.patternCompiled || '');
      mappings = rule.fields?.map((f) => ({
        groupIndex: f.index,
        fieldName: f.name || `field${f.index}`,
        fieldType: f.type,
      })) ?? [];
    }
  } catch {
    return groups;
  }

  return groups.map((group) => {
    // 优先在已标记为 isMatch 的行中匹配，找不到则遍历所有行
    const candidates = group.lines.filter((l) => l.isMatch);
    const allLines = candidates.length > 0 ? candidates : group.lines;

    for (const line of allLines) {
      const { matched, fields } = parseSingleLine(line.content, regex, mappings);
      if (matched) {
        return {
          ...group,
          matched: true,
          matchedLineContent: line.content,
          parsedFields: fields,
        };
      }
    }
    return { ...group, matched: false, matchedLineContent: '', parsedFields: {} };
  });
}

const defaultRules: ParseRule[] = [
  {
    id: 'rule-nginx',
    name: 'Nginx 访问日志',
    mode: 'REGEX',
    pattern:
      '^(\\S+)\\s+\\S+\\s+\\S+\\s+\\[([^\\]]+)\\]\\s+"(\\S+)\\s+(\\S+)\\s+\\S+"\\s+(\\d+)\\s+(\\d+)',
    fieldMappings: [
      { groupIndex: 1, fieldName: 'remote_ip', fieldType: 'ip' },
      { groupIndex: 2, fieldName: 'time', fieldType: 'date' },
      { groupIndex: 3, fieldName: 'method', fieldType: 'string' },
      { groupIndex: 4, fieldName: 'path', fieldType: 'string' },
      { groupIndex: 5, fieldName: 'status', fieldType: 'number' },
      { groupIndex: 6, fieldName: 'bytes', fieldType: 'number' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'rule-java',
    name: 'Java 应用日志',
    mode: 'REGEX',
    pattern:
      '^(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(ERROR|INFO|WARN|DEBUG)\\s+\\[([^\\]]+)\\]\\s+(.+)$',
    fieldMappings: [
      { groupIndex: 1, fieldName: 'timestamp', fieldType: 'date' },
      { groupIndex: 2, fieldName: 'level', fieldType: 'string' },
      { groupIndex: 3, fieldName: 'thread', fieldType: 'string' },
      { groupIndex: 4, fieldName: 'message', fieldType: 'string' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export const useLogStore = create<LogStore>()(
  persist(
    (set, get) => ({
      rules: defaultRules,
      activeRuleId: null,
      logText: '',
      parseResults: [],
      grepGroups: [],
      grepCMode: false,
      isParsing: false,

      setLogText: (text) => set({ logText: text }),
      setActiveRule: (id) => set({ activeRuleId: id }),
      setGrepCMode: (enabled) => set({ grepCMode: enabled }),

      addRegexRule: (data) => {
        const id = generateId();
        const now = Date.now();
        set((s) => ({
          rules: [
            ...s.rules,
            { ...data, id, mode: 'REGEX' as const, createdAt: now, updatedAt: now },
          ],
          activeRuleId: id,
        }));
        return id;
      },

      addCFormatRule: (name, patternSource, fields) => {
        const id = generateId();
        const now = Date.now();
        const { regex } = cFormatToRegex(patternSource);
        set((s) => ({
          rules: [
            ...s.rules,
            {
              id,
              name,
              mode: 'C_FORMAT' as const,
              patternSource,
              patternCompiled: regex,
              fields,
              createdAt: now,
              updatedAt: now,
            },
          ],
          activeRuleId: id,
        }));
        return id;
      },

      updateRule: (id, data) => {
        set((s) => ({
          rules: s.rules.map((r) =>
            r.id === id ? { ...r, ...data, updatedAt: Date.now() } : r
          ),
        }));
      },

      deleteRule: (id) => {
        set((s) => ({
          rules: s.rules.filter((r) => r.id !== id),
          activeRuleId: s.activeRuleId === id ? null : s.activeRuleId,
        }));
      },

      runParse: () => {
        const { logText, activeRuleId, rules, grepCMode } = get();
        const rule = rules.find((r) => r.id === activeRuleId);
        if (!rule || !logText.trim()) {
          set({ parseResults: [], grepGroups: [] });
          return;
        }
        set({ isParsing: true });

        setTimeout(() => {
          if (grepCMode) {
            // grep -C 聚合模式：先解析分组，再对每组找主匹配行
            const rawGroups = parseGrepCOutput(logText);
            const groups = parseGrepGroups(rawGroups, rule);
            set({ grepGroups: groups, parseResults: [], isParsing: false });
          } else {
            // 普通逐行模式
            const lines = logText.split('\n').filter((l) => l.trim());
            const results = parseLogLines(lines, rule);
            set({ parseResults: results, grepGroups: [], isParsing: false });
          }
        }, 0);
      },

      clearResults: () =>
        set({ parseResults: [], grepGroups: [], logText: '' }),
    }),
    {
      name: 'devutility-log-analyzer',
      partialize: (state) => ({
        rules: state.rules,
        activeRuleId: state.activeRuleId,
        grepCMode: state.grepCMode,
      }),
    }
  )
);
