/**
 * SSH Manager Store
 *
 * 认证模型对应 paramiko:
 *   authType: 'privateKey'  → key_filename + passphrase
 *   authType: 'password'    → username + password
 *   authType: 'agent'       → SSH Agent socket
 *
 * exec_plan: 对应 SOP 自动批量执行，每步独立 exec 通道，
 * 实时推送进度事件到前端，完成后结果写入 SOPInstance。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export type AuthType = 'privateKey' | 'password' | 'agent';
export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export interface SSHProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  keyFilePath?: string;   // 私钥文件路径（等同 paramiko key_filename）
  // passphrase / password 不持久化，每次连接时填入
  createdAt: number;
}

export interface PlanStep {
  id: string;
  cmd: string;
  name: string;
  timeout?: number;
}

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface PlanStepResult {
  stepId:    string;
  status:    PlanStepStatus;
  stdout:    string;
  stderr:    string;
  exitCode:  number;
  durationMs: number;
}

export interface ExecPlan {
  id:        string;
  steps:     PlanStep[];
  results:   Record<string, PlanStepResult>;
  status:    'idle' | 'running' | 'done' | 'aborted';
  startedAt?: number;
  doneAt?:   number;
}

// ─── 常量 ──────────────────────────────────────────────────────────────────

const PROXY_HTTP = 'http://127.0.0.1:3001';
const PROXY_WS   = 'ws://127.0.0.1:3001/terminal';

// ─── Store ─────────────────────────────────────────────────────────────────

interface SSHStore {
  // 连接档案（持久化，不含密码/passphrase）
  profiles:       SSHProfile[];
  activeProfileId: string | null;
  addProfile:     (p: Omit<SSHProfile, 'id' | 'createdAt'>) => string;
  updateProfile:  (id: string, p: Partial<SSHProfile>) => void;
  deleteProfile:  (id: string) => void;
  setActiveProfile: (id: string | null) => void;

  // 代理服务状态
  proxyOnline:  boolean;
  checkProxy:   () => Promise<void>;

  // 当前连接状态
  status:    ConnStatus;
  statusMsg: string;
  ws:        WebSocket | null;

  // 终端数据回调（由 TerminalPanel 注入）
  onTermData: ((b64: string) => void) | null;
  setOnTermData: (fn: ((b64: string) => void) | null) => void;

  // 执行计划
  currentPlan: ExecPlan | null;

  // 单条命令历史（exec 通道）
  execHistory: Array<{ id: string; cmd: string; stdout: string; stderr: string; exitCode: number; durationMs: number; ts: number }>;

  // 操作
  connect: (params: {
    profile:     SSHProfile;
    passphrase?: string;
    password?:   string;
    agent?:      string;
    cols?:       number;
    rows?:       number;
  }) => void;
  disconnect:   () => void;
  sendInput:    (data: string) => void;
  resize:       (cols: number, rows: number) => void;
  execCommand:  (cmd: string, timeoutMs?: number) => Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;
  runPlan:      (steps: PlanStep[]) => Promise<ExecPlan>;
  cancelPlan:   () => void;
  clearHistory: () => void;

  // 验证私钥文件路径是否可读
  checkKeyFile: (path: string) => Promise<{ ok: boolean; msg?: string }>;
}

// 存放 Promise resolver（exec 单条命令用）
const _execResolvers = new Map<string, (r: { stdout: string; stderr: string; exitCode: number; durationMs: number }) => void>();

// 存放 exec_plan 的 resolve
let _planResolve: ((plan: ExecPlan) => void) | null = null;

export const useSSHStore = create<SSHStore>()(
  persist(
    (set, get) => ({
      profiles:        [],
      activeProfileId: null,
      proxyOnline:     false,
      status:          'idle',
      statusMsg:       '',
      ws:              null,
      onTermData:      null,
      currentPlan:     null,
      execHistory:     [],

      // ── 档案管理 ────────────────────────────────────────────────────────

      addProfile: (p) => {
        const id = generateId();
        set((s) => ({
          profiles: [...s.profiles, { ...p, id, createdAt: Date.now() }],
          activeProfileId: id,
        }));
        return id;
      },

      updateProfile: (id, p) =>
        set((s) => ({
          profiles: s.profiles.map((x) => (x.id === id ? { ...x, ...p } : x)),
        })),

      deleteProfile: (id) =>
        set((s) => ({
          profiles:        s.profiles.filter((x) => x.id !== id),
          activeProfileId: s.activeProfileId === id ? null : s.activeProfileId,
        })),

      setActiveProfile: (id) => set({ activeProfileId: id }),

      // ── 代理健康检查 ─────────────────────────────────────────────────────

      checkProxy: async () => {
        try {
          const r = await fetch(`${PROXY_HTTP}/api/health`, { signal: AbortSignal.timeout(2000) });
          set({ proxyOnline: r.ok });
        } catch {
          set({ proxyOnline: false });
        }
      },

      setOnTermData: (fn) => set({ onTermData: fn }),

      // ── SSH 连接 ─────────────────────────────────────────────────────────

      connect: ({ profile, passphrase, password, agent, cols = 220, rows = 50 }) => {
        const { ws: existing } = get();
        if (existing) existing.close();

        const socket = new WebSocket(PROXY_WS);

        socket.onopen = () => {
          socket.send(JSON.stringify({
            type:        'connect',
            host:        profile.host,
            port:        profile.port,
            username:    profile.username,
            authType:    profile.authType,
            keyFilePath: profile.keyFilePath,
            passphrase,
            password,
            agent,
            cols,
            rows,
          }));
        };

        socket.onmessage = (event) => {
          let msg: Record<string, unknown>;
          try { msg = JSON.parse(event.data); } catch { return; }

          switch (msg.type) {
            case 'status':
              set({ status: msg.status as ConnStatus, statusMsg: (msg.msg as string) ?? '' });
              break;

            case 'data':
              get().onTermData?.(msg.data as string);
              break;

            case 'exec_result': {
              const resolver = _execResolvers.get(msg.id as string);
              if (resolver) {
                resolver({
                  stdout:    (msg.stdout as string)    ?? '',
                  stderr:    (msg.stderr as string)    ?? '',
                  exitCode:  (msg.exitCode as number)  ?? -1,
                  durationMs:(msg.durationMs as number) ?? 0,
                });
                _execResolvers.delete(msg.id as string);
              }
              break;
            }

            case 'plan_step': {
              const { planId, stepId, status, stdout, stderr, exitCode, durationMs } =
                msg as Record<string, unknown>;
              set((s) => {
                if (!s.currentPlan || s.currentPlan.id !== planId) return {};
                const results = {
                  ...s.currentPlan.results,
                  [stepId as string]: {
                    stepId:     stepId as string,
                    status:     status as PlanStepStatus,
                    stdout:     (stdout  as string) ?? '',
                    stderr:     (stderr  as string) ?? '',
                    exitCode:   (exitCode  as number) ?? 0,
                    durationMs: (durationMs as number) ?? 0,
                  },
                };
                return { currentPlan: { ...s.currentPlan, results } };
              });
              break;
            }

            case 'plan_done': {
              set((s) => {
                if (!s.currentPlan) return {};
                const plan: ExecPlan = {
                  ...s.currentPlan,
                  status:  (msg.aborted as boolean) ? 'aborted' : 'done',
                  doneAt:  Date.now(),
                };
                _planResolve?.(plan);
                _planResolve = null;
                return { currentPlan: plan };
              });
              break;
            }
          }
        };

        socket.onclose  = () => set({ status: 'disconnected', ws: null });
        socket.onerror  = () =>
          set({ status: 'error', statusMsg: '无法连接到 SSH Proxy，请确认代理服务已启动', ws: null });

        set({ ws: socket, status: 'connecting', statusMsg: '' });
      },

      disconnect: () => {
        const { ws } = get();
        ws?.send(JSON.stringify({ type: 'disconnect' }));
        ws?.close();
        set({ ws: null, status: 'idle', statusMsg: '', currentPlan: null });
      },

      sendInput: (data) => get().ws?.send(JSON.stringify({ type: 'data', data })),
      resize:    (cols, rows) => get().ws?.send(JSON.stringify({ type: 'resize', cols, rows })),

      // ── 单条命令 exec ────────────────────────────────────────────────────

      execCommand: (cmd, timeoutMs = 30000) =>
        new Promise((resolve) => {
          const id      = generateId();
          const timeout = setTimeout(() => {
            _execResolvers.delete(id);
            resolve({ stdout: '', stderr: '[TIMEOUT]', exitCode: -1, durationMs: timeoutMs });
          }, timeoutMs + 1000);

          _execResolvers.set(id, (r) => {
            clearTimeout(timeout);
            set((s) => ({
              execHistory: [
                { id, cmd, ...r, ts: Date.now() },
                ...s.execHistory,
              ].slice(0, 200),
            }));
            resolve(r);
          });

          get().ws?.send(JSON.stringify({ type: 'exec', cmd, id, timeout: timeoutMs }));
        }),

      // ── SOP 批量执行计划 ─────────────────────────────────────────────────

      runPlan: (steps) =>
        new Promise((resolve) => {
          const planId = generateId();
          const plan: ExecPlan = {
            id:        planId,
            steps,
            results:   {},
            status:    'running',
            startedAt: Date.now(),
          };
          set({ currentPlan: plan });
          _planResolve = resolve;

          get().ws?.send(JSON.stringify({
            type:  'exec_plan',
            id:    planId,
            steps: steps.map((s) => ({ id: s.id, cmd: s.cmd, timeout: s.timeout })),
          }));
        }),

      cancelPlan: () => {
        get().ws?.send(JSON.stringify({ type: 'exec_plan_cancel' }));
        set((s) => ({
          currentPlan: s.currentPlan
            ? { ...s.currentPlan, status: 'aborted', doneAt: Date.now() }
            : null,
        }));
      },

      clearHistory: () => set({ execHistory: [] }),

      // ── 私钥文件路径验证 ─────────────────────────────────────────────────

      checkKeyFile: async (keyPath) => {
        try {
          const r = await fetch(`${PROXY_HTTP}/api/check-key`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ keyFilePath: keyPath }),
            signal:  AbortSignal.timeout(3000),
          });
          return await r.json();
        } catch {
          return { ok: false, msg: '代理服务未运行' };
        }
      },
    }),
    {
      name:        'devutility-ssh',
      partialize:  (s) => ({ profiles: s.profiles, activeProfileId: s.activeProfileId }),
    }
  )
);
