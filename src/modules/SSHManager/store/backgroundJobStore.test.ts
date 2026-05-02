import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldUpdateJobOutput } from './backgroundJobStore.ts';

test('shouldUpdateJobOutput skips unchanged output', () => {
  assert.equal(shouldUpdateJobOutput('line 1\nline 2', 'line 1\nline 2'), false);
});

test('shouldUpdateJobOutput accepts changed output', () => {
  assert.equal(shouldUpdateJobOutput('line 1', 'line 1\nline 2'), true);
});
