import test from 'node:test';
import assert from 'node:assert/strict';

import { filterNoiseText, matchLogNoise, shouldSuppressSessionLog } from './logNoise.ts';

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

test('shouldSuppressSessionLog suppresses empty successful command results', () => {
  const suppressed = shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    message: '命令执行完成，exit=0，duration=4ms',
    stdout: '   ',
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

test('filterNoiseText folds structured prepare chatter in default info mode', () => {
  const filtered = filterNoiseText([
    '[2026-04-20 10:00:00] INFO bootstrap ready',
    '[context] shell=/bin/bash',
    '[tool] journalctl=/usr/bin/journalctl',
    'WINDOW ts=2026-04-20T10:00:00+0800 uptime=12:34 shell=/bin/bash',
    'panic: disk detached',
  ].join('\n'));

  assert.equal(filtered.suppressedCount, 4);
  assert.equal(filtered.text, 'panic: disk detached');
});

test('filterNoiseText removes indented continuation lines that belong to info noise blocks', () => {
  const filtered = filterNoiseText([
    '[INFO] background probe started',
    '  node=node-a',
    '  phase=warmup',
    'panic: disk detached',
  ].join('\n'));

  assert.equal(filtered.suppressedCount, 3);
  assert.equal(filtered.text, 'panic: disk detached');
});

test('focus mode suppresses debug lines and keeps nearby risk signals visible', () => {
  assert.deepEqual(
    matchLogNoise('DEBUG warmup started', { builtinMode: 'focus', customKeywords: [] }),
    {
      kind: 'builtin',
      id: 'plain-debug-prefix',
      label: 'DEBUG 前缀',
    }
  );

  assert.equal(shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    message: '命令执行完成，exit=0，duration=8ms',
    stdout: 'DEBUG warmup started\nTRACE probe finished',
    stderr: '',
    exitCode: 0,
  }, {
    builtinMode: 'focus',
    customKeywords: [],
  }), true);

  assert.equal(shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    message: '命令执行完成，exit=0，duration=8ms',
    stdout: 'DEBUG warmup started\nERROR dependency refused connection',
    stderr: '',
    exitCode: 0,
  }, {
    builtinMode: 'focus',
    customKeywords: [],
  }), false);
});

test('matchLogNoise recognizes level=info style emitters', () => {
  assert.deepEqual(
    matchLogNoise('time="2026-04-20T10:00:00Z" level=info msg="sync ok"'),
    {
      kind: 'builtin',
      id: 'info-level-pair',
      label: 'level=info',
    }
  );
});
