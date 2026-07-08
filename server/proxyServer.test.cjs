const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startProxyServer, stopProxyServer } = require('./index');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devutility-proxy-'));
}

test('startProxyServer serves api health and does not serve a browser app shell', async (t) => {
  const staticDir = makeTempDir();
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><body>desktop shell</body></html>');

  const runtime = await startProxyServer({ host: '127.0.0.1', port: 0, staticDir });
  t.after(async () => {
    await stopProxyServer();
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  const healthResponse = await fetch(`${runtime.httpBaseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.ok, true);

  const browserPathResponse = await fetch(`${runtime.httpBaseUrl}/diagnostic-workbench`);
  assert.equal(browserPathResponse.status, 404);
});
