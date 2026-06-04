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

async function waitForServerReady(baseUrl = BASE_URL, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/agent/command-policy`);
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
    await waitForServerReady(BASE_URL);

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

test('command policy validate route returns structured allow and block decisions', async () => {
  const server = spawn('node', ['index.js'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
      PORT: String(PORT + 1),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${PORT + 1}`;
  let stderr = '';
  server.stdout.on('data', () => {
    // drain stdout so the child cannot block on banner output
  });
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServerReady(baseUrl);

    const allowedResponse = await fetch(`${baseUrl}/api/agent/command-policy/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'tail -n 20 /var/log/messages', context: 'mcp-preflight' }),
    });
    assert.equal(allowedResponse.status, 200);
    const allowedBody = await allowedResponse.json();
    assert.equal(allowedBody.ok, true);
    assert.equal(allowedBody.data.allowed, true);
    assert.equal(allowedBody.data.context, 'mcp-preflight');
    assert.deepEqual(allowedBody.data.baseCommands, ['tail']);
    assert.deepEqual(allowedBody.data.segments, ['tail -n 20 /var/log/messages']);

    const blockedResponse = await fetch(`${baseUrl}/api/agent/command-policy/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'rm -rf /tmp/some-path', context: 'mcp-preflight' }),
    });
    assert.equal(blockedResponse.status, 200);
    const blockedBody = await blockedResponse.json();
    assert.equal(blockedBody.ok, true);
    assert.equal(blockedBody.data.allowed, false);
    assert.equal(blockedBody.data.blockedRuleId, 'rm_rf');
    assert.match(blockedBody.data.reason, /禁止删除文件或目录/);
  } finally {
    const exitPromise = waitForExit(server);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
    }
    await exitPromise;
  }

  assert.equal(stderr.includes('ReferenceError'), false, `unexpected server stderr: ${stderr}`);
});
