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
import { generateId, renderTemplate } from '../../../utils';
import { matchLogNoise } from '../../../utils/logNoise';
import { PROXY_HTTP_BASE, PROXY_WS_BASE } from '../../../config/runtime';
import { buildShellVarsSyncScript } from '../shellVars';
import { useAnalyzerStore } from './analyzerStore';
import { useJournalStore } from './journalStore';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export type AuthType    = 'privateKey' | 'password' | 'agent';
export type ConnStatus  = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
export type RunMode     = 'broadcast' | 'targeted';
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface SSHCredential {
  id: string;
  name: string;         // e.g., "Prod Global Key", "Test Root Pass"
  username: string;
  authType: AuthType;
  password?: string;
  keyFilePath?: string;
  createdAt: number;
}

export interface SSHProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  credentialId?: string; // Ref to SSHCredential
  // Legacy fields below (can be overwritten or ignored if credentialId is set)
  username?: string;
  authType?: AuthType;
  password?: string;
  keyFilePath?: string;
  jumpHostProfileId?: string; // Phase 12: Bastion/Jump Host
  bootstrapCommandGroupIds?: string[];
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

export interface InitCommandTemplate {
  id: string;
  name: string;
  command: string;
  captureVar?: string;
  capturePattern?: string;
  timeout?: number;
  continueOnFailure?: boolean;
  parallelGroup?: string;
}

export interface SessionGroup {
  id: string;
  name: string;
  tags: string[];
  sessionIds: string[];
  initCommands: InitCommandTemplate[];
  createdAt: number;
  updatedAt: number;
}

export interface CommandPresetGroup {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  commands: InitCommandTemplate[];
  createdAt: number;
  updatedAt: number;
}

export type NodeContextEntrySource = 'init' | 'manual';
export type BootstrapStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed';

export interface NodeContextEntry {
  id: string;
  source: NodeContextEntrySource;
  name: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  extractedVars: Record<string, string>;
  timestamp: number;
}

export interface NodeConnectionContext {
  sessionId: string;
  connectionEpoch: number;
  entries: NodeContextEntry[];
  vars: Record<string, string>;
  bootstrapStatus: BootstrapStatus;
  bootstrapError?: string;
  updatedAt: number;
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
  terminalBuffer:  string;
  onTermData:      ((b64: string) => void) | null;
  execResolvers:   Map<string, (r: { stdout: string; stderr: string; exitCode: number; durationMs: number }) => void>;
  planNodeResolve: (() => void) | null;  // resolve 单个节点的 plan 完成
  planAborted:     boolean;
  pendingManualCmd: {
    cmd: string;
    startTime: number;
    startIndex: number;
    debounceTimer: ReturnType<typeof setTimeout> | null;
  } | null;
  disconnectRequested: boolean;
  // 14-E: asciinema 录像数据
  recordingFrames:    { t: number; data: string }[];
  recordingStartedAt: number | null;
  // 智能抓取日志使用
  lineBuffer: string;
}

const runtimes = new Map<string, SessionRuntime>();

// ─── 调度器专用执行回调（planId 路由，不影响 multiNodeRun 状态） ──────────

interface SchedulerPlanCallback {
  stepResults: Record<string, PlanStepResult>;
  onStep?:     (stepId: string, result: PlanStepResult) => void;
  resolve:     (r: {
    success:          boolean;
    results:          Record<string, PlanStepResult>;
    finalVarContext?: Record<string, string>;
    error?:           string;
  }) => void;
}

const schedulerPlanCallbacks = new Map<string, SchedulerPlanCallback>();

function getRT(sessionId: string): SessionRuntime {
  if (!runtimes.has(sessionId)) {
    runtimes.set(sessionId, {
      ws: null, terminalBuffer: '', onTermData: null,
      execResolvers: new Map(),
      planNodeResolve: null, planAborted: false,
      pendingManualCmd: null,
      disconnectRequested: false,
      recordingFrames: [], recordingStartedAt: null,
      lineBuffer: '',
    });
  }
  return runtimes.get(sessionId)!;
}

function sanitizeTerminalText(text: string): string {
  /* eslint-disable no-control-regex */
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .trim();
  /* eslint-enable no-control-regex */
}

const DEFAULT_INIT_COMMANDS: InitCommandTemplate[] = [
  {
    id: 'default-hostname',
    name: '主机名',
    command: 'hostname',
    captureVar: 'node_hostname',
    timeout: 8000,
    continueOnFailure: true,
    parallelGroup: 'bootstrap-default-context',
  },
  {
    id: 'default-user',
    name: '当前用户',
    command: 'whoami',
    captureVar: 'node_user',
    timeout: 8000,
    continueOnFailure: true,
    parallelGroup: 'bootstrap-default-context',
  },
  {
    id: 'default-pwd',
    name: '当前目录',
    command: 'pwd',
    captureVar: 'node_pwd',
    timeout: 8000,
    continueOnFailure: true,
    parallelGroup: 'bootstrap-default-context',
  },
  {
    id: 'default-shell',
    name: 'Shell',
    command: 'printf "%s" "$SHELL"',
    captureVar: 'node_shell',
    timeout: 8000,
    continueOnFailure: true,
    parallelGroup: 'bootstrap-default-context',
  },
];

function extractCapturedVars(
  stdout: string,
  captureVar?: string,
  capturePattern?: string
): Record<string, string> {
  if (!captureVar) return {};
  if (!capturePattern) {
    const trimmed = stdout.trim();
    return trimmed ? { [captureVar]: trimmed } : {};
  }

  try {
    const match = stdout.match(new RegExp(capturePattern, 'm'));
    if (!match) return {};
    const extracted = (match[1] ?? match[0] ?? '').trim();
    return extracted ? { [captureVar]: extracted } : {};
  } catch {
    const trimmed = stdout.trim();
    return trimmed ? { [captureVar]: trimmed } : {};
  }
}

function rebuildNodeContextVars(entries: NodeContextEntry[]): Record<string, string> {
  return entries.reduce<Record<string, string>>((acc, entry) => {
    Object.entries(entry.extractedVars).forEach(([key, value]) => {
      acc[key] = value;
    });
    return acc;
  }, {});
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function addSessionJournalEvent(sessionId: string, eventTitle: string, content: string): void {
  const { sessions } = useSSHStore.getState();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  useJournalStore.getState().addEntry({
    sessionId,
    sessionName: session.name,
    type: 'session_evt',
    timestamp: Date.now(),
    eventTitle,
    content,
  });
}

function syncShellVarsForSession(
  sessionId: string,
  previousVars: Record<string, string>,
  nextVars: Record<string, string>
): void {
  const { sessions, sendInputToSession } = useSSHStore.getState();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session || session.status !== 'connected') return;
  const script = buildShellVarsSyncScript(previousVars, nextVars);
  if (!script) return;
  sendInputToSession(sessionId, `${script}\n`);
}

function cloneScopedInitCommands(
  commands: InitCommandTemplate[],
  scope: { id: string; name: string; prefix?: string }
): InitCommandTemplate[] {
  return commands.map((command) => ({
    ...command,
    id: `${scope.id}::${command.id}`,
    name: scope.prefix ? `${scope.prefix} · ${command.name}` : command.name,
  }));
}

function addQuickExecJournalEntry(
  sessionId: string,
  cmd: string,
  result: { stdout: string; stderr: string; exitCode: number; durationMs: number },
  timestamp: number
): void {
  const { sessions, profiles } = useSSHStore.getState();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  const profile = profiles.find((item) => item.id === session.profileId);

  useJournalStore.getState().addEntry({
    sessionId,
    sessionName: session.name,
    type: 'quick_exec',
    timestamp,
    command: cmd,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    nodeHost: profile?.host,
    nodePort: profile?.port,
    nodeUser: profile?.username,
  });
}

function flushPendingManualCommand(sessionId: string, endIndex?: number): void {
  const rt = getRT(sessionId);
  const pending = rt.pendingManualCmd;
  if (!pending) return;

  if (pending.debounceTimer) {
    clearTimeout(pending.debounceTimer);
  }

  const safeEndIndex = Math.max(
    pending.startIndex,
    Math.min(endIndex ?? rt.terminalBuffer.length, rt.terminalBuffer.length)
  );
  const outputBin = rt.terminalBuffer.slice(pending.startIndex, safeEndIndex);
  const bytes = new Uint8Array(outputBin.length);
  for (let i = 0; i < outputBin.length; i++) bytes[i] = outputBin.charCodeAt(i);
  const outputUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const cleanOutput = sanitizeTerminalText(outputUtf8);

  const { sessions, profiles } = useSSHStore.getState();
  const session = sessions.find((item) => item.id === sessionId);
  if (session) {
    const profile = profiles.find((item) => item.id === session.profileId);
    useJournalStore.getState().addEntry({
      sessionId,
      sessionName: session.name,
      type: 'manual_cmd',
      timestamp: pending.startTime,
      command: pending.cmd,
      output: cleanOutput,
      nodeHost: profile?.host,
      nodePort: profile?.port,
      nodeUser: profile?.username,
    });
  }

  rt.pendingManualCmd = null;
}

// 14-E: 开始/清空录像
export function startTermRecording(sessionId: string): void {
  const rt = getRT(sessionId);
  rt.recordingFrames = [];
  rt.recordingStartedAt = Date.now();
}

export function getTermRecording(sessionId: string): { frames: { t: number; data: string }[]; startedAt: number | null } {
  const rt = getRT(sessionId);
  return { frames: rt.recordingFrames, startedAt: rt.recordingStartedAt };
}

export function getTerminalBuffer(sessionId: string): string {
  return getRT(sessionId).terminalBuffer;
}

export function recordManualCommandStart(sessionId: string, cmd: string, currentLine = '') {
  const rt = getRT(sessionId);
  if (rt.pendingManualCmd) {
    const boundaryIndex = currentLine
      ? Math.max(rt.pendingManualCmd.startIndex, rt.terminalBuffer.length - currentLine.length)
      : rt.terminalBuffer.length;
    flushPendingManualCommand(sessionId, boundaryIndex);
  }
  rt.pendingManualCmd = {
    cmd,
    startTime: Date.now(),
    startIndex: rt.terminalBuffer.length,
    debounceTimer: null,
  };
}

// ─── 常量 ──────────────────────────────────────────────────────────────────

const PROXY_HTTP = PROXY_HTTP_BASE;
const PROXY_WS   = PROXY_WS_BASE;

interface ExecCommandOptions {
  journal?: boolean;
}

export interface ContextCaptureConfig {
  source: NodeContextEntrySource;
  name: string;
  command: string;
  captureVar?: string;
  capturePattern?: string;
  timeout?: number;
  continueOnFailure?: boolean;
}

// ─── Store ─────────────────────────────────────────────────────────────────

interface SSHStore {
  // 凭证管理 (Phase 15: 支持预设凭证/记住密码)
  credentials:      SSHCredential[];
  addCredential:    (c: Omit<SSHCredential, 'id' | 'createdAt'>) => string;
  updateCredential: (id: string, c: Partial<SSHCredential>) => void;
  deleteCredential: (id: string) => void;

  // 连接档案（持久化）
  profiles:       SSHProfile[];
  addProfile:     (p: Omit<SSHProfile, 'id' | 'createdAt'>) => string;
  updateProfile:  (id: string, p: Partial<SSHProfile>) => void;
  deleteProfile:  (id: string) => void;
  commandPresetGroups: CommandPresetGroup[];
  createCommandPresetGroup: (group: Omit<CommandPresetGroup, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCommandPresetGroup: (groupId: string, patch: Partial<Omit<CommandPresetGroup, 'id' | 'createdAt' | 'updatedAt'>>) => void;
  deleteCommandPresetGroup: (groupId: string) => void;

  // 命名会话（持久化元数据）
  sessions:         SSHSession[];
  sessionGroups:    SessionGroup[];
  activeSessionId:  string | null;
  nodeContexts:     Record<string, NodeConnectionContext>;
  addSession:       (name: string, profileId: string) => string;
  removeSession:    (sessionId: string) => void;
  renameSession:    (sessionId: string, name: string) => void;
  setActiveSession: (id: string | null) => void;
  createSessionGroup: (group: Omit<SessionGroup, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateSessionGroup: (groupId: string, patch: Partial<Omit<SessionGroup, 'id' | 'createdAt' | 'updatedAt'>>) => void;
  deleteSessionGroup: (groupId: string) => void;
  assignSessionsToGroup: (groupId: string, sessionIds: string[]) => void;
  connectGroup: (groupId: string) => void;
  reconnectGroup: (groupId: string) => void;
  disconnectGroup: (groupId: string) => void;
  saveContextEntry: (sessionId: string, entry: Omit<NodeContextEntry, 'id'>) => string;
  removeContextEntry: (sessionId: string, entryId: string) => void;
  clearNodeContext: (sessionId: string) => void;
  captureContextCommand: (
    sessionId: string,
    config: ContextCaptureConfig
  ) => Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number; extractedVars: Record<string, string> }>;
  runSessionBootstrap: (sessionId: string) => Promise<void>;
  buildNodeScopedVars: (
    sessionId: string,
    explicitVars?: Record<string, string>,
    templateDefaults?: Record<string, string>
  ) => Record<string, string>;

  // 代理健康检查
  proxyOnline: boolean;
  checkProxy:  () => Promise<void>;

  // 每会话连接操作
  connectSession:         (sessionId: string, params: { credentialId?: string; passphrase?: string; password?: string; agent?: string; jumpPassphrase?: string; jumpPassword?: string; jumpAgent?: string; cols?: number; rows?: number }) => void;
  disconnectSession:      (sessionId: string) => void;
  sendInputToSession:     (sessionId: string, data: string) => void;
  resizeSession:          (sessionId: string, cols: number, rows: number) => void;
  setSessionTermCallback: (sessionId: string, cb: ((b64: string) => void) | null) => void;

  // 单会话命令执行（exec 通道，独立环境）
  execCommandOnSession: (
    sessionId: string,
    cmd: string,
    timeout?: number,
    options?: ExecCommandOptions
  ) => Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;

  // 多节点执行
  multiNodeRun:    MultiNodeRun | null;
  startMultiNodeRun: (configs: Array<{ sessionId: string; instanceId: string; instanceTitle?: string; templateName?: string; steps: PlanStep[] }>, mode: RunMode) => Promise<void>;
  cancelMultiNodeRun: () => void;
  clearMultiNodeRun:  () => void;

  // 监听独立会话的实时行数据（去除 ANSI）
  termLineListeners: Record<string, ((line: string) => void)[]>;
  subscribeToSessionLines: (sessionId: string, cb: (line: string) => void) => () => void;

  // 调度器专用执行通道（planId 路由，不写入 multiNodeRun 全局状态）
  executeSOPPlanForScheduler: (
    sessionId: string,
    steps:     PlanStep[],
    onStep?:   (stepId: string, result: PlanStepResult) => void,
  ) => Promise<{
    success:          boolean;
    results:          Record<string, PlanStepResult>;
    finalVarContext?: Record<string, string>;
    error?:           string;
  }>;

  // 私钥路径验证
  checkKeyFile: (path: string) => Promise<{ ok: boolean; resolved?: string; msg?: string }>;
}

// ─── WebSocket 消息处理器（每会话一个） ──────────────────────────────────────

function makeWSHandler(
  sessionId: string,
  set: (fn: (s: SSHStore) => Partial<SSHStore>) => void,
  get: () => SSHStore
) {
  return (event: MessageEvent) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(event.data as string); } catch { return; }

    const rt = runtimes.get(sessionId);
    if (!rt) return;

    switch (msg.type) {

      case 'status': {
        const nextStatus = msg.status as ConnStatus;
        const nextStatusMsg = (msg.msg as string) ?? '';
        const prevSession = get().sessions.find((sess) => sess.id === sessionId);
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id !== sessionId ? sess : {
              ...sess,
              status:      nextStatus,
              statusMsg:   nextStatusMsg,
              connectedAt: nextStatus === 'connected' ? Date.now() : sess.connectedAt,
            }
          ),
        }));
        if (prevSession?.status !== nextStatus) {
          if (nextStatus === 'connected') {
            addSessionJournalEvent(sessionId, '连接已建立', nextStatusMsg || 'SSH 会话已连接');
            void get().runSessionBootstrap(sessionId);
          } else if (nextStatus === 'error') {
            addSessionJournalEvent(sessionId, '连接异常', nextStatusMsg || 'SSH 会话连接失败');
          }
        }
        break;
      }

      case 'data': {
        const payload = msg.data as string;
        const finalPayload = payload;
        try {
          const bin = atob(payload);
          rt.terminalBuffer += bin;
          if (rt.terminalBuffer.length > 200000) {
            const drop = rt.terminalBuffer.length - 200000;
            rt.terminalBuffer = rt.terminalBuffer.slice(-200000);
            if (rt.pendingManualCmd) {
              rt.pendingManualCmd.startIndex = Math.max(0, rt.pendingManualCmd.startIndex - drop);
            }
          }

          // ---- 智能日志抽取逻辑 ----
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const chunkUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes); // For simple analytics
          
          rt.lineBuffer += chunkUtf8;
          const lines = rt.lineBuffer.split('\n');
          rt.lineBuffer = lines.pop() ?? '';

          const analyzerStore = useAnalyzerStore.getState();

          if (lines.length > 0) {
            const keywords = analyzerStore.keywords;
            const noiseOptions = {
              builtinMode: analyzerStore.builtinNoiseMode,
              customKeywords: analyzerStore.noiseKeywords,
            };
            const sess = get().sessions.find(s => s.id === sessionId);
            const lineListeners = get().termLineListeners[sessionId] || [];

            for (const line of lines) {
              const cleanLine = sanitizeTerminalText(line);
              
              if (lineListeners.length > 0) {
                lineListeners.forEach(cb => cb(cleanLine));
              }

              if (!cleanLine) continue;

              const noiseMatch = matchLogNoise(cleanLine, noiseOptions);
              if (noiseMatch) {
                analyzerStore.recordSuppressedLog(noiseMatch, cleanLine);
                continue;
              }

              const cleanLower = cleanLine.toLowerCase();
              const matched = keywords.filter(k => cleanLower.includes(k));
              
              if (matched.length > 0) {
                let type: 'error' | 'data' | 'keyword' = 'keyword';
                if (matched.some(k => ['error', 'exception', 'fail', 'failed', 'panic', 'fatal'].includes(k))) type = 'error';
                else if (matched.some(k => ['data'].includes(k))) type = 'data';

                analyzerStore.addLog({
                  sessionId,
                  sessionName: sess?.name || sessionId,
                  timestamp: Date.now(),
                  type,
                  text: cleanLine,
                  matchedKeywords: matched,
                });
              }
            }
          }
        } catch { /* ignore base64 parse error */ }
        rt.onTermData?.(finalPayload);

        // 14-E: asciinema \u5f55\u50cf — \u8ffd\u52a0\u5e27\u6570\u636e
        if (rt.recordingStartedAt !== null) {
          const t = (Date.now() - rt.recordingStartedAt) / 1000;
          rt.recordingFrames.push({ t, data: atob(payload) });
        }

        // 处理输出记录 debounce
        if (rt.pendingManualCmd) {
          if (rt.pendingManualCmd.debounceTimer) clearTimeout(rt.pendingManualCmd.debounceTimer);
          rt.pendingManualCmd.debounceTimer = setTimeout(() => {
            flushPendingManualCommand(sessionId);
          }, 500);
        }
        break;
      }

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
        const m     = msg as Record<string, unknown>;
        const planId = m.planId as string | undefined;

        // 优先路由到调度器专用回调（planId 精确匹配）
        const schedCb = planId ? schedulerPlanCallbacks.get(planId) : undefined;
        if (schedCb) {
          const result: PlanStepResult = {
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
          };
          schedCb.stepResults[m.stepId as string] = result;
          schedCb.onStep?.(m.stepId as string, result);
          break;
        }

        // 原有 multiNodeRun 路径
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
        const planId = msg.planId as string | undefined;

        // 路由到调度器回调
        const schedCb = planId ? schedulerPlanCallbacks.get(planId) : undefined;
        if (schedCb) {
          schedulerPlanCallbacks.delete(planId!);
          schedCb.resolve({
            success:          !(msg.aborted as boolean),
            results:          schedCb.stepResults,
            finalVarContext:  msg.finalVarContext as Record<string, string> | undefined,
          });
          break;
        }

        // 原有 multiNodeRun 路径
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
          const allDone = nodeExecutions.every((ne) => ne.status !== 'running' && ne.status !== 'pending');
          return {
            multiNodeRun: {
              ...s.multiNodeRun,
              nodeExecutions,
              doneAt: allDone ? Date.now() : s.multiNodeRun.doneAt,
            },
          };
        });
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
      credentials:     [],
      profiles:        [],
      commandPresetGroups: [],
      sessions:        [],
      sessionGroups:   [],
      activeSessionId: null,
      nodeContexts:    {},
      proxyOnline:     false,
      multiNodeRun:    null,
      termLineListeners: {},

      // ── 凭证管理 ──────────────────────────────────────────────────────────

      addCredential: (c) => {
        const id = generateId();
        set((s) => ({ credentials: [...s.credentials, { ...c, id, createdAt: Date.now() }] }));
        return id;
      },
      updateCredential: (id, c) =>
        set((s) => ({ credentials: s.credentials.map((x) => x.id === id ? { ...x, ...c } : x) })),
      deleteCredential: (id) =>
        set((s) => ({
          credentials: s.credentials.filter((x) => x.id !== id),
          profiles: s.profiles.map((profile) =>
            profile.credentialId === id
              ? { ...profile, credentialId: undefined }
              : profile
          ),
        })),

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

      createCommandPresetGroup: (group) => {
        const id = generateId();
        const now = Date.now();
        set((s) => ({
          commandPresetGroups: [
            ...s.commandPresetGroups,
            {
              ...group,
              id,
              tags: Array.from(new Set((group.tags ?? []).filter(Boolean))),
              commands: group.commands ?? [],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
        return id;
      },

      updateCommandPresetGroup: (groupId, patch) =>
        set((s) => ({
          commandPresetGroups: s.commandPresetGroups.map((group) =>
            group.id !== groupId
              ? group
              : {
                  ...group,
                  ...patch,
                  tags: patch.tags ? Array.from(new Set(patch.tags.filter(Boolean))) : group.tags,
                  commands: patch.commands ?? group.commands,
                  updatedAt: Date.now(),
                }
          ),
        })),

      deleteCommandPresetGroup: (groupId) =>
        set((s) => ({
          commandPresetGroups: s.commandPresetGroups.filter((group) => group.id !== groupId),
          profiles: s.profiles.map((profile) => ({
            ...profile,
            bootstrapCommandGroupIds: (profile.bootstrapCommandGroupIds ?? []).filter((id) => id !== groupId),
          })),
        })),

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
        flushPendingManualCommand(sessionId);
        rt?.ws?.close();
        runtimes.delete(sessionId);
        set((s) => ({
          sessions:        s.sessions.filter((x) => x.id !== sessionId),
          sessionGroups:   s.sessionGroups.map((group) => ({
            ...group,
            sessionIds: group.sessionIds.filter((id) => id !== sessionId),
          })),
          nodeContexts:    omitKey(s.nodeContexts, sessionId),
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

      createSessionGroup: (group) => {
        const id = generateId();
        const now = Date.now();
        set((s) => ({
          sessionGroups: [
            ...s.sessionGroups,
            {
              ...group,
              id,
              tags: Array.from(new Set(group.tags.filter(Boolean))),
              sessionIds: Array.from(new Set(group.sessionIds)),
              initCommands: group.initCommands ?? [],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
        return id;
      },

      updateSessionGroup: (groupId, patch) =>
        set((s) => ({
          sessionGroups: s.sessionGroups.map((group) =>
            group.id !== groupId
              ? group
              : {
                  ...group,
                  ...patch,
                  tags: patch.tags ? Array.from(new Set(patch.tags.filter(Boolean))) : group.tags,
                  sessionIds: patch.sessionIds ? Array.from(new Set(patch.sessionIds)) : group.sessionIds,
                  initCommands: patch.initCommands ?? group.initCommands,
                  updatedAt: Date.now(),
                }
          ),
        })),

      deleteSessionGroup: (groupId) =>
        set((s) => ({
          sessionGroups: s.sessionGroups.filter((group) => group.id !== groupId),
        })),

      assignSessionsToGroup: (groupId, sessionIds) =>
        set((s) => ({
          sessionGroups: s.sessionGroups.map((group) =>
            group.id !== groupId
              ? group
              : {
                  ...group,
                  sessionIds: Array.from(new Set(sessionIds)),
                  updatedAt: Date.now(),
                }
          ),
        })),

      connectGroup: (groupId) => {
        const group = get().sessionGroups.find((item) => item.id === groupId);
        if (!group) return;
        group.sessionIds.forEach((sessionId) => {
          const session = get().sessions.find((item) => item.id === sessionId);
          const profile = get().profiles.find((item) => item.id === session?.profileId);
          if (!session || !profile || session.status === 'connected' || session.status === 'connecting') return;
          get().connectSession(sessionId, { credentialId: profile.credentialId });
        });
      },

      reconnectGroup: (groupId) => {
        const group = get().sessionGroups.find((item) => item.id === groupId);
        if (!group) return;
        group.sessionIds.forEach((sessionId) => {
          const session = get().sessions.find((item) => item.id === sessionId);
          const profile = get().profiles.find((item) => item.id === session?.profileId);
          if (!session || !profile) return;
          if (session.status === 'connected' || session.status === 'connecting') {
            get().disconnectSession(sessionId);
          }
          queueMicrotask(() => get().connectSession(sessionId, { credentialId: profile.credentialId }));
        });
      },

      disconnectGroup: (groupId) => {
        const group = get().sessionGroups.find((item) => item.id === groupId);
        if (!group) return;
        group.sessionIds.forEach((sessionId) => {
          const session = get().sessions.find((item) => item.id === sessionId);
          if (session?.status === 'connected' || session?.status === 'connecting') {
            get().disconnectSession(sessionId);
          }
        });
      },

      saveContextEntry: (sessionId, entry) => {
        const entryId = generateId();
        const nextEntry: NodeContextEntry = { ...entry, id: entryId };
        let previousVars: Record<string, string> = {};
        let nextVars: Record<string, string> = {};
        set((s) => {
          const current = s.nodeContexts[sessionId];
          previousVars = current?.vars ?? {};
          const entries = [...(current?.entries ?? []), nextEntry];
          nextVars = rebuildNodeContextVars(entries);
          return {
            nodeContexts: {
              ...s.nodeContexts,
              [sessionId]: {
                sessionId,
                connectionEpoch: current?.connectionEpoch ?? Date.now(),
                entries,
                vars: nextVars,
                bootstrapStatus: current?.bootstrapStatus ?? 'idle',
                bootstrapError: current?.bootstrapError,
                updatedAt: Date.now(),
              },
            },
          };
        });
        syncShellVarsForSession(sessionId, previousVars, nextVars);
        return entryId;
      },

      removeContextEntry: (sessionId, entryId) =>
        set((s) => {
          const current = s.nodeContexts[sessionId];
          if (!current) return {};
          const entries = current.entries.filter((entry) => entry.id !== entryId);
          const nextVars = rebuildNodeContextVars(entries);
          queueMicrotask(() => syncShellVarsForSession(sessionId, current.vars, nextVars));
          return {
            nodeContexts: {
              ...s.nodeContexts,
              [sessionId]: {
                ...current,
                entries,
                vars: nextVars,
                updatedAt: Date.now(),
              },
            },
          };
        }),

      clearNodeContext: (sessionId) =>
        set((s) => {
          const previousVars = s.nodeContexts[sessionId]?.vars ?? {};
          queueMicrotask(() => syncShellVarsForSession(sessionId, previousVars, {}));
          return { nodeContexts: omitKey(s.nodeContexts, sessionId) };
        }),

      captureContextCommand: async (sessionId, config) => {
        const renderedCommand = renderTemplate(
          config.command,
          get().buildNodeScopedVars(sessionId)
        );
        const result = await get().execCommandOnSession(
          sessionId,
          renderedCommand,
          config.timeout ?? 15000
        );
        const extractedVars = extractCapturedVars(result.stdout, config.captureVar, config.capturePattern);
        get().saveContextEntry(sessionId, {
          source: config.source,
          name: config.name,
          command: renderedCommand,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          extractedVars,
          timestamp: Date.now(),
        });
        return { ...result, extractedVars };
      },

      buildNodeScopedVars: (sessionId, explicitVars = {}, templateDefaults = {}) => ({
        ...templateDefaults,
        ...(get().nodeContexts[sessionId]?.vars ?? {}),
        ...explicitVars,
      }),

      runSessionBootstrap: async (sessionId) => {
        const session = get().sessions.find((item) => item.id === sessionId);
        if (!session || session.status !== 'connected') return;
        const profile = get().profiles.find((item) => item.id === session.profileId);

        const connectionEpoch = Date.now();
        set((s) => ({
          nodeContexts: {
            ...s.nodeContexts,
            [sessionId]: {
              sessionId,
              connectionEpoch,
              entries: [],
              vars: {},
              bootstrapStatus: 'running',
              updatedAt: connectionEpoch,
            },
          },
        }));

        get().sendInputToSession(sessionId, 'export TMOUT=0\n');
        addSessionJournalEvent(sessionId, 'Shell Bootstrap', '已发送 export TMOUT=0');

        const profileCommandGroups = (profile?.bootstrapCommandGroupIds ?? [])
          .map((groupId) => get().commandPresetGroups.find((group) => group.id === groupId))
          .filter(Boolean) as CommandPresetGroup[];
        const profileCommands = profileCommandGroups.flatMap((group) =>
          cloneScopedInitCommands(group.commands ?? [], {
            id: group.id,
            name: group.name,
            prefix: `档案命令组 ${group.name}`,
          })
        );
        const groupCommands = get().sessionGroups
          .filter((group) => group.sessionIds.includes(sessionId))
          .flatMap((group) => cloneScopedInitCommands(group.initCommands ?? [], {
            id: group.id,
            name: group.name,
            prefix: `会话组 ${group.name}`,
          }));
        const mergedCommands = [...DEFAULT_INIT_COMMANDS, ...profileCommands, ...groupCommands];

        let failedCount = 0;
        let blockingFailure = false;
        let lastError = '';

        const executeBootstrapCommand = async (command: InitCommandTemplate) => {
          const activeContext = get().nodeContexts[sessionId];
          if (!activeContext || activeContext.connectionEpoch !== connectionEpoch) {
            return null;
          }
          const result = await get().captureContextCommand(sessionId, {
            source: 'init',
            name: command.name,
            command: command.command,
            captureVar: command.captureVar,
            capturePattern: command.capturePattern,
            timeout: command.timeout,
            continueOnFailure: command.continueOnFailure,
          });
          return { command, result };
        };

        const applyBootstrapResult = (
          command: InitCommandTemplate,
          result: {
            stdout: string;
            stderr: string;
            exitCode: number;
            durationMs: number;
            extractedVars: Record<string, string>;
          }
        ) => {
          if (result.exitCode !== 0) {
            failedCount += 1;
            lastError = result.stderr || result.stdout || `${command.name} 执行失败`;
            if (!command.continueOnFailure) {
              blockingFailure = true;
            }
          }
        };

        for (let index = 0; index < mergedCommands.length; index += 1) {
          const command = mergedCommands[index];
          const activeContext = get().nodeContexts[sessionId];
          if (!activeContext || activeContext.connectionEpoch !== connectionEpoch) {
            return;
          }

          const groupId = String(command.parallelGroup || '');
          if (groupId) {
            const group: InitCommandTemplate[] = [command];
            let cursor = index + 1;
            while (cursor < mergedCommands.length) {
              const candidate = mergedCommands[cursor];
              if (String(candidate?.parallelGroup || '') !== groupId) break;
              group.push(candidate);
              cursor += 1;
            }

            // 默认上下文采集互不依赖，合并并发能明显缩短“登录后可定位”的等待时间。
            const results = await Promise.all(group.map((item) => executeBootstrapCommand(item)));
            index = cursor - 1;

            for (const item of results) {
              const latestContext = get().nodeContexts[sessionId];
              if (!latestContext || latestContext.connectionEpoch !== connectionEpoch) {
                return;
              }
              if (!item) continue;
              applyBootstrapResult(item.command, item.result);
              if (blockingFailure) break;
            }
            if (blockingFailure) {
              break;
            }
            continue;
          }

          const executed = await executeBootstrapCommand(command);
          if (!executed) return;
          applyBootstrapResult(command, executed.result);
          if (blockingFailure) break;
        }

        set((s) => {
          const current = s.nodeContexts[sessionId];
          if (!current || current.connectionEpoch !== connectionEpoch) return {};
          const bootstrapStatus: BootstrapStatus =
            blockingFailure ? 'failed'
              : failedCount > 0 ? 'partial'
              : 'success';
          return {
            nodeContexts: {
              ...s.nodeContexts,
              [sessionId]: {
                ...current,
                bootstrapStatus,
                bootstrapError: lastError || undefined,
                updatedAt: Date.now(),
              },
            },
          };
        });

        if (failedCount > 0) {
          addSessionJournalEvent(sessionId, '上下文初始化异常', lastError || `初始化采集失败 ${failedCount} 项`);
        } else {
          const exportedVarCount = Object.keys(get().nodeContexts[sessionId]?.vars ?? {}).length;
          addSessionJournalEvent(
            sessionId,
            '上下文初始化完成',
            `已完成 ${mergedCommands.length} 条初始化采集命令${exportedVarCount > 0 ? ` · ${exportedVarCount} 个 shell 变量可直接复用` : ''}`
          );
        }
      },

      subscribeToSessionLines: (sessionId, cb) => {
        set((s) => {
          const arr = s.termLineListeners[sessionId] || [];
          return { termLineListeners: { ...s.termLineListeners, [sessionId]: [...arr, cb] } };
        });
        return () => {
          set((s) => {
            const arr = s.termLineListeners[sessionId] || [];
            return { termLineListeners: { ...s.termLineListeners, [sessionId]: arr.filter(x => x !== cb) } };
          });
        };
      },

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

      connectSession: (sessionId, { credentialId, passphrase, password, agent, jumpPassphrase, jumpPassword, jumpAgent, cols = 220, rows = 50 }) => {
        const session = get().sessions.find((s) => s.id === sessionId);
        const profile = get().profiles.find(
          (p) => p.id === session?.profileId
        );
        if (!session || !profile) return;

        const failConnection = (statusMsg: string) => {
          set((s) => ({
            sessions: s.sessions.map((x) =>
              x.id === sessionId ? { ...x, status: 'error', statusMsg } : x
            ),
          }));
          addSessionJournalEvent(sessionId, '连接配置异常', statusMsg);
        };

        let targetUser = profile.username ?? '';
        let targetAuth = profile.authType ?? 'password';
        let targetKey  = profile.keyFilePath;
        let targetPass = password || profile.password;

        const effectiveCredId = credentialId || profile.credentialId;
        if (effectiveCredId) {
          const cred = get().credentials.find(c => c.id === effectiveCredId);
          if (cred) {
            targetUser = cred.username;
            targetAuth = cred.authType;
            targetKey = cred.keyFilePath;
            targetPass = cred.password || profile.password || password;
          } else {
            failConnection('绑定的登录凭证已不存在，请重新绑定凭证后再连接');
            return;
          }
        }
        if (!targetUser.trim()) {
          failConnection('连接档案缺少用户名，请补充用户名或重新绑定凭证');
          return;
        }

        let jumpHostConfig = undefined;
        if (profile.jumpHostProfileId) {
          const jp = get().profiles.find(p => p.id === profile.jumpHostProfileId);
          if (jp) {
            let jpUser = jp.username ?? '';
            let jpAuth = jp.authType ?? 'password';
            let jpKey = jp.keyFilePath;
            let jpPass = jumpPassword || jp.password;

            if (jp.credentialId) {
               const jc = get().credentials.find(c => c.id === jp.credentialId);
               if (jc) {
                 jpUser = jc.username; jpAuth = jc.authType; jpKey = jc.keyFilePath; jpPass = jc.password || jp.password || jumpPassword;
               } else {
                 failConnection(`跳板机档案「${jp.name}」绑定的凭证已不存在，请重新绑定后再连接`);
                 return;
               }
            }
            if (!jpUser.trim()) {
              failConnection(`跳板机档案「${jp.name}」缺少用户名，请补充用户名或重新绑定凭证`);
              return;
            }

            jumpHostConfig = {
              host: jp.host, port: jp.port, username: jpUser,
              authType: jpAuth, keyFilePath: jpKey,
              passphrase: jumpPassphrase, password: jpPass, agent: jumpAgent
            };
          }
        }

        const rt = getRT(sessionId);
        flushPendingManualCommand(sessionId);
        rt.disconnectRequested = false;
        rt.ws?.close();
        set((s) => ({ nodeContexts: omitKey(s.nodeContexts, sessionId) }));

        const socket = new WebSocket(PROXY_WS);
        rt.ws = socket;

        socket.onopen = () => {
          rt.disconnectRequested = false;
          socket.send(JSON.stringify({
            type: 'connect',
            sessionId,
            host: profile.host, port: profile.port, username: targetUser,
            authType: targetAuth, keyFilePath: targetKey,
            passphrase, password: targetPass, agent, cols, rows,
            jumpHost: jumpHostConfig,
          }));
        };

        socket.onmessage = makeWSHandler(sessionId, set as Parameters<typeof makeWSHandler>[1], get);
        socket.onclose   = () => {
          const prevSession = get().sessions.find((x) => x.id === sessionId);
          const wasRequested = rt.disconnectRequested;
          rt.disconnectRequested = false;
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status: 'disconnected', statusMsg: '' } : x
          ),
        }));
        get().clearNodeContext(sessionId);
        if (!wasRequested && prevSession?.status === 'connected') {
          addSessionJournalEvent(sessionId, '连接已关闭', 'SSH 会话连接已断开');
        }
      };
        socket.onerror = () => {
          const prevSession = get().sessions.find((x) => x.id === sessionId);
          set((s) => ({
            sessions: s.sessions.map((x) =>
              x.id === sessionId ? { ...x, status: 'error', statusMsg: '无法连接到 SSH Proxy' } : x
            ),
          }));
          if (prevSession?.status !== 'error') {
            addSessionJournalEvent(sessionId, '连接异常', '无法连接到 SSH Proxy');
          }
        };

        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status: 'connecting', statusMsg: `连接中…` } : x
          ),
        }));
      },

      disconnectSession: (sessionId) => {
        const rt = runtimes.get(sessionId);
        flushPendingManualCommand(sessionId);
        if (rt) rt.disconnectRequested = true;
        rt?.ws?.send(JSON.stringify({ type: 'disconnect' }));
        rt?.ws?.close();
        if (rt) rt.ws = null;
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status: 'idle', statusMsg: '' } : x
          ),
          nodeContexts: omitKey(s.nodeContexts, sessionId),
        }));
        addSessionJournalEvent(sessionId, '用户主动断开', '会话已主动断开');
      },

      sendInputToSession:  (sessionId, data) =>
        runtimes.get(sessionId)?.ws?.send(JSON.stringify({ type: 'data', data })),

      resizeSession: (sessionId, cols, rows) =>
        runtimes.get(sessionId)?.ws?.send(JSON.stringify({ type: 'resize', cols, rows })),

      // ── 单会话独立命令（exec 通道） ───────────────────────────────────────

      execCommandOnSession: (sessionId, cmd, timeout = 30000, options) =>
        new Promise((resolve) => {
          const rt  = getRT(sessionId);
          const id  = generateId();
          const startTime = Date.now();
          const shouldJournal = options?.journal !== false;
          let settled = false;

          const settle = (result: { stdout: string; stderr: string; exitCode: number; durationMs: number }) => {
            if (settled) return;
            settled = true;
            if (shouldJournal) {
              addQuickExecJournalEntry(sessionId, cmd, result, startTime);
            }
            resolve(result);
          };

          if (!rt.ws || rt.ws.readyState !== WebSocket.OPEN) {
            settle({ stdout: '', stderr: '[DISCONNECTED]', exitCode: -1, durationMs: 0 });
            return;
          }

          const timer = setTimeout(() => {
            rt.execResolvers.delete(id);
            settle({ stdout: '', stderr: '[TIMEOUT]', exitCode: -1, durationMs: Date.now() - startTime });
          }, timeout + 1000);

          rt.execResolvers.set(id, (r) => {
            clearTimeout(timer);
            settle(r);
          });

          rt.ws.send(JSON.stringify({ type: 'exec', cmd, id, timeout }));
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

      // ── 调度器专用：独立 planId 路由，不干扰 multiNodeRun ─────────────────

      executeSOPPlanForScheduler: (sessionId, steps, onStep) =>
        new Promise((resolve) => {
          const rt = getRT(sessionId);
          if (!rt.ws || rt.ws.readyState !== WebSocket.OPEN) {
            resolve({ success: false, results: {}, error: '会话未连接' });
            return;
          }

          const planId = generateId();
          const PLAN_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟超时

          const cb: SchedulerPlanCallback = {
            stepResults: {},
            onStep,
            resolve,
          };
          schedulerPlanCallbacks.set(planId, cb);

          // 超时保护：避免 planDone 永远不到达时内存泄漏
          setTimeout(() => {
            if (!schedulerPlanCallbacks.has(planId)) return;
            schedulerPlanCallbacks.delete(planId);
            resolve({ success: false, results: cb.stepResults, error: '执行超时 (30 min)' });
          }, PLAN_TIMEOUT_MS);

          rt.ws.send(JSON.stringify({
            type:  'exec_plan',
            id:    planId,
            steps: steps.map((s) => ({
              id: s.id, cmd: s.cmd, name: s.name,
              captureVar: s.captureVar, capturePattern: s.capturePattern,
              normalRegex: s.normalRegex, abnormalRegex: s.abnormalRegex,
              scriptPath: s.scriptPath, timeout: s.timeout,
            })),
          }));
        }),

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
        credentials:     s.credentials,
        profiles:        s.profiles,
        commandPresetGroups: s.commandPresetGroups,
        sessions:        s.sessions,
        sessionGroups:   s.sessionGroups,
        activeSessionId: s.activeSessionId,
      }),
    }
  )
);
