const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const { STORE_FILE } = require('../diagnosticKb');

const PORT = 3313;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once('exit', resolve));
}

async function waitForServerReady(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/agent/command-policy`);
      if (response.ok) return;
    } catch {
      // keep polling until timeout
    }
    await sleep(100);
  }
  throw new Error('server did not become ready in time');
}

test('diagnostic workbench PATCH route persists only manual desk fields', async () => {
  const originalStore = fs.existsSync(STORE_FILE) ? fs.readFileSync(STORE_FILE, 'utf8') : null;
  fs.mkdirSync(require('node:path').dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify({
      runs: [
        {
          id: 'run-workbench-test',
          title: 'Original title',
          symptom: 'Original symptom',
          status: 'completed',
          startedAt: 1_000,
          finishedAt: 2_000,
        },
      ],
    }, null, 2),
    'utf8'
  );

  const server = spawn('node', ['index.js'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stdout.on('data', () => {
    // drain stdout so the child cannot block on banner output
  });
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServerReady();

    const rejectedResponse = await fetch(`${BASE_URL}/api/diagnostic/runs/run-workbench-test/workbench`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Mutated title',
      }),
    });
    assert.equal(rejectedResponse.status, 400);
    const rejectedBody = await rejectedResponse.json();
    assert.equal(rejectedBody.ok, false);
    assert.match(rejectedBody.error, /workbench/i);

    const patchResponse = await fetch(`${BASE_URL}/api/diagnostic/runs/run-workbench-test/workbench`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manualCommandRuns: [
          {
            id: 'manual-run-1',
            sessionId: 'session-123',
            command: 'tail -n 50 /var/log/messages',
            stdout: 'fatal: queue stalled',
            stderr: '',
            exitCode: 0,
            durationMs: 812,
          },
        ],
        activeCodeBinding: {
          repo: 'repo-a',
          repoDisplayName: 'repo-a',
          branch: 'main',
          commit: 'abc123def456',
          worktreePath: '/tmp/repo-a',
        },
        timelineWhiteboard: [
          {
            id: 'node-1',
            kind: 'log',
            title: 'first anomaly',
            excerpt: 'blk_update_request I/O error',
            timestamp: 1_111,
            sourceType: 'session_log',
            sourceId: 'log-1',
            accent: 'error',
          },
        ],
      }),
    });
    assert.equal(patchResponse.status, 200);
    const patchBody = await patchResponse.json();
    assert.equal(patchBody.ok, true);
    assert.equal(patchBody.run.title, 'Original title');
    assert.equal(patchBody.run.manualCommandRuns.length, 1);
    assert.equal(patchBody.run.manualCommandRuns[0].sessionId, 'session-123');
    assert.equal(patchBody.run.activeCodeBinding.repo, 'repo-a');
    assert.equal(patchBody.run.activeCodeBinding.branch, 'main');
    assert.equal(patchBody.run.timelineWhiteboard.length, 1);
    assert.equal(patchBody.run.timelineWhiteboard[0].kind, 'log');
    assert.equal(patchBody.run.timelineWhiteboard[0].title, 'first anomaly');

    const runResponse = await fetch(`${BASE_URL}/api/diagnostic/runs/run-workbench-test`);
    assert.equal(runResponse.status, 200);
    const runBody = await runResponse.json();
    assert.equal(runBody.ok, true);
    assert.equal(runBody.run.title, 'Original title');
    assert.equal(runBody.run.manualCommandRuns[0].sessionId, 'session-123');
    assert.equal(runBody.run.manualCommandRuns[0].command, 'tail -n 50 /var/log/messages');
    assert.equal(runBody.run.activeCodeBinding.repo, 'repo-a');
    assert.equal(runBody.run.activeCodeBinding.repoDisplayName, 'repo-a');
    assert.equal(runBody.run.timelineWhiteboard[0].title, 'first anomaly');
    assert.equal(runBody.run.timelineWhiteboard[0].sourceType, 'session_log');
  } finally {
    const exitPromise = waitForExit(server);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
    }
    await exitPromise;

    if (originalStore === null) {
      fs.rmSync(STORE_FILE, { force: true });
    } else {
      fs.writeFileSync(STORE_FILE, originalStore, 'utf8');
    }
  }

  assert.equal(stderr.includes('ReferenceError'), false, `unexpected server stderr: ${stderr}`);
});
