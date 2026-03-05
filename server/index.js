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
const cors  = require('cors');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/terminal' });

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

// ─── WebSocket ─────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  let ssh   = null;
  let shell = null;   // 交互式 Shell PTY（唯一通道，保持用户预处理状态）

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
     *   <命令>              — 实际命令
     *   echo "===E:id===:$?" — 结束标记（双引号以便 $? 展开）
     *
     * 三条命令一次性写入，确保在同一 Shell 上下文中原子执行
     */
    shell.write(`echo '${mkS(id)}'\n${cmd}\necho "${mkE(id)}$?"\n`);
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
        try { cfg = buildConnectConfig(msg); }
        catch (e) {
          send({ type: 'status', status: 'error', msg: e.message });
          return;
        }

        ssh.on('ready', () => {
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

              stream.on('close', () => {
                send({ type: 'status', status: 'disconnected' });
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
        });

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

        send({ type: 'status', status: 'connecting',
               msg: `正在连接 ${cfg.username}@${cfg.host}:${cfg.port}…` });
        ssh.connect(cfg);
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

          // 3. 变量捕获
          let capturedVar = undefined;
          if (step.captureVar && result.exitCode === 0) {
            let value = result.stdout.trim();
            if (step.capturePattern) {
              try {
                const re = new RegExp(step.capturePattern);
                const m  = re.exec(result.stdout);
                if (m) value = m[1] !== undefined ? m[1] : m[0];
              } catch { /* 正则无效，使用整个 stdout */ }
            }
            // 只在值非空时写入 context
            if (value) {
              varContext[step.captureVar] = value;
              capturedVar = { name: step.captureVar, value };
            }
          }

          send({
            type:       'plan_step',
            planId,
            stepId:     step.id,
            status:     result.exitCode === 0 ? 'done' : 'failed',
            stdout:     result.stdout,
            stderr:     result.stderr,
            exitCode:   result.exitCode,
            durationMs: result.durationMs,
            resolvedCmd,          // 实际执行的命令（变量已替换）
            capturedVar,          // 本步骤捕获的变量（name + value）
            varSnapshot: { ...varContext },  // 当前累积变量快照（供前端展示）
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
