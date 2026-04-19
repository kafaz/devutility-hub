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

test('log noise filter suppresses last login banners by default', () => {
  const filtered = filterNoiseText([
    'Last login: Mon Apr 20 09:31:00 2026 from 10.0.0.8',
    'ERROR disk timeout on nvme0n1',
  ].join('\n'));

  assert.equal(filtered.suppressedCount, 1);
  assert.equal(filtered.text, 'ERROR disk timeout on nvme0n1');
});

test('log noise filter suppresses common login MOTD chatter but keeps actionable notices', () => {
  const filtered = filterNoiseText([
    'Welcome to Ubuntu 24.04.2 LTS (GNU/Linux 6.8.0-31-generic x86_64)',
    ' * Documentation:  https://help.ubuntu.com',
    ' System information as of Mon Apr 20 10:00:00 CST 2026',
    '  System load:  0.08',
    '  Usage of /:   41.2% of 49.06GB',
    'System restart required',
  ].join('\n'));

  assert.equal(filtered.suppressedCount, 5);
  assert.equal(filtered.text, 'System restart required');
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

test('session log suppression drops MOTD-only command output', () => {
  assert.equal(shouldSuppressSessionLog({
    type: 'command_result',
    level: 'info',
    stdout: [
      'Welcome to Ubuntu 24.04.2 LTS (GNU/Linux 6.8.0-31-generic x86_64)',
      ' * Documentation:  https://help.ubuntu.com',
      ' System information as of Mon Apr 20 10:00:00 CST 2026',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  }), true);
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
