const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterNoiseText,
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
