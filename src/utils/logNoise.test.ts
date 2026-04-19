import test from 'node:test';
import assert from 'node:assert/strict';

import { filterNoiseText, shouldSuppressSessionLog } from './logNoise.ts';

test('shouldSuppressSessionLog suppresses session logs whose stdout is only info noise', () => {
  const suppressed = shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    message: '命令执行完成，exit=0，duration=12ms',
    stdout: '[INFO] bootstrap ready\nINFO next check complete',
    stderr: '',
    exitCode: 0,
  });

  assert.equal(suppressed, true);
});

test('shouldSuppressSessionLog keeps mixed logs when a risk signal appears beside info noise', () => {
  const suppressed = shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    message: '命令执行完成，exit=0，duration=12ms',
    stdout: '[INFO] probe started\nERROR dependency refused connection',
    stderr: '',
    exitCode: 0,
  });

  assert.equal(suppressed, false);
});

test('filterNoiseText removes info lines but preserves risky lines', () => {
  const filtered = filterNoiseText('[INFO] warmup\nINFO health ok\npanic: disk detached');

  assert.equal(filtered.suppressedCount, 2);
  assert.equal(filtered.text, 'panic: disk detached');
});
