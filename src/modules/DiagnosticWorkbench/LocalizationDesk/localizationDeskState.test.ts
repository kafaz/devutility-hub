import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInitialLocalizationDeskState,
  expandLogContextWindow,
  popCodeNavigationTo,
  pushCodeNavigation,
  selectAnchorLog,
} from './useLocalizationDeskState.ts';

test('localization desk state starts with manual-only defaults', () => {
  const state = createInitialLocalizationDeskState();

  assert.equal(state.currentAnchorLogId, null);
  assert.deepEqual(state.logContextWindow, { before: 5, after: 5 });
  assert.equal(state.commandDraft, '');
  assert.deepEqual(state.codeNavigationStack, []);
});

test('log context expansion only mutates the targeted edge', () => {
  const initialWindow = { before: 5, after: 5 };

  assert.deepEqual(
    expandLogContextWindow(initialWindow, 'before', 20),
    { before: 25, after: 5 }
  );
  assert.deepEqual(
    expandLogContextWindow(initialWindow, 'after', 8),
    { before: 5, after: 13 }
  );
});

test('selecting a new anchor log resets the context window', () => {
  const current = {
    currentAnchorLogId: 'log-1',
    logContextWindow: { before: 21, after: 34 },
    commandDraft: 'journalctl -xe',
    codeNavigationStack: [{ symbolId: 's-1', symbolName: 'bio_submit' }],
  };

  const next = selectAnchorLog(current, 'log-2');

  assert.equal(next.currentAnchorLogId, 'log-2');
  assert.deepEqual(next.logContextWindow, { before: 5, after: 5 });
  assert.equal(next.commandDraft, current.commandDraft);
  assert.deepEqual(next.codeNavigationStack, current.codeNavigationStack);
});

test('code navigation stack pushes forward and pops back by index', () => {
  const first = pushCodeNavigation([], {
    symbolId: 's-1',
    symbolName: 'io_worker_submit',
  });
  const second = pushCodeNavigation(first, {
    symbolId: 's-2',
    symbolName: 'dump_queue_depth',
  });

  assert.deepEqual(
    second.map((item) => item.symbolName),
    ['io_worker_submit', 'dump_queue_depth']
  );

  const rewound = popCodeNavigationTo(second, 0);
  assert.deepEqual(rewound.map((item) => item.symbolName), ['io_worker_submit']);
});

test('localization desk shell composes the extracted session-log lane with real workflow props', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const localizationDeskSource = fs.readFileSync(path.join(currentDir, 'LocalizationDesk.tsx'), 'utf8');

  assert.doesNotMatch(localizationDeskSource, /\bchildren\??\s*:/);
  assert.match(localizationDeskSource, /SessionLogLane/);
  assert.match(localizationDeskSource, /ManualCommandLane/);
  assert.match(localizationDeskSource, /CodeProvenanceLane/);
  assert.match(localizationDeskSource, /TimelineWhiteboard/);
  assert.match(localizationDeskSource, /diagnostic-localization-desk__lanes/);
  assert.match(localizationDeskSource, /currentAnchorLogId=\{deskState\.currentAnchorLogId\}/);
  assert.match(localizationDeskSource, /logContextWindow=\{deskState\.logContextWindow\}/);
  assert.match(localizationDeskSource, /onSelectAnchor=\{\(logId\) => setDeskState\(\(current\) => selectAnchorLog\(current, logId\)\)\}/);
  assert.match(localizationDeskSource, /expandLogContextWindow\(current\.logContextWindow, 'before', 20\)/);
  assert.match(localizationDeskSource, /expandLogContextWindow\(current\.logContextWindow, 'after', 20\)/);
  assert.match(localizationDeskSource, /onOpenRawLogs=\{props\.onOpenRawLogs\}/);
  assert.match(localizationDeskSource, /onOpenEvidenceBasket=\{props\.onOpenEvidenceBasket\}/);
  assert.match(localizationDeskSource, /useTimelineWhiteboard/);
  assert.match(localizationDeskSource, /buildLogWhiteboardNode/);
  assert.match(localizationDeskSource, /buildManualCommandWhiteboardNode/);
  assert.match(localizationDeskSource, /onSendToWhiteboard=\{sendLogToWhiteboard\}/);
  assert.match(localizationDeskSource, /onSendToWhiteboard=\{sendManualCommandToWhiteboard\}/);
  assert.match(localizationDeskSource, /nodes=\{whiteboardState\.nodes\}/);
  assert.match(localizationDeskSource, /selectedNodeId=\{whiteboardState\.selectedNodeId\}/);
  assert.doesNotMatch(localizationDeskSource, /onSendSessionLogToWhiteboard/);
});

test('session log lane source keeps real operator actions reachable', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const sessionLogLaneSource = fs.readFileSync(path.join(currentDir, 'SessionLogLane.tsx'), 'utf8');

  assert.match(sessionLogLaneSource, /ResizableOutput/);
  assert.match(sessionLogLaneSource, /onSelectAnchor/);
  assert.match(sessionLogLaneSource, /onExpandBefore/);
  assert.match(sessionLogLaneSource, /onExpandAfter/);
  assert.match(sessionLogLaneSource, /onLockEvidence/);
  assert.match(sessionLogLaneSource, /onOpenRawLogs/);
  assert.match(sessionLogLaneSource, /onOpenEvidenceBasket/);
  assert.match(sessionLogLaneSource, /onLocateSource/);
  assert.match(sessionLogLaneSource, /currentAnchorLogId\?: string \| null;/);
  assert.match(sessionLogLaneSource, /onSelectAnchor\?\(logId: string\): void;/);
  assert.match(sessionLogLaneSource, /onExpandBefore\?\(\): void;/);
  assert.match(sessionLogLaneSource, /onExpandAfter\?\(\): void;/);
  assert.match(sessionLogLaneSource, /onLockEvidence\?\(log: LocalizationDeskSessionLogItem\): void;/);
  assert.match(sessionLogLaneSource, /onSendToWhiteboard\?\(log: LocalizationDeskSessionLogItem\): void;/);
  assert.match(sessionLogLaneSource, /logContextWindow/);
  assert.match(sessionLogLaneSource, /currentAnchorLogId/);
  assert.match(sessionLogLaneSource, /向上展开 20 行|前文 \+20/);
  assert.match(sessionLogLaneSource, /向下展开 20 行|后文 \+20/);
  assert.match(sessionLogLaneSource, /发送到白板/);
  assert.match(sessionLogLaneSource, /const sendToWhiteboard = props\.onSendToWhiteboard \|\| \(\(\) => \{\}\);/);
  assert.match(sessionLogLaneSource, /onClick=\{\(\) => sendToWhiteboard\(item\)\}/);
  assert.doesNotMatch(sessionLogLaneSource, /disabled=\{!props\.onSendToWhiteboard\}/);
  assert.doesNotMatch(sessionLogLaneSource, /Waiting for session log anchors\./);
  assert.doesNotMatch(sessionLogLaneSource, /No preview available\./);
});

test('timeline whiteboard source reflects locally sent session log items', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const localizationDeskSource = fs.readFileSync(path.join(currentDir, 'LocalizationDesk.tsx'), 'utf8');

  assert.match(localizationDeskSource, /appendTimelineWhiteboardNode\(whiteboardState, buildLogWhiteboardNode\(log\)\)/);
  assert.match(localizationDeskSource, /appendTimelineWhiteboardNode\(whiteboardState, buildManualCommandWhiteboardNode\(run\)\)/);
  assert.match(localizationDeskSource, /appendTimelineWhiteboardNote/);
  assert.match(localizationDeskSource, /clearTimelineWhiteboard/);
  assert.match(localizationDeskSource, /<TimelineWhiteboard[\s\S]*nodes=\{whiteboardState\.nodes\}/);
});

test('flow tab wires LocalizationDesk back to raw-log and evidence drawers', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workbenchSource = fs.readFileSync(path.join(currentDir, '..', 'index.tsx'), 'utf8');

  assert.match(
    workbenchSource,
    /<LocalizationDesk[\s\S]*sessionLogs=\{sessionLogs\}[\s\S]*selectedSessionId=\{selectedSessionId\}[\s\S]*activeCodeContext=\{activeCodeContext\}[\s\S]*onOpenRawLogs=\{\(\) => setLogsDrawerOpen\(true\)\}[\s\S]*onOpenEvidenceBasket=\{\(\) => setEvidenceDrawerOpen\(true\)\}/
  );
  assert.match(workbenchSource, /type AgentSessionLogItem = LocalizationDeskSessionLogItem;/);
  assert.match(workbenchSource, /onLockSessionLogEvidence=\{\(item\) => lockEvidence\(/);
  assert.match(workbenchSource, /lookupText: buildLookupText\(\[item\.type, item\.message, item\.stdout, item\.stderr\]\)/);
  assert.match(workbenchSource, /onLocateSessionLogSource=\{\(request, preferred\) => locateSourceFromParts\(request, preferred\)\}/);
  assert.match(workbenchSource, /codeCurrentFrame=\{codeCurrentFrame\}/);
  assert.match(workbenchSource, /codeNavigationStack=\{codeNavigationStack\}/);
  assert.match(workbenchSource, /codeForwardTargets=\{codeForwardTargets\}/);
  assert.match(workbenchSource, /onNavigateCodeForward=\{\(target\) => navigateCodeForward\(target\)\}/);
  assert.match(workbenchSource, /onJumpBackInCode=\{\(index\) => jumpBackInCode\(index\)\}/);
});
