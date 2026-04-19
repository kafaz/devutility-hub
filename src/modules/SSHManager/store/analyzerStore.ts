import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';
import { normalizeNoiseKeyword, normalizeNoiseKeywords } from '../../../utils/logNoise';

export interface CriticalLog {
  id: string;
  sessionId: string;
  sessionName: string;
  timestamp: number;
  type: 'error' | 'data' | 'keyword';
  text: string;
  matchedKeywords: string[];
}

export interface HighlightRule {
  id: string;
  keyword: string;
  color: string;
}

interface AnalyzerStore {
  // 匹配的关键词列表（不区分大小写检索）
  keywords: string[];
  setKeywords: (keywords: string[]) => void;
  addKeyword: (keyword: string) => void;
  removeKeyword: (keyword: string) => void;

  // 截获的关键日志列表，最新的在前面
  logs: CriticalLog[];
  addLog: (log: Omit<CriticalLog, 'id'>) => void;
  clearLogs: (sessionId?: string) => void;
  suppressedCount: number;
  recordSuppressedLog: () => void;
  clearSuppressedCount: () => void;

  // 终端动态高亮规则
  highlightRules: HighlightRule[];
  addHighlightRule: (rule: Omit<HighlightRule, 'id'>) => void;
  removeHighlightRule: (id: string) => void;
  updateHighlightRule: (id: string, rule: Partial<Omit<HighlightRule, 'id'>>) => void;

  // 日志降噪规则（大小写不敏感的子串匹配，内建规则始终生效）
  noiseKeywords: string[];
  addNoiseKeyword: (keyword: string) => void;
  removeNoiseKeyword: (keyword: string) => void;
}

const DEFAULT_KEYWORDS = [
  'error',
  'exception',
  'fail',
  'failed',
  'data',
  'warning',
  'timeout',
  'panic',
  'fatal'
];

const DEFAULT_HIGHLIGHT_RULES: HighlightRule[] = [
  { id: 'h-1', keyword: 'error', color: '#ef4444' }, // Red
  { id: 'h-2', keyword: 'fail', color: '#ef4444' },
  { id: 'h-3', keyword: 'timeout', color: '#eab308' }, // Yellow
  { id: 'h-4', keyword: 'success', color: '#22c55e' }, // Green
];

export const useAnalyzerStore = create<AnalyzerStore>()(
  persist(
    (set) => ({
      keywords: DEFAULT_KEYWORDS,

      setKeywords: (keywords) => set({ keywords }),
      addKeyword: (keyword) => set((state) => {
        if (state.keywords.includes(keyword.toLowerCase())) return state;
        return { keywords: [...state.keywords, keyword.toLowerCase()] };
      }),
      removeKeyword: (keyword) => set((state) => ({
        keywords: state.keywords.filter((k) => k !== keyword.toLowerCase())
      })),

      logs: [],
      addLog: (log) => set((state) => {
        const newLogs = [{ ...log, id: generateId() }, ...state.logs].slice(0, 1000);
        return { logs: newLogs };
      }),
      clearLogs: (sessionId) => set((state) => ({
        logs: sessionId ? state.logs.filter((l) => l.sessionId !== sessionId) : []
      })),
      suppressedCount: 0,
      recordSuppressedLog: () => set((state) => ({ suppressedCount: state.suppressedCount + 1 })),
      clearSuppressedCount: () => set({ suppressedCount: 0 }),

      highlightRules: DEFAULT_HIGHLIGHT_RULES,
      addHighlightRule: (rule) => set((state) => ({
        highlightRules: [...state.highlightRules, { ...rule, id: generateId() }],
      })),
      removeHighlightRule: (id) => set((state) => ({
        highlightRules: state.highlightRules.filter((r) => r.id !== id),
      })),
      updateHighlightRule: (id, updates) => set((state) => ({
        highlightRules: state.highlightRules.map((r) => r.id === id ? { ...r, ...updates } : r),
      })),

      noiseKeywords: [],
      addNoiseKeyword: (keyword) => set((state) => {
        const normalized = normalizeNoiseKeyword(keyword);
        if (!normalized || state.noiseKeywords.includes(normalized)) return state;
        return { noiseKeywords: normalizeNoiseKeywords([...state.noiseKeywords, normalized]) };
      }),
      removeNoiseKeyword: (keyword) => set((state) => ({
        noiseKeywords: state.noiseKeywords.filter((item) => item !== normalizeNoiseKeyword(keyword)),
      })),
    }),
    {
      name: 'devutility-analyzer-store',
      partialize: (s) => ({
        keywords: s.keywords,
        highlightRules: s.highlightRules,
        noiseKeywords: s.noiseKeywords,
      }),
    }
  )
);
