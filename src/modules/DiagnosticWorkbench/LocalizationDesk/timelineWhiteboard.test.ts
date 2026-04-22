import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendTimelineWhiteboardNode,
  appendTimelineWhiteboardNote,
  buildTimelineWhiteboardNode,
  clearTimelineWhiteboard,
  createEmptyTimelineWhiteboardState,
  moveTimelineWhiteboardNode,
  removeTimelineWhiteboardNode,
  selectTimelineWhiteboardNode,
} from './useTimelineWhiteboard.ts';

test('timeline whiteboard state starts empty and manual only', () => {
  const state = createEmptyTimelineWhiteboardState();

  assert.deepEqual(state.nodes, []);
  assert.equal(state.selectedNodeId, null);
});

test('buildTimelineWhiteboardNode normalizes explicit operator-provided data', () => {
  const node = buildTimelineWhiteboardNode({
    kind: 'log',
    title: '异常日志片段',
    excerpt: 'ERROR timeout waiting io_submit completion',
    timestamp: 1713777000000,
    sourceType: 'session_log',
    sourceId: 'log-1',
    accent: 'error',
  });

  assert.match(node.id, /^timeline-node-/);
  assert.equal(node.kind, 'log');
  assert.equal(node.title, '异常日志片段');
  assert.equal(node.excerpt, 'ERROR timeout waiting io_submit completion');
  assert.equal(node.timestamp, 1713777000000);
  assert.equal(node.sourceType, 'session_log');
  assert.equal(node.sourceId, 'log-1');
  assert.equal(node.accent, 'error');
});

test('buildTimelineWhiteboardNode upgrades legacy session-log shaped items into log nodes', () => {
  const node = buildTimelineWhiteboardNode({
    id: 'legacy-log-1',
    type: 'command_result',
    message: 'blk_update_request I/O error',
    stdout: 'read timeout',
    stderr: '',
    ts: 1713777001000,
    exitCode: 1,
  } as unknown as Parameters<typeof buildTimelineWhiteboardNode>[0]);

  assert.equal(node.id, 'legacy-log-1');
  assert.equal(node.kind, 'command');
  assert.equal(node.title, 'blk_update_request I/O error');
  assert.match(node.excerpt, /read timeout/);
  assert.equal(node.timestamp, 1713777001000);
  assert.equal(node.sourceType, 'command_result');
  assert.equal(node.sourceId, 'legacy-log-1');
  assert.equal(node.accent, 'error');
});

test('appendTimelineWhiteboardNode deduplicates by id and selects the appended node', () => {
  const first = buildTimelineWhiteboardNode({
    id: 'log-1',
    kind: 'log',
    title: '第一次锚点',
    excerpt: 'blk_update_request I/O error',
    timestamp: 10,
    sourceType: 'session_log',
  });
  const second = buildTimelineWhiteboardNode({
    id: 'cmd-1',
    kind: 'command',
    title: '复现命令',
    excerpt: 'fio --name=verify --rw=randread',
    timestamp: 20,
    sourceType: 'manual_command',
  });

  const withFirst = appendTimelineWhiteboardNode(createEmptyTimelineWhiteboardState(), first);
  const withSecond = appendTimelineWhiteboardNode(withFirst, second);
  const refreshed = appendTimelineWhiteboardNode(withSecond, {
    ...first,
    excerpt: 'blk_update_request I/O error (重点保留)',
  });

  assert.deepEqual(
    withSecond.nodes.map((item) => item.id),
    ['log-1', 'cmd-1']
  );
  assert.deepEqual(
    refreshed.nodes.map((item) => item.id),
    ['cmd-1', 'log-1']
  );
  assert.equal(refreshed.nodes.at(-1)?.excerpt, 'blk_update_request I/O error (重点保留)');
  assert.equal(refreshed.selectedNodeId, 'log-1');
});

test('appendTimelineWhiteboardNote creates a manual note node with a stable default title', () => {
  const state = appendTimelineWhiteboardNote(createEmptyTimelineWhiteboardState(), {
    excerpt: '确认异常先出现在 nvme1n1，再扩散到 md0',
    timestamp: 30,
  });

  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].kind, 'note');
  assert.equal(state.nodes[0].title, '人工备注');
  assert.equal(state.nodes[0].sourceType, 'manual_note');
  assert.equal(state.selectedNodeId, state.nodes[0].id);
});

test('timeline whiteboard supports manual selection, reorder, remove, and clear', () => {
  const first = buildTimelineWhiteboardNode({
    id: 'a',
    kind: 'log',
    title: '日志',
    excerpt: 'first',
    timestamp: 1,
    sourceType: 'session_log',
  });
  const second = buildTimelineWhiteboardNode({
    id: 'b',
    kind: 'command',
    title: '命令',
    excerpt: 'second',
    timestamp: 2,
    sourceType: 'manual_command',
  });
  const third = buildTimelineWhiteboardNode({
    id: 'c',
    kind: 'source',
    title: '源码',
    excerpt: 'third',
    timestamp: 3,
    sourceType: 'source_snippet',
  });

  const seeded = [first, second, third].reduce(appendTimelineWhiteboardNode, createEmptyTimelineWhiteboardState());
  const selected = selectTimelineWhiteboardNode(seeded, 'b');
  const movedUp = moveTimelineWhiteboardNode(selected, 'b', 'up');
  const movedDown = moveTimelineWhiteboardNode(movedUp, 'b', 'down');
  const removed = removeTimelineWhiteboardNode(movedDown, 'b');
  const cleared = clearTimelineWhiteboard(removed);

  assert.equal(selected.selectedNodeId, 'b');
  assert.deepEqual(
    movedUp.nodes.map((item) => item.id),
    ['b', 'a', 'c']
  );
  assert.deepEqual(
    movedDown.nodes.map((item) => item.id),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    removed.nodes.map((item) => item.id),
    ['a', 'c']
  );
  assert.equal(removed.selectedNodeId, 'c');
  assert.deepEqual(cleared.nodes, []);
  assert.equal(cleared.selectedNodeId, null);
});

test('timeline whiteboard component exposes explicit manual controls for integration', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(currentDir, 'TimelineWhiteboard.tsx'), 'utf8');

  assert.match(source, /export interface TimelineWhiteboardProps/);
  assert.match(source, /nodes: TimelineWhiteboardNode\[\];/);
  assert.match(source, /onCreateNote\?\(input: TimelineWhiteboardManualNoteInput\): void;/);
  assert.match(source, /onMoveNode\?\(nodeId: string, direction: 'up' \| 'down'\): void;/);
  assert.match(source, /onRemoveNode\?\(nodeId: string\): void;/);
  assert.match(source, /onClearBoard\?\(\): void;/);
  assert.match(source, /手动整理时序节点，不做自动分析或建议/);
  assert.match(source, /新增备注/);
  assert.match(source, /上移/);
  assert.match(source, /下移/);
  assert.match(source, /移除/);
  assert.match(source, /清空白板/);
});
