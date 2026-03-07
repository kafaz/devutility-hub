/**
 * SSH Manager Store — 多会话版本
 *
 * 架构设计：
 *   - sessions[]: 每个 SSH 会话的元数据（持久化，不含凭证）
 *   - runtimes Map: 每个会话的运行时状态（WebSocket、回调、不序列化）
 *   - 一个会话 = 一个 WebSocket 连接 = 一个 SSH Shell PTY
 *   - SOP 命令通过对应会话的 Shell PTY 执行（复用用户预处理的 Shell 状态）
 *
 * 多节点执行：
 *   - startMultiNodeRun: 并行向多个会话发送 exec_plan
 *   - 每个会话的 plan_step 事件实时更新 multiNodeRun.nodeExecutions
 *   - 支持 broadcast（所有节点执行同一 SOP）和 targeted（每节点独立 SOP）
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export type AuthType    = 'privateKey' | 'password' | 'agent';
export type ConnStatus  = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
export type RunMode     = 'broadcast' | 'targeted';
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface SSHProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  keyFilePath?: string;
  createdAt: number;
}

// 一个命名的 SSH 会话（对应一个 WebSocket 连接）
export interface SSHSession {
  id: string;
  name: string;          // 用户自定义会话名称，如 "主节点-01" / "从节点-DB"
  profileId: string;     // 使用哪个连接档案
  status: ConnStatus;
  statusMsg: string;
  connectedAt?: number;
}

export interface PlanStep {
  id: string;
  cmd: string;
  name: string;
  captureVar?:     string;
  capturePattern?: string;
  normalRegex?:    string;
  abnormalRegex?:  string;
  scriptPath?:     string;
  timeout?:        number;
  checkId?:        string;
  isSubStep?:      boolean;
}

export interface PlanStepResult {
  stepId:           string;
  status:           PlanStepStatus;
  stdout:           string;
  stderr:           string;
  exitCode:         number;
  durationMs:       number;
  resolvedCmd?:     string;
  capturedVar?:     { name: string; value: string };
  varSnapshot?:     Record<string, string>;
  statusReason?:    string;
  processedOutput?: string;
  scriptError?:     string;
}

// 单个节点的执行结果
export interface NodeExecution {
  sessionId:       string;
  sessionName:     string;
  instanceId:      string;   // SOPInstance ID
  instanceTitle?:  string;   // 快照标题
  templateName?:   string;   // 快照模板名
  steps:           PlanStep[];
  results:         Record<string, PlanStepResult>;
  status:          'pending' | 'running' | 'done' | 'failed';
  startedAt?:      number;
  doneAt?:         number;
  finalVarContext?: Record<string, string>;
}

// 多节点执行计划
export interface MultiNodeRun {
  id:               string;
  mode:             RunMode;
  nodeExecutions:   NodeExecution[];
  startedAt:        number;
  doneAt?:          number;
}

// ─── 运行时状态（不序列化，不放 Zustand） ─────────────────────────────────

interface SessionRuntime {
  ws:              WebSocket | null;
  onTermData:      ((b64: string) => void) | null;
  execResolvers:   Map<string, (r: { stdout: string; stderr: string; exitCode: number; durationMs: number }) => void>;
  planNodeResolve: (() => void) | null;  // resolve 单个节点的 plan 完成
  planAborted:     boolean;
}

const runtimes = new Map<string, SessionRuntime>();

function getRT(sessionId: string): SessionRuntime {
  if (!runtimes.has(sessionId)) {
    runtimes.set(sessionId, {
      ws: null, onTermData: null,
      execResolvers: new Map(),
      planNodeResolve: null, planAborted: false,
    });
  }
  return runtimes.get(sessionId)!;
}

// ─── 常量 ──────────────────────────────────────────────────────────────────

const PROXY_HTTP = 'http://127.0.0.1:3001';
const PROXY_WS   = 'ws://127.0.0.1:3001/terminal';

// ─── Store ─────────────────────────────────────────────────────────────────

interface SSHStore {
  // 连接档案（持久化）
  profiles:       SSHProfile[];
  addProfile:     (p: Omit<SSHProfile, 'id' | 'createdAt'>) => string;
  updateProfile:  (id: string, p: Partial<SSHProfile>) => void;
  deleteProfile:  (id: string) => void;

  // 命名会话（持久化元数据）
  sessions:         SSHSession[];
  activeSessionId:  string | null;
  addSession:       (name: string, profileId: string) => string;
  removeSession:    (sessionId: string) => void;
  renameSession:    (sessionId: string, name: string) => void;
  setActiveSession: (id: string | null) => void;

  // 代理健康检查
  proxyOnline: boolean;
  checkProxy:  () => Promise<void>;

  // 每会话连接操作
  connectSession:         (sessionId: string, params: { passphrase?: string; password?: string; agent?: string; cols?: number; rows?: number }) => void;
  disconnectSession:      (sessionId: string) => void;
  sendInputToSession:     (sessionId: string, data: string) => void;
  resizeSession:          (sessionId: string, cols: number, rows: number) => void;
  setSessionTermCallback: (sessionId: string, cb: ((b64: string) => void) | null) => void;

  // 单会话命令执行（exec 通道，独立环境）
  execCommandOnSession: (sessionId: string, cmd: string, timeout?: number) => Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;

  // 多节点执行
  multiNodeRun:    MultiNodeRun | null;
  startMultiNodeRun: (configs: Array<{ sessionId: string; instanceId: string; instanceTitle?: string; templateName?: string; steps: PlanStep[] }>, mode: RunMode) => Promise<void>;
  cancelMultiNodeRun: () => void;
  clearMultiNodeRun:  () => void;

  // 私钥路径验证
  checkKeyFile: (path: string) => Promise<{ ok: boolean; resolved?: string; msg?: string }>;
}

// ─── WebSocket 消息处理器（每会话一个） ──────────────────────────────────────

function makeWSHandler(sessionId: string, set: (fn: (s: SSHStore) => Partial<SSHStore>) => void) {
  return (event: MessageEvent) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(event.data as string); } catch { return; }

    const rt = runtimes.get(sessionId);
    if (!rt) return;

    switch (msg.type) {

      case 'status':
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id !== sessionId ? sess : {
              ...sess,
              status:      (msg.status as ConnStatus),
              statusMsg:   (msg.msg as string) ?? '',
              connectedAt: msg.status === 'connected' ? Date.now() : sess.connectedAt,
            }
          ),
        }));
        break;

      case 'data':
        rt.onTermData?.(msg.data as string);
        break;

      case 'exec_result': {
        const resolver = rt.execResolvers.get(msg.id as string);
        if (resolver) {
          resolver({
            stdout:     (msg.stdout    as string) ?? '',
            stderr:     (msg.stderr    as string) ?? '',
            exitCode:   (msg.exitCode  as number) ?? 0,
            durationMs: (msg.durationMs as number) ?? 0,
          });
          rt.execResolvers.delete(msg.id as string);
        }
        break;
      }

      case 'plan_step': {
        const m = msg as Record<string, unknown>;
        set((s) => {
          if (!s.multiNodeRun) return {};
          const nodeExecutions = s.multiNodeRun.nodeExecutions.map((ne) => {
            if (ne.sessionId !== sessionId) return ne;
            return {
              ...ne,
              status: 'running' as const,
              results: {
                ...ne.results,
                [m.stepId as string]: {
                  stepId:          m.stepId         as string,
                  status:          m.status         as PlanStepStatus,
                  stdout:          (m.stdout         as string) ?? '',
                  stderr:          (m.stderr         as string) ?? '',
                  exitCode:        (m.exitCode       as number) ?? 0,
                  durationMs:      (m.durationMs     as number) ?? 0,
                  resolvedCmd:     m.resolvedCmd     as string | undefined,
                  capturedVar:     m.capturedVar     as { name: string; value: string } | undefined,
                  varSnapshot:     m.varSnapshot     as Record<string, string> | undefined,
                  statusReason:    m.statusReason    as string | undefined,
                  processedOutput: m.processedOutput as string | undefined,
                  scriptError:     m.scriptError     as string | undefined,
                },
              },
            };
          });
          return { multiNodeRun: { ...s.multiNodeRun, nodeExecutions } };
        });
        break;
      }

      case 'plan_done': {
        set((s) => {
          if (!s.multiNodeRun) return {};
          const aborted = msg.aborted as boolean;
          const nodeExecutions = s.multiNodeRun.nodeExecutions.map((ne) => {
            if (ne.sessionId !== sessionId) return ne;
            return {
              ...ne,
              status:          (aborted ? 'failed' : 'done') as NodeExecution['status'],
              doneAt:           Date.now(),
              finalVarContext:  msg.finalVarContext as Record<string, string> | undefined,
            };
          });
          // 检查是否所有节点都已完成
          const allDone = nodeExecutions.every((ne) => ne.status !== 'running' && ne.status !== 'pending');
          return {
            multiNodeRun: {
              ...s.multiNodeRun,
              nodeExecutions,
              doneAt: allDone ? Date.now() : s.multiNodeRun.doneAt,
            },
          };
        });
        // 通知等待中的 Promise
        rt.planNodeResolve?.();
        rt.planNodeResolve = null;
        break;
      }
    }
  };
}

// ─── Store 实现 ────────────────────────────────────────────────────────────

export const useSSHStore = create<SSHStore>()(
  persist(
    (set, get) => ({
      profiles:        [],
      sessions:        [],
      activeSessionId: null,
      proxyOnline:     false,
      multiNodeRun:    null,

      // ── 档案管理 ──────────────────────────────────────────────────────────

      addProfile: (p) => {
        const id = generateId();
        set((s) => ({ profiles: [...s.profiles, { ...p, id, createdAt: Date.now() }] }));
        return id;
      },
      updateProfile: (id, p) =>
        set((s) => ({ profiles: s.profiles.map((x) => x.id === id ? { ...x, ...p } : x) })),
      deleteProfile: (id) =>
        set((s) => ({ profiles: s.profiles.filter((x) => x.id !== id) })),

      // ── 会话管理 ──────────────────────────────────────────────────────────

      addSession: (name, profileId) => {
        const id = generateId();
        set((s) => ({
          sessions:        [...s.sessions, { id, name, profileId, status: 'idle', statusMsg: '' }],
          activeSessionId: id,
        }));
        return id;
      },

      removeSession: (sessionId) => {
        const rt = runtimes.get(sessionId);
        rt?.ws?.close();
        runtimes.delete(sessionId);
        set((s) => ({
          sessions:        s.sessions.filter((x) => x.id !== sessionId),
          activeSessionId: s.activeSessionId === sessionId
            ? (s.sessions.find((x) => x.id !== sessionId)?.id ?? null)
            : s.activeSessionId,
        }));
      },

      renameSession: (sessionId, name) =>
        set((s) => ({
          sessions: s.sessions.map((x) => x.id === sessionId ? { ...x, name } : x),
        })),

      setActiveSession: (id) => set({ activeSessionId: id }),

      // ── 代理健康检查 ──────────────────────────────────────────────────────

      checkProxy: async () => {
        try {
          const r = await fetch(`${PROXY_HTTP}/api/health`, { signal: AbortSignal.timeout(2000) });
          set({ proxyOnline: r.ok });
        } catch {
          set({ proxyOnline: false });
        }
      },

      setSessionTermCallback: (sessionId, cb) => {
        getRT(sessionId).onTermData = cb;
      },

      // ── 建立 SSH 连接 ─────────────────────────────────────────────────────

      connectSession: (sessionId, { passphrase, password, agent, cols = 220, rows = 50 }) => {
        const profile = get().profiles.find(
          (p) => p.id === get().sessions.find((s) => s.id === sessionId)?.profileId
        );
        if (!profile) return;

        const rt = getRT(sessionId);
        rt.ws?.close();

        const socket = new WebSocket(PROXY_WS);
        rt.ws = socket;

        socket.onopen = () => {
          socket.send(JSON.stringify({
            type: 'connect',
            host: profile.host, port: profile.port, username: profile.username,
            authType: profile.authType, keyFilePath: profile.keyFilePath,
            passphrase, password, agent, cols, rows,
          }));
        };

        socket.onmessage = makeWSHandler(sessionId, set as Parameters<typeof makeWSHandler>[1]);
        socket.onclose   = () => set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status: 'disconnected', statusMsg: '' } : x
          ),
        }));
        socket.onerror = () => set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status: 'error', statusMsg: '无法连接到 SSH Proxy' } : x
          ),
        }));

        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status: 'connecting', statusMsg: `连接中…` } : x
          ),
        }));
      },

      disconnectSession: (sessionId) => {
        const rt = runtimes.get(sessionId);
        rt?.ws?.send(JSON.stringify({ type: 'disconnect' }));
        rt?.ws?.close();
        if (rt) rt.ws = null;
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status: 'idle', statusMsg: '' } : x
          ),
        }));
      },

      sendInputToSession:  (sessionId, data) =>
        runtimes.get(sessionId)?.ws?.send(JSON.stringify({ type: 'data', data })),

      resizeSession: (sessionId, cols, rows) =>
        runtimes.get(sessionId)?.ws?.send(JSON.stringify({ type: 'resize', cols, rows })),

      // ── 单会话独立命令（exec 通道） ───────────────────────────────────────

      execCommandOnSession: (sessionId, cmd, timeout = 30000) =>
        new Promise((resolve) => {
          const rt  = getRT(sessionId);
          const id  = generateId();
          const timer = setTimeout(() => {
            rt.execResolvers.delete(id);
            resolve({ stdout: '', stderr: '[TIMEOUT]', exitCode: -1, durationMs: timeout });
          }, timeout + 1000);

          rt.execResolvers.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
          });

          rt.ws?.send(JSON.stringify({ type: 'exec', cmd, id, timeout }));
        }),

      // ── 多节点执行 ────────────────────────────────────────────────────────

      startMultiNodeRun: async (configs, mode) => {
        if (get().multiNodeRun && !get().multiNodeRun?.doneAt) return;

        const runId = generateId();
        const nodeExecutions: NodeExecution[] = configs.map((c) => {
          const sess = get().sessions.find((s) => s.id === c.sessionId);
          return {
            sessionId:     c.sessionId,
            sessionName:   sess?.name ?? c.sessionId,
            instanceId:    c.instanceId,
            instanceTitle: c.instanceTitle,
            templateName:  c.templateName,
            steps:         c.steps,
            results:       {},
            status:        'pending',
            startedAt:     Date.now(),
          };
        });

        set({ multiNodeRun: { id: runId, mode, nodeExecutions, startedAt: Date.now() } });

        // 并行向每个节点发送 exec_plan，各自独立跑
        await Promise.allSettled(
          configs.map((c) => new Promise<void>((resolve) => {
            const rt = runtimes.get(c.sessionId);
            if (!rt?.ws || rt.ws.readyState !== WebSocket.OPEN) {
              set((s) => ({
                multiNodeRun: s.multiNodeRun ? {
                  ...s.multiNodeRun,
                  nodeExecutions: s.multiNodeRun.nodeExecutions.map((ne) =>
                    ne.sessionId === c.sessionId ? { ...ne, status: 'failed', doneAt: Date.now() } : ne
                  ),
                } : null,
              }));
              resolve();
              return;
            }

            rt.planAborted    = false;
            rt.planNodeResolve = resolve;

            const planId = generateId();
            set((s) => ({
              multiNodeRun: s.multiNodeRun ? {
                ...s.multiNodeRun,
                nodeExecutions: s.multiNodeRun.nodeExecutions.map((ne) =>
                  ne.sessionId === c.sessionId ? { ...ne, status: 'running' } : ne
                ),
              } : null,
            }));

            rt.ws.send(JSON.stringify({
              type: 'exec_plan',
              id:   planId,
              steps: c.steps.map((s) => ({
                id: s.id, cmd: s.cmd, name: s.name,
                captureVar: s.captureVar, capturePattern: s.capturePattern,
                normalRegex: s.normalRegex, abnormalRegex: s.abnormalRegex,
                scriptPath: s.scriptPath, timeout: s.timeout,
              })),
            }));
          }))
        );

        set((s) => ({
          multiNodeRun: s.multiNodeRun ? { ...s.multiNodeRun, doneAt: Date.now() } : null,
        }));
      },

      cancelMultiNodeRun: () => {
        // 取消每个节点的执行
        get().multiNodeRun?.nodeExecutions.forEach((ne) => {
          const rt = runtimes.get(ne.sessionId);
          if (rt?.ws?.readyState === WebSocket.OPEN) {
            rt.ws.send(JSON.stringify({ type: 'exec_plan_cancel' }));
          }
          rt?.planNodeResolve?.();
        });
      },

      clearMultiNodeRun: () => set({ multiNodeRun: null }),

      // ── 私钥文件验证 ──────────────────────────────────────────────────────

      checkKeyFile: async (keyPath) => {
        try {
          const r = await fetch(`${PROXY_HTTP}/api/check-key`, {
            method: 'POST',
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
      name:        'devutility-ssh-v2',
      partialize:  (s) => ({
        profiles:        s.profiles,
        sessions:        s.sessions,
        activeSessionId: s.activeSessionId,
      }),
    }
  )
);
