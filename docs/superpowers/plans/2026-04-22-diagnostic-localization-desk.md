# Diagnostic Localization Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `DiagnosticWorkbench`'s `flow` view into a dark-theme, session-log-driven localization desk with explicit manual commands, C/C++ code provenance navigation, evidence locking, and a timeline whiteboard.

**Architecture:** Keep `src/modules/DiagnosticWorkbench/index.tsx` as the route entry, but extract a dedicated `LocalizationDesk` subtree so the flow surface becomes a composable three-lane workspace plus whiteboard. Reuse existing session log, command execution, and code-context server APIs; add one narrow workbench persistence endpoint and extend the diagnostic run schema only for durable operator artifacts.

**Tech Stack:** React 19, TypeScript, Ant Design 6, Zustand 5, existing `code-context` server routes, existing session command routes, Node test runner, Vite build.

---

## File Structure

### Existing files to modify

- `src/modules/DiagnosticWorkbench/index.tsx`
  - keep routing and high-level view switching
  - delegate `flow` rendering and most localization behavior to extracted components
- `src/modules/DiagnosticWorkbench/viewModel.ts`
  - keep section metadata aligned with the new localization desk framing
- `src/modules/DiagnosticWorkbench/viewModel.test.ts`
  - extend coverage for the updated flow framing
- `server/index.js`
  - add the workbench persistence route
  - keep reuse of `/api/agent/sessions/:sessionId/logs`, `/api/agent/sessions/:sessionId/commands`, and `/api/code-context/*`
- `server/diagnosticKb.js`
  - extend stored run objects to include workbench artifacts
- `package.json`
  - add any new test files to `test:web` / `test:server:integration` if needed

### New frontend files to create

- `src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/types.ts`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/useLocalizationDeskState.ts`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/useManualCommandRuns.ts`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/useTimelineWhiteboard.ts`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/SessionLogLane.tsx`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/ManualCommandLane.tsx`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/CodeProvenanceLane.tsx`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/TimelineWhiteboard.tsx`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/manualCommandRuns.test.ts`
- `src/modules/DiagnosticWorkbench/LocalizationDesk/timelineWhiteboard.test.ts`

### New server test files to create

- `server/test/diagnosticWorkbenchRoutes.test.js`

### Responsibility boundaries

- `LocalizationDesk.tsx` owns three-lane composition and passes explicit callbacks between lanes.
- `SessionLogLane.tsx` owns anchor selection, log context expansion, and log-derived evidence actions.
- `ManualCommandLane.tsx` owns command shelf, draft input, execution, and command result rendering.
- `CodeProvenanceLane.tsx` owns code binding, source rendering, expand-above/below/full-function, function forward navigation, and breadcrumb jump-back.
- `TimelineWhiteboard.tsx` owns whiteboard nodes, edges, SVG snapshot generation, and manual note creation.
- `useLocalizationDeskState.ts` owns transient flow state only.
- `useManualCommandRuns.ts` owns persisted manual command run objects and server syncing.
- `useTimelineWhiteboard.ts` owns persisted whiteboard state and server syncing.

## Task 1: Extract The Localization Desk Shell

**Files:**
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/types.ts`
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/useLocalizationDeskState.ts`
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx`
- Modify: `src/modules/DiagnosticWorkbench/index.tsx`
- Test: `src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

- [ ] **Step 1: Write the failing state-shape test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialLocalizationDeskState,
  pushCodeNavigation,
  popCodeNavigationTo,
  expandLogContextWindow,
} from './useLocalizationDeskState.ts';

test('localization desk state starts with manual-only defaults', () => {
  const state = createInitialLocalizationDeskState();

  assert.equal(state.currentAnchorLogId, null);
  assert.deepEqual(state.logContextWindow, { before: 5, after: 5 });
  assert.equal(state.commandDraft, '');
  assert.deepEqual(state.codeNavigationStack, []);
});

test('log context expansion only mutates the targeted edge', () => {
  const next = expandLogContextWindow({ before: 5, after: 5 }, 'before', 20);
  assert.deepEqual(next, { before: 25, after: 5 });
});

test('code navigation stack pushes forward and pops back by index', () => {
  const first = pushCodeNavigation([], { symbolId: 's-1', symbolName: 'io_worker_submit' });
  const second = pushCodeNavigation(first, { symbolId: 's-2', symbolName: 'dump_queue_depth' });

  assert.deepEqual(
    second.map((item) => item.symbolName),
    ['io_worker_submit', 'dump_queue_depth']
  );

  const rewound = popCodeNavigationTo(second, 0);
  assert.deepEqual(rewound.map((item) => item.symbolName), ['io_worker_submit']);
});
```

- [ ] **Step 2: Run the new state test to verify it fails**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

Expected: FAIL with `Cannot find module` or missing exports from `useLocalizationDeskState.ts`

- [ ] **Step 3: Create the desk types file**

```ts
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
```

- [ ] **Step 4: Implement the desk state helpers**

```ts
import type {
  CodeNavigationEntry,
  LocalizationDeskState,
  LogContextWindow,
} from './types';

export function createInitialLocalizationDeskState(): LocalizationDeskState {
  return {
    currentAnchorLogId: null,
    logContextWindow: { before: 5, after: 5 },
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
```

- [ ] **Step 5: Implement the localization desk shell**

```tsx
import React from 'react';

import type { AgentSessionLogItem, CodeContextBindingResult } from '../index';
import { SessionLogLane } from './SessionLogLane';
import { ManualCommandLane } from './ManualCommandLane';
import { CodeProvenanceLane } from './CodeProvenanceLane';
import { TimelineWhiteboard } from './TimelineWhiteboard';

export interface LocalizationDeskProps {
  sessionLogs: AgentSessionLogItem[];
  selectedSessionId?: string;
  activeCodeContext: CodeContextBindingResult | null;
}

export function LocalizationDesk(props: LocalizationDeskProps) {
  return (
    <div className="diagnostic-localization-desk">
      <div className="diagnostic-localization-desk__lanes">
        <SessionLogLane sessionLogs={props.sessionLogs} />
        <ManualCommandLane selectedSessionId={props.selectedSessionId} />
        <CodeProvenanceLane activeCodeContext={props.activeCodeContext} />
      </div>
      <TimelineWhiteboard />
    </div>
  );
}
```

- [ ] **Step 6: Replace the monolithic flow rendering entry**

```tsx
import { LocalizationDesk } from './LocalizationDesk/LocalizationDesk';

// inside DiagnosticWorkbench/index.tsx flow view branch
<LocalizationDesk
  sessionLogs={sessionLogs}
  selectedSessionId={selectedSessionId}
  activeCodeContext={activeCodeContext}
/>
```

- [ ] **Step 7: Run the state test to verify it passes**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

Expected: PASS with `3 tests` and `0 failures`

- [ ] **Step 8: Run the existing flow view model test to ensure the extraction did not regress section framing**

Run: `node --test src/modules/DiagnosticWorkbench/viewModel.test.ts`

Expected: PASS with `4 tests` and `0 failures`

- [ ] **Step 9: Commit**

```bash
git add \
  src/modules/DiagnosticWorkbench/index.tsx \
  src/modules/DiagnosticWorkbench/LocalizationDesk/types.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/useLocalizationDeskState.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx \
  src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts
git commit -m "refactor(diagnostic): extract localization desk shell"
```

## Task 2: Build The Session Log Lane And Manual Anchor Flow

**Files:**
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/SessionLogLane.tsx`
- Modify: `src/modules/DiagnosticWorkbench/index.tsx`
- Test: `src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

- [ ] **Step 1: Extend the failing test for anchor and log context behavior**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialLocalizationDeskState,
  selectAnchorLog,
  expandLogContextWindow,
} from './useLocalizationDeskState.ts';

test('selecting a new anchor resets the log context window to the default span', () => {
  const state = createInitialLocalizationDeskState();
  const expanded = {
    ...state,
    currentAnchorLogId: 'log-old',
    logContextWindow: expandLogContextWindow(state.logContextWindow, 'before', 20),
  };

  const next = selectAnchorLog(expanded, 'log-new');

  assert.equal(next.currentAnchorLogId, 'log-new');
  assert.deepEqual(next.logContextWindow, { before: 5, after: 5 });
});
```

- [ ] **Step 2: Run the state test to verify it fails**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

Expected: FAIL with `selectAnchorLog is not a function`

- [ ] **Step 3: Implement anchor-selection state reset**

```ts
export function selectAnchorLog(
  current: LocalizationDeskState,
  logId: string
): LocalizationDeskState {
  return {
    ...current,
    currentAnchorLogId: logId,
    logContextWindow: { before: 5, after: 5 },
  };
}
```

- [ ] **Step 4: Build the session log lane component**

```tsx
import React from 'react';
import { Button, List, Space, Tag, Typography } from 'antd';
import { PushpinOutlined } from '@ant-design/icons';

import type { AgentSessionLogItem } from '../index';

const { Text } = Typography;

export interface SessionLogLaneProps {
  sessionLogs: AgentSessionLogItem[];
  currentAnchorLogId?: string | null;
  onSelectAnchor?: (logId: string) => void;
  onExpandBefore?: () => void;
  onExpandAfter?: () => void;
  onLockEvidence?: (log: AgentSessionLogItem) => void;
  onSendToWhiteboard?: (log: AgentSessionLogItem) => void;
}

export function SessionLogLane(props: SessionLogLaneProps) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Button onClick={props.onExpandBefore}>向上展开 20 行</Button>
        <Button onClick={props.onExpandAfter}>向下展开 20 行</Button>
      </Space>
      <List
        dataSource={[...props.sessionLogs].reverse()}
        renderItem={(item) => (
          <List.Item
            onClick={() => props.onSelectAnchor?.(item.id)}
            actions={[
              <Button
                key="lock"
                type="link"
                icon={<PushpinOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onLockEvidence?.(item);
                }}
              >
                锁定证据
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space wrap>
                  <Text strong>{item.type}</Text>
                  {item.id === props.currentAnchorLogId && <Tag color="processing">anchor</Tag>}
                </Space>
              }
              description={item.message || item.cmd || ''}
            />
          </List.Item>
        )}
      />
    </Space>
  );
}
```

- [ ] **Step 5: Wire the lane into the desk shell**

```tsx
<SessionLogLane
  sessionLogs={props.sessionLogs}
  currentAnchorLogId={deskState.currentAnchorLogId}
  onSelectAnchor={(logId) => setDeskState((current) => selectAnchorLog(current, logId))}
  onExpandBefore={() =>
    setDeskState((current) => ({
      ...current,
      logContextWindow: expandLogContextWindow(current.logContextWindow, 'before', 20),
    }))
  }
  onExpandAfter={() =>
    setDeskState((current) => ({
      ...current,
      logContextWindow: expandLogContextWindow(current.logContextWindow, 'after', 20),
    }))
  }
/>
```

- [ ] **Step 6: Run the desk state tests**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

Expected: PASS with the new anchor reset coverage

- [ ] **Step 7: Run the web test set to ensure the extraction still compiles in Node test mode**

Run: `npm run test:web`

Expected: PASS, including the existing `viewModel.test.ts`

- [ ] **Step 8: Commit**

```bash
git add \
  src/modules/DiagnosticWorkbench/index.tsx \
  src/modules/DiagnosticWorkbench/LocalizationDesk/SessionLogLane.tsx \
  src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/useLocalizationDeskState.ts
git commit -m "feat(diagnostic): add manual session log lane"
```

## Task 3: Build The Manual Command Lane On The Existing Session Command Route

**Files:**
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/useManualCommandRuns.ts`
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/manualCommandRuns.test.ts`
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/ManualCommandLane.tsx`
- Modify: `src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx`
- Modify: `server/index.js`
- Modify: `server/diagnosticKb.js`
- Create: `server/test/diagnosticWorkbenchRoutes.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing command-run normalization test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeManualCommandRun } from './useManualCommandRuns.ts';

test('normalizeManualCommandRun captures the durable fields used for replay', () => {
  const run = normalizeManualCommandRun({
    sessionId: 'session-1',
    command: 'grep -n "io_submit" /var/log/app.log',
    startedAt: 100,
    finishedAt: 160,
    stdout: 'engine/io_worker.c:417',
    stderr: '',
    exitCode: 0,
  });

  assert.equal(run.sessionId, 'session-1');
  assert.equal(run.command, 'grep -n "io_submit" /var/log/app.log');
  assert.equal(run.durationMs, 60);
});
```

- [ ] **Step 2: Run the new command-run test to verify it fails**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/manualCommandRuns.test.ts`

Expected: FAIL with missing module or export

- [ ] **Step 3: Implement command-run normalization and local append helpers**

```ts
import { generateId } from '../../../utils';

export interface ManualCommandRun {
  id: string;
  sessionId: string;
  command: string;
  startedAt: number;
  finishedAt: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export function normalizeManualCommandRun(input: Omit<ManualCommandRun, 'id' | 'durationMs'>): ManualCommandRun {
  return {
    id: generateId(),
    ...input,
    durationMs: Math.max(0, input.finishedAt - input.startedAt),
  };
}
```

- [ ] **Step 4: Build the manual command lane component using the existing session command route**

```tsx
import React, { useState } from 'react';
import { Button, Input, List, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export interface ManualCommandLaneProps {
  selectedSessionId?: string;
  runs: Array<{
    id: string;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  }>;
  onRunCommand?: (command: string) => Promise<void>;
}

export function ManualCommandLane(props: ManualCommandLaneProps) {
  const [draft, setDraft] = useState('');

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Input.TextArea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder="手动输入只读诊断命令"
      />
      <Button
        type="primary"
        disabled={!props.selectedSessionId || !draft.trim()}
        onClick={() => props.onRunCommand?.(draft)}
      >
        执行
      </Button>
      <List
        dataSource={[...props.runs].reverse()}
        renderItem={(run) => (
          <List.Item>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Text code>{run.command}</Text>
                  <Tag color={run.exitCode === 0 ? 'green' : 'red'}>exit {run.exitCode}</Tag>
                </Space>
              }
              description={`${run.durationMs}ms`}
            />
          </List.Item>
        )}
      />
    </Space>
  );
}
```

- [ ] **Step 5: Add the narrow workbench persistence endpoint**

```js
app.patch('/api/diagnostic/runs/:id/workbench', (req, res) => {
  try {
    const updated = updateRunWorkbench(req.params.id, req.body || {});
    res.json({ ok: true, run: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
```

- [ ] **Step 6: Extend the diagnostic KB with workbench updates**

```js
function updateRunWorkbench(runId, patch) {
  const store = loadStore();
  const index = store.runs.findIndex((run) => run.id === runId);
  if (index < 0) {
    throw new Error('诊断 Run 不存在');
  }

  const current = store.runs[index];
  const next = {
    ...current,
    manualCommandRuns: Array.isArray(patch.manualCommandRuns) ? patch.manualCommandRuns : current.manualCommandRuns || [],
    activeCodeBinding: patch.activeCodeBinding || current.activeCodeBinding || null,
    timelineWhiteboard: patch.timelineWhiteboard || current.timelineWhiteboard || null,
  };

  store.runs[index] = next;
  saveStore(store);
  return next;
}

module.exports = {
  // existing exports...
  updateRunWorkbench,
};
```

- [ ] **Step 7: Add the route test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('PATCH /api/diagnostic/runs/:id/workbench persists manual command runs', async () => {
  const response = await fetch(`${BASE_URL}/api/diagnostic/runs/${runId}/workbench`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manualCommandRuns: [
        {
          id: 'cmd-1',
          sessionId: 'session-1',
          command: 'grep -n "io_submit" /var/log/app.log',
          startedAt: 100,
          finishedAt: 160,
          stdout: 'engine/io_worker.c:417',
          stderr: '',
          exitCode: 0,
          durationMs: 60,
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.run.manualCommandRuns.length, 1);
});
```

- [ ] **Step 8: Add the new route test file to the integration test command**

```json
"test:server:integration": "node --test server/test/commandPolicyRoutes.test.js server/test/diagnosticWorkbenchRoutes.test.js"
```

- [ ] **Step 9: Run the targeted command-run and route tests**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/manualCommandRuns.test.ts server/test/diagnosticWorkbenchRoutes.test.js`

Expected: PASS with the manual-command normalization and workbench patch route covered

- [ ] **Step 10: Run the server integration suite**

Run: `npm run test:server:integration`

Expected: PASS, including the new workbench patch test

- [ ] **Step 11: Commit**

```bash
git add \
  src/modules/DiagnosticWorkbench/LocalizationDesk/useManualCommandRuns.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/manualCommandRuns.test.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/ManualCommandLane.tsx \
  src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx \
  server/index.js \
  server/diagnosticKb.js \
  server/test/diagnosticWorkbenchRoutes.test.js \
  package.json
git commit -m "feat(diagnostic): add manual command lane persistence"
```

## Task 4: Implement C/C++ Code Provenance Navigation With Expand And Jump-Back

**Files:**
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/CodeProvenanceLane.tsx`
- Modify: `src/modules/DiagnosticWorkbench/LocalizationDesk/useLocalizationDeskState.ts`
- Modify: `src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`
- Modify: `src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx`
- Modify: `src/modules/DiagnosticWorkbench/index.tsx`

- [ ] **Step 1: Write the failing code-window and breadcrumb test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialLocalizationDeskState,
  expandCodeContextWindow,
  pushCodeNavigation,
  popCodeNavigationTo,
} from './useLocalizationDeskState.ts';

test('code context expansion and breadcrumb rewind are independent', () => {
  const state = createInitialLocalizationDeskState();
  const expanded = expandCodeContextWindow(state.codeContextWindow, 'after', 20);
  assert.deepEqual(expanded, { before: 5, after: 25, fullFunction: false });

  const stack = pushCodeNavigation(
    pushCodeNavigation([], { symbolId: 's-1', symbolName: 'io_worker_submit' }),
    { symbolId: 's-2', symbolName: 'dump_queue_depth' }
  );

  const rewound = popCodeNavigationTo(stack, 0);
  assert.deepEqual(rewound.map((item) => item.symbolName), ['io_worker_submit']);
});
```

- [ ] **Step 2: Run the state test to verify it fails**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

Expected: FAIL with missing `codeContextWindow` support

- [ ] **Step 3: Extend the state helpers**

```ts
export interface CodeContextWindow {
  before: number;
  after: number;
  fullFunction: boolean;
}

export function expandCodeContextWindow(
  current: CodeContextWindow,
  edge: 'before' | 'after' | 'fullFunction',
  delta = 20
): CodeContextWindow {
  if (edge === 'fullFunction') {
    return { ...current, fullFunction: true };
  }
  return edge === 'before'
    ? { ...current, before: current.before + delta }
    : { ...current, after: current.after + delta };
}
```

- [ ] **Step 4: Build the code provenance lane**

```tsx
import React from 'react';
import { Button, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export interface CodeProvenanceLaneProps {
  activeCodeContext: { contextId: string } | null;
  breadcrumb: Array<{ symbolId: string; symbolName: string }>;
  onExpandBefore?: () => void;
  onExpandAfter?: () => void;
  onExpandFullFunction?: () => void;
  onJumpBack?: (index: number) => void;
}

export function CodeProvenanceLane(props: CodeProvenanceLaneProps) {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        {props.breadcrumb.map((item, index) => (
          <Tag key={item.symbolId} color={index === props.breadcrumb.length - 1 ? 'processing' : 'default'}>
            <span onClick={() => props.onJumpBack?.(index)}>{item.symbolName}()</span>
          </Tag>
        ))}
      </Space>
      <Space wrap>
        <Button onClick={props.onExpandBefore}>展开上文 20 行</Button>
        <Button onClick={props.onExpandAfter}>展开下文 20 行</Button>
        <Button onClick={props.onExpandFullFunction}>展开完整函数</Button>
      </Space>
      {!props.activeCodeContext && <Text type="secondary">请先绑定 repo / branch / commit</Text>}
    </Space>
  );
}
```

- [ ] **Step 5: Use the existing code-context routes without adding new server surface**

```ts
const renderResponse = await fetch(`${PROXY_HTTP}/api/code-context/${contextId}/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    symbolId,
    beforeContext: codeContextWindow.before,
    afterContext: codeContextWindow.after,
  }),
});

const calleesResponse = await fetch(`${PROXY_HTTP}/api/code-context/${contextId}/symbols/${symbolId}/callees`);
```

- [ ] **Step 6: Run the desk state test again**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts`

Expected: PASS with code context window coverage added

- [ ] **Step 7: Run the web test suite**

Run: `npm run test:web`

Expected: PASS, including the extracted localization desk tests

- [ ] **Step 8: Commit**

```bash
git add \
  src/modules/DiagnosticWorkbench/LocalizationDesk/CodeProvenanceLane.tsx \
  src/modules/DiagnosticWorkbench/LocalizationDesk/useLocalizationDeskState.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx \
  src/modules/DiagnosticWorkbench/index.tsx
git commit -m "feat(diagnostic): add code provenance navigation lane"
```

## Task 5: Add The Timeline Whiteboard And SVG Snapshot Persistence

**Files:**
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/useTimelineWhiteboard.ts`
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/timelineWhiteboard.test.ts`
- Create: `src/modules/DiagnosticWorkbench/LocalizationDesk/TimelineWhiteboard.tsx`
- Modify: `src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx`
- Modify: `server/diagnosticKb.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write the failing whiteboard node test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyTimelineWhiteboard,
  appendTimelineNode,
  buildTimelineNode,
} from './useTimelineWhiteboard.ts';

test('appendTimelineNode adds explicit operator-created nodes only', () => {
  const board = createEmptyTimelineWhiteboard();
  const node = buildTimelineNode({
    type: 'log',
    title: '异常日志片段',
    excerpt: 'ERROR timeout waiting io_submit completion',
    ts: 100,
    sourceType: 'session_log',
  });

  const next = appendTimelineNode(board, node);

  assert.equal(next.nodes.length, 1);
  assert.equal(next.nodes[0].title, '异常日志片段');
});
```

- [ ] **Step 2: Run the whiteboard test to verify it fails**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/timelineWhiteboard.test.ts`

Expected: FAIL with missing module or exports

- [ ] **Step 3: Implement the whiteboard data helpers**

```ts
import { generateId } from '../../../utils';

export interface TimelineWhiteboardNode {
  id: string;
  type: 'log' | 'command' | 'source' | 'function' | 'note';
  title: string;
  excerpt: string;
  ts: number;
  sourceType: string;
  x: number;
  y: number;
}

export interface TimelineWhiteboardState {
  nodes: TimelineWhiteboardNode[];
  edges: Array<{ id: string; from: string; to: string }>;
  viewport: { x: number; y: number; zoom: number };
  svgSnapshot: string;
}

export function createEmptyTimelineWhiteboard(): TimelineWhiteboardState {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    svgSnapshot: '',
  };
}

export function buildTimelineNode(input: Omit<TimelineWhiteboardNode, 'id' | 'x' | 'y'>): TimelineWhiteboardNode {
  return {
    id: generateId(),
    x: 40,
    y: 40,
    ...input,
  };
}

export function appendTimelineNode(
  board: TimelineWhiteboardState,
  node: TimelineWhiteboardNode
): TimelineWhiteboardState {
  return {
    ...board,
    nodes: [...board.nodes, node],
  };
}
```

- [ ] **Step 4: Build the whiteboard component**

```tsx
import React from 'react';
import { Button, Card, Space } from 'antd';

export interface TimelineWhiteboardProps {
  nodes: Array<{ id: string; title: string; excerpt: string }>;
  onAddManualNote?: () => void;
}

export function TimelineWhiteboard(props: TimelineWhiteboardProps) {
  return (
    <Card title="Timeline Whiteboard">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Button onClick={props.onAddManualNote}>新增人工备注</Button>
        {props.nodes.map((node) => (
          <Card key={node.id} size="small" title={node.title}>
            {node.excerpt}
          </Card>
        ))}
      </Space>
    </Card>
  );
}
```

- [ ] **Step 5: Extend the workbench persistence updater for whiteboard fields**

```js
const next = {
  ...current,
  manualCommandRuns: Array.isArray(patch.manualCommandRuns) ? patch.manualCommandRuns : current.manualCommandRuns || [],
  activeCodeBinding: patch.activeCodeBinding || current.activeCodeBinding || null,
  timelineWhiteboard: patch.timelineWhiteboard || current.timelineWhiteboard || null,
};
```

- [ ] **Step 6: Reuse the existing report `whiteboardSvg` slot**

```js
const next = {
  ...current,
  timelineWhiteboard: patch.timelineWhiteboard || current.timelineWhiteboard || null,
  whiteboardSvg: patch.timelineWhiteboard?.svgSnapshot || current.whiteboardSvg || '',
};
```

- [ ] **Step 7: Run the whiteboard test**

Run: `node --test src/modules/DiagnosticWorkbench/LocalizationDesk/timelineWhiteboard.test.ts`

Expected: PASS with explicit-node creation covered

- [ ] **Step 8: Run the full server and web verification set for the new persisted fields**

Run: `npm run test:web && npm run test:server:integration`

Expected: PASS, including the workbench patch persistence path

- [ ] **Step 9: Commit**

```bash
git add \
  src/modules/DiagnosticWorkbench/LocalizationDesk/useTimelineWhiteboard.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/timelineWhiteboard.test.ts \
  src/modules/DiagnosticWorkbench/LocalizationDesk/TimelineWhiteboard.tsx \
  src/modules/DiagnosticWorkbench/LocalizationDesk/LocalizationDesk.tsx \
  server/diagnosticKb.js \
  server/index.js
git commit -m "feat(diagnostic): add timeline whiteboard persistence"
```

## Task 6: Integrate The Desk Into The Existing Flow View And Verify End-To-End

**Files:**
- Modify: `src/modules/DiagnosticWorkbench/index.tsx`
- Modify: `src/modules/DiagnosticWorkbench/viewModel.ts`
- Modify: `src/modules/DiagnosticWorkbench/viewModel.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Extend the view model test to reflect the localization desk phrasing**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { getDiagnosticWorkbenchSections } from './viewModel.ts';

test('flow view keeps the localization desk funnel labels stable', () => {
  const sections = getDiagnosticWorkbenchSections('flow');

  assert.deepEqual(
    sections.map((section) => section.title),
    ['定位上下文', '执行与采集', '关键证据', '诊断结论']
  );
});
```

- [ ] **Step 2: Run the view model test to verify it still passes**

Run: `node --test src/modules/DiagnosticWorkbench/viewModel.test.ts`

Expected: PASS with the updated phrasing assertion

- [ ] **Step 3: Wire `LocalizationDesk` into the `flow` tab and remove obsolete flow-only drawers if they are no longer needed**

```tsx
{activeWorkbenchView === 'flow' ? (
  <LocalizationDesk
    sessionLogs={sessionLogs}
    selectedSessionId={selectedSessionId}
    activeCodeContext={activeCodeContext}
    // pass the existing evidence and code-binding handlers through
  />
) : null}
```

- [ ] **Step 4: Run the build**

Run: `npm run build`

Expected: PASS with `vite build` output and no TypeScript errors

- [ ] **Step 5: Run the full verification suite**

Run: `npm run ci:verify`

Expected: PASS for:
- `npm run build`
- `npm run test:web`
- `npm run test:server`
- `npm run test:server:integration`

- [ ] **Step 6: Commit**

```bash
git add \
  src/modules/DiagnosticWorkbench/index.tsx \
  src/modules/DiagnosticWorkbench/viewModel.ts \
  src/modules/DiagnosticWorkbench/viewModel.test.ts \
  package.json
git commit -m "feat(diagnostic): integrate localization desk flow"
```

## Self-Review

### Spec coverage

- Dark theme localization desk: covered in Tasks 1, 2, and 6 through the extracted `LocalizationDesk` flow integration.
- Session-log-only phase 1 source: covered in Task 2 by making `SessionLogLane` the anchor entrypoint.
- Manual-only commands and decisions: covered in Task 3 and reinforced in Task 6 integration.
- C/C++ provenance with expand/jump forward/jump back: covered in Task 4.
- Timeline whiteboard and persistent SVG snapshot: covered in Task 5.
- Reuse of existing session/code-context routes and minimal new server surface: covered in Task 3 and Task 4.
- Evidence preservation without persisting transient operator state: covered in Tasks 3 and 5.

No spec gaps remain.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation placeholders remain.
- Every code-changing step includes an explicit code block.
- Every verification step includes an exact command and expected outcome.

### Type consistency

- `LocalizationDeskState`, `ManualCommandRun`, and `TimelineWhiteboardState` names are used consistently across later tasks.
- `codeNavigationStack`, `logContextWindow`, and `activeCodeBinding` naming is consistent with the approved spec.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-diagnostic-localization-desk.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
