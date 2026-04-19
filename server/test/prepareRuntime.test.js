const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildPrepareRunMetrics,
  normalizePreparePhase,
  readPrepareStepCache,
  writePrepareStepCache,
} = require('../lib/prepareRuntime');

function makeTempCacheFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-runtime-'));
  return path.join(dir, 'prepare-cache.json');
}

test('prepare runtime cache stores and reloads target-scoped successful steps', () => {
  const filePath = makeTempCacheFile();
  const session = { host: '10.0.0.8', port: 22, username: 'root' };
  const step = { name: 'warm-common-tools', cacheScope: 'target', cacheTtlMs: 1000 };
  const result = {
    stdout: '[tool] journalctl=/usr/bin/journalctl',
    stderr: '',
    exitCode: 0,
    durationMs: 187,
    status: 'done',
    statusReason: '正常退出',
  };

  writePrepareStepCache(session, 'linux-problem-localization-fast-path', step, 'command -v journalctl', result, {
    filePath,
    now: 100,
  });

  const cached = readPrepareStepCache(session, 'linux-problem-localization-fast-path', step, 'command -v journalctl', {
    filePath,
    now: 200,
  });

  assert.ok(cached);
  assert.equal(cached.fromCache, true);
  assert.equal(cached.cachedAt, 100);
  assert.equal(cached.cacheTtlMs, 1000);
  assert.equal(cached.stdout, result.stdout);
  assert.equal(cached.durationMs, result.durationMs);
});

test('prepare runtime cache expires stale entries', () => {
  const filePath = makeTempCacheFile();
  const session = { host: '10.0.0.9', port: 22, username: 'root' };
  const step = { name: 'warm-common-tools', cacheScope: 'target', cacheTtlMs: 300 };
  const result = {
    stdout: 'cached',
    stderr: '',
    exitCode: 0,
    durationMs: 22,
    status: 'done',
  };

  writePrepareStepCache(session, 'linux-problem-localization-fast-path', step, 'cached command', result, {
    filePath,
    now: 100,
  });

  const cached = readPrepareStepCache(session, 'linux-problem-localization-fast-path', step, 'cached command', {
    filePath,
    now: 450,
  });

  assert.equal(cached, null);
});

test('prepare metrics track ready/context boundaries and cached steps', () => {
  const metrics = buildPrepareRunMetrics([
    { phase: 'ready', startedAt: 100, finishedAt: 280 },
    { phase: 'ready', startedAt: 120, finishedAt: 320 },
    { phase: 'context', startedAt: 330, finishedAt: 600, fromCache: true },
    { phase: 'context', startedAt: 340, finishedAt: 620 },
  ], 520);

  assert.equal(normalizePreparePhase('ready'), 'ready');
  assert.equal(normalizePreparePhase('context'), 'context');
  assert.equal(normalizePreparePhase('anything-else'), 'context');
  assert.equal(metrics.readyStepCount, 2);
  assert.equal(metrics.contextStepCount, 2);
  assert.equal(metrics.cachedStepCount, 1);
  assert.equal(metrics.readyDurationMs, 220);
  assert.equal(metrics.totalDurationMs, 520);
});
