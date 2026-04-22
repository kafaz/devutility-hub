import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFlowRunActiveCodeBinding,
  getFlowRunManualCommandRuns,
  getFlowRunTimelineWhiteboard,
  getLocalizationDeskStateKey,
  toCodeContextBindingDraft,
} from './workbenchPersistence.ts';

test('live flow state stays session-scoped until a flow run is explicitly attached', () => {
  assert.equal(getLocalizationDeskStateKey(null, 'session-a'), 'live:session-a');
  assert.deepEqual(getFlowRunManualCommandRuns(null), []);
  assert.deepEqual(getFlowRunTimelineWhiteboard(null), []);
  assert.equal(getFlowRunActiveCodeBinding(null), null);
});

test('flow run artifacts are read from the explicitly attached run only', () => {
  const flowRun = {
    id: 'run-flow-1',
    manualCommandRuns: [{ id: 'cmd-1', sessionId: 'session-a', command: 'tail -n 50 /var/log/messages' }],
    activeCodeBinding: {
      repo: 'repo-live',
      repoDisplayName: 'repo-live',
      branch: 'main',
      commit: 'abc123',
      worktreePath: '/tmp/repo-live',
    },
    timelineWhiteboard: [
      {
        id: 'log-1',
        kind: 'log',
        title: 'queue stalled',
        excerpt: 'queue stalled',
        timestamp: 123,
        sourceType: 'session_log',
        sourceId: 'session-log-1',
        accent: 'warning',
      },
    ],
  };

  assert.equal(getLocalizationDeskStateKey(flowRun, 'session-b'), 'run:run-flow-1');
  assert.equal(getFlowRunManualCommandRuns(flowRun).length, 1);
  assert.equal(getFlowRunTimelineWhiteboard(flowRun).length, 1);
  assert.equal(getFlowRunActiveCodeBinding(flowRun)?.commit, 'abc123');
});

test('code-context draft prefers persisted repo and falls back to display name for legacy records', () => {
  assert.deepEqual(
    toCodeContextBindingDraft({
      repo: 'repo-a',
      repoDisplayName: 'Repo A',
      branch: 'main',
      commit: 'abc123',
      worktreePath: '/tmp/repo-a',
    }),
    { repo: 'repo-a', branch: 'main', commit: 'abc123' }
  );

  assert.deepEqual(
    toCodeContextBindingDraft({
      repo: '',
      repoDisplayName: 'legacy-repo-name',
      branch: 'release',
      commit: 'def456',
      worktreePath: '/tmp/legacy',
    }),
    { repo: 'legacy-repo-name', branch: 'release', commit: 'def456' }
  );
});
