import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeManualCommandRun } from './useManualCommandRuns.ts';

test('normalizeManualCommandRun preserves sessionId, derives duration from timestamps, and adds an id', () => {
  const normalized = normalizeManualCommandRun({
    sessionId: 'session-123',
    command: 'journalctl -xe',
    stdout: 'line-1',
    stderr: '',
    exitCode: 0,
    startedAt: 1_000,
    finishedAt: 1_245,
  });

  assert.equal(normalized.sessionId, 'session-123');
  assert.equal(normalized.command, 'journalctl -xe');
  assert.equal(normalized.durationMs, 245);
  assert.equal(typeof normalized.id, 'string');
  assert.ok(normalized.id.length > 0);
});

test('manual command lane owns its draft and keeps the parent API near the planned baseline', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const laneSource = fs.readFileSync(path.join(currentDir, 'ManualCommandLane.tsx'), 'utf8');
  const deskSource = fs.readFileSync(path.join(currentDir, 'LocalizationDesk.tsx'), 'utf8');

  assert.match(laneSource, /const \[commandDraft, setCommandDraft\] = useState/);
  assert.doesNotMatch(laneSource, /commandDraft:\s*string;/);
  assert.doesNotMatch(laneSource, /onCommandDraftChange/);
  assert.doesNotMatch(deskSource, /commandDraft=\{/);
  assert.doesNotMatch(deskSource, /onCommandDraftChange=\{/);
});
