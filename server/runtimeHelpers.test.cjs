const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeServerRuntimeOptions,
  buildRuntimeUrls,
  shouldServeAppShell,
} = require('./runtimeHelpers');

test('normalizeServerRuntimeOptions preserves explicit host/port/staticDir', () => {
  const normalized = normalizeServerRuntimeOptions({
    host: '127.0.0.1',
    port: 0,
    staticDir: '/tmp/devutility-dist',
  });

  assert.equal(normalized.host, '127.0.0.1');
  assert.equal(normalized.port, 0);
  assert.equal(normalized.staticDir, '/tmp/devutility-dist');
});

test('buildRuntimeUrls derives ws url from assigned address', () => {
  const urls = buildRuntimeUrls({ address: '127.0.0.1', port: 34567 });

  assert.equal(urls.httpBaseUrl, 'http://127.0.0.1:34567');
  assert.equal(urls.wsBaseUrl, 'ws://127.0.0.1:34567/terminal');
});

test('shouldServeAppShell only matches non-api browser paths', () => {
  assert.equal(shouldServeAppShell('/ssh-manager'), true);
  assert.equal(shouldServeAppShell('/block-benchmark/tasks'), true);
  assert.equal(shouldServeAppShell('/api/health'), false);
  assert.equal(shouldServeAppShell('/terminal'), false);
  assert.equal(shouldServeAppShell('/assets/index.js'), false);
});
