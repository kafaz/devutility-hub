# Diagnostic Localization Desk Design

Date: 2026-04-22
Repo: `/Users/kafaz/dev/dev_utils/devutility-hub`
Module: `DiagnosticWorkbench`
Status: Approved for planning

## 1. Goal

Turn `DiagnosticWorkbench`'s `flow` view into a localization-first operator desk for `session log` driven investigation.

The primary user problem is not "finding logs", but efficiently moving from a suspicious log line to:

1. readable surrounding context without hand-running `grep -C`
2. code provenance for the emitted log
3. manually chosen follow-up commands
4. durable evidence and timeline analysis artifacts

This design is intentionally operator-controlled. The system must not auto-suggest next actions, auto-run commands, or auto-decide what to inspect. It provides context, execution surfaces, and persistence. The developer chooses every investigative step.

## 2. Approved Scope

### In scope for phase 1

- `DiagnosticWorkbench / flow` becomes the main localization work surface.
- Coverage is limited to `session log` as the investigation source.
- The work surface uses a dark theme by default.
- The main workspace is elastic and resizable.
- The workspace has three primary lanes:
  - `Session Log Context`
  - `Manual Command Lane`
  - `Code Provenance`
- A `Timeline Whiteboard` is part of the same work surface.
- Log context expansion operates only on currently loaded text.
- Code provenance supports `C/C++` only.
- Code provenance supports:
  - expanding source context above and below
  - expanding to the full function
  - clicking function references to navigate forward
  - breadcrumb-based jump back across the visited function path
- Evidence can be explicitly locked.
- Log snippets, command results, code snippets, and manual notes can be explicitly sent into the whiteboard.
- `repo + branch + commit` is bound once and reused across the session.
- `gdb` is exposed only as a manual escalation path.

### Explicitly out of scope for phase 1

- automatic command recommendation
- automatic command execution
- automatic next-step suggestion
- automatic whiteboard node creation
- automatic source jumps from command output or logs
- remote log backfill beyond the currently loaded text
- multi-language precise provenance beyond `C/C++`
- automatic `gdb bt` / `bt full` / crash summarization
- extending the localization desk to `collection_step`, `business_action`, `finding evidence`, or pasted external logs

## 3. Product Principles

### 3.1 Manual control only

Every meaningful diagnostic action is explicitly triggered by the operator. The system must never "helpfully" decide what to do next.

### 3.2 Localization-first

The primary workflow is:

1. select suspicious log
2. expand context
3. inspect code provenance
4. run manually chosen command
5. lock evidence
6. place evidence on a timeline whiteboard

### 3.3 Single work surface

The operator should not bounce between multiple modules just to complete one localization loop. Logs, commands, code, and timeline analysis belong in the same work surface.

### 3.4 Preserve evidence

The desk should preserve investigation artifacts that matter for replay and reporting, while keeping temporary UI state transient.

## 4. Information Architecture

### 4.1 Top bar

The top of the localization desk always shows:

- run title
- symptom summary
- selected session
- active `repo + branch + commit` code binding
- current anchor log summary
- explicit manual-mode reminder

This top bar remains visible so the operator always knows:

- what incident is being analyzed
- which session is active
- which code version is bound
- which log line currently drives the desk

### 4.2 Three-lane workspace

#### Left lane: `Session Log Context`

Responsibilities:

- show filtered, operator-relevant session logs
- allow the operator to select the current anchor log
- show the currently loaded textual context around the anchor
- support explicit expand-up / expand-down actions
- support explicit evidence locking
- support explicit send-to-whiteboard

Important constraint:

- context is derived only from the currently loaded log text held by the UI
- no silent remote fetch is performed when expanding

#### Middle lane: `Manual Command Lane`

Responsibilities:

- present a command shelf / command library as an optional source of manually chosen commands
- provide an editable command input
- run a command only when the operator explicitly clicks execute
- show structured command results
- allow command result locking
- allow command results to be sent to the whiteboard

Important constraint:

- this lane is a manual execution surface, not a recommendation engine
- selecting a log must not auto-fill or auto-run a command

#### Right lane: `Code Provenance`

Responsibilities:

- show current bound code context
- resolve source location from the selected anchor log
- display source context around the matched line
- support explicit:
  - expand above
  - expand below
  - expand full function
- support clickable function navigation forward
- support breadcrumb jump-back across visited functions
- allow current source snippet or function node to be locked or sent to the whiteboard

Important constraint:

- source navigation only changes the right-lane state
- it must not silently mutate the anchor log or run commands

### 4.3 Timeline Whiteboard

The whiteboard is part of the same localization desk, not a separate module.

Default behavior:

- nodes are placed on a timeline-oriented canvas
- nodes remain freely movable
- the user can connect and annotate them manually

Node entry sources:

- log context snippet
- command result snippet
- source snippet
- source function node
- manual note

The whiteboard is not an auto-summary surface. It is a manual operator analysis canvas for sequencing and causality.

## 5. Interaction Rules

### 5.1 Anchor log selection

When the operator selects a suspicious log:

- `currentAnchorLogId` updates
- the left lane context view updates
- the right lane source lookup input updates
- the top bar anchor summary updates

What does not happen:

- no command is auto-filled
- no command is auto-run
- no evidence is auto-locked
- no whiteboard node is auto-created

### 5.2 Log context expansion

When the operator clicks expand-up or expand-down:

- the left lane `logContextWindow` changes
- only the left lane view updates

What does not happen:

- no remote log fetch
- no source jump
- no whiteboard mutation

### 5.3 Manual command execution

When the operator chooses or types a command and clicks execute:

- the command is run against the selected session via the existing session command endpoint
- a command-run record is created
- the result appears in the middle lane
- any emitted session logs may appear in the log stream on refresh

What does not happen:

- no new anchor is auto-selected
- no source location is auto-opened
- no evidence is auto-locked

### 5.4 Source navigation

When the operator clicks a function in the right lane:

- `codeNavigationStack` is pushed
- the right lane re-renders the selected function

When the operator clicks a breadcrumb:

- `codeNavigationStack` pops back to the selected prior position
- the right lane re-renders accordingly

What does not happen:

- no left-lane anchor rewrite
- no command changes
- no automatic caller/callee exploration

### 5.5 Evidence locking and whiteboard entry

Nothing enters persistent evidence or timeline analysis unless the operator explicitly clicks:

- `锁定证据`
- `送入白板`

This rule applies equally to:

- logs
- command results
- source snippets
- function nodes

## 6. State Model

### 6.1 Transient UI state

These states are not persisted because they are interaction-local:

- `currentAnchorLogId`
- `logContextWindow`
- `commandDraft`
- `codeNavigationStack`
- `codeContextWindow`
- lane widths / temporary panel arrangement

### 6.2 Persisted run artifacts

These states are persisted because they matter for replay and reporting:

- `manualCommandRuns[]`
- `lockedEvidence[]`
- `timelineWhiteboard`
- `activeCodeBinding`

### 6.3 Persisted object shapes

#### `manualCommandRuns[]`

Each run stores:

- `id`
- `sessionId`
- `command`
- `startedAt`
- `finishedAt`
- `stdout`
- `stderr`
- `exitCode`
- `durationMs`

#### `timelineWhiteboard`

Stores:

- `nodes[]`
- `edges[]`
- `viewport`
- `svgSnapshot`

Each node stores at least:

- `id`
- `type` (`log`, `command`, `source`, `function`, `note`)
- `title`
- `excerpt`
- `ts`
- `sourceType`
- source reference fields such as `sessionId`, `commandRunId`, `contextId`, or `evidenceId`
- canvas position

#### `activeCodeBinding`

Stores:

- `repo`
- `branch`
- `commit`
- optional `contextId`

## 7. Frontend Component Boundaries

### 7.1 Keep `DiagnosticWorkbench/index.tsx` as composition root

`src/modules/DiagnosticWorkbench/index.tsx` should remain the route entry and top-level view switcher, but `flow` should be extracted so this file stops growing as the workbench accumulates behavior.

### 7.2 New localization desk components

Create a new component subtree under `src/modules/DiagnosticWorkbench/LocalizationDesk/`:

- `LocalizationDesk.tsx`
- `SessionLogLane.tsx`
- `ManualCommandLane.tsx`
- `CodeProvenanceLane.tsx`
- `TimelineWhiteboard.tsx`

Supporting hooks:

- `useLocalizationDeskState()`
- `useManualCommandRuns()`
- `useTimelineWhiteboard()`

Responsibilities:

- keep lane-specific logic local
- keep shared flow state explicit
- prevent cross-lane hidden coupling

## 8. Backend and API Strategy

### 8.1 Reuse existing endpoints

Use the current server surface wherever possible:

- `GET /api/agent/sessions/:sessionId/logs`
- `POST /api/agent/sessions/:sessionId/commands`
- `POST /api/code-context/open`
- `POST /api/code-context/:contextId/render`
- `POST /api/code-context/:contextId/render-location`
- `GET /api/code-context/:contextId/symbols/:symbolId/callers`
- `GET /api/code-context/:contextId/symbols/:symbolId/callees`
- `POST /api/code-context/:contextId/call-relation`

This is sufficient for phase 1 log viewing, manual commands, and function navigation.

### 8.2 Add one minimal workbench persistence endpoint

Add:

- `PATCH /api/diagnostic/runs/:id/workbench`

Purpose:

- persist operator-created desk artifacts without overloading orchestrate flows

Accepted update surface:

- `manualCommandRuns`
- `timelineWhiteboard`
- `activeCodeBinding`

Do not create separate endpoints for each whiteboard or command subfeature in phase 1.

## 9. Error Handling and Degradation

### 9.1 Session problems

If the session disconnects:

- command execution returns a clear `session disconnected` error
- the current command draft remains intact
- the desk does not auto-reconnect

### 9.2 Code binding problems

If code binding is missing or invalid:

- the right lane shows a precise binding error
- left lane, middle lane, and whiteboard continue working

### 9.3 Source lookup ambiguity

If multiple symbol or location candidates match:

- show explicit candidates
- require manual operator choice
- do not auto-pick one

### 9.4 No source hint found

If a log or command result lacks usable source hints:

- show `当前片段没有可定位源码线索`
- keep the desk stable
- do not perform fuzzy jumps

### 9.5 Whiteboard persistence failure

If whiteboard persistence fails:

- preserve local whiteboard state in memory
- show a clear save error
- do not destroy existing desk context

## 10. Testing Strategy

### 10.1 Unit tests

Add focused tests for:

- log context expansion window calculation
- `codeNavigationStack` push / pop behavior
- whiteboard node add / update / remove
- manual command execution state transitions

### 10.2 Frontend integration tests

Verify:

- selecting a log updates left lane and right lane only
- executing a command updates middle lane state without auto-changing anchor
- source navigation changes only the right lane navigation state
- locking evidence or sending to whiteboard requires explicit clicks

### 10.3 Server tests

Verify:

- existing `/api/agent/sessions/:sessionId/commands` behavior in the desk flow
- existing `/api/code-context/*` behavior used by function navigation
- new `PATCH /api/diagnostic/runs/:id/workbench` persistence

## 11. Non-goals

This design does not attempt to:

- redesign orchestration / recall flows
- redesign SSH Manager
- replace the evidence basket with the whiteboard
- make whiteboard a full general-purpose diagram editor
- add automated diagnosis or agent-driven command selection

## 12. Implementation Notes

This design is intentionally constrained so phase 1 can land without destabilizing adjacent features:

- reuse current session logs and code-context server capabilities
- keep persistence additions narrow
- keep manual-control semantics explicit
- keep the whiteboard useful for timeline analysis, not generic canvas ambition

The next step after this document is to write an implementation plan that sequences:

1. component extraction
2. state model additions
3. workbench persistence changes
4. source navigation enhancements
5. whiteboard integration
6. verification
