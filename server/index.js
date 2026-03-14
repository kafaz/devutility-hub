/**
 * SSH Proxy Server — Shell 通道复用 + Marker 标记输出捕获
 *
 * 核心设计改变：
 *   旧方案：SOP 命令通过 ssh.exec() → 每次创建新通道 → 不继承 Shell 状态
 *   新方案：SOP 命令通过已有 Shell PTY 写入 → 继承 sudo/cd/env 等所有状态
 *
 * Marker 标记法原理：
 *   向 Shell 写入:
 *     echo '===S:abc123==='        ← 开始标记
 *     <实际命令>
 *     echo "===E:abc123===:$?"    ← 结束标记（包含退出码）
 *
 *   Shell 输出流中会出现（同时回显到终端让用户看到执行过程）:
 *     echo '===S:abc123==='       ← 终端回显命令本身（含单引号，不是标记）
 *     ===S:abc123===              ← 真正的标记输出（无引号）
 *     <命令输出>
 *     echo "===E:abc123===:$?"   ← 终端回显
 *     ===E:abc123===:0            ← 标记 + 退出码
 *
 *   解析：按行扫描，trimmed 行完全等于标记字符串时识别
 *
 * 命令队列：
 *   单 Shell 同一时刻只能执行一条命令，通过队列序列化，
 *   等待上一条命令的结束标记后才发送下一条。
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const { Client }          = require('ssh2');
const { spawn }           = require('child_process');
const cors   = require('cors');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const { simpleGit } = require('simple-git');
const { ManagedAgentSession } = require('./lib/managedAgentSession');
const {
  getNode,
  getPrepareProfile,
  listNodes,
  listPrepareProfiles,
  resolveNode,
  saveNode,
  savePrepareProfile,
  updateNode,
  updatePrepareProfile,
} = require('./lib/agentRegistry');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/terminal' });

// 全局 Session 会话池 - 供 Agent / MCP Remote API 访问
global.activeSessions = new Map();

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/** 去除 ANSI 转义序列（用于解析标记，不影响终端显示） */
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '');
}

/** 构造唯一标记 ID（仅含字母数字，对单引号 echo 安全） */
function makeMarkerId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const mkS = (id) => `===S:${id}===`;          // 开始标记
const mkE = (id) => `===E:${id}===:`;         // 结束标记前缀

/**
 * 执行本地 Python 脚本，通过 stdin 传入数据，返回 stdout
 *
 * 脚本使用场景：对子步骤的原始 stdout 做二次处理
 *   - 提取特定字段（正则/JSON解析）
 *   - 格式转换（bytes → human-readable）
 *   - 聚合多行输出为单一值
 *
 * 示例脚本（提取 PID）：
 *   import sys, re
 *   data = sys.stdin.read()
 *   m = re.search(r'(\d+)', data)
 *   print(m.group(1) if m else '', end='')
 */
async function runPythonScript(scriptPath, inputData, timeoutMs = 15000) {
  return new Promise((resolve) => {
    // 路径处理：支持 ~ 前缀
    const resolved = scriptPath.startsWith('~')
      ? path.join(process.env.HOME || process.env.USERPROFILE || '', scriptPath.slice(1))
      : scriptPath;

    let stdout = '';
    let stderr = '';

    // 优先使用 python3，回退 python
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    let proc;
    try {
      proc = spawn(pythonBin, [resolved], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ stdout: '', stderr: String(e), exitCode: -1 });
      return;
    }

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout: stdout.trimEnd(), stderr: '[TIMEOUT] ' + stderr, exitCode: -1 });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: code ?? 0 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: -1 });
    });

    // 将子步骤 stdout 写入脚本 stdin
    proc.stdin.write(inputData ?? '');
    proc.stdin.end();
  });
}

/**
 * 基于正则对输出做状态判断（服务器侧，与前端 evaluateStepOutput 逻辑一致）
 *   priority: abnormalRegex > normalRegex > exitCode
 */
function evalOutputStatus(stdout, opts) {
  const text = stdout ?? '';

  if (opts.abnormalRegex) {
    try {
      if (new RegExp(opts.abnormalRegex, 'im').test(text)) {
        return { status: 'failed', reason: `异常正则命中: /${opts.abnormalRegex}/` };
      }
    } catch { /* 无效正则，跳过 */ }
  }

  if (opts.normalRegex) {
    try {
      const matched = new RegExp(opts.normalRegex, 'im').test(text);
      return {
        status: matched ? 'done' : 'failed',
        reason: matched
          ? `正常正则命中: /${opts.normalRegex}/`
          : `正常正则未匹配: /${opts.normalRegex}/`,
      };
    } catch { /* 无效正则，跳过 */ }
  }

  // 回退：exit code
  return {
    status: opts.exitCode === 0 ? 'done' : 'failed',
    reason: `exit ${opts.exitCode}`,
  };
}

/** 构造 paramiko 等效连接配置 */
function buildConnectConfig(msg) {
  const cfg = {
    host:              msg.host,
    port:              msg.port || 22,
    username:          msg.username,
    readyTimeout:      msg.readyTimeout || 30000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 5,
  };

  const authType = msg.authType || 'privateKey';

  if (authType === 'privateKey') {
    if (msg.keyContent) {
      cfg.privateKey = msg.keyContent;
    } else if (msg.keyFilePath) {
      const resolved = msg.keyFilePath.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', msg.keyFilePath.slice(1))
        : msg.keyFilePath;
      cfg.privateKey = fs.readFileSync(resolved);
    } else {
      throw new Error('privateKey 模式需要 keyContent 或 keyFilePath');
    }
    if (msg.passphrase) cfg.passphrase = msg.passphrase;
  } else if (authType === 'password') {
    if (!msg.password) throw new Error('password 模式需要 password 字段');
    cfg.password = msg.password;
  } else if (authType === 'agent') {
    cfg.agent = msg.agent || process.env.SSH_AUTH_SOCK;
    if (!cfg.agent) throw new Error('agent 模式需要 SSH Agent 正在运行');
  }

  return cfg;
}

// ─── REST ──────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, platform: process.platform, pid: process.pid })
);

app.get('/api/agents', (_req, res) => {
  const agents = [];
  if (process.platform === 'win32') {
    agents.push({ id: 'openssh-win', name: 'Windows OpenSSH Agent',
      value: '\\\\.\\pipe\\openssh-ssh-agent' });
    agents.push({ id: 'pageant', name: 'Pageant', value: 'pageant' });
  } else {
    const sock = process.env.SSH_AUTH_SOCK;
    if (sock) agents.push({ id: 'unix', name: `ssh-agent (${sock})`, value: sock });
  }
  res.json({ agents });
});

app.post('/api/check-key', (req, res) => {
  const { keyFilePath } = req.body;
  if (!keyFilePath) return res.json({ ok: false, msg: '路径为空' });
  const resolved = keyFilePath.startsWith('~')
    ? path.join(process.env.HOME || process.env.USERPROFILE || '', keyFilePath.slice(1))
    : keyFilePath;
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
    res.json({ ok: true, resolved });
  } catch (e) {
    res.json({ ok: false, msg: e.message });
  }
});

// ─── AI Agent / MCP 远程控制 API ──────────────────────────────────────────

const AGENT_COMMAND_BLACKLIST = [
  /rm\s+-rf/,
  /mkfs/,
  /dd\s+if=/,
  /reboot/,
  /shutdown/,
  /init\s+[06]/,
  /:(\s*)\{\s*\|\|\s*:\s*\&\s*\}\s*;\s*:/ // bash fork bomb
];

function writeAgentAuditLog(text) {
  const logFilePath = path.join(os.tmpdir(), 'agent-execution-audit.log');
  fs.appendFileSync(logFilePath, text, 'utf8');
}

function getBlockedCommandError(cmd) {
  for (const regex of AGENT_COMMAND_BLACKLIST) {
    if (regex.test(cmd)) {
      return `[Agent Security Block] 拒绝执行具有受限或破坏性特征的命令: ${cmd}`;
    }
  }
  return null;
}

function sanitizeNode(node) {
  if (!node) return null;
  const {
    keyContent, password, passphrase,
    jumpPassword, jumpPassphrase, jumpKeyContent,
    ...rest
  } = node;
  return rest;
}

function describeSession(sessionId, session) {
  if (!session) return null;
  if (typeof session.getInfo === 'function') return session.getInfo();
  return {
    sessionId,
    nodeId: session.nodeId || null,
    name: session.name || sessionId,
    host: session.host,
    port: session.port || 22,
    username: session.username,
    source: session.source || 'ui',
    status: 'connected',
    createdAt: session.createdAt || null,
    connectedAt: session.connectedAt || null,
    lastActivityAt: session.lastActivityAt || null,
    shellReady: Boolean(session.shellStream || session.shell),
  };
}

function resolveJumpSource(connection) {
  if (connection.jumpHost) return connection.jumpHost;
  if (connection.jumpHostId) {
    const jumpNode = getNode(connection.jumpHostId);
    if (!jumpNode) throw new Error(`jumpHostId 不存在: ${connection.jumpHostId}`);
    return jumpNode;
  }
  return null;
}

function materializeConnectionSpec(body) {
  let rawConnection = body.connection;
  let node = null;

  if (body.nodeId) {
    node = getNode(body.nodeId);
    if (!node) throw new Error(`节点不存在: ${body.nodeId}`);
    rawConnection = node;
  }

  if (!rawConnection) {
    throw new Error('缺少 nodeId 或 connection 参数');
  }

  const authOverrides = body.auth || {};
  const jumpOverrides = body.jumpAuth || {};

  const connectSource = {
    host: rawConnection.host,
    port: rawConnection.port || 22,
    username: rawConnection.username,
    authType: rawConnection.authType || 'agent',
    keyContent: rawConnection.keyContent,
    keyFilePath: rawConnection.keyFilePath,
    passphrase: rawConnection.passphrase,
    password: rawConnection.password,
    agent: rawConnection.agent,
    readyTimeout: rawConnection.readyTimeout,
    ...authOverrides,
  };

  const jumpSource = resolveJumpSource(rawConnection);
  const jumpConfig = jumpSource
    ? buildConnectConfig({
      host: jumpSource.host,
      port: jumpSource.port || 22,
      username: jumpSource.username,
      authType: jumpSource.authType || 'agent',
      keyContent: jumpSource.keyContent,
      keyFilePath: jumpSource.keyFilePath,
      passphrase: jumpSource.passphrase,
      password: jumpSource.password,
      agent: jumpSource.agent,
      readyTimeout: jumpSource.readyTimeout,
      ...jumpOverrides,
    })
    : undefined;

  return {
    node,
    connectConfig: buildConnectConfig(connectSource),
    jumpConfig,
    name: rawConnection.name || rawConnection.nodeId || rawConnection.host,
    host: rawConnection.host,
    port: rawConnection.port || 22,
    username: rawConnection.username,
  };
}

async function executeStructuredSteps(session, steps, opts = {}) {
  const varContext = { ...(opts.variables || {}) };
  const results = [];
  const continueOnError = opts.continueOnError === true;

  for (const step of steps || []) {
    if (!step?.cmd) continue;

    const resolvedCmd = step.cmd.replace(
      /\$\{([^}]+)\}/g,
      (_, name) => varContext[name] !== undefined ? varContext[name] : `\${${name}}`
    );

    const blocked = getBlockedCommandError(resolvedCmd);
    if (blocked) {
      results.push({
        name: step.name || resolvedCmd,
        cmd: step.cmd,
        resolvedCmd,
        stdout: '',
        stderr: blocked,
        exitCode: -1,
        durationMs: 0,
        status: 'failed',
        statusReason: blocked,
        varSnapshot: { ...varContext },
      });
      if (!continueOnError) break;
      continue;
    }

    const result = await session.enqueueShellCmd(resolvedCmd, step.timeoutMs || step.timeout || 30000);
    let processedOutput = result.stdout;
    let scriptResult;
    let scriptError;

    if (step.scriptPath) {
      const sr = await runPythonScript(step.scriptPath, result.stdout, 15000);
      if (sr.exitCode === 0) {
        processedOutput = sr.stdout;
        scriptResult = { exitCode: sr.exitCode, stdout: sr.stdout };
      } else {
        scriptError = `脚本执行失败(exit ${sr.exitCode}): ${sr.stderr}`;
      }
    }

    const evalResult = evalOutputStatus(processedOutput, {
      abnormalRegex: step.abnormalRegex,
      normalRegex: step.normalRegex,
      exitCode: result.exitCode,
    });

    let capturedVar;
    if (step.captureVar && evalResult.status !== 'failed') {
      let value = processedOutput.trim();
      if (step.capturePattern) {
        try {
          const matched = new RegExp(step.capturePattern).exec(processedOutput);
          if (matched) value = matched[1] !== undefined ? matched[1] : matched[0];
        } catch { /* ignore invalid regex */ }
      }
      if (value) {
        varContext[step.captureVar] = value;
        capturedVar = { name: step.captureVar, value };
      }
    }

    results.push({
      name: step.name || resolvedCmd,
      cmd: step.cmd,
      resolvedCmd,
      stdout: result.stdout,
      processedOutput: step.scriptPath ? processedOutput : undefined,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      status: evalResult.status,
      statusReason: evalResult.reason,
      capturedVar,
      scriptResult,
      scriptError,
      varSnapshot: { ...varContext },
    });

    if (evalResult.status === 'failed' && !continueOnError) break;
  }

  return {
    status: results.some((item) => item.status === 'failed') ? 'failed' : 'done',
    steps: results,
    finalVarContext: varContext,
  };
}

async function executeSingleCommand(session, cmd, timeout, mode) {
  if (mode === 'exec') {
    if (typeof session.execCommand === 'function') {
      return session.execCommand(cmd, timeout);
    }

    if (session.sshClient) {
      return new Promise((resolve) => {
        const startTs = Date.now();
        let stdout = '';
        let stderr = '';

        session.sshClient.exec(cmd, (err, stream) => {
          if (err) {
            resolve({ stdout: '', stderr: err.message, exitCode: -1, durationMs: Date.now() - startTs });
            return;
          }
          stream.on('data', (data) => { stdout += data.toString(); });
          stream.stderr.on('data', (data) => { stderr += data.toString(); });
          stream.on('close', (code) => {
            resolve({
              stdout: stdout.trimEnd(),
              stderr: stderr.trimEnd(),
              exitCode: code ?? 0,
              durationMs: Date.now() - startTs,
            });
          });
        });
      });
    }
  }

  return session.enqueueShellCmd(cmd, timeout);
}

// 节点注册
app.get('/api/agent/nodes', (_req, res) => {
  res.json({ ok: true, data: listNodes().map(sanitizeNode) });
});

app.post('/api/agent/nodes/resolve', (req, res) => {
  const matched = resolveNode(req.body?.query);
  res.json({ ok: true, data: { matched: Boolean(matched), node: sanitizeNode(matched) } });
});

app.post('/api/agent/nodes', (req, res) => {
  const { nodeId, name, host, username } = req.body || {};
  if (!nodeId || !name || !host || !username) {
    return res.status(400).json({ ok: false, error: 'nodeId/name/host/username 为必填项' });
  }
  const saved = saveNode(req.body);
  res.json({ ok: true, data: sanitizeNode(saved) });
});

app.patch('/api/agent/nodes/:nodeId', (req, res) => {
  const saved = updateNode(req.params.nodeId, req.body || {});
  if (!saved) {
    return res.status(404).json({ ok: false, error: '节点不存在' });
  }
  res.json({ ok: true, data: sanitizeNode(saved) });
});

// 预操作模板
app.get('/api/agent/prepare-profiles', (_req, res) => {
  res.json({ ok: true, data: listPrepareProfiles() });
});

app.post('/api/agent/prepare-profiles', (req, res) => {
  const { profileId, name } = req.body || {};
  if (!profileId || !name) {
    return res.status(400).json({ ok: false, error: 'profileId/name 为必填项' });
  }
  res.json({ ok: true, data: savePrepareProfile(req.body) });
});

app.patch('/api/agent/prepare-profiles/:profileId', (req, res) => {
  const saved = updatePrepareProfile(req.params.profileId, req.body || {});
  if (!saved) {
    return res.status(404).json({ ok: false, error: '预操作模板不存在' });
  }
  res.json({ ok: true, data: saved });
});

// agent 自建会话
app.post('/api/agent/sessions/open', async (req, res) => {
  let sessionId = null;
  try {
    const { node, connectConfig, jumpConfig, name, host, port, username } = materializeConnectionSpec(req.body || {});
    const reuseIfExists = req.body?.reuseIfExists !== false;

    if (reuseIfExists) {
      for (const [sessionId, session] of global.activeSessions.entries()) {
        const info = describeSession(sessionId, session);
        if (info?.status === 'connected' && (
          (node?.nodeId && info.nodeId === node.nodeId) ||
          (info.host === host && info.username === username)
        )) {
          return res.json({ ok: true, data: info, reused: true });
        }
      }
    }

    sessionId = req.body?.sessionId || `agent_${crypto.randomBytes(6).toString('hex')}`;
    const managedSession = new ManagedAgentSession({
      sessionId,
      nodeId: node?.nodeId,
      name,
      host,
      port,
      username,
      reason: req.body?.reason,
      ttlSec: req.body?.ttlSec,
      connectConfig,
      jumpConfig,
      onClose: () => {
        global.activeSessions.delete(sessionId);
      },
    });

    global.activeSessions.set(sessionId, managedSession);
    await managedSession.connect();
    res.json({ ok: true, data: managedSession.getInfo() });
  } catch (e) {
    if (sessionId) {
      const failedSession = global.activeSessions.get(sessionId);
      if (failedSession && typeof failedSession.close === 'function') {
        failedSession.close('connect_failed');
      }
      global.activeSessions.delete(sessionId);
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/agent/sessions
 * 暴露当前活跃的会话列表给 Agent
 */
app.get('/api/agent/sessions', (req, res) => {
  const sessions = [];
  for (const [id, session] of global.activeSessions.entries()) {
    sessions.push(describeSession(id, session));
  }
  res.json({ ok: true, sessions });
});

app.get('/api/agent/sessions/:sessionId', (req, res) => {
  const session = global.activeSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Session 不存在或已断开连接' });
  }
  res.json({ ok: true, data: describeSession(req.params.sessionId, session) });
});

app.delete('/api/agent/sessions/:sessionId', (req, res) => {
  const session = global.activeSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Session 不存在或已断开连接' });
  }

  if (typeof session.close === 'function') {
    session.close('closed_by_api');
  } else if (session.sshClient) {
    session.sshClient.end();
    global.activeSessions.delete(req.params.sessionId);
  }

  res.json({ ok: true, data: { sessionId: req.params.sessionId, closed: true } });
});

app.post('/api/agent/sessions/:sessionId/prepare', async (req, res) => {
  const session = global.activeSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Session 不存在或已断开连接' });
  }

  const profile = req.body?.profileId ? getPrepareProfile(req.body.profileId) : null;
  const steps = req.body?.steps || profile?.steps;
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ ok: false, error: '缺少 prepare steps' });
  }

  try {
    const result = await executeStructuredSteps(session, steps, {
      continueOnError: req.body?.continueOnError,
      variables: req.body?.variables,
    });
    res.json({
      ok: true,
      data: {
        session: describeSession(req.params.sessionId, session),
        profile: profile || null,
        ...result,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/agent/sessions/:sessionId/commands', async (req, res) => {
  const { cmd, timeoutMs = 30000, mode = 'pty' } = req.body || {};
  if (!cmd) {
    return res.status(400).json({ ok: false, error: '缺少 cmd 参数' });
  }

  const blocked = getBlockedCommandError(cmd);
  if (blocked) {
    return res.status(403).json({ ok: false, error: blocked });
  }

  const session = global.activeSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Session 不存在或已断开连接' });
  }

  const startTime = new Date().toISOString();

  try {
    const result = await executeSingleCommand(session, cmd, timeoutMs, mode);
    writeAgentAuditLog(
      `[${startTime}] Agent Command on ${session.username}@${session.host} (Session: ${req.params.sessionId})\n` +
      `Mode    : ${mode}\n` +
      `Command : ${cmd}\n` +
      `ExitCode: ${result.exitCode}\n` +
      `Duration: ${result.durationMs}ms\n` +
      `Stdout  :\n${result.stdout}\n` +
      `Stderr  :\n${result.stderr}\n` +
      '---------------------------------------------------\n'
    );
    res.json({ ok: true, data: result });
  } catch (e) {
    writeAgentAuditLog(
      `[${startTime}] Agent Command ERR on ${session.username}@${session.host} (Session: ${req.params.sessionId})\n` +
      `Command: ${cmd}\nError: ${e.message}\n---------------------------------------------------\n`
    );
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/agent/execute
 * 供 Agent 远程执行命令，并且阻塞等待命令执行结束返回 std/out。
 * 
 * Body: { sessionId: "string", cmd: "string", timeout?: number }
 */
app.post('/api/agent/execute', async (req, res) => {
  const { sessionId, cmd, timeout = 30000 } = req.body;
  if (!sessionId || !cmd) {
    return res.status(400).json({ ok: false, error: '缺少 sessionId 或 cmd 参数' });
  }

  const blocked = getBlockedCommandError(cmd);
  if (blocked) {
    console.warn(blocked);
    return res.status(403).json({ ok: false, error: blocked });
  }

  const session = global.activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Session 不存在或已断开连接' });
  }

  const startTime = new Date().toISOString();
  let result;
  try {
    result = await session.enqueueShellCmd(cmd, timeout);
    
    // 审计日志: 保存执行记录到临时文件
    writeAgentAuditLog(
      `[${startTime}] Agent Execution on ${session.username}@${session.host} (Session: ${sessionId})\n` +
      `Command : ${cmd}\n` +
      `ExitCode: ${result.exitCode}\n` +
      `Duration: ${result.durationMs}ms\n` +
      `Stdout  :\n${result.stdout}\n` +
      `Stderr  :\n${result.stderr}\n` +
      '---------------------------------------------------\n'
    );

    res.json({
      ok: true,
      result: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs
      }
    });
  } catch (e) {
    writeAgentAuditLog(
      `[${startTime}] Agent Execution ERR on ${session.username}@${session.host} (Session: ${sessionId})\n` +
      `Command: ${cmd}\nError: ${e.message}\n---------------------------------------------------\n`
    );

    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── SOP Git 仓库同步 ──────────────────────────────────────────────────────

/**
 * POST /api/sop/git-sync
 *
 * 从指定 Git 仓库的特定路径批量读取 SOP 模板文件（.md / .json）。
 * 流程：
 *   1. 以 URL + branch 的 MD5 哈希作为缓存目录名，避免重复 clone
 *   2. 目录已存在 → pull 最新；不存在 → shallow clone (--depth 1)
 *   3. 遍历 path 指定的子目录，读取所有 .md 和 .json 文件内容
 *   4. 返回文件列表供前端解析并导入模板
 *
 * 鉴权：将 token 以 Basic Auth 形式嵌入 URL（兼容 GitHub / GitLab / Gitea）
 *   https://<token>@github.com/org/repo.git
 *
 * Request body:
 *   { url: string, branch?: string, path?: string, token?: string }
 *
 * Response:
 *   { ok: true, files: [{name, relativePath, content, ext}], branch, count }
 *   { ok: false, error: string }
 */
app.post('/api/sop/git-sync', async (req, res) => {
  const { url, branch = 'main', path: repoSubPath = '', token } = req.body;

  if (!url) {
    return res.status(400).json({ ok: false, error: '仓库 URL 不能为空' });
  }

  // 构造带鉴权的克隆 URL（仅用于 git 操作，不对外暴露）
  let cloneUrl = url;
  if (token) {
    try {
      const parsed = new URL(url);
      // GitHub/GitLab PAT: https://oauth2:TOKEN@host/org/repo.git
      parsed.username = 'oauth2';
      parsed.password = token;
      cloneUrl = parsed.toString();
    } catch (e) {
      return res.status(400).json({ ok: false, error: `无效的仓库 URL: ${e.message}` });
    }
  }

  // 缓存目录：用 url+branch 做哈希，避免同仓库不同分支冲突
  const cacheKey  = crypto.createHash('md5').update(`${url}#${branch}`).digest('hex').slice(0, 12);
  const cacheDir  = path.join(os.tmpdir(), 'devutility-git', cacheKey);
  const gitMarker = path.join(cacheDir, '.git');

  try {
    if (fs.existsSync(gitMarker)) {
      // 已有缓存：pull 最新
      const git = simpleGit(cacheDir);
      await git.fetch(['--depth', '1', 'origin', branch]);
      await git.checkout(branch);
      await git.reset(['--hard', `origin/${branch}`]);
    } else {
      // 首次克隆：shallow clone 节省空间和时间
      fs.mkdirSync(cacheDir, { recursive: true });
      const git = simpleGit();
      await git.clone(cloneUrl, cacheDir, ['--branch', branch, '--depth', '1']);
    }
  } catch (e) {
    // 清理可能损坏的缓存目录，下次重试会重新 clone
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (_) {}
    return res.status(500).json({ ok: false, error: `Git 操作失败: ${e.message}` });
  }

  // 确定读取目录
  const targetDir = repoSubPath
    ? path.join(cacheDir, repoSubPath)
    : cacheDir;

  if (!fs.existsSync(targetDir)) {
    return res.status(400).json({
      ok: false,
      error: `路径在仓库中不存在: "${repoSubPath}"`,
    });
  }

  // 递归遍历目录，收集 .md / .json 文件
  const files = [];

  function collectFiles(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (/\.(md|json)$/i.test(entry.name)) {
        try {
          const content      = fs.readFileSync(fullPath, 'utf-8');
          const relativePath = path.relative(targetDir, fullPath);
          const ext          = path.extname(entry.name).toLowerCase().slice(1);
          files.push({ name: entry.name, relativePath, content, ext });
        } catch (_) { /* 跳过无法读取的文件 */ }
      }
    }
  }

  collectFiles(targetDir);

  res.json({ ok: true, files, branch, count: files.length });
});

// ─── WebSocket ─────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  let ssh   = null;
  let shell = null;   // 交互式 Shell PTY（唯一通道，保持用户预处理状态）
  let attachedSessionId = null; // Agent API Tracking

  // ─── Shell 命令队列（序列化执行，保证不并发） ────────────────────────────

  /**
   * captureCtx: 当前正在捕获输出的命令上下文
   * {
   *   id:          string      — 标记 ID
   *   started:     boolean     — 是否已找到开始标记
   *   lines:       string[]    — 收集到的输出行
   *   partialLine: string      — 未完成的当前行缓冲
   *   resolver:    function    — Promise resolve
   *   timer:       TimeoutId   — 超时定时器
   *   startTs:     number      — 命令开始时间戳
   * }
   */
  let captureCtx  = null;
  const shellQueue  = [];     // 待执行命令队列
  let   shellBusy   = false;  // 是否正在等待当前命令的结束标记
  let   planAborted = false;

  /** 处理来自 Shell 的原始数据：转发终端 + 解析标记 */
  function onShellData(rawData) {
    // 1. 原始字节原样转发给前端终端（用户可实时看到 SOP 命令执行过程）
    send({ type: 'data', data: Buffer.from(rawData).toString('base64') });

    if (!captureCtx) return;

    // 2. 去除 ANSI，规范化换行，累积到行解析器
    const text = stripAnsi(rawData.toString())
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    captureCtx.partialLine += text;

    // 3. 提取完整行（最后一段保留为不完整行）
    const parts = captureCtx.partialLine.split('\n');
    captureCtx.partialLine = parts.pop() ?? '';

    for (const line of parts) {
      const trimmed = line.trim();

      // ── 等待开始标记 ────────────────────────────────────────────────────
      if (!captureCtx.started) {
        // 精确匹配：trimmed 行 === 标记字符串（排除含引号的 echo 命令回显）
        if (trimmed === mkS(captureCtx.id)) {
          captureCtx.started = true;
        }
        continue;
      }

      // ── 已捕获中，等待结束标记 ──────────────────────────────────────────
      if (trimmed.startsWith(mkE(captureCtx.id))) {
        // 提取退出码（标记后紧跟数字）
        const exitStr   = trimmed.slice(mkE(captureCtx.id).length).match(/^(\d+)/);
        const exitCode  = exitStr ? parseInt(exitStr[1]) : 0;
        const durationMs = Date.now() - captureCtx.startTs;

        clearTimeout(captureCtx.timer);
        const resolve       = captureCtx.resolver;
        const capturedLines = captureCtx.lines;
        captureCtx          = null;
        shellBusy           = false;

        // 过滤：去掉 echo 命令的回显行（含单引号标记的那行）
        const stdout = capturedLines
          .filter((l) => {
            const t = l.trim();
            return (
              t !== `echo '${mkS(captureCtx?.id ?? '')}'` &&
              !t.startsWith(`echo "===E:`)                 &&
              !t.startsWith(`echo '===`)
            );
          })
          .join('\n')
          .trim();

        resolve({ stdout, stderr: '', exitCode, durationMs });

        // 处理队列中下一条命令
        processShellQueue();
        return; // 当前 for 循环可以退出
      }

      // ── 过滤 echo 命令回显，保留真实输出 ────────────────────────────────
      const t = line.trim();
      const isEchoMarker =
        t === `echo '${mkS(captureCtx.id)}'`  ||
        t.startsWith(`echo "===E:${captureCtx.id}`);

      if (!isEchoMarker) {
        captureCtx.lines.push(line);
      }
    }
  }

  /** 从队列取下一条命令发送到 Shell */
  function processShellQueue() {
    if (shellBusy || shellQueue.length === 0 || !shell) return;

    shellBusy = true;
    const { id, cmd, timeoutMs, resolve } = shellQueue.shift();
    const startTs = Date.now();

    captureCtx = {
      id, started: false,
      lines: [], partialLine: '',
      resolver: resolve, startTs,
      timer: setTimeout(() => {
        const ctx  = captureCtx;
        captureCtx = null;
        shellBusy  = false;
        ctx?.resolver({
          stdout:    ctx.lines.join('\n').trim(),
          stderr:    '[命令执行超时]',
          exitCode:  -1,
          durationMs: timeoutMs,
        });
        processShellQueue();
      }, timeoutMs),
    };

    /**
     * 写入 Shell：
     *   echo '===S:id==='   — 开始标记（单引号防止变量展开）
     *   <命令>              — 实际命令 (临时覆盖 COLUMNS 防止如 ls 等命令输出发生换行截断/折行)
     *   echo "===E:id===:$?" — 结束标记（双引号以便 $? 展开）
     *
     * 三条命令一次性写入，确保在同一 Shell 上下文中原子执行
     */
    shell.write(`echo '${mkS(id)}'\nCOLUMNS=10000; ${cmd}\necho "${mkE(id)}$?"\n`);
  }

  /** 将命令加入队列，返回 Promise */
  function enqueueShellCmd(cmd, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const id = makeMarkerId();
      shellQueue.push({ id, cmd, timeoutMs, resolve });
      processShellQueue();
    });
  }

  // ─── 消息发送 ─────────────────────────────────────────────────────────────

  function send(obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  // ─── 消息路由 ─────────────────────────────────────────────────────────────

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      // ── 建立 SSH 连接 ────────────────────────────────────────────────────
      case 'connect': {
        if (ssh) { ssh.end(); ssh = null; shell = null; }

        ssh = new Client();
        let cfg;
        let jumpCfg;
        try { 
          cfg = buildConnectConfig(msg);
          if (msg.jumpHost) jumpCfg = buildConnectConfig(msg.jumpHost);
        } catch (e) {
          send({ type: 'status', status: 'error', msg: e.message });
          return;
        }

        const handleReady = () => {
          send({ type: 'status', status: 'connected',
                 host: cfg.host, port: cfg.port, username: cfg.username });

          // 打开唯一的交互式 Shell PTY
          ssh.shell(
            { term: 'xterm-256color', cols: msg.cols || 220, rows: msg.rows || 50 },
            (err, stream) => {
              if (err) {
                send({ type: 'status', status: 'error', msg: err.message });
                return;
              }
              shell = stream;

              // Shell 输出同时用于：终端显示 + 标记捕获
              stream.on('data', onShellData);
              stream.stderr?.on('data', onShellData);

              // 暴露给外部 Agent
              if (msg.sessionId) {
                attachedSessionId = msg.sessionId;
                global.activeSessions.set(attachedSessionId, {
                  sshClient: ssh,
                  shellStream: stream,
                  enqueueShellCmd: enqueueShellCmd,
                  host: cfg.host,
                  username: cfg.username
                });
              }

              stream.on('close', () => {
                send({ type: 'status', status: 'disconnected' });
                if (attachedSessionId) global.activeSessions.delete(attachedSessionId);
                shell = null;
                // 清理队列中所有待执行命令
                shellBusy = false;
                const pending = shellQueue.splice(0);
                pending.forEach((item) =>
                  item.resolve({ stdout: '', stderr: 'Shell 已关闭', exitCode: -1, durationMs: 0 })
                );
              });
            }
          );
        };

        ssh.on('ready', handleReady);

        ssh.on('error', (err) => {
          let userMsg = err.message;
          if (/authentication/i.test(err.message))
            userMsg = '认证失败：请检查私钥/口令，或确认服务器已授权该公钥';
          else if (/ECONNREFUSED/.test(err.message))
            userMsg = `连接被拒绝：${cfg.host}:${cfg.port} 不可达`;
          else if (/ETIMEDOUT/.test(err.message))
            userMsg = `连接超时：${cfg.host}:${cfg.port} 无响应`;
          send({ type: 'status', status: 'error', msg: userMsg });
        });

        ssh.on('end', () => send({ type: 'status', status: 'disconnected' }));

        if (jumpCfg) {
          send({ type: 'status', status: 'connecting', msg: `正在连接跳板机 ${jumpCfg.username}@${jumpCfg.host}:${jumpCfg.port}…` });
          
          const jumpSsh = new Client();
          jumpSsh.on('ready', () => {
            send({ type: 'status', status: 'connecting', msg: `跳板机就绪，正在通过隧道连接目标机 ${cfg.username}@${cfg.host}:${cfg.port}…` });
            jumpSsh.forwardOut('127.0.0.1', 12345, cfg.host, cfg.port, (err, stream) => {
              if (err) {
                jumpSsh.end();
                send({ type: 'status', status: 'error', msg: `跳板机隧道转发失败: ${err.message}` });
                return;
              }
              ssh.connect({ ...cfg, sock: stream });
              
              // 绑定生命周期：目标机端口则断开跳板机
              ssh.on('close', () => jumpSsh.end());
            });
          });
          
          jumpSsh.on('error', (err) => {
            send({ type: 'status', status: 'error', msg: `跳板机连接失败: ${err.message}` });
          });
          
          jumpSsh.connect(jumpCfg);
        } else {
          send({ type: 'status', status: 'connecting', msg: `正在连接 ${cfg.username}@${cfg.host}:${cfg.port}…` });
          ssh.connect(cfg);
        }
        break;
      }

      // ── 终端键盘输入（直接写入 Shell PTY） ──────────────────────────────
      case 'data':   shell?.write(msg.data);              break;
      case 'resize': shell?.setWindow(msg.rows, msg.cols, 0, 0); break;

      // ── 独立 exec 通道（快速测试，不共享 Shell 状态） ───────────────────
      case 'exec': {
        if (!ssh) { send({ type: 'exec_result', id: msg.id, error: '未连接' }); return; }
        const startTs = Date.now();
        let stdout = '', stderr = '';
        ssh.exec(msg.cmd, (err, stream) => {
          if (err) {
            send({ type: 'exec_result', id: msg.id, error: err.message });
            return;
          }
          stream.on('data', (d) => { stdout += d.toString(); });
          stream.stderr.on('data', (d) => { stderr += d.toString(); });
          stream.on('close', (code) => {
            send({
              type: 'exec_result', id: msg.id,
              stdout: stdout.trimEnd(), stderr: stderr.trimEnd(),
              exitCode: code ?? 0, durationMs: Date.now() - startTs,
            });
          });
        });
        break;
      }

      /**
       * SOP 批量执行计划
       *
       * 关键改变：使用 enqueueShellCmd() 复用已有 Shell PTY，
       * 而不是 ssh.exec() 新建独立通道。
       *
       * 这保证了：
       *   - sudo su 后的 root 身份得到保留
       *   - cd /var/log 后的工作目录得到保留
       *   - source env.sh 设置的环境变量得到保留
       *   - 堡垒机跳转后的网络上下文得到保留
       */
      /**
       * SOP 批量执行计划（支持变量捕获与上下文渲染）
       *
       * msg.steps 结构：
       *   { id, cmd, name, captureVar?, capturePattern?, timeout?, checkId?, isSubStep? }
       *
       * 执行流程（每一步）：
       *   1. 用 varContext 渲染 cmd 中的 ${VAR} 占位符
       *   2. 在已有 Shell PTY 中执行渲染后的命令（保留 sudo/cwd/env 状态）
       *   3. 若设置了 captureVar，从 stdout 中提取值（可选 capturePattern 正则）
       *   4. 将捕获值写入 varContext，后续步骤可立即引用
       *   5. 发送 plan_step 事件（含 resolvedCmd、capturedVar 字段）
       */
      case 'exec_plan': {
        if (!shell) {
          send({ type: 'plan_done', planId: msg.id, aborted: true,
                 error: 'Shell 未就绪，请先建立 SSH 连接并完成预处理操作' });
          return;
        }

        planAborted = false;
        const planId = msg.id;

        // 变量上下文：在整个 plan 生命周期内累积，步骤间共享
        const varContext = {};

        for (const step of msg.steps) {
          if (planAborted) break;

          // 1. 渲染变量：将 cmd 中的 ${VAR} 替换为已捕获的值
          const resolvedCmd = step.cmd.replace(
            /\$\{([^}]+)\}/g,
            (_, name) => varContext[name] !== undefined ? varContext[name] : `\${${name}}`
          );

          send({ type: 'plan_step', planId, stepId: step.id, status: 'running',
                 resolvedCmd });

          // 2. 在 Shell PTY 中执行（复用 sudo/cwd/env 状态）
          const result = await enqueueShellCmd(resolvedCmd, step.timeout || 30000);

          // 3. Python 脚本后处理（可选）
          let processedOutput    = result.stdout;
          let scriptResult       = undefined;
          let scriptError        = undefined;

          if (step.scriptPath) {
            const sr = await runPythonScript(step.scriptPath, result.stdout, 15000);
            if (sr.exitCode === 0) {
              processedOutput = sr.stdout;
              scriptResult    = { exitCode: sr.exitCode, stdout: sr.stdout };
            } else {
              scriptError = `脚本执行失败(exit ${sr.exitCode}): ${sr.stderr}`;
              // 脚本失败时保留原始输出，不中断流程
            }
          }

          // 4. 正则状态判断（覆盖 exit code 的默认判断）
          const evalResult = evalOutputStatus(processedOutput, {
            abnormalRegex: step.abnormalRegex,
            normalRegex:   step.normalRegex,
            exitCode:      result.exitCode,
          });

          // 5. 变量捕获（使用处理后的输出）
          let capturedVar = undefined;
          if (step.captureVar && evalResult.status !== 'failed') {
            let value = processedOutput.trim();
            if (step.capturePattern) {
              try {
                const re = new RegExp(step.capturePattern);
                const m  = re.exec(processedOutput);
                if (m) value = m[1] !== undefined ? m[1] : m[0];
              } catch { /* 无效正则，使用整个 processedOutput */ }
            }
            if (value) {
              varContext[step.captureVar] = value;
              capturedVar = { name: step.captureVar, value };
            }
          }

          send({
            type:            'plan_step',
            planId,
            stepId:          step.id,
            status:          evalResult.status,   // 正则判断后的最终状态
            statusReason:    evalResult.reason,   // 状态依据（方便前端展示）
            stdout:          result.stdout,       // 原始输出
            processedOutput: step.scriptPath ? processedOutput : undefined,
            scriptResult,
            scriptError,
            stderr:          result.stderr,
            exitCode:        result.exitCode,
            durationMs:      result.durationMs,
            resolvedCmd,
            capturedVar,
            varSnapshot:     { ...varContext },
          });
        }

        send({ type: 'plan_done', planId, aborted: planAborted,
               finalVarContext: varContext });
        break;
      }

      case 'exec_plan_cancel': {
        planAborted = true;
        // 清空队列中未发送的命令（当前正在执行的等超时或完成）
        shellQueue.splice(0).forEach((item) =>
          item.resolve({ stdout: '', stderr: '已取消', exitCode: -1, durationMs: 0 })
        );
        break;
      }

      case 'disconnect': {
        ssh?.end();
        ssh = null; shell = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    ssh?.end();
    if (attachedSessionId) {
      global.activeSessions.delete(attachedSessionId);
    }
    planAborted = true;
    shellQueue.splice(0).forEach((item) =>
      item.resolve({ stdout: '', stderr: 'WebSocket 已关闭', exitCode: -1, durationMs: 0 })
    );
  });
});

// ─── 启动 ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   DevUtility Hub — SSH Proxy (Shell 复用模式)    ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  HTTP : http://127.0.0.1:${PORT}                    ║`);
  console.log(`║  WS   : ws://127.0.0.1:${PORT}/terminal             ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  SOP 执行复用同一 Shell PTY，保留:               ║');
  console.log('║    sudo/su 身份、cd 路径、source env 变量         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});
