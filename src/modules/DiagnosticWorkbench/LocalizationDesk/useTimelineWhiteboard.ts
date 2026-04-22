import { useEffect, useState } from 'react';

export type TimelineWhiteboardNodeKind = 'log' | 'command' | 'source' | 'note';
export type TimelineWhiteboardNodeAccent = 'default' | 'warning' | 'error';

export interface TimelineWhiteboardNodeInput {
  id?: string;
  kind: TimelineWhiteboardNodeKind;
  title: string;
  excerpt?: string;
  timestamp?: number | null;
  sourceType: string;
  sourceId?: string;
  accent?: TimelineWhiteboardNodeAccent;
}

export interface TimelineWhiteboardManualNoteInput {
  title?: string;
  excerpt: string;
  timestamp?: number | null;
}

export interface TimelineWhiteboardNode {
  id: string;
  kind: TimelineWhiteboardNodeKind;
  title: string;
  excerpt: string;
  timestamp: number | null;
  sourceType: string;
  sourceId: string;
  accent: TimelineWhiteboardNodeAccent;
}

export interface TimelineWhiteboardState {
  nodes: TimelineWhiteboardNode[];
  selectedNodeId: string | null;
}

function makeTimelineNodeId() {
  return `timeline-node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value: string | undefined, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeTimestamp(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function createEmptyTimelineWhiteboardState(): TimelineWhiteboardState {
  return {
    nodes: [],
    selectedNodeId: null,
  };
}

export function buildTimelineWhiteboardNode(
  input: TimelineWhiteboardNodeInput | TimelineWhiteboardNode
): TimelineWhiteboardNode {
  const raw = input as unknown as Record<string, unknown>;
  const inferredKind =
    input.kind === 'command' || input.kind === 'source' || input.kind === 'note'
      ? input.kind
      : raw.type === 'command_result'
        ? 'command'
        : 'log';
  const legacyExcerpt = [raw.cmd, raw.message, raw.stdout, raw.stderr]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const rawExitCode = Number(raw.exitCode);
  const inferredAccent =
    input.accent === 'warning' || input.accent === 'error'
      ? input.accent
      : raw.level === 'error' || (Number.isFinite(rawExitCode) && rawExitCode !== 0)
        ? 'error'
        : raw.level === 'warning'
          ? 'warning'
          : 'default';

  return {
    id: normalizeText(input.id, makeTimelineNodeId()),
    kind: inferredKind,
    title: normalizeText(input.title, normalizeText(String(raw.message || raw.type || ''), '未命名节点')),
    excerpt: normalizeText(input.excerpt, legacyExcerpt),
    timestamp: normalizeTimestamp(input.timestamp ?? (raw.ts as number | null | undefined)),
    sourceType: normalizeText(input.sourceType, normalizeText(String(raw.type || ''), 'manual')),
    sourceId: normalizeText(input.sourceId, normalizeText(String(raw.id || ''))),
    accent: inferredAccent,
  };
}

export function appendTimelineWhiteboardNode(
  current: TimelineWhiteboardState,
  input: TimelineWhiteboardNodeInput | TimelineWhiteboardNode
): TimelineWhiteboardState {
  const nextNode = buildTimelineWhiteboardNode(input);
  const nodes = [...current.nodes.filter((item) => item.id !== nextNode.id), nextNode];

  return {
    nodes,
    selectedNodeId: nextNode.id,
  };
}

export function appendTimelineWhiteboardNote(
  current: TimelineWhiteboardState,
  input: TimelineWhiteboardManualNoteInput
): TimelineWhiteboardState {
  return appendTimelineWhiteboardNode(current, {
    kind: 'note',
    title: normalizeText(input.title, '人工备注'),
    excerpt: normalizeText(input.excerpt),
    timestamp: normalizeTimestamp(input.timestamp),
    sourceType: 'manual_note',
    accent: 'default',
  });
}

export function selectTimelineWhiteboardNode(
  current: TimelineWhiteboardState,
  nodeId: string | null
): TimelineWhiteboardState {
  if (!nodeId) {
    return {
      ...current,
      selectedNodeId: null,
    };
  }

  const exists = current.nodes.some((item) => item.id === nodeId);
  if (!exists || current.selectedNodeId === nodeId) {
    return current;
  }

  return {
    ...current,
    selectedNodeId: nodeId,
  };
}

export function moveTimelineWhiteboardNode(
  current: TimelineWhiteboardState,
  nodeId: string,
  direction: 'up' | 'down'
): TimelineWhiteboardState {
  const index = current.nodes.findIndex((item) => item.id === nodeId);
  if (index < 0) return current;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= current.nodes.length) {
    return current;
  }

  const nodes = [...current.nodes];
  [nodes[index], nodes[targetIndex]] = [nodes[targetIndex], nodes[index]];

  return {
    ...current,
    nodes,
  };
}

export function removeTimelineWhiteboardNode(
  current: TimelineWhiteboardState,
  nodeId: string
): TimelineWhiteboardState {
  const index = current.nodes.findIndex((item) => item.id === nodeId);
  if (index < 0) return current;

  const nodes = current.nodes.filter((item) => item.id !== nodeId);
  if (nodes.length === 0) {
    return createEmptyTimelineWhiteboardState();
  }

  const nextSelectedId =
    current.selectedNodeId === nodeId
      ? nodes[clampIndex(index, nodes.length)]?.id || null
      : nodes.some((item) => item.id === current.selectedNodeId)
        ? current.selectedNodeId
        : nodes[nodes.length - 1]?.id || null;

  return {
    nodes,
    selectedNodeId: nextSelectedId,
  };
}

export function clearTimelineWhiteboard(_current?: TimelineWhiteboardState): TimelineWhiteboardState {
  return createEmptyTimelineWhiteboardState();
}

export function replaceTimelineWhiteboardNodes(
  inputs: Array<TimelineWhiteboardNodeInput | TimelineWhiteboardNode> = []
): TimelineWhiteboardState {
  const nodes = inputs.map((item) => buildTimelineWhiteboardNode(item));
  return {
    nodes,
    selectedNodeId: nodes[nodes.length - 1]?.id || null,
  };
}

export function useTimelineWhiteboard(
  initialNodes: Array<TimelineWhiteboardNodeInput | TimelineWhiteboardNode> = [],
  resetKey?: string
) {
  const [state, setState] = useState<TimelineWhiteboardState>(() => replaceTimelineWhiteboardNodes(initialNodes));

  useEffect(() => {
    setState(replaceTimelineWhiteboardNodes(initialNodes));
  }, [resetKey]);

  function appendNode(input: TimelineWhiteboardNodeInput | TimelineWhiteboardNode) {
    const nextNode = buildTimelineWhiteboardNode(input);
    setState((current) => appendTimelineWhiteboardNode(current, nextNode));
    return nextNode;
  }

  function addNote(input: TimelineWhiteboardManualNoteInput) {
    let createdNote: TimelineWhiteboardNode | null = null;
    setState((current) => {
      const next = appendTimelineWhiteboardNote(current, input);
      createdNote = next.nodes.at(-1) || null;
      return next;
    });
    return createdNote;
  }

  function selectNode(nodeId: string | null) {
    setState((current) => selectTimelineWhiteboardNode(current, nodeId));
  }

  function moveNode(nodeId: string, direction: 'up' | 'down') {
    setState((current) => moveTimelineWhiteboardNode(current, nodeId, direction));
  }

  function removeNode(nodeId: string) {
    setState((current) => removeTimelineWhiteboardNode(current, nodeId));
  }

  function clearBoard() {
    setState(clearTimelineWhiteboard());
  }

  function replaceNodes(nextNodes: Array<TimelineWhiteboardNodeInput | TimelineWhiteboardNode> = []) {
    setState(replaceTimelineWhiteboardNodes(nextNodes));
  }

  return {
    state,
    nodes: state.nodes,
    selectedNodeId: state.selectedNodeId,
    appendNode,
    addNote,
    selectNode,
    moveNode,
    removeNode,
    clearBoard,
    replaceNodes,
    setState,
  };
}
