# SSH Manager Terminal Scroll UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix SSH Manager xterm continuous-output scroll jitter and tighten the first-pass SSH Manager troubleshooting UX without removing existing capabilities.

**Architecture:** Keep `TerminalInstance` inside `src/modules/SSHManager/index.tsx` as the xterm lifecycle owner, but move scroll-follow decisions into a small pure helper module that can be tested independently. Gate expensive highlight snapshot refresh work behind active highlight rules, keep resize dedupe in `terminalResize.ts`, and add a narrow background job output update guard for the same class of log-refresh jitter.

**Tech Stack:** React 19, TypeScript, Ant Design 6, xterm 5, xterm-addon-fit, Zustand 5, Node test runner, Vite.

---

## File Structure

### Existing files to modify

- `src/modules/SSHManager/index.tsx`
  - wire the xterm scroll-follow state into `TerminalInstance`
  - skip screen snapshot refresh when no highlight rule exists
  - throttle highlight refresh when highlight rules exist
  - render a small `viewing history` / `back to bottom` control inside the terminal viewport wrapper
- `src/modules/SSHManager/components/BackgroundJobMonitor.tsx`
  - skip `updateJobOutput` when a `tail -n 200` poll returns the same output
  - keep prior output on polling errors
- `src/modules/SSHManager/store/backgroundJobStore.ts`
  - export a pure `shouldUpdateJobOutput(current, next)` helper
- `src/modules/SSHManager/components/SessionJournal.tsx`
  - tighten focused/raw wording around folded records
- `src/modules/SSHManager/components/KeywordAnalyzer.tsx`
  - align monitoring/noise wording with the journal focused view
- `package.json`
  - include new SSH Manager tests in `npm run test:web`

### New files to create

- `src/modules/SSHManager/terminalScroll.ts`
  - pure scroll-follow helpers and types
- `src/modules/SSHManager/terminalScroll.test.ts`
  - unit tests for bottom detection, follow pause/resume, overlay eligibility, and alternate buffer behavior
- `src/modules/SSHManager/store/backgroundJobStore.test.ts`
  - unit tests for output update guard behavior

### Responsibility boundaries

- `terminalScroll.ts` owns pure decisions only. It must not import React, xterm, Ant Design, Zustand, or DOM APIs.
- `TerminalInstance` owns xterm instance state, DOM wiring, overlay rendering, and callback registration.
- `terminalResize.ts` remains limited to resize dimension publication decisions.
- `BackgroundJobMonitor.tsx` owns polling flow; `backgroundJobStore.ts` owns persistent job data.
- `SessionJournal.tsx` and `KeywordAnalyzer.tsx` changes are UI wording/status adjustments only.

## Task 1: Add Terminal Scroll Decision Helpers

**Files:**
- Create: `src/modules/SSHManager/terminalScroll.ts`
- Create: `src/modules/SSHManager/terminalScroll.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing terminal scroll helper tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getNextTerminalScrollMode,
  isTerminalNearBottom,
  shouldShowTerminalScrollOverlay,
  type TerminalScrollMetrics,
} from './terminalScroll.ts';

function metrics(overrides: Partial<TerminalScrollMetrics> = {}): TerminalScrollMetrics {
  return {
    visible: true,
    bufferType: 'normal',
    viewportY: 90,
    rows: 10,
    bufferLength: 100,
    ...overrides,
  };
}

test('isTerminalNearBottom treats the current bottom and a small threshold as bottom', () => {
  assert.equal(isTerminalNearBottom(metrics({ viewportY: 90, rows: 10, bufferLength: 100 })), true);
  assert.equal(isTerminalNearBottom(metrics({ viewportY: 88, rows: 10, bufferLength: 100 })), true);
  assert.equal(isTerminalNearBottom(metrics({ viewportY: 87, rows: 10, bufferLength: 100 })), false);
});

test('getNextTerminalScrollMode pauses when the operator scrolls away from bottom', () => {
  assert.equal(
    getNextTerminalScrollMode('following', metrics({ viewportY: 60, rows: 10, bufferLength: 100 })),
    'history',
  );
});

test('getNextTerminalScrollMode resumes when the operator returns near bottom', () => {
  assert.equal(
    getNextTerminalScrollMode('history', metrics({ viewportY: 89, rows: 10, bufferLength: 100 })),
    'following',
  );
});

test('alternate and hidden terminals stay in following mode and suppress the overlay', () => {
  assert.equal(
    getNextTerminalScrollMode('history', metrics({ bufferType: 'alternate', viewportY: 5 })),
    'following',
  );
  assert.equal(
    getNextTerminalScrollMode('history', metrics({ visible: false, viewportY: 5 })),
    'following',
  );
  assert.equal(
    shouldShowTerminalScrollOverlay({ visible: true, bufferType: 'alternate', mode: 'history' }),
    false,
  );
  assert.equal(
    shouldShowTerminalScrollOverlay({ visible: false, bufferType: 'normal', mode: 'history' }),
    false,
  );
});

test('normal visible history mode shows the back-to-bottom overlay', () => {
  assert.equal(
    shouldShowTerminalScrollOverlay({ visible: true, bufferType: 'normal', mode: 'history' }),
    true,
  );
});
```

- [ ] **Step 2: Run the terminal scroll helper test to verify it fails**

Run:

```bash
node --test src/modules/SSHManager/terminalScroll.test.ts
```

Expected: FAIL with an error that `src/modules/SSHManager/terminalScroll.ts` does not exist or the named exports are missing.

- [ ] **Step 3: Implement the terminal scroll helper**

```ts
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
  current: TerminalScrollMode,
  metrics: TerminalScrollMetrics,
): TerminalScrollMode {
  if (!metrics.visible || metrics.bufferType !== 'normal') return 'following';
  return isTerminalNearBottom(metrics) ? 'following' : 'history';
}

export function shouldShowTerminalScrollOverlay(state: TerminalScrollOverlayState): boolean {
  return state.visible && state.bufferType === 'normal' && state.mode === 'history';
}
```

- [ ] **Step 4: Run the terminal scroll helper test to verify it passes**

Run:

```bash
node --test src/modules/SSHManager/terminalScroll.test.ts
```

Expected: PASS with `5` tests and `0` failures.

- [ ] **Step 5: Add the terminal scroll test to the web test script**

Modify the `test:web` script in `package.json` so it includes the new test immediately after `src/modules/SSHManager/terminalResize.test.ts`:

```json
"test:web": "node --test src/utils/logNoise.test.ts src/modules/SSHManager/prepareInsights.test.ts src/modules/SSHManager/shellVars.test.ts src/modules/SSHManager/terminalResize.test.ts src/modules/SSHManager/terminalScroll.test.ts src/modules/DiagnosticWorkbench/viewModel.test.ts src/modules/DiagnosticWorkbench/floatingSourceWindow.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/workbenchPersistence.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/manualCommandRuns.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/timelineWhiteboard.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/codeProvenanceLane.test.ts"
```

- [ ] **Step 6: Run the web test script to verify the new test participates**

Run:

```bash
npm run test:web
```

Expected: PASS. The output should include `terminalScroll.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add package.json src/modules/SSHManager/terminalScroll.ts src/modules/SSHManager/terminalScroll.test.ts
git commit -m "test(ssh-manager): cover terminal scroll follow decisions"
```

## Task 2: Wire Scroll Follow State Into TerminalInstance

**Files:**
- Modify: `src/modules/SSHManager/index.tsx`
- Test: `src/modules/SSHManager/terminalScroll.test.ts`
- Regression Test: `src/modules/SSHManager/terminalResize.test.ts`

- [ ] **Step 1: Add the SSH Manager imports**

Add `VerticalAlignBottomOutlined` to the icon import list in `src/modules/SSHManager/index.tsx`:

```ts
    ThunderboltOutlined,
    VerticalAlignBottomOutlined,
```

Add terminal scroll imports below the existing `terminalResize` import:

```ts
import {
  getNextTerminalScrollMode,
  shouldShowTerminalScrollOverlay,
  type TerminalBufferType,
  type TerminalScrollMetrics,
  type TerminalScrollMode,
} from './terminalScroll';
```

- [ ] **Step 2: Add snapshot signature and highlight timing helpers**

Insert these helpers after `collectTerminalScreenSnapshot(...)` and before `renderTerminalMatchText(...)`:

```ts
function buildTerminalScreenSnapshotSignature(snapshot: TerminalScreenSnapshot): string {
  const rules = snapshot.ruleSummaries
    .map((rule) => `${rule.id}:${rule.matchCount}:${rule.lineCount}`)
    .join('|');
  const lines = snapshot.matchedLines
    .map((line) => {
      const matches = line.matches
        .map((match) => `${match.id}:${match.start}:${match.end}`)
        .join(',');
      return `${line.row}:${matches}:${line.text}`;
    })
    .join('\n');
  return [
    snapshot.bufferType,
    snapshot.scannedRows,
    snapshot.totalMatchCount,
    rules,
    lines,
  ].join('::');
}

const TERMINAL_HIGHLIGHT_REFRESH_MIN_INTERVAL_MS = 120;
```

- [ ] **Step 3: Add scroll and highlight refs/state inside `TerminalInstance`**

Inside `TerminalInstance`, place these declarations after `const resizeFrameRef = useRef<number | null>(null);`:

```ts
  const refreshTimerRef = useRef<number | null>(null);
  const highlightRefreshLastAtRef = useRef(0);
  const screenSnapshotSignatureRef = useRef('');
  const scrollModeRef = useRef<TerminalScrollMode>('following');
  const [scrollMode, setScrollMode] = useState<TerminalScrollMode>('following');
  const [hasPendingOutput, setHasPendingOutput] = useState(false);
```

After `visibleRef.current = visible;`, keep the scroll mode ref synchronized:

```ts
  scrollModeRef.current = scrollMode;
```

- [ ] **Step 4: Add local terminal metric and scroll state callbacks**

Insert these callbacks after `const activeHighlightRule = ...` and before `visibleRef.current = visible;`:

```ts
  const readTerminalScrollMetrics = React.useCallback((): TerminalScrollMetrics | null => {
    const term = termRef.current;
    if (!term) return null;
    const activeBuffer = term.buffer.active;
    return {
      visible: visibleRef.current,
      bufferType: activeBuffer.type as TerminalBufferType,
      viewportY: activeBuffer.viewportY,
      rows: term.rows,
      bufferLength: activeBuffer.length,
    };
  }, []);

  const applyTerminalScrollState = React.useCallback(() => {
    const metrics = readTerminalScrollMetrics();
    if (!metrics) return;

    const nextMode = getNextTerminalScrollMode(scrollModeRef.current, metrics);
    if (nextMode !== scrollModeRef.current) {
      scrollModeRef.current = nextMode;
      setScrollMode(nextMode);
    }
    if (nextMode === 'following') {
      setHasPendingOutput(false);
    }
  }, [readTerminalScrollMetrics]);

  const returnTerminalToBottom = React.useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    term.scrollToBottom();
    scrollModeRef.current = 'following';
    setScrollMode('following');
    setHasPendingOutput(false);
  }, []);
```

- [ ] **Step 5: Replace `refreshScreenHighlights` with a demand-driven version**

Replace the existing `refreshScreenHighlights` callback with:

```ts
  const refreshScreenHighlights = React.useCallback(() => {
    const term = termRef.current;
    const rules = highlightRulesRef.current;
    if (!term || rules.length === 0) return;

    const nextSnapshot = collectTerminalScreenSnapshot(term, rules);
    const nextSignature = buildTerminalScreenSnapshotSignature(nextSnapshot);
    if (nextSignature === screenSnapshotSignatureRef.current) return;

    screenSnapshotSignatureRef.current = nextSignature;
    setScreenSnapshot(nextSnapshot);
    clearScreenDecorations();
    if (nextSnapshot.bufferType !== 'normal') return;

    let decorationCount = 0;
    nextSnapshot.matchedLines.forEach((line) => {
      line.matches.forEach((match) => {
        if (decorationCount >= TERMINAL_HIGHLIGHT_DECORATION_LIMIT) return;
        const marker = term.registerMarker(line.row - term.buffer.active.baseY - term.buffer.active.cursorY);
        if (!marker) return;
        const decoration = term.registerDecoration({
          marker,
          x: match.start,
          width: Math.max(1, match.end - match.start),
          backgroundColor: match.color,
          foregroundColor: getReadableTextColor(match.color),
          layer: 'top',
        });
        if (!decoration) {
          marker.dispose();
          return;
        }
        decorationCount += 1;
        const renderDisposable = decoration.onRender((element) => {
          element.style.borderRadius = '3px';
          element.style.boxShadow = `inset 0 0 0 1px ${match.color}`;
          element.style.opacity = '0.92';
        });
        decorationDisposablesRef.current.push({
          dispose: () => {
            renderDisposable.dispose();
            decoration.dispose();
            marker.dispose();
          },
        });
      });
    });
  }, [clearScreenDecorations]);
```

- [ ] **Step 6: Replace `scheduleScreenHighlightRefresh` with a throttled version**

Replace the existing `scheduleScreenHighlightRefresh` callback with:

```ts
  const scheduleScreenHighlightRefresh = React.useCallback(() => {
    if (highlightRulesRef.current.length === 0) return;
    if (refreshFrameRef.current != null || refreshTimerRef.current != null) return;

    const now = Date.now();
    const elapsed = now - highlightRefreshLastAtRef.current;
    const delay = Math.max(0, TERMINAL_HIGHLIGHT_REFRESH_MIN_INTERVAL_MS - elapsed);

    const run = () => {
      refreshTimerRef.current = null;
      refreshFrameRef.current = requestAnimationFrame(() => {
        refreshFrameRef.current = null;
        highlightRefreshLastAtRef.current = Date.now();
        refreshScreenHighlights();
      });
    };

    if (delay > 0) {
      refreshTimerRef.current = window.setTimeout(run, delay);
      return;
    }
    run();
  }, [refreshScreenHighlights]);
```

- [ ] **Step 7: Update highlight-rule clearing behavior**

In the `useEffect` that watches `highlightRules`, extend the empty-rule branch to reset the snapshot signature:

```ts
    if (highlightRules.length === 0) {
      setActiveHighlightRuleId(null);
      clearScreenDecorations();
      screenSnapshotSignatureRef.current = '';
      setScreenSnapshot(createEmptyTerminalScreenSnapshot());
      searchAddonRef.current?.clearDecorations();
      return;
    }
```

- [ ] **Step 8: Wire terminal scroll events and write callbacks**

In the xterm setup effect, replace:

```ts
    const d2 = term.onRender(() => scheduleScreenHighlightRefresh());
    const d3 = term.onScroll(() => scheduleScreenHighlightRefresh());
    const d4 = term.onResize(() => scheduleScreenHighlightRefresh());
```

with:

```ts
    const d2 = term.onRender(() => scheduleScreenHighlightRefresh());
    const d3 = term.onScroll(() => {
      applyTerminalScrollState();
      scheduleScreenHighlightRefresh();
    });
    const d4 = term.onResize(() => {
      applyTerminalScrollState();
      scheduleScreenHighlightRefresh();
    });
```

Replace the `registerWrite` callback body with:

```ts
    registerWrite((b64: string) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const wasViewingHistory = scrollModeRef.current === 'history';
      term.write(bytes, () => {
        if (wasViewingHistory) {
          setHasPendingOutput(true);
        } else {
          term.scrollToBottom();
        }
        applyTerminalScrollState();
        scheduleScreenHighlightRefresh();
      });
    });
```

- [ ] **Step 9: Clean up the highlight timer**

In the cleanup function for the xterm setup effect, add this block after the existing `refreshFrameRef` cancellation:

```ts
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
```

- [ ] **Step 10: Reset scroll state when a visible terminal is activated**

In the `useEffect` that watches `visible`, replace the body with:

```ts
  useEffect(() => {
    if (!visible) return;
    scrollModeRef.current = 'following';
    setScrollMode('following');
    setHasPendingOutput(false);
    scheduleFitAndPublishResize();
    scheduleScreenHighlightRefresh();
  }, [visible, scheduleFitAndPublishResize, scheduleScreenHighlightRefresh]);
```

- [ ] **Step 11: Wrap the terminal viewport and render the back-to-bottom overlay**

Replace the standalone terminal container:

```tsx
      <div
        ref={ref}
        style={{
          width: '100%', flex: 1,
          background: isDark ? '#1e1e1e' : '#fafafa',
          padding: 4,
          minHeight: 0,
        }}
      />
```

with:

```tsx
      <div style={{ width: '100%', flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          ref={ref}
          style={{
            width: '100%',
            height: '100%',
            background: isDark ? '#1e1e1e' : '#fafafa',
            padding: 4,
            minHeight: 0,
          }}
        />
        {shouldShowTerminalScrollOverlay({
          visible,
          bufferType: (termRef.current?.buffer.active.type ?? 'normal') as TerminalBufferType,
          mode: scrollMode,
        }) && (
          <div
            style={{
              position: 'absolute',
              right: 14,
              bottom: 14,
              zIndex: 102,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              borderRadius: 6,
              background: isDark ? 'rgba(24, 24, 27, 0.92)' : 'rgba(255, 255, 255, 0.94)',
              border: `1px solid ${isDark ? '#3f3f46' : '#d4d4d8'}`,
              boxShadow: '0 4px 12px rgba(0,0,0,.18)',
            }}
          >
            <Text style={{ fontSize: 11 }}>
              {hasPendingOutput ? '有新输出' : '正在查看历史'}
            </Text>
            <Button
              size="small"
              type="primary"
              icon={<VerticalAlignBottomOutlined />}
              onClick={returnTerminalToBottom}
            >
              回到底部
            </Button>
          </div>
        )}
      </div>
```

- [ ] **Step 12: Run focused regression tests**

Run:

```bash
node --test src/modules/SSHManager/terminalScroll.test.ts src/modules/SSHManager/terminalResize.test.ts
```

Expected: PASS with all tests green.

- [ ] **Step 13: Run targeted eslint for touched files**

Run:

```bash
npx eslint src/modules/SSHManager/index.tsx src/modules/SSHManager/terminalScroll.ts src/modules/SSHManager/terminalScroll.test.ts
```

Expected: PASS with no lint errors.

- [ ] **Step 14: Commit**

```bash
git add src/modules/SSHManager/index.tsx src/modules/SSHManager/terminalScroll.ts src/modules/SSHManager/terminalScroll.test.ts
git commit -m "fix(ssh-manager): stabilize terminal scroll follow"
```

## Task 3: Stabilize Background Job Output Polling

**Files:**
- Modify: `src/modules/SSHManager/store/backgroundJobStore.ts`
- Create: `src/modules/SSHManager/store/backgroundJobStore.test.ts`
- Modify: `src/modules/SSHManager/components/BackgroundJobMonitor.tsx`
- Modify: `package.json`

- [ ] **Step 1: Write the failing background job output guard test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldUpdateJobOutput } from './backgroundJobStore.ts';

test('shouldUpdateJobOutput skips unchanged output', () => {
  assert.equal(shouldUpdateJobOutput('line 1\nline 2', 'line 1\nline 2'), false);
});

test('shouldUpdateJobOutput accepts changed output', () => {
  assert.equal(shouldUpdateJobOutput('line 1', 'line 1\nline 2'), true);
});
```

- [ ] **Step 2: Run the background job output test to verify it fails**

Run:

```bash
node --test src/modules/SSHManager/store/backgroundJobStore.test.ts
```

Expected: FAIL because `shouldUpdateJobOutput` is not exported.

- [ ] **Step 3: Export the output update helper**

Add this helper near the top of `src/modules/SSHManager/store/backgroundJobStore.ts`, after `const MAX_LOG_BYTES = ...`:

```ts
export function shouldUpdateJobOutput(current: string, next: string): boolean {
  return current !== next;
}
```

- [ ] **Step 4: Use the helper in `BackgroundJobMonitor`**

Change the store import in `src/modules/SSHManager/components/BackgroundJobMonitor.tsx` from:

```ts
import { useBackgroundJobStore, type BackgroundJob, type JobMode } from '../store/backgroundJobStore';
```

to:

```ts
import {
  shouldUpdateJobOutput,
  useBackgroundJobStore,
  type BackgroundJob,
  type JobMode,
} from '../store/backgroundJobStore';
```

Then replace:

```ts
        const output = tailRes.stdout || '（无输出）';
        updateJobOutput(job.id, output);
```

with:

```ts
        const output = tailRes.stdout || '（无输出）';
        if (shouldUpdateJobOutput(job.output, output)) {
          updateJobOutput(job.id, output);
        }
```

- [ ] **Step 5: Keep polling errors from replacing visible output**

Leave the existing `catch` branch silent and add this comment inside it:

```ts
        // Keep the last visible output. A transient disconnect should not blank the log pane.
```

The branch should remain:

```ts
      } catch {
        // Keep the last visible output. A transient disconnect should not blank the log pane.
      }
```

- [ ] **Step 6: Add the background job store test to the web test script**

Modify the `test:web` script in `package.json` so it includes the new test immediately after `src/modules/SSHManager/terminalScroll.test.ts`:

```json
"test:web": "node --test src/utils/logNoise.test.ts src/modules/SSHManager/prepareInsights.test.ts src/modules/SSHManager/shellVars.test.ts src/modules/SSHManager/terminalResize.test.ts src/modules/SSHManager/terminalScroll.test.ts src/modules/SSHManager/store/backgroundJobStore.test.ts src/modules/DiagnosticWorkbench/viewModel.test.ts src/modules/DiagnosticWorkbench/floatingSourceWindow.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/workbenchPersistence.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/manualCommandRuns.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/localizationDeskState.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/timelineWhiteboard.test.ts src/modules/DiagnosticWorkbench/LocalizationDesk/codeProvenanceLane.test.ts"
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test src/modules/SSHManager/store/backgroundJobStore.test.ts src/modules/SSHManager/terminalScroll.test.ts
```

Expected: PASS with all tests green.

- [ ] **Step 8: Run targeted eslint**

Run:

```bash
npx eslint src/modules/SSHManager/store/backgroundJobStore.ts src/modules/SSHManager/store/backgroundJobStore.test.ts src/modules/SSHManager/components/BackgroundJobMonitor.tsx
```

Expected: PASS with no lint errors.

- [ ] **Step 9: Commit**

```bash
git add package.json src/modules/SSHManager/store/backgroundJobStore.ts src/modules/SSHManager/store/backgroundJobStore.test.ts src/modules/SSHManager/components/BackgroundJobMonitor.tsx
git commit -m "fix(ssh-manager): skip unchanged background job output"
```

## Task 4: Tighten SSH Manager Focused-View Wording

**Files:**
- Modify: `src/modules/SSHManager/components/SessionJournal.tsx`
- Modify: `src/modules/SSHManager/components/KeywordAnalyzer.tsx`

- [ ] **Step 1: Update SessionJournal folded-record wording**

In `SessionJournal.tsx`, replace:

```tsx
              <Text type="secondary" style={{ fontSize: 11 }}>显示原始记录</Text>
```

with:

```tsx
              <Text type="secondary" style={{ fontSize: 11 }}>原始记录</Text>
```

Replace:

```tsx
              这条输出已被聚焦视图折叠；切到“显示原始记录”可查看完整内容。
```

with:

```tsx
              这条输出已被聚焦视图折叠；打开“原始记录”可查看完整内容。
```

- [ ] **Step 2: Update KeywordAnalyzer monitoring/noise wording**

In `KeywordAnalyzer.tsx`, replace:

```tsx
          <Tag color="gold">{suppressedCount} 条已忽略</Tag>
```

with:

```tsx
          <Tag color="gold">{suppressedCount} 条聚焦折叠</Tag>
```

Replace:

```tsx
          <Button size="small" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            关键词与降噪
          </Button>
```

with:

```tsx
          <Button size="small" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            关键词与聚焦
          </Button>
```

Replace:

```tsx
          <Text strong style={{ display: 'block', marginBottom: 8 }}>日志降噪规则</Text>
```

with:

```tsx
          <Text strong style={{ display: 'block', marginBottom: 8 }}>聚焦折叠规则</Text>
```

Replace:

```tsx
          header={<Text strong>近期忽略来源</Text>}
```

with:

```tsx
          header={<Text strong>近期折叠来源</Text>}
```

Replace:

```tsx
          header={<Text strong>自定义忽略词</Text>}
```

with:

```tsx
          header={<Text strong>自定义折叠词</Text>}
```

Replace:

```tsx
          description="系统会先按当前内建模式与自定义忽略词做降噪，再把命中关键字的日志抽取到监控面板里。"
```

with:

```tsx
          description="系统会先按当前内建模式与自定义折叠词过滤低价值噪声，再把命中关键字的日志抽取到监控面板里。原始数据仍保留在对应会话输出中。"
```

- [ ] **Step 3: Run targeted eslint for wording-only files**

Run:

```bash
npx eslint src/modules/SSHManager/components/SessionJournal.tsx src/modules/SSHManager/components/KeywordAnalyzer.tsx
```

Expected: PASS with no lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/SSHManager/components/SessionJournal.tsx src/modules/SSHManager/components/KeywordAnalyzer.tsx
git commit -m "style(ssh-manager): clarify focused log wording"
```

## Task 5: Full Verification And Browser Smoke Check

**Files:**
- Verify: all touched files from Tasks 1-4

- [ ] **Step 1: Run the full web test bundle**

Run:

```bash
npm run test:web
```

Expected: PASS with all web tests green.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS. Existing Vite large-chunk warnings are acceptable. TypeScript errors are not acceptable.

- [ ] **Step 3: Run targeted eslint across touched SSH Manager files**

Run:

```bash
npx eslint \
  src/modules/SSHManager/index.tsx \
  src/modules/SSHManager/terminalScroll.ts \
  src/modules/SSHManager/terminalScroll.test.ts \
  src/modules/SSHManager/store/backgroundJobStore.ts \
  src/modules/SSHManager/store/backgroundJobStore.test.ts \
  src/modules/SSHManager/components/BackgroundJobMonitor.tsx \
  src/modules/SSHManager/components/SessionJournal.tsx \
  src/modules/SSHManager/components/KeywordAnalyzer.tsx
```

Expected: PASS with no lint errors.

- [ ] **Step 4: Check diff whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Start the local dev server**

Run:

```bash
npm run dev
```

Expected: Vite and `server/index.js` start successfully. Use the printed Vite URL, normally `http://localhost:5173`.

- [ ] **Step 6: Browser smoke check SSH Manager**

Open:

```text
http://localhost:5173/ssh-manager
```

Manual checks:

- terminal tab renders without a blank viewport
- search and keyword highlight buttons remain usable
- no highlight summary panel appears when no highlight rules exist
- after a connected session receives continuous output, scrolling up shows the `正在查看历史` / `回到底部` control
- new output while viewing history does not move the viewport
- clicking `回到底部` restores follow mode
- background job log panes do not flicker when output is unchanged

- [ ] **Step 7: Stop the dev server**

Stop the `npm run dev` process with `Ctrl-C`.

Expected: no long-running terminal session remains from verification.

- [ ] **Step 8: Final commit if verification required small fixes**

If Task 5 required code fixes, commit only those fixes:

```bash
git add \
  package.json \
  src/modules/SSHManager/index.tsx \
  src/modules/SSHManager/terminalScroll.ts \
  src/modules/SSHManager/terminalScroll.test.ts \
  src/modules/SSHManager/store/backgroundJobStore.ts \
  src/modules/SSHManager/store/backgroundJobStore.test.ts \
  src/modules/SSHManager/components/BackgroundJobMonitor.tsx \
  src/modules/SSHManager/components/SessionJournal.tsx \
  src/modules/SSHManager/components/KeywordAnalyzer.tsx
git commit -m "fix(ssh-manager): finish terminal scroll verification"
```

If Task 5 required no code fixes, do not create an empty commit.

## Self-Review Checklist

- Spec coverage:
  - terminal continuous-output scroll jitter is covered by Tasks 1-2
  - default follow, user scroll pause, and back-to-bottom recovery are covered by Tasks 1-2
  - no-highlight snapshot skipping and highlight throttling are covered by Task 2
  - background job output stability is covered by Task 3
  - focused/raw wording for journal and analyzer is covered by Task 4
  - full verification is covered by Task 5
- Scope check:
  - the plan stays inside SSH Manager and package test script updates
  - no full layout rebuild, websocket protocol change, or global-store scroll persistence is included
- Type consistency:
  - `TerminalScrollMode`, `TerminalBufferType`, and `TerminalScrollMetrics` are defined in Task 1 before use in Task 2
  - `shouldUpdateJobOutput` is defined in Task 3 before use in `BackgroundJobMonitor`
