import type {
  CodeNavigationEntry,
  LocalizationDeskState,
  LogContextWindow
} from './types.ts';

const DEFAULT_LOG_CONTEXT_WINDOW: LogContextWindow = { before: 5, after: 5 };

export function createInitialLocalizationDeskState(): LocalizationDeskState {
  return {
    currentAnchorLogId: null,
    logContextWindow: { ...DEFAULT_LOG_CONTEXT_WINDOW },
    commandDraft: '',
    codeNavigationStack: [],
  };
}

export function expandLogContextWindow(
  current: LogContextWindow,
  edge: 'before' | 'after',
  delta: number
): LogContextWindow {
  return edge === 'before'
    ? { ...current, before: current.before + delta }
    : { ...current, after: current.after + delta };
}

export function selectAnchorLog(
  current: LocalizationDeskState,
  logId: string
): LocalizationDeskState {
  if (current.currentAnchorLogId === logId) return current;
  return {
    ...current,
    currentAnchorLogId: logId,
    logContextWindow: { ...DEFAULT_LOG_CONTEXT_WINDOW },
  };
}

export function pushCodeNavigation(
  current: CodeNavigationEntry[],
  next: CodeNavigationEntry
): CodeNavigationEntry[] {
  return [...current, next];
}

export function popCodeNavigationTo(
  current: CodeNavigationEntry[],
  index: number
): CodeNavigationEntry[] {
  return current.slice(0, index + 1);
}
