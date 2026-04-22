import type { ManualCommandRunInput } from './useManualCommandRuns.ts';
import type { TimelineWhiteboardNode } from './useTimelineWhiteboard.ts';
import type {
  LocalizationDeskCodeContextSummary,
} from './types.ts';

export interface FlowWorkbenchRunState {
  id: string;
  manualCommandRuns?: ManualCommandRunInput[];
  activeCodeBinding?: LocalizationDeskCodeContextSummary | null;
  timelineWhiteboard?: TimelineWhiteboardNode[];
}

export interface CodeContextBindingDraftInput {
  repo: string;
  branch: string;
  commit: string;
}

export function getLocalizationDeskStateKey(
  flowRun: Pick<FlowWorkbenchRunState, 'id'> | null,
  selectedSessionId?: string
) {
  return flowRun ? `run:${flowRun.id}` : `live:${selectedSessionId || 'none'}`;
}

export function getFlowRunManualCommandRuns(flowRun: FlowWorkbenchRunState | null) {
  return Array.isArray(flowRun?.manualCommandRuns) ? flowRun.manualCommandRuns : [];
}

export function getFlowRunTimelineWhiteboard(flowRun: FlowWorkbenchRunState | null) {
  return Array.isArray(flowRun?.timelineWhiteboard) ? flowRun.timelineWhiteboard : [];
}

export function getFlowRunActiveCodeBinding(flowRun: FlowWorkbenchRunState | null) {
  return flowRun?.activeCodeBinding || null;
}

export function toCodeContextBindingDraft(
  binding?: LocalizationDeskCodeContextSummary | null
): CodeContextBindingDraftInput | null {
  if (!binding) return null;

  const repo = String(binding.repo || binding.repoDisplayName || '').trim();
  const branch = String(binding.branch || '').trim();
  const commit = String(binding.commit || '').trim();

  if (!repo || !branch || !commit) {
    return null;
  }

  return {
    repo,
    branch,
    commit,
  };
}
