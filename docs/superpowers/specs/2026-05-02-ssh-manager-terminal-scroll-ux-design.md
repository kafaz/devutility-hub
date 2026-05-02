# SSH Manager Terminal Scroll UX Design

Date: 2026-05-02
Repo: `/Users/kafaz/dev/dev_utils/devutility-hub`
Module: `SSHManager`
Status: Written spec, pending user review before implementation planning

## 1. Goal

Fix the SSH Manager xterm output area so continuous log output no longer causes high-frequency scroll jitter.

The first version focuses on the operator's troubleshooting loop inside SSH Manager. It should make terminal output stable during commands such as `tail -f`, `journalctl -f`, or any high-volume log stream, while preserving the existing SSH session, command, journal, analyzer, background job, and prepare insight capabilities.

The desired behavior is:

1. terminal output follows the newest line by default
2. manual upward scrolling pauses follow mode
3. incoming output does not steal the user's historical scroll position
4. a clear `back to bottom` control restores follow mode
5. high-frequency render, scroll, resize, or highlight refresh work does not create React state churn

## 2. Approved Scope

### In scope

- Fix terminal xterm scrolling jitter in `SSHManager`.
- Add a three-state terminal scroll model:
  - following newest output
  - viewing history
  - back-to-bottom recovery
- Avoid terminal screen snapshot and highlight refresh work when no highlight rule exists.
- Throttle highlight refresh when highlight rules are active and terminal output is high frequency.
- Keep terminal resize publishing deduplicated through the existing `terminalResize` path.
- Keep scroll state local to each `TerminalInstance`.
- Add a small pure helper module for scroll-follow decisions so behavior can be unit tested.
- Improve SSH Manager main-chain UX without large layout changes:
  - terminal toolbar and scroll state affordance
  - session journal state labels
  - keyword analyzer filtering and noise-state copy
  - background job output update stability
  - prepare insight visibility in the existing panel

### Out of scope

- Rebuilding the full SSH Manager layout.
- Replacing xterm.
- Moving terminal runtime state into a global store.
- Redesigning `DiagnosticWorkbench`, `LogAnalyzer`, `BlockBenchmark`, SOP modules, or app navigation.
- Automatic command recommendation or automatic diagnostic action selection.
- Changing SSH websocket protocol semantics.
- Changing the persisted session journal data model.
- Changing background job launch semantics.

## 3. Product Principles

### 3.1 Operator position is durable

When the operator scrolls up to inspect historical output, the interface must preserve that position until the operator explicitly returns to the bottom.

### 3.2 Follow mode is explicit and recoverable

The default behavior follows new output. Once paused by user scroll, the UI must show that new output is arriving and provide a direct return path.

### 3.3 Rendering work must be demand driven

Terminal render hooks are allowed to keep xterm up to date, but React state updates and screen scans must happen only when the UI actually needs them.

### 3.4 Preserve the existing troubleshooting surface

The SSH Manager already combines terminal sessions, prepare summaries, command execution, journal evidence, smart monitoring, background jobs, and session groups. This work tightens that surface instead of splitting it into a new tool.

## 4. Terminal Scroll Model

Each mounted `TerminalInstance` owns its scroll-follow state.

### 4.1 Following newest output

Default state after connection, reconnect, visible tab activation, or explicit return-to-bottom.

Behavior:

- xterm can follow incoming output normally.
- no `back to bottom` control is shown.
- high-frequency output should not trigger resize publishes unless dimensions changed.
- highlight refresh is skipped when there are no active highlight rules.

### 4.2 Viewing history

Entered when the operator scrolls up away from the bottom while the terminal is in the normal buffer.

Behavior:

- incoming output is written to xterm, but the UI does not force-scroll to bottom.
- a lightweight status/control appears near the terminal edge.
- the control communicates that the operator is viewing history and that new output may be arriving.
- scrolling back near the bottom automatically restores follow mode.

### 4.3 Back to bottom

The status/control offers a direct action to restore following.

Behavior:

- clicking it scrolls the xterm viewport to the bottom.
- follow mode is restored.
- the control disappears once the viewport is back at the bottom.

### 4.4 Alternate buffer

When xterm is in an alternate buffer, such as `vim`, `less`, or `top`, the scroll-follow overlay should not appear.

Reason:

- alternate-buffer applications own their own navigation model
- a generic log-scroll affordance would be misleading

## 5. Component Design

### 5.1 `TerminalInstance`

Responsibilities:

- instantiate xterm and addons
- register write, snapshot, and current-line callbacks
- own search and highlight UI
- own local terminal scroll-follow state
- schedule resize publishing through existing helpers
- schedule highlight refresh only when active highlight rules require it

The component should not push scroll-follow state into Zustand. It is transient UI state tied to a specific xterm instance and DOM viewport.

### 5.2 Terminal scroll helper

Create or extend a small helper module for pure decisions such as:

- whether a terminal viewport is near the bottom
- whether user scroll should pause follow mode
- whether follow mode should resume
- whether the overlay is allowed for the current buffer type

The helper should be independent of React and xterm objects where practical. Tests should pass simple numbers and buffer names.

### 5.3 `terminalResize.ts`

Keep resize behavior focused on dimension publication.

Responsibilities remain:

- reject hidden terminal resize events
- reject unusable dimensions
- reject duplicate dimensions
- allow real visible dimension changes

Scroll-follow logic must not be folded into this file.

### 5.4 Highlight refresh path

Current code collects a screen snapshot and updates React state from render, scroll, and resize events.

New rule:

- if there are no highlight rules, do not collect screen snapshots
- if highlight rules exist, refresh on a throttled schedule
- if the next snapshot is equivalent to the previous one, do not update state
- do not render highlight summary UI unless rules exist

### 5.5 Background job output stability

`BackgroundJobMonitor` is not the primary bug surface for this report, but it has a similar risk pattern because it polls `tail -n 200`.

Add a small guard:

- if the fetched output equals the existing job output, skip the store update
- if tail fails during a transient disconnect, keep the previous output instead of replacing it with an empty message

This keeps the panel from flickering when the user later uses background log following.

## 6. SSH Manager UX Adjustments

### 6.1 Terminal toolbar

The existing search and keyword highlight controls remain.

Adjustments:

- keep toolbar compact
- avoid covering the newest output line or bottom scroll control
- make search/highlight popovers easy to dismiss
- do not show highlight summary when no highlight rules exist

### 6.2 Session journal

Keep current journal capabilities:

- focused view
- raw record toggle
- type filters
- export
- notes
- snapshots
- terminal recording

Adjustments:

- make folded record count visible without implying data loss
- keep type counts and active filter easy to scan
- preserve current journal data model

### 6.3 Keyword analyzer

Keep current keyword and noise-rule configuration.

Adjustments:

- make `matched`, `ignored`, and `filtered` states visually consistent with the journal
- keep the suppression count visible
- avoid wording that suggests logs were deleted when they were only suppressed from the focused view

### 6.4 Prepare insight visibility

Keep existing prepare insight data and summaries.

Adjustments:

- make `ready`, `background filling`, and failure reasons easier to see from the current SSH Manager surface
- do not add a new prepare subsystem

## 7. Data Flow

Existing data flow remains:

1. SSH websocket receives terminal data.
2. `sshStore` appends runtime terminal buffer.
3. `registerWrite` writes base64 payloads into the xterm instance.
4. xterm renders terminal output.
5. local terminal scroll state decides whether the operator is following or viewing history.
6. session journal and analyzer continue to receive events through existing store paths.

The scroll-follow state is not persisted. It resets on reconnect or remount.

## 8. Error Handling and Edge Cases

### 8.1 Hidden terminal or inactive tab

If a terminal is hidden or inactive:

- do not publish resize dimensions
- do not force-scroll
- do not run unnecessary highlight refresh

When it becomes visible:

- schedule one fit-and-resize pass
- schedule highlight refresh only if highlight rules exist

### 8.2 Continuous output while viewing history

If output continues while the operator is viewing history:

- write output normally
- do not change the viewport position
- show the paused-follow status/control

### 8.3 Returning near bottom manually

If the operator scrolls back near the bottom, follow mode can resume automatically.

### 8.4 Alternate buffer

If `term.buffer.active.type` is not `normal`:

- do not show the log-scroll overlay
- keep xterm application behavior untouched

### 8.5 Session disconnect or reconnect

On reconnect or terminal remount:

- reset scroll state to follow mode
- restore the terminal buffer using the existing runtime buffer path
- do not preserve a stale `viewing history` state from the previous runtime

### 8.6 Background job polling failure

If background job tail polling fails:

- keep the last known output
- avoid replacing output with `no output`
- continue status checks when the session is still usable

## 9. Testing Plan

### 9.1 Unit tests

Add tests for terminal scroll helpers:

- visible normal buffer near bottom should follow
- scrolling away from bottom should pause follow mode
- returning near bottom should restore follow mode
- alternate buffer should suppress the overlay
- hidden terminal should not trigger follow overlay decisions

Extend or preserve `terminalResize.test.ts`:

- hidden resize stays suppressed
- zero or too-small dimensions stay suppressed
- duplicate dimensions stay suppressed
- real visible dimension changes are published

### 9.2 Web test bundle

Run:

```bash
npm run test:web
```

### 9.3 Build

Run:

```bash
npm run build
```

Existing Vite large chunk warnings are acceptable. TypeScript or build failures are not acceptable.

### 9.4 Targeted lint and diff hygiene

Run targeted eslint for touched SSH Manager files, then:

```bash
git diff --check
```

### 9.5 Browser verification

When implementation is ready, start the local dev server and inspect SSH Manager in the browser.

Manual checks:

- continuous terminal output follows by default
- user scroll up pauses follow mode
- new output does not steal the scroll position
- back-to-bottom restores following
- search and highlight controls remain usable
- no highlight rules means no highlight summary panel
- background job output does not flicker when unchanged

## 10. Implementation Constraints

- Keep edits scoped to SSH Manager and shared helper tests unless build constraints require a narrow adjacent change.
- Use existing Ant Design and xterm dependencies.
- Do not introduce a new state management library.
- Do not remove existing SSH Manager capabilities while tightening the UI.
- Prefer pure helper functions for scroll/resize decisions so regressions are easy to test.
- Preserve current command execution and journal persistence behavior.

## 11. Acceptance Criteria

The work is complete when:

1. SSH Manager terminal continuous output no longer causes high-frequency scroll jitter.
2. Default terminal behavior follows newest output.
3. User scroll-up pauses follow mode and preserves historical position.
4. A clear control restores following from the bottom.
5. Highlight refresh does not run when no highlight rules exist.
6. Existing terminal resize regression tests still pass.
7. `npm run test:web`, `npm run build`, targeted eslint, and `git diff --check` pass.
8. No SSH Manager capability is removed.
