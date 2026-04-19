const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterNoiseText,
  foldSessionLogs,
  matchLogNoise,
  shouldSuppressSessionLog,
} = require('../lib/logNoise');

test('log noise filter removes info-prefixed lines but keeps risk signals', () => {
  const filtered = filterNoiseText([
    '[INFO] warming cache',
    'level=info component=agent',
    'ERROR disk timeout on nvme0n1',
  ].join('\n'));

  assert.equal(filtered.suppressedCount, 2);
  assert.equal(filtered.text, 'ERROR disk timeout on nvme0n1');
});

test('log noise filter folds structured prepare chatter and bracketed info lines by default', () => {
  const filtered = filterNoiseText([
    '[2026-04-20 10:00:00] INFO background probe',
    '[context] shell=/bin/bash',
    '[tool] journalctl=/usr/bin/journalctl',
    'WINDOW ts=2026-04-20T10:00:00+0800 uptime=12:34 shell=/bin/bash',
    'panic: disk detached',
  ].join('\n'));

  assert.equal(filtered.suppressedCount, 4);
  assert.equal(filtered.text, 'panic: disk detached');
});

test('log noise filter removes indented continuation lines that belong to info noise blocks', () => {
  const filtered = filterNoiseText([
    '[INFO] background probe started',
    '  node=node-a',
    '  phase=warmup',
    'panic: disk detached',
  ].join('\n'));

  assert.equal(filtered.suppressedCount, 3);
  assert.equal(filtered.text, 'panic: disk detached');
});

test('session log suppression drops low-signal info events and keeps failures', () => {
  assert.equal(shouldSuppressSessionLog({
    type: 'command_started',
    level: 'info',
    message: '开始执行命令 (exec)',
  }), true);

  assert.equal(shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    stdout: '[INFO] background sync',
    stderr: '',
    exitCode: 0,
  }), true);

  assert.equal(shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    message: '命令执行完成，exit=0，duration=4ms',
    stdout: '   ',
    stderr: '',
    exitCode: 0,
  }), true);

  assert.equal(shouldSuppressSessionLog({
    type: 'command_result',
    level: 'warning',
    stdout: '[INFO] background sync',
    stderr: 'timeout while reading socket',
    exitCode: 1,
  }), false);
});

test('focus mode suppresses debug/trace noise without hiding risky lines', () => {
  assert.deepEqual(
    matchLogNoise('DEBUG warmup started', { builtinMode: 'focus', customKeywords: [] }),
    {
      kind: 'builtin',
      id: 'plain-debug-prefix',
      label: 'DEBUG 前缀',
    }
  );

  assert.equal(
    shouldSuppressSessionLog({
      type: 'command_result',
      level: 'info',
      stdout: 'DEBUG warmup started\nTRACE probe finished',
      stderr: '',
      exitCode: 0,
    }, { builtinMode: 'focus', customKeywords: [] }),
    true
  );

  assert.equal(
    shouldSuppressSessionLog({
      type: 'command_result',
      level: 'info',
      stdout: 'DEBUG warmup started\nERROR probe failed',
      stderr: '',
      exitCode: 0,
    }, { builtinMode: 'focus', customKeywords: [] }),
    false
  );
});

test('matchLogNoise detects common structured info emitters', () => {
  assert.deepEqual(
    matchLogNoise('time="2026-04-20T10:00:00Z" level=info msg="sync ok"'),
    {
      kind: 'builtin',
      id: 'info-level-pair',
      label: 'level=info',
    }
  );
});

test('foldSessionLogs groups suppressed noise with samples and keeps risky records visible', () => {
  const folded = foldSessionLogs([
    {
      id: 'noise-1',
      type: 'command_started',
      level: 'info',
      message: '开始执行命令 (exec)',
    },
    {
      id: 'noise-2',
      type: 'command_result',
      level: 'info',
      stdout: '[INFO] background sync',
      stderr: '',
      exitCode: 0,
    },
    {
      id: 'risk-1',
      type: 'command_result',
      level: 'warning',
      stdout: '[INFO] background sync',
      stderr: 'timeout while reading socket',
      exitCode: 1,
    },
  ]);

  assert.equal(folded.logs.length, 1);
  assert.equal(folded.logs[0].id, 'risk-1');
  assert.equal(folded.foldedNoiseCount, 2);
  assert.equal(folded.foldedNoiseStats[0].count, 1);
  assert.ok(folded.foldedNoiseStats.some((item) => item.sampleText.includes('background sync')));
});
