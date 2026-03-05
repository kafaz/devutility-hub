/**
 * SSH Proxy Server — 私钥 + Passphrase 认证版
 *
 * 认证方式对应 paramiko 的 key_filename + passphrase：
 *   ssh.connect({ privateKey, passphrase })  ← 同等于 paramiko 的行为
 *
 * WebSocket 消息协议
 * ─────────────────────────────────────────────────────────
 * Client → Server:
 *   { type: 'connect',      host, port, username,
 *                           authType: 'privateKey'|'password'|'agent',
 *                           keyContent?,    // 私钥内容（直接粘贴）
 *                           keyFilePath?,   // 私钥文件路径（proxy 读取）
 *                           passphrase?,    // 私钥加密口令
 *                           password?,      // 密码登录时使用
 *                           agent?,         // agent socket 路径
 *                           cols?, rows? }
 *
 *   { type: 'data',         data: string }        ← 交互终端键盘输入
 *   { type: 'resize',       cols, rows }
 *   { type: 'exec',         cmd, id }             ← 单条命令（独立通道）
 *   { type: 'exec_plan',    id, steps: [{ id, cmd, timeout? }] }  ← SOP 批量执行
 *   { type: 'exec_plan_cancel' }
 *   { type: 'disconnect' }
 *
 * Server → Client:
 *   { type: 'status',       status: 'connecting'|'connected'|'error'|'disconnected', msg? }
 *   { type: 'data',         data: string (base64) }
 *   { type: 'exec_result',  id, stdout, stderr, exitCode, durationMs }
 *   { type: 'plan_step',    planId, stepId, status: 'running'|'done'|'failed',
 *                           stdout?, stderr?, exitCode?, durationMs? }
 *   { type: 'plan_done',    planId, aborted }
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const { Client }          = require('ssh2');
const cors  = require('cors');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/terminal' });

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── REST ──────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, platform: process.platform, pid: process.pid })
);

/** 返回当前平台可用的 Agent 列表（兼容旧版，也支持 agent 模式） */
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

/** 检查私钥文件路径是否可读（前端填写路径后实时验证） */
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

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/**
 * 从消息中构造 ssh2 的连接配置
 * 对应 paramiko 的 key_filename + passphrase 认证方式
 */
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
    // 优先使用直接传入的 key 内容，否则从文件读取
    if (msg.keyContent) {
      cfg.privateKey = msg.keyContent;
    } else if (msg.keyFilePath) {
      const resolved = msg.keyFilePath.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', msg.keyFilePath.slice(1))
        : msg.keyFilePath;
      cfg.privateKey = fs.readFileSync(resolved);
    } else {
      throw new Error('privateKey 模式需要提供 keyContent 或 keyFilePath');
    }
    // passphrase 对应 paramiko 的 passphrase 参数
    if (msg.passphrase) cfg.passphrase = msg.passphrase;

  } else if (authType === 'password') {
    if (!msg.password) throw new Error('password 模式需要提供 password');
    cfg.password = msg.password;

  } else if (authType === 'agent') {
    cfg.agent = msg.agent || process.env.SSH_AUTH_SOCK;
    if (!cfg.agent) throw new Error('agent 模式需要 SSH Agent 正在运行');
  }

  return cfg;
}

/**
 * 通过独立 exec 通道执行单条命令
 * 返回 Promise<{ stdout, stderr, exitCode, durationMs }>
 */
function execCommand(ssh, cmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const startTs = Date.now();
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1,
                  durationMs: Date.now() - startTs });
      }
    }, timeoutMs);

    ssh.exec(cmd, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: err.message, exitCode: -1,
                  durationMs: Date.now() - startTs });
        return;
      }
      stream.on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({
            stdout:     stdout.trimEnd(),
            stderr:     stderr.trimEnd(),
            exitCode:   code ?? 0,
            durationMs: Date.now() - startTs,
          });
        }
      });
    });
  });
}

// ─── WebSocket ─────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  let ssh         = null;
  let shell       = null;
  let planAborted = false;

  function send(obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      // ── 建立 SSH 连接 ────────────────────────────────────────────────────
      case 'connect': {
        if (ssh) ssh.end();

        ssh = new Client();
        let cfg;
        try {
          cfg = buildConnectConfig(msg);
        } catch (e) {
          send({ type: 'status', status: 'error', msg: e.message });
          return;
        }

        ssh.on('ready', () => {
          send({ type: 'status', status: 'connected',
                 host: cfg.host, port: cfg.port, username: cfg.username });

          // 同时打开交互式 Shell（用于终端面板）
          ssh.shell(
            { term: 'xterm-256color', cols: msg.cols || 220, rows: msg.rows || 50 },
            (err, stream) => {
              if (err) {
                send({ type: 'status', status: 'error', msg: err.message });
                return;
              }
              shell = stream;
              stream.on('data', (d) =>
                send({ type: 'data', data: Buffer.from(d).toString('base64') })
              );
              stream.stderr?.on('data', (d) =>
                send({ type: 'data', data: Buffer.from(d).toString('base64') })
              );
              stream.on('close', () => {
                send({ type: 'status', status: 'disconnected' });
                shell = null;
              });
            }
          );
        });

        ssh.on('error', (err) => {
          // 常见错误增加友好提示
          let userMsg = err.message;
          if (/authentication/i.test(err.message))
            userMsg = '认证失败：请检查私钥/口令是否正确，或确认服务器已授权该公钥';
          if (/ECONNREFUSED/.test(err.message))
            userMsg = `连接被拒绝：${cfg.host}:${cfg.port} 不可达，请检查地址和防火墙`;
          if (/ETIMEDOUT/.test(err.message))
            userMsg = `连接超时：${cfg.host}:${cfg.port} 无响应`;
          send({ type: 'status', status: 'error', msg: userMsg });
        });

        ssh.on('end', () => send({ type: 'status', status: 'disconnected' }));

        send({ type: 'status', status: 'connecting',
               msg: `正在连接 ${cfg.username}@${cfg.host}:${cfg.port}…` });
        ssh.connect(cfg);
        break;
      }

      // ── 终端输入 ─────────────────────────────────────────────────────────
      case 'data':   shell?.write(msg.data);                           break;
      case 'resize': shell?.setWindow(msg.rows, msg.cols, 0, 0);      break;

      // ── 单条命令（独立 exec 通道）───────────────────────────────────────
      case 'exec': {
        if (!ssh) { send({ type: 'exec_result', id: msg.id, error: '未连接' }); return; }
        const r = await execCommand(ssh, msg.cmd, msg.timeout || 30000);
        send({ type: 'exec_result', id: msg.id, ...r });
        break;
      }

      // ── SOP 批量自动执行 ─────────────────────────────────────────────────
      case 'exec_plan': {
        if (!ssh) {
          send({ type: 'plan_done', planId: msg.id, aborted: true, error: '未连接' });
          return;
        }

        planAborted = false;
        const planId = msg.id;

        for (const step of msg.steps) {
          if (planAborted) break;

          // 通知前端该步骤开始
          send({ type: 'plan_step', planId, stepId: step.id, status: 'running' });

          const result = await execCommand(ssh, step.cmd, step.timeout || 30000);

          send({
            type:      'plan_step',
            planId,
            stepId:    step.id,
            status:    result.exitCode === 0 ? 'done' : 'failed',
            ...result,
          });
        }

        send({ type: 'plan_done', planId, aborted: planAborted });
        break;
      }

      // ── 取消正在执行的计划 ───────────────────────────────────────────────
      case 'exec_plan_cancel': {
        planAborted = true;
        break;
      }

      // ── 断开 ─────────────────────────────────────────────────────────────
      case 'disconnect': {
        ssh?.end();
        ssh   = null;
        shell = null;
        break;
      }
    }
  });

  ws.on('close', () => { ssh?.end(); planAborted = true; });
});

// ─── 启动 ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   DevUtility Hub — SSH Proxy (PrivateKey Mode)   ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  HTTP : http://127.0.0.1:${PORT}                    ║`);
  console.log(`║  WS   : ws://127.0.0.1:${PORT}/terminal             ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  认证方式: 私钥+Passphrase / 密码 / Agent         ║');
  console.log('║  等同 paramiko: key_filename + passphrase         ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
});
