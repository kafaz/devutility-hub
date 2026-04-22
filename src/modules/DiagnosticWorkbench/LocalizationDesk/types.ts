import type {
  FunctionCandidateToken,
  SourceLocationCandidate,
} from '../../../utils/sourceLookupHints';

export interface LogContextWindow {
  before: number;
  after: number;
}

export interface CodeNavigationEntry {
  symbolId: string;
  symbolName: string;
}

export interface LocalizationDeskState {
  currentAnchorLogId: string | null;
  logContextWindow: LogContextWindow;
  commandDraft: string;
  codeNavigationStack: CodeNavigationEntry[];
}

export interface LocalizationDeskSessionLogItem {
  id: string;
  ts: number;
  type: string;
  level?: 'info' | 'warning' | 'error';
  cmd?: string;
  mode?: 'pty' | 'exec' | string;
  message?: string;
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
}

export interface LocalizationDeskCodeContextSummary {
  repo: string;
  repoDisplayName: string;
  branch: string;
  commit: string;
  worktreePath: string;
}

export interface LocalizationDeskSourceLocateRequest {
  title: string;
  summary: string;
  sourceType: string;
  text?: string;
  parts?: Array<string | undefined>;
  command?: string;
}

export interface LocalizationDeskSourceLocatePreferred {
  location?: SourceLocationCandidate;
  functionCandidate?: FunctionCandidateToken;
}
