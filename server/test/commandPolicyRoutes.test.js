const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = 3311;
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

test('agent command routes block disallowed commands with controlled 403 errors', async () => {
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

    const sessionCmdResponse = await fetch(`${BASE_URL}/api/agent/sessions/fake-session/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'rm -rf /tmp/some-path' }),
    });
    assert.equal(sessionCmdResponse.status, 403);
    const sessionCmdBody = await sessionCmdResponse.json();
    assert.equal(sessionCmdBody.ok, false);
    assert.match(sessionCmdBody.error, /Command Policy Block/);
    assert.doesNotMatch(sessionCmdBody.error, /ReferenceError/i);

    const agentExecuteResponse = await fetch(`${BASE_URL}/api/agent/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'fake-session', cmd: 'rm -rf /tmp/some-path' }),
    });
    assert.equal(agentExecuteResponse.status, 403);
    const agentExecuteBody = await agentExecuteResponse.json();
    assert.equal(agentExecuteBody.ok, false);
    assert.match(agentExecuteBody.error, /Command Policy Block/);
    assert.doesNotMatch(agentExecuteBody.error, /ReferenceError/i);
  } finally {
    const exitPromise = waitForExit(server);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
    }
    await exitPromise;
  }

  assert.equal(stderr.includes('ReferenceError'), false, `unexpected server stderr: ${stderr}`);
});
