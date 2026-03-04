import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParseRule, ParseResult, CFormatField } from '../../../types';
import { generateId, cFormatToRegex } from '../../../utils';

interface LogStore {
  rules: ParseRule[];
  activeRuleId: string | null;
  logText: string;
  parseResults: ParseResult[];
  isParsing: boolean;

  setLogText: (text: string) => void;
  setActiveRule: (id: string | null) => void;

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

function parseLogWithRule(
  lines: string[],
  rule: ParseRule
): ParseResult[] {
  let regex: RegExp;
  let fieldNames: string[] = [];

  try {
    if (rule.mode === 'REGEX') {
      regex = new RegExp(rule.pattern || '');
      fieldNames =
        rule.fieldMappings?.map((m) => m.fieldName) ?? [];
    } else {
      regex = new RegExp(rule.patternCompiled || '');
      fieldNames = rule.fields?.map((f) => f.name || `field${f.index}`) ?? [];
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
    const m = regex.exec(line);
    if (!m) {
      return { lineIndex: i, rawLine: line, matched: false, fields: {} };
    }
    const fields: Record<string, string | number> = {};
    const mappings =
      rule.mode === 'REGEX'
        ? rule.fieldMappings ?? []
        : (rule.fields ?? []).map((f) => ({
            groupIndex: f.index,
            fieldName: f.name || `field${f.index}`,
            fieldType: f.type,
          }));

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
    // 补充未映射的捕获组
    fieldNames.forEach((name, idx) => {
      if (!(name in fields)) {
        fields[name] = m[idx + 1] ?? '';
      }
    });

    return { lineIndex: i, rawLine: line, matched: true, fields };
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
      isParsing: false,

      setLogText: (text) => set({ logText: text }),

      setActiveRule: (id) => set({ activeRuleId: id }),

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
            r.id === id
              ? { ...r, ...data, updatedAt: Date.now() }
              : r
          ),
        }));
      },

      deleteRule: (id) => {
        set((s) => ({
          rules: s.rules.filter((r) => r.id !== id),
          activeRuleId:
            s.activeRuleId === id ? null : s.activeRuleId,
        }));
      },

      runParse: () => {
        const { logText, activeRuleId, rules } = get();
        const rule = rules.find((r) => r.id === activeRuleId);
        if (!rule || !logText.trim()) {
          set({ parseResults: [] });
          return;
        }
        set({ isParsing: true });
        // 使用 setTimeout 避免阻塞 UI
        setTimeout(() => {
          const lines = logText.split('\n').filter((l) => l.trim());
          const results = parseLogWithRule(lines, rule);
          set({ parseResults: results, isParsing: false });
        }, 0);
      },

      clearResults: () => set({ parseResults: [], logText: '' }),
    }),
    {
      name: 'devutility-log-analyzer',
      partialize: (state) => ({
        rules: state.rules,
        activeRuleId: state.activeRuleId,
      }),
    }
  )
);
