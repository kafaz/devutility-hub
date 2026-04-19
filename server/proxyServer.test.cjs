const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startProxyServer, stopProxyServer } = require('./index');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devutility-proxy-'));
}

test('startProxyServer serves api health and static app shell', async (t) => {
  const staticDir = makeTempDir();
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><body>desktop shell</body></html>');
  fs.mkdirSync(path.join(staticDir, 'assets'));
  fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log("ok");');

  const runtime = await startProxyServer({ host: '127.0.0.1', port: 0, staticDir });
  t.after(async () => {
    await stopProxyServer();
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  const healthResponse = await fetch(`${runtime.httpBaseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.ok, true);

  const shellResponse = await fetch(`${runtime.httpBaseUrl}/diagnostic-workbench`);
  assert.equal(shellResponse.status, 200);
  const shellHtml = await shellResponse.text();
  assert.match(shellHtml, /desktop shell/);

  const assetResponse = await fetch(`${runtime.httpBaseUrl}/assets/app.js`);
  assert.equal(assetResponse.status, 200);
  const assetContent = await assetResponse.text();
  assert.match(assetContent, /console\.log/);
});
