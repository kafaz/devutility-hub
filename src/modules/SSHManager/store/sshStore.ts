import { create } from 'zustand';

export type ConnStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disconnected';

export interface AgentOption {
  id: string;
  name: string;
  value: string;
  hint: string;
}

export interface ExecResult {
  id: string;
  cmd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  ts: number;
}

export interface ConnectParams {
  host: string;
  port: number;
  username: string;
  agent: string;
  cols: number;
  rows: number;
}

const PROXY_BASE = 'http://127.0.0.1:3001';
const PROXY_WS   = 'ws://127.0.0.1:3001/terminal';

interface SSHStore {
  // 连接配置
  params: ConnectParams;
  setParams: (p: Partial<ConnectParams>) => void;

  // 代理服务器状态
  proxyOnline: boolean;
  agents: AgentOption[];
  checkProxy: () => Promise<void>;

  // SSH 会话状态
  status: ConnStatus;
  statusMsg: string;
  ws: WebSocket | null;

  // 命令执行历史
  execHistory: ExecResult[];

  // 对外操作
  connect: (onData: (b64: string) => void) => void;
  disconnect: () => void;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  execCommand: (cmd: string) => Promise<ExecResult>;
  clearHistory: () => void;
}

let _onData: ((b64: string) => void) | null = null;
let _pendingExec: Map<string, (r: ExecResult) => void> = new Map();

export const useSSHStore = create<SSHStore>((set, get) => ({
  params: {
    host:     '',
    port:     22,
    username: '',
    agent:    '',
    cols:     220,
    rows:     50,
  },

  setParams: (p) =>
    set((s) => ({ params: { ...s.params, ...p } })),

  proxyOnline: false,
  agents: [],

  checkProxy: async () => {
    try {
      const [health, agentsRes] = await Promise.all([
        fetch(`${PROXY_BASE}/api/health`, { signal: AbortSignal.timeout(2000) }),
        fetch(`${PROXY_BASE}/api/agents`, { signal: AbortSignal.timeout(2000) }),
      ]);
      if (!health.ok) throw new Error('proxy not ok');
      const { agents } = await agentsRes.json();
      set({ proxyOnline: true, agents });
      // 自动选中第一个有效 agent
      if (agents.length > 0 && !get().params.agent) {
        set((s) => ({ params: { ...s.params, agent: agents[0].value } }));
      }
    } catch {
      set({ proxyOnline: false, agents: [] });
    }
  },

  status:    'idle',
  statusMsg: '',
  ws:        null,

  execHistory: [],

  connect: (onData) => {
    _onData = onData;

    const { ws: existing } = get();
    if (existing) existing.close();

    const socket = new WebSocket(PROXY_WS);

    socket.onopen = () => {
      const { params } = get();
      socket.send(JSON.stringify({
        type:     'connect',
        host:     params.host,
        port:     params.port,
        username: params.username,
        agent:    params.agent,
        cols:     params.cols,
        rows:     params.rows,
      }));
    };

    socket.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'status') {
        const s = msg.status as ConnStatus;
        set({ status: s, statusMsg: (msg.msg as string) ?? '' });
      }

      if (msg.type === 'data') {
        _onData?.(msg.data as string);
      }

      if (msg.type === 'exec_result') {
        const id = msg.id as string;
        const result: ExecResult = {
          id,
          cmd:       '', // 调用方自行记录
          stdout:    (msg.stdout as string) ?? '',
          stderr:    (msg.stderr as string) ?? '',
          exitCode:  (msg.exitCode as number) ?? -1,
          durationMs:(msg.durationMs as number) ?? 0,
          ts:        Date.now(),
        };
        const resolver = _pendingExec.get(id);
        if (resolver) {
          resolver(result);
          _pendingExec.delete(id);
        }
      }
    };

    socket.onclose = () => {
      set({ status: 'disconnected', ws: null });
    };

    socket.onerror = () => {
      set({ status: 'error', statusMsg: '无法连接到 SSH Proxy，请确认代理服务已启动', ws: null });
    };

    set({ ws: socket, status: 'connecting', statusMsg: '' });
  },

  disconnect: () => {
    const { ws } = get();
    ws?.send(JSON.stringify({ type: 'disconnect' }));
    ws?.close();
    set({ ws: null, status: 'idle', statusMsg: '' });
  },

  sendInput: (data) => {
    get().ws?.send(JSON.stringify({ type: 'data', data }));
  },

  resize: (cols, rows) => {
    get().ws?.send(JSON.stringify({ type: 'resize', cols, rows }));
    set((s) => ({ params: { ...s.params, cols, rows } }));
  },

  execCommand: (cmd) =>
    new Promise((resolve) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const timeout = setTimeout(() => {
        _pendingExec.delete(id);
        resolve({
          id, cmd,
          stdout: '', stderr: 'timeout: command exceeded 30s',
          exitCode: -1, durationMs: 30000, ts: Date.now(),
        });
      }, 30000);

      _pendingExec.set(id, (result) => {
        clearTimeout(timeout);
        result.cmd = cmd;
        set((s) => ({ execHistory: [result, ...s.execHistory].slice(0, 100) }));
        resolve(result);
      });

      get().ws?.send(JSON.stringify({ type: 'exec', cmd, id }));
    }),

  clearHistory: () => set({ execHistory: [] }),
}));
