export type TerminalBufferType = 'normal' | 'alternate';

export type TerminalScrollMode = 'following' | 'history';

export interface TerminalScrollMetrics {
  visible: boolean;
  bufferType: TerminalBufferType;
  viewportY: number;
  rows: number;
  bufferLength: number;
}

export interface TerminalScrollOverlayState {
  visible: boolean;
  bufferType: TerminalBufferType;
  mode: TerminalScrollMode;
}

const DEFAULT_BOTTOM_THRESHOLD_ROWS = 2;

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function isTerminalNearBottom(
  metrics: TerminalScrollMetrics,
  thresholdRows = DEFAULT_BOTTOM_THRESHOLD_ROWS,
): boolean {
  if (!metrics.visible || metrics.bufferType !== 'normal') return true;
  if (
    !isFiniteNonNegative(metrics.viewportY)
    || !isFiniteNonNegative(metrics.rows)
    || !isFiniteNonNegative(metrics.bufferLength)
  ) {
    return true;
  }

  const viewportEnd = metrics.viewportY + metrics.rows;
  const distanceFromBottom = metrics.bufferLength - viewportEnd;
  return distanceFromBottom <= Math.max(0, thresholdRows);
}

export function getNextTerminalScrollMode(
  _current: TerminalScrollMode,
  metrics: TerminalScrollMetrics,
): TerminalScrollMode {
  if (!metrics.visible || metrics.bufferType !== 'normal') return 'following';
  return isTerminalNearBottom(metrics) ? 'following' : 'history';
}

export function shouldShowTerminalScrollOverlay(state: TerminalScrollOverlayState): boolean {
  return state.visible && state.bufferType === 'normal' && state.mode === 'history';
}
