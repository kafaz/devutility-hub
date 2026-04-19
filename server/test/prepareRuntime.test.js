const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearPrepareStepCache,
  executeStructuredSteps,
} = require('../lib/prepareRuntime');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('executeStructuredSteps parallelizes exec groups and reuses target-scoped cache', async () => {
  clearPrepareStepCache();

  let inFlight = 0;
  let maxInFlight = 0;
  const calls = [];
  const executeCommand = async (_session, cmd, _timeoutMs, mode) => {
    calls.push({ cmd, mode });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(mode === 'exec' ? 20 : 5);
    inFlight -= 1;
    return {
      stdout: `${cmd}-stdout`,
      stderr: '',
      exitCode: 0,
      durationMs: mode === 'exec' ? 20 : 5,
    };
  };

  const session = { username: 'root', host: 'node-a', port: 22 };
  const steps = [
    { name: 'ready-shell', cmd: 'source /etc/profile >/dev/null 2>&1 || true', phase: 'ready' },
    {
      name: 'tool-paths',
      cmd: 'command -v journalctl',
      mode: 'exec',
      phase: 'context',
      parallelGroup: 'context',
      cacheKey: 'tool-paths',
      cacheTtlMs: 60_000,
    },
    {
      name: 'os-release',
      cmd: 'uname -a',
      mode: 'exec',
      phase: 'context',
      parallelGroup: 'context',
      cacheKey: 'os-release',
      cacheTtlMs: 60_000,
    },
  ];

  const firstRun = await executeStructuredSteps(session, steps, { profileId: 'localization' }, {
    allowParallelExec: true,
    executeCommand,
    getBlockedCommandError: () => null,
  });

  assert.equal(firstRun.status, 'done');
  assert.equal(firstRun.readyStepCount, 1);
  assert.equal(firstRun.contextStepCount, 2);
  assert.equal(firstRun.cachedStepCount, 0);
  assert.equal(firstRun.serialDurationMs, 45);
  assert.equal(firstRun.totalDurationMs, 25);
  assert.equal(maxInFlight, 2);
  assert.deepEqual(calls.map((item) => item.mode), ['pty', 'exec', 'exec']);

  calls.length = 0;
  maxInFlight = 0;
  inFlight = 0;

  const secondRun = await executeStructuredSteps(session, steps, { profileId: 'localization' }, {
    allowParallelExec: true,
    executeCommand,
    getBlockedCommandError: () => null,
  });

  assert.equal(secondRun.status, 'done');
  assert.equal(secondRun.cachedStepCount, 2);
  assert.equal(secondRun.serialDurationMs, 5);
  assert.equal(secondRun.totalDurationMs, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'pty');
  assert.equal(secondRun.steps.filter((item) => item.status === 'cached').length, 2);
  assert.equal(secondRun.steps.filter((item) => item.status === 'cached').every((item) => item.durationMs === 0), true);
});

test('target-scoped cache survives profile switches while profile-scoped cache stays isolated', async () => {
  clearPrepareStepCache();

  const calls = [];
  const executeCommand = async (_session, cmd, _timeoutMs, mode) => {
    calls.push({ cmd, mode });
    await sleep(5);
    return {
      stdout: `${cmd}-stdout`,
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    };
  };

  const session = { username: 'root', host: 'node-a', port: 22 };
  const steps = [
    {
      name: 'collect-target-identity',
      cmd: 'printf "[context] user=%s\\n" "$(whoami)"',
      mode: 'exec',
      phase: 'context',
      cacheKey: 'collect-target-identity',
      cacheScope: 'target',
      cacheTtlMs: 60_000,
    },
    {
      name: 'collect-working-dir',
      cmd: 'pwd',
      mode: 'exec',
      phase: 'context',
      cacheKey: 'collect-working-dir',
      cacheTtlMs: 60_000,
    },
  ];

  const firstRun = await executeStructuredSteps(session, steps, { profileId: 'fast-path' }, {
    allowParallelExec: true,
    executeCommand,
    getBlockedCommandError: () => null,
  });

  assert.equal(firstRun.cachedStepCount, 0);
  assert.equal(firstRun.serialDurationMs, 10);
  assert.equal(firstRun.totalDurationMs, 10);
  assert.equal(calls.length, 2);

  calls.length = 0;

  const secondRun = await executeStructuredSteps(session, steps, { profileId: 'boost' }, {
    allowParallelExec: true,
    executeCommand,
    getBlockedCommandError: () => null,
  });

  assert.equal(secondRun.cachedStepCount, 1);
  assert.equal(secondRun.serialDurationMs, 5);
  assert.equal(secondRun.totalDurationMs, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'pwd');
  assert.equal(secondRun.steps[0].status, 'cached');
  assert.equal(secondRun.steps[1].status, 'done');
});
