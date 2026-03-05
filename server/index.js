/**
 * SSH Agent Proxy Server
 *
 * 职责：
 *   1. 检测本机可用的 SSH Agent（Windows OpenSSH Agent / Pageant / Unix socket）
 *   2. 通过 Agent 复用方式连接 SSH 目标服务器（不需要用户再次输入密码/密钥）
 *   3. 将 SSH Shell 流通过 WebSocket 双向转发给前端 XTerm.js
 *   4. 支持独立的命令执行通道（exec），用于 SOP 命令的输出捕获
 *
 * WebSocket 消息协议：
 *   Client → Server:
 *     { type: 'connect',    host, port, username, agent }
 *     { type: 'data',       data: string }          ← 用户键盘输入
 *     { type: 'resize',     cols, rows }
 *     { type: 'exec',       cmd, id }               ← 独立命令执行
 *     { type: 'disconnect' }
 *
 *   Server → Client:
 *     { type: 'status',     status: 'connected'|'disconnected'|'error', msg? }
 *     { type: 'data',       data: string (base64) } ← 终端输出
 *     { type: 'exec_result', id, stdout, stderr, exitCode, durationMs }
 *     { type: 'agent_keys', count }                 ← 当前 Agent 持有的密钥数
 */

const express  = require('express');
const { WebSocketServer } = require('ws');
const { Client }          = require('ssh2');
const cors   = require('cors');
const http   = require('http');
const os     = require('os');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/terminal' });

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── REST API ──────────────────────────────────────────────────────────────

/** 健康检查 */
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, platform: process.platform, pid: process.pid })
);

/**
 * 返回当前平台可用的 SSH Agent 列表
 * 前端据此展示下拉选项，用户选择后通过 WebSocket connect 消息传递
 */
app.get('/api/agents', (_req, res) => {
  const agents = [];

  if (process.platform === 'win32') {
    // Windows OpenSSH Authentication Agent（Windows 10/11 内置）
    agents.push({
      id:    'openssh-win',
      name:  'Windows OpenSSH Agent',
      value: '\\\\.\\pipe\\openssh-ssh-agent',
      hint:  '需要在服务管理器中启动 "OpenSSH Authentication Agent" 服务',
    });
    // Pageant（PuTTY / XShell 的外部 Agent）
    agents.push({
      id:    'pageant',
      name:  'Pageant (PuTTY / XShell)',
      value: 'pageant',
      hint:  '需要 Pageant 进程正在运行且已加载密钥',
    });
  } else {
    // Linux / macOS：通过 SSH_AUTH_SOCK 环境变量
    const sock = process.env.SSH_AUTH_SOCK;
    if (sock) {
      agents.push({
        id:    'unix-agent',
        name:  `SSH Agent (${sock})`,
        value: sock,
        hint:  'ssh-add -l 查看已加载的密钥',
      });
    } else {
      agents.push({
        id:    'no-agent',
        name:  '未检测到 SSH_AUTH_SOCK',
        value: '',
        hint:  '请先启动 ssh-agent 并用 ssh-add 加载密钥',
      });
    }
  }

  res.json({ agents });
});

// ─── WebSocket 处理 ────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  let ssh   = null;   // ssh2 Client 实例
  let shell = null;   // 交互式 Shell 流

  /**
   * 向前端发送结构化消息
   */
  function send(obj) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  /**
   * 通过独立 exec 通道执行命令并捕获输出
   * 注意：exec 通道有独立环境，不共享 shell 的 cwd / 环境变量
   * 用于 SOP 的"孤立命令测试"场景（验证连通性、检查端口等）
   */
  function execCommand(cmd, id) {
    if (!ssh) {
      send({ type: 'exec_result', id, error: 'SSH 未连接' });
      return;
    }

    const startTs = Date.now();
    let stdout = '';
    let stderr = '';

    ssh.exec(cmd, (err, stream) => {
      if (err) {
        send({ type: 'exec_result', id, error: err.message });
        return;
      }

      stream.on('data', (data) => { stdout += data.toString(); });
      stream.stderr.on('data', (data) => { stderr += data.toString(); });
      stream.on('close', (code) => {
        send({
          type:       'exec_result',
          id,
          stdout:     stdout.trimEnd(),
          stderr:     stderr.trimEnd(),
          exitCode:   code,
          durationMs: Date.now() - startTs,
        });
      });
    });
  }

  // ─── 消息路由 ─────────────────────────────────────────────────────────

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return; }

    switch (msg.type) {

      // ── 建立 SSH 连接 ──────────────────────────────────────────────────
      case 'connect': {
        if (ssh) ssh.end();   // 清理旧连接

        ssh = new Client();

        const cfg = {
          host:         msg.host,
          port:         msg.port || 22,
          username:     msg.username,
          readyTimeout: 15000,
          // keepaliveInterval 防止内网长时间空闲被防火墙切断
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
        };

        // Agent 配置：直接使用前端传来的 agent socket 路径 / 'pageant'
        if (msg.agent) {
          cfg.agent = msg.agent;
        } else if (process.platform !== 'win32' && process.env.SSH_AUTH_SOCK) {
          cfg.agent = process.env.SSH_AUTH_SOCK;
        }

        ssh.on('ready', () => {
          send({ type: 'status', status: 'connected',
                 host: msg.host, port: cfg.port, username: msg.username });

          // 开启交互式 Shell
          ssh.shell(
            { term: 'xterm-256color', cols: msg.cols || 220, rows: msg.rows || 50 },
            (err, stream) => {
              if (err) {
                send({ type: 'status', status: 'error', msg: err.message });
                return;
              }

              shell = stream;

              // 终端输出 → 前端（base64 编码避免 JSON 转义问题）
              stream.on('data', (data) => {
                send({ type: 'data', data: Buffer.from(data).toString('base64') });
              });

              stream.stderr.on('data', (data) => {
                send({ type: 'data', data: Buffer.from(data).toString('base64') });
              });

              stream.on('close', () => {
                send({ type: 'status', status: 'disconnected' });
                shell = null;
              });
            }
          );
        });

        ssh.on('error', (err) => {
          send({ type: 'status', status: 'error', msg: err.message });
        });

        ssh.on('end', () => {
          send({ type: 'status', status: 'disconnected' });
        });

        send({ type: 'status', status: 'connecting', host: msg.host });
        ssh.connect(cfg);
        break;
      }

      // ── 键盘输入 → 终端 ───────────────────────────────────────────────
      case 'data': {
        shell?.write(msg.data);
        break;
      }

      // ── 终端窗口大小变化 ──────────────────────────────────────────────
      case 'resize': {
        shell?.setWindow(msg.rows, msg.cols, 0, 0);
        break;
      }

      // ── 独立命令执行（SOP 步骤） ───────────────────────────────────────
      case 'exec': {
        execCommand(msg.cmd, msg.id);
        break;
      }

      // ── 向 Shell 发送命令（共享 Shell 状态，cd/env 等会保留） ──────────
      case 'shell_exec': {
        if (shell) shell.write(msg.cmd + '\n');
        break;
      }

      // ── 断开连接 ──────────────────────────────────────────────────────
      case 'disconnect': {
        ssh?.end();
        ssh   = null;
        shell = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    ssh?.end();
    ssh   = null;
    shell = null;
  });
});

// ─── 启动 ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║      DevUtility Hub - SSH Agent Proxy        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  HTTP : http://127.0.0.1:${PORT}                ║`);
  console.log(`║  WS   : ws://127.0.0.1:${PORT}/terminal         ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Platform : ${process.platform.padEnd(32)}║`);

  if (process.platform === 'win32') {
    console.log('║  Agents   : Windows OpenSSH Agent / Pageant  ║');
  } else {
    const sock = process.env.SSH_AUTH_SOCK || '(not set)';
    console.log(`║  Agent    : ${sock.slice(0, 32).padEnd(32)}║`);
  }

  console.log('╚══════════════════════════════════════════════╝\n');
});
