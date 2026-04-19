const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterNoiseText,
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
