const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifySessionTarget,
} = require('./targetGuard');

const session = {
  sessionId: 'agent_001',
  nodeId: 'node-prod-db-01',
  host: '10.0.0.11',
  port: 22,
  username: 'root',
};

test('verifySessionTarget passes when the asserted target matches the session', () => {
  const result = verifySessionTarget(session, {
    nodeId: 'node-prod-db-01',
    host: '10.0.0.11',
    port: 22,
    username: 'root',
  }, { requireTarget: true });

  assert.equal(result.ok, true);
  assert.equal(result.enforced, true);
  assert.deepEqual(result.mismatches, []);
});

test('verifySessionTarget rejects a command intended for a different node target', () => {
  const result = verifySessionTarget(session, {
    nodeId: 'node-prod-db-02',
    host: '10.0.0.12',
    port: 22,
    username: 'root',
  }, { requireTarget: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, '目标断言与当前会话不匹配');
  assert.deepEqual(result.mismatches.map((item) => item.field), ['nodeId', 'host']);
});

test('verifySessionTarget rejects missing target assertions when required', () => {
  const result = verifySessionTarget(session, null, { requireTarget: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, '缺少目标断言');
  assert.equal(result.enforced, false);
});

test('verifySessionTarget rejects weak assertions without nodeId or host', () => {
  const result = verifySessionTarget(session, {
    username: 'root',
    port: 22,
  }, { requireTarget: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, '目标断言缺少 nodeId 或 host');
  assert.equal(result.enforced, false);
});
