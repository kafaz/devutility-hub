import { useEffect, useState } from 'react';

export interface ManualCommandRunInput {
  id?: string;
  sessionId?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface ManualCommandRun {
  id: string;
  sessionId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  startedAt?: number;
  finishedAt?: number;
}

function makeManualCommandRunId() {
  return `manual-command-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeManualCommandRun(input: ManualCommandRunInput): ManualCommandRun {
  const startedAt = Number.isFinite(Number(input.startedAt)) ? Number(input.startedAt) : undefined;
  const finishedAt = Number.isFinite(Number(input.finishedAt)) ? Number(input.finishedAt) : undefined;
  const derivedDurationMs =
    startedAt !== undefined && finishedAt !== undefined
      ? Math.max(0, finishedAt - startedAt)
      : Math.max(0, Number(input.durationMs) || 0);

  return {
    id: String(input.id || makeManualCommandRunId()),
    sessionId: String(input.sessionId || ''),
    command: String(input.command || ''),
    stdout: String(input.stdout || ''),
    stderr: String(input.stderr || ''),
    exitCode:
      input.exitCode === null || input.exitCode === undefined
        ? null
        : Number.isFinite(Number(input.exitCode))
          ? Number(input.exitCode)
          : null,
    durationMs: derivedDurationMs,
    startedAt,
    finishedAt,
  };
}

export function normalizeManualCommandRuns(runs: ManualCommandRunInput[] = []): ManualCommandRun[] {
  return runs.map((run) => normalizeManualCommandRun(run));
}

export function useManualCommandRuns(initialRuns: ManualCommandRunInput[] = [], resetKey?: string) {
  const [runs, setRuns] = useState<ManualCommandRun[]>(() => normalizeManualCommandRuns(initialRuns));

  useEffect(() => {
    setRuns(normalizeManualCommandRuns(initialRuns));
  }, [resetKey]);

  function prependRun(nextRun: ManualCommandRunInput, limit = 12) {
    const normalized = normalizeManualCommandRun(nextRun);
    setRuns((current) => [normalized, ...current.filter((item) => item.id !== normalized.id)].slice(0, limit));
    return normalized;
  }

  function replaceRuns(nextRuns: ManualCommandRunInput[] = []) {
    setRuns(normalizeManualCommandRuns(nextRuns));
  }

  return {
    runs,
    prependRun,
    replaceRuns,
    setRuns,
  };
}
