const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeServerRuntimeOptions,
  buildRuntimeUrls,
} = require('./runtimeHelpers');

test('normalizeServerRuntimeOptions preserves explicit host and port', () => {
  const normalized = normalizeServerRuntimeOptions({
    host: '127.0.0.1',
    port: 0,
    staticDir: '/tmp/devutility-dist',
  });

  assert.equal(normalized.host, '127.0.0.1');
  assert.equal(normalized.port, 0);
  assert.equal(Object.hasOwn(normalized, 'staticDir'), false);
});

test('buildRuntimeUrls derives ws url from assigned address', () => {
  const urls = buildRuntimeUrls({ address: '127.0.0.1', port: 34567 });

  assert.equal(urls.httpBaseUrl, 'http://127.0.0.1:34567');
  assert.equal(urls.wsBaseUrl, 'ws://127.0.0.1:34567/terminal');
});
