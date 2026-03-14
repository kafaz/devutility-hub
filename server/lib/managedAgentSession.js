const { Client } = require('ssh2');

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '');
}

function makeMarkerId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const mkS = (id) => `===S:${id}===`;
const mkE = (id) => `===E:${id}===:`;

class ManagedAgentSession {
  constructor(params) {
    this.sessionId = params.sessionId;
    this.nodeId = params.nodeId || null;
    this.name = params.name || params.sessionId;
    this.host = params.host;
    this.port = params.port || 22;
    this.username = params.username;
    this.source = 'agent';
    this.reason = params.reason || '';
    this.ttlSec = params.ttlSec || 1800;
    this.createdAt = Date.now();
    this.connectedAt = null;
    this.lastActivityAt = Date.now();
    this.status = 'connecting';
    this.connectConfig = params.connectConfig;
    this.jumpConfig = params.jumpConfig;
    this.onClose = params.onClose || null;
    this.ssh = null;
    this.jumpSsh = null;
    this.shell = null;
    this.captureCtx = null;
    this.shellQueue = [];
    this.shellBusy = false;
  }

  markActive() {
    this.lastActivityAt = Date.now();
  }

  getInfo() {
    return {
      sessionId: this.sessionId,
      nodeId: this.nodeId,
      name: this.name,
      host: this.host,
      port: this.port,
      username: this.username,
      source: this.source,
      reason: this.reason,
      ttlSec: this.ttlSec,
      status: this.status,
      createdAt: this.createdAt,
      connectedAt: this.connectedAt,
      lastActivityAt: this.lastActivityAt,
      shellReady: Boolean(this.shell),
    };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ssh = new Client();
      this.ssh = ssh;

      const fail = (error) => {
        if (this.status === 'closed' || this.status === 'connected') return;
        this.status = 'error';
        reject(error);
      };

      const handleReady = () => {
        ssh.shell(
          { term: 'xterm-256color', cols: 220, rows: 50 },
          (err, stream) => {
            if (err) {
              fail(err);
              return;
            }

            this.shell = stream;
            this.status = 'connected';
            this.connectedAt = Date.now();
            this.markActive();

            stream.on('data', (data) => this.onShellData(data));
            stream.stderr?.on('data', (data) => this.onShellData(data));
            stream.on('close', () => this.handleClose('shell_closed'));

            this.processShellQueue();
            resolve(this.getInfo());
          }
        );
      };

      ssh.on('ready', handleReady);
      ssh.on('end', () => this.handleClose('ssh_end'));
      ssh.on('close', () => this.handleClose('ssh_close'));
      ssh.on('error', fail);

      if (this.jumpConfig) {
        const jumpSsh = new Client();
        this.jumpSsh = jumpSsh;

        jumpSsh.on('ready', () => {
          jumpSsh.forwardOut('127.0.0.1', 12345, this.host, this.port, (err, stream) => {
            if (err) {
              fail(err);
              jumpSsh.end();
              return;
            }
            ssh.connect({ ...this.connectConfig, sock: stream });
          });
        });

        jumpSsh.on('error', fail);
        jumpSsh.on('end', () => {
          if (this.status !== 'closed') {
            this.handleClose('jump_ssh_end');
          }
        });

        jumpSsh.connect(this.jumpConfig);
      } else {
        ssh.connect(this.connectConfig);
      }
    });
  }

  handleClose(reason) {
    if (this.status === 'closed') return;

    this.status = 'closed';
    this.shell = null;
    this.shellBusy = false;

    if (this.captureCtx?.timer) clearTimeout(this.captureCtx.timer);
    this.captureCtx = null;

    const pending = this.shellQueue.splice(0);
    pending.forEach((item) => item.resolve({
      stdout: '',
      stderr: reason || 'session closed',
      exitCode: -1,
      durationMs: 0,
    }));

    this.jumpSsh?.end();
    this.ssh?.end();
    this.onClose?.(this);
  }

  onShellData(rawData) {
    if (!this.captureCtx) return;

    const text = stripAnsi(rawData.toString())
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    this.captureCtx.partialLine += text;
    const parts = this.captureCtx.partialLine.split('\n');
    this.captureCtx.partialLine = parts.pop() ?? '';

    for (const line of parts) {
      const trimmed = line.trim();

      if (!this.captureCtx.started) {
        if (trimmed === mkS(this.captureCtx.id)) {
          this.captureCtx.started = true;
        }
        continue;
      }

      if (trimmed.startsWith(mkE(this.captureCtx.id))) {
        const exitMatch = trimmed.slice(mkE(this.captureCtx.id).length).match(/^(\d+)/);
        const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;
        const durationMs = Date.now() - this.captureCtx.startTs;
        const markerId = this.captureCtx.id;
        const resolve = this.captureCtx.resolver;
        const lines = this.captureCtx.lines;

        clearTimeout(this.captureCtx.timer);
        this.captureCtx = null;
        this.shellBusy = false;
        this.markActive();

        const stdout = lines
          .filter((entry) => {
            const clean = entry.trim();
            return clean !== `echo '${mkS(markerId)}'`
              && !clean.startsWith(`echo "${mkE(markerId)}`);
          })
          .join('\n')
          .trim();

        resolve({ stdout, stderr: '', exitCode, durationMs });
        this.processShellQueue();
        return;
      }

      const clean = line.trim();
      const isEchoMarker = clean === `echo '${mkS(this.captureCtx.id)}'`
        || clean.startsWith(`echo "${mkE(this.captureCtx.id)}`);

      if (!isEchoMarker) {
        this.captureCtx.lines.push(line);
      }
    }
  }

  processShellQueue() {
    if (this.shellBusy || this.shellQueue.length === 0 || !this.shell) return;

    this.shellBusy = true;
    const item = this.shellQueue.shift();
    const { id, cmd, timeoutMs, resolve } = item;

    this.captureCtx = {
      id,
      started: false,
      lines: [],
      partialLine: '',
      resolver: resolve,
      startTs: Date.now(),
      timer: setTimeout(() => {
        const ctx = this.captureCtx;
        this.captureCtx = null;
        this.shellBusy = false;
        ctx?.resolver({
          stdout: ctx?.lines.join('\n').trim() || '',
          stderr: '[命令执行超时]',
          exitCode: -1,
          durationMs: timeoutMs,
        });
        this.processShellQueue();
      }, timeoutMs),
    };

    this.markActive();
    this.shell.write(`echo '${mkS(id)}'\nCOLUMNS=10000; ${cmd}\necho "${mkE(id)}$?"\n`);
  }

  enqueueShellCmd(cmd, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const id = makeMarkerId();
      this.shellQueue.push({ id, cmd, timeoutMs, resolve });
      this.processShellQueue();
    });
  }

  execCommand(cmd, timeoutMs = 30000) {
    return new Promise((resolve) => {
      if (!this.ssh) {
        resolve({ stdout: '', stderr: '会话未连接', exitCode: -1, durationMs: 0 });
        return;
      }

      const startTs = Date.now();
      let stdout = '';
      let stderr = '';
      let finished = false;

      const timer = setTimeout(() => {
        finished = true;
        resolve({ stdout: stdout.trimEnd(), stderr: '[TIMEOUT]', exitCode: -1, durationMs: timeoutMs });
      }, timeoutMs);

      this.ssh.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          resolve({ stdout: '', stderr: err.message, exitCode: -1, durationMs: Date.now() - startTs });
          return;
        }

        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
        stream.on('close', (code) => {
          if (finished) return;
          clearTimeout(timer);
          this.markActive();
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

  close(reason = 'closed_by_user') {
    this.handleClose(reason);
  }
}

module.exports = { ManagedAgentSession };
