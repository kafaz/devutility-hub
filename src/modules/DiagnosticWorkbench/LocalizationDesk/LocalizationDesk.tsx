import { useEffect, useState } from 'react';

import CodeProvenanceLane, {
  type CodeProvenanceFocusFrame,
  type CodeProvenanceForwardTarget,
  type CodeProvenanceNavigationEntry,
} from './CodeProvenanceLane.tsx';
import ManualCommandLane from './ManualCommandLane.tsx';
import SessionLogLane from './SessionLogLane.tsx';
import TimelineWhiteboard from './TimelineWhiteboard.tsx';
import {
  createInitialLocalizationDeskState,
  expandLogContextWindow,
  selectAnchorLog,
} from './useLocalizationDeskState.ts';
import {
  appendTimelineWhiteboardNode,
  appendTimelineWhiteboardNote,
  clearTimelineWhiteboard,
  moveTimelineWhiteboardNode,
  removeTimelineWhiteboardNode,
  replaceTimelineWhiteboardNodes,
  selectTimelineWhiteboardNode,
  useTimelineWhiteboard,
  type TimelineWhiteboardManualNoteInput,
  type TimelineWhiteboardNode,
  type TimelineWhiteboardNodeInput,
} from './useTimelineWhiteboard.ts';
import { useManualCommandRuns } from './useManualCommandRuns.ts';

import type {
  LocalizationDeskCodeContextSummary,
  LocalizationDeskSessionLogItem,
  LocalizationDeskSourceLocatePreferred,
  LocalizationDeskSourceLocateRequest,
} from './types.ts';
import type {
  ManualCommandRun,
  ManualCommandRunInput,
} from './useManualCommandRuns.ts';

interface LocalizationDeskProps {
  sessionLogs: LocalizationDeskSessionLogItem[];
  selectedSessionId?: string;
  currentSessionLabel?: string;
  loadingSessionLogs?: boolean;
  evidenceCount?: number;
  isDark?: boolean;
  activeCodeContext: LocalizationDeskCodeContextSummary | null;
  persistedActiveCodeBinding?: LocalizationDeskCodeContextSummary | null;
  codeCurrentFrame?: CodeProvenanceFocusFrame | null;
  codeNavigationStack?: CodeProvenanceNavigationEntry[];
  codeForwardTargets?: CodeProvenanceForwardTarget[];
  canLocateSessionLogSource?(lookupText: string): boolean;
  onOpenRawLogs(): void;
  onOpenEvidenceBasket(): void;
  onLockSessionLogEvidence(log: LocalizationDeskSessionLogItem): void;
  onLocateSessionLogSource(
    request: LocalizationDeskSourceLocateRequest,
    preferred?: LocalizationDeskSourceLocatePreferred
  ): void;
  manualCommandRuns?: ManualCommandRunInput[];
  timelineWhiteboard?: TimelineWhiteboardNode[];
  workbenchStateKey?: string;
  onRunManualCommand?(command: string): Promise<ManualCommandRunInput | null>;
  onManualCommandRunsChange?(runs: ManualCommandRun[]): void;
  onTimelineWhiteboardChange?(items: TimelineWhiteboardNode[]): void;
  onExpandCodeAbove?(): void;
  onExpandCodeBelow?(): void;
  onOpenCodeFullFunction?(): void;
  onNavigateCodeForward?(target: CodeProvenanceForwardTarget): void;
  onJumpBackInCode?(index: number): void;
}

function buildLogWhiteboardNode(log: LocalizationDeskSessionLogItem): TimelineWhiteboardNodeInput {
  return {
    id: `log-${log.id}`,
    kind: 'log',
    title: log.message ? `${log.type}: ${log.message}` : log.type,
    excerpt: [log.cmd, log.stdout, log.stderr].filter(Boolean).join('\n\n'),
    timestamp: Number.isFinite(Number(log.ts)) ? Number(log.ts) : null,
    sourceType: 'session_log',
    sourceId: log.id,
    accent:
      log.level === 'error' || (typeof log.exitCode === 'number' && log.exitCode !== 0)
        ? 'error'
        : log.level === 'warning'
          ? 'warning'
          : 'default',
  };
}

function buildManualCommandWhiteboardNode(run: ManualCommandRun): TimelineWhiteboardNodeInput {
  const output = [run.stdout, run.stderr].filter(Boolean).join('\n\n');
  return {
    id: `command-${run.id}`,
    kind: 'command',
    title: run.command || '手动命令',
    excerpt: output || '该命令没有返回 stdout/stderr 输出。',
    timestamp: Number.isFinite(Number(run.finishedAt ?? run.startedAt))
      ? Number(run.finishedAt ?? run.startedAt)
      : null,
    sourceType: 'manual_command',
    sourceId: run.id,
    accent: run.exitCode === 0 || run.exitCode === null ? 'default' : 'error',
  };
}

function buildSourceWhiteboardNode(frame: CodeProvenanceFocusFrame): TimelineWhiteboardNodeInput {
  const location = frame.filePath
    ? `${frame.filePath}:${frame.line || '?'}${frame.endLine ? `-${frame.endLine}` : ''}`
    : frame.symbolName;
  return {
    id: `source-${frame.symbolId}`,
    kind: 'source',
    title: frame.signature || frame.symbolName,
    excerpt: frame.preview || frame.summary || location,
    timestamp: null,
    sourceType: 'source_preview',
    sourceId: frame.symbolId,
    accent: 'default',
  };
}

export default function LocalizationDesk(props: LocalizationDeskProps) {
  const [deskState, setDeskState] = useState(createInitialLocalizationDeskState);
  const { runs: manualCommandRuns, prependRun, replaceRuns } = useManualCommandRuns(
    props.manualCommandRuns || [],
    props.workbenchStateKey
  );
  const {
    state: whiteboardState,
    setState: setWhiteboardState,
  } = useTimelineWhiteboard(props.timelineWhiteboard || [], props.workbenchStateKey);
  const [runningManualCommand, setRunningManualCommand] = useState(false);
  const [manualCommandError, setManualCommandError] = useState<string | null>(null);

  useEffect(() => {
    setDeskState(createInitialLocalizationDeskState());
    replaceRuns(props.manualCommandRuns || []);
    setWhiteboardState(replaceTimelineWhiteboardNodes(props.timelineWhiteboard || []));
    setManualCommandError(null);
  }, [props.workbenchStateKey]);

  function commitWhiteboard(nextState: typeof whiteboardState) {
    setWhiteboardState(nextState);
    props.onTimelineWhiteboardChange?.(nextState.nodes);
  }

  function sendLogToWhiteboard(log: LocalizationDeskSessionLogItem) {
    commitWhiteboard(
      appendTimelineWhiteboardNode(whiteboardState, buildLogWhiteboardNode(log))
    );
  }

  function sendManualCommandToWhiteboard(run: ManualCommandRun) {
    commitWhiteboard(
      appendTimelineWhiteboardNode(whiteboardState, buildManualCommandWhiteboardNode(run))
    );
  }

  function sendCurrentSourceToWhiteboard() {
    if (!props.codeCurrentFrame) return;
    commitWhiteboard(
      appendTimelineWhiteboardNode(whiteboardState, buildSourceWhiteboardNode(props.codeCurrentFrame))
    );
  }

  async function handleRunManualCommand(command: string) {
    if (!props.onRunManualCommand) return;
    setRunningManualCommand(true);
    setManualCommandError(null);
    try {
      const nextRun = await props.onRunManualCommand(command);
      if (!nextRun) return;
      const normalizedRun = prependRun(nextRun, 12);
      const nextRuns = [normalizedRun, ...manualCommandRuns.filter((item) => item.id !== normalizedRun.id)].slice(0, 12);
      props.onManualCommandRunsChange?.(nextRuns);
    } catch (error) {
      setManualCommandError(error instanceof Error ? error.message : '手动命令执行失败');
    } finally {
      setRunningManualCommand(false);
    }
  }

  return (
    <div className="diagnostic-localization-desk">
      <div className="diagnostic-localization-desk__lanes">
        <SessionLogLane
          sessionLogs={props.sessionLogs}
          selectedSessionId={props.selectedSessionId}
          currentSessionLabel={props.currentSessionLabel}
          loading={props.loadingSessionLogs}
          evidenceCount={props.evidenceCount}
          isDark={props.isDark}
          currentAnchorLogId={deskState.currentAnchorLogId}
          logContextWindow={deskState.logContextWindow}
          onSelectAnchor={(logId) => setDeskState((current) => selectAnchorLog(current, logId))}
          onExpandBefore={() => setDeskState((current) => ({
            ...current,
            logContextWindow: expandLogContextWindow(current.logContextWindow, 'before', 20),
          }))}
          onExpandAfter={() => setDeskState((current) => ({
            ...current,
            logContextWindow: expandLogContextWindow(current.logContextWindow, 'after', 20),
          }))}
          onOpenRawLogs={props.onOpenRawLogs}
          onOpenEvidenceBasket={props.onOpenEvidenceBasket}
          onLockEvidence={props.onLockSessionLogEvidence}
          onSendToWhiteboard={sendLogToWhiteboard}
          onLocateSource={(request) => props.onLocateSessionLogSource(request)}
          canLocateSource={props.canLocateSessionLogSource}
        />
        <ManualCommandLane
          selectedSessionId={props.selectedSessionId}
          runs={manualCommandRuns}
          running={runningManualCommand}
          errorMessage={manualCommandError}
          onRunCommand={handleRunManualCommand}
          onSendToWhiteboard={sendManualCommandToWhiteboard}
        />
        <CodeProvenanceLane
          binding={props.activeCodeContext || props.persistedActiveCodeBinding || null}
          isDark={props.isDark}
          currentFrame={props.codeCurrentFrame}
          navigationStack={props.codeNavigationStack}
          forwardTargets={props.codeForwardTargets}
          onExpandAbove={props.onExpandCodeAbove}
          onExpandBelow={props.onExpandCodeBelow}
          onOpenFullFunction={props.onOpenCodeFullFunction}
          onNavigateForward={props.onNavigateCodeForward}
          onJumpBack={props.onJumpBackInCode}
          onSendCurrentFrameToWhiteboard={sendCurrentSourceToWhiteboard}
        />
      </div>
      <TimelineWhiteboard
        nodes={whiteboardState.nodes}
        selectedNodeId={whiteboardState.selectedNodeId}
        isDark={props.isDark}
        onSelectNode={(nodeId) => commitWhiteboard(selectTimelineWhiteboardNode(whiteboardState, nodeId))}
        onCreateNote={(input: TimelineWhiteboardManualNoteInput) => commitWhiteboard(appendTimelineWhiteboardNote(whiteboardState, input))}
        onMoveNode={(nodeId, direction) => commitWhiteboard(moveTimelineWhiteboardNode(whiteboardState, nodeId, direction))}
        onRemoveNode={(nodeId) => commitWhiteboard(removeTimelineWhiteboardNode(whiteboardState, nodeId))}
        onClearBoard={() => commitWhiteboard(clearTimelineWhiteboard())}
      />
    </div>
  );
}
