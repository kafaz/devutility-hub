import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import type {
  BusinessTemplate,
  BusinessExecution,
  StepResult,
  ChaosFault,
  ChaosInjection,
  TracedTask,
  IostatMetrics,
  IOMetricsSnapshot,
  ConsistencyCheck,
} from '../types';

export interface AgentStatus {
  id: string;
  ip: string;
  status: 'online' | 'offline';
  last_heartbeat: string;
}

export interface BenchmarkTask {
  id: string;
  agent_id: string;
  task_type: string;
  status: string;
  created_at: string;
  session_id?: string;
  pid?: string;
  device?: string;
  io_model?: string;
  business_name?: string;
  log_path?: string;
  last_checked_at?: string;
}

export interface WriteTestPayload {
  agent_id: string;
  task_type: 'WRITE_TEST';
  business_name: string;
  dispatch_count: number;
  params: {
    device: string;
    volume_id: string;
    lba: string;
    block_size: string;
    io_model: string;
    concurrency: string;
    iterations: string;
    read_verify: string;
    fio_engine?: string;
    workload_profile?: string;
    iodepth?: string;
  };
}

export interface IOModelConfig {
  id: string;
  name: string;
  io_model: 'sync' | 'direct' | 'fio' | 'simulated';
  block_size: string;
  concurrency?: string;
  iterations?: string;
  fio_engine?: string;
  workload_profile?: string;
  iodepth?: string;
}

// FIX-1: Shared disk topology state (moved from local useState in useDiskDiscovery)
export interface DiscoveredDisk {
  name: string;
  type: string;
  size: number;
  mountpoint: string | null;
  pkname: string | null;
  model?: string;
}

export interface NodeDisks {
  sessionId: string;
  disks: DiscoveredDisk[];
  lastScan: number;
}

// FIX-2: SSH SessionId → Block Benchmark Agent ID mapping
export interface AgentMapping {
  sshSessionId: string;   // SSH Store session UUID
  bbAgentId: string;      // Block Benchmark agent ID, e.g. "node-a"
  label: string;          // Human readable label
}

export const BUILTIN_CHAOS_FAULTS: ChaosFault[] = [
  {
    id: 'net_delay',
    name: 'Network Delay',
    category: 'network',
    description: 'network delay via tc qdisc',
    cmdTemplate: 'tc qdisc add dev ${interface} root netem delay ${delay}ms',
    params: [
      { name: 'interface', label: 'Interface', defaultValue: 'eth0', required: true },
      { name: 'delay', label: 'Delay (ms)', defaultValue: '100', required: true },
    ],
    recoveryCmdTemplate: 'tc qdisc del dev ${interface} root',
    recoveryParams: [
      { name: 'interface', label: 'Interface', defaultValue: 'eth0', required: true },
    ],
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'net_loss',
    name: 'Network Loss',
    category: 'network',
    description: 'network loss via tc qdisc',
    cmdTemplate: 'tc qdisc add dev ${interface} root netem loss ${loss}%',
    params: [
      { name: 'interface', label: 'Interface', defaultValue: 'eth0', required: true },
      { name: 'loss', label: 'Loss (%)', defaultValue: '10', required: true },
    ],
    recoveryCmdTemplate: 'tc qdisc del dev ${interface} root',
    recoveryParams: [
      { name: 'interface', label: 'Interface', defaultValue: 'eth0', required: true },
    ],
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'io_stuck',
    name: 'IO Stuck',
    category: 'disk',
    description: 'IO stuck via sys/block timeout',
    cmdTemplate: 'echo ${timeout} > /sys/block/${device}/queue/io_timeout',
    params: [
      { name: 'device', label: 'Device', defaultValue: 'sda', required: true },
      { name: 'timeout', label: 'Timeout (ms)', defaultValue: '30000', required: true },
    ],
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'cpu_stress',
    name: 'CPU Stress',
    category: 'cpu',
    description: 'CPU stress via stress-ng',
    cmdTemplate: 'stress-ng --cpu ${workers} --cpu-load ${load} --timeout ${duration}s',
    params: [
      { name: 'workers', label: 'Workers', defaultValue: '4', required: true },
      { name: 'load', label: 'Load (%)', defaultValue: '80', required: true },
      { name: 'duration', label: 'Duration (s)', defaultValue: '60', required: true },
    ],
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'proc_kill',
    name: 'Process Kill',
    category: 'process',
    description: 'process kill via kill -9',
    cmdTemplate: 'kill -9 ${pid}',
    params: [
      { name: 'pid', label: 'PID', required: true },
    ],
    defaultDurationSec: 0,
    isBuiltin: true,
  },
  {
    id: 'disk_ro',
    name: 'Disk Read-Only',
    category: 'disk',
    description: 'disk read-only via blockdev',
    cmdTemplate: 'blockdev --setro ${device}',
    params: [
      { name: 'device', label: 'Device', defaultValue: '/dev/sda', required: true },
    ],
    recoveryCmdTemplate: 'blockdev --setrw ${device}',
    recoveryParams: [
      { name: 'device', label: 'Device', defaultValue: '/dev/sda', required: true },
    ],
    defaultDurationSec: 60,
    isBuiltin: true,
  },
];

export const BUILTIN_CONSISTENCY_CHECKS: ConsistencyCheck[] = [
  {
    id: 'crc_check',
    name: 'CRC Check',
    checkType: 'crc',
    nodeIds: [],
    cmdTemplate: 'md5sum ${device}',
    params: { device: '' },
    status: 'pending',
    triggeredAt: 0,
  },
  {
    id: 'lba_cmp',
    name: 'LBA Compare',
    checkType: 'lba_range',
    nodeIds: [],
    cmdTemplate: 'dd if=${device} bs=${bs} count=${count} skip=${skip} | md5sum',
    params: { device: '', bs: '4k', count: '1024', skip: '0' },
    status: 'pending',
    triggeredAt: 0,
  },
  {
    id: 'meta_cmp',
    name: 'Metadata Compare',
    checkType: 'metadata',
    nodeIds: [],
    cmdTemplate: 'rbd info ${image} --format json',
    params: { image: '' },
    status: 'pending',
    triggeredAt: 0,
  },
];

function quoteShellArg(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function normalizeJobName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.-]+/g, '-');
  return normalized || 'block-benchmark';
}

function resolveSessionIdForAgent(agentId: string, mappings: AgentMapping[]): string | null {
  const { sessions } = useSSHStore.getState();
  const mapped = mappings.find((item) => item.bbAgentId === agentId);
  if (mapped) return mapped.sshSessionId;

  const bySessionId = sessions.find((session) => session.id === agentId);
  if (bySessionId) return bySessionId.id;

  const bySessionName = sessions.find((session) => session.name === agentId);
  return bySessionName?.id ?? null;
}

function buildAgentSnapshot(mappings: AgentMapping[]): AgentStatus[] {
  const { sessions, profiles } = useSSHStore.getState();

  return sessions.map((session) => {
    const mapping = mappings.find((item) => item.sshSessionId === session.id);
    const profile = profiles.find((item) => item.id === session.profileId);

    return {
      id: mapping?.bbAgentId ?? session.name,
      ip: profile?.host ?? '',
      status: session.status === 'connected' ? 'online' : 'offline',
      last_heartbeat: new Date(session.connectedAt ?? Date.now()).toISOString(),
    };
  });
}

function buildBenchmarkCommand(payload: WriteTestPayload): string {
  const { params } = payload;
  const jobName = normalizeJobName(payload.business_name || `${payload.agent_id}-${params.device}`);

  if (params.io_model === 'simulated') {
    return [
      'bash -lc',
      quoteShellArg(
        [
          `echo "[simulated] ${jobName} -> ${params.device}"`,
          'sleep 1',
          'echo "[simulated] completed"',
        ].join(' && ')
      ),
    ].join(' ');
  }

  const ioengine =
    params.fio_engine ||
    (params.io_model === 'sync' ? 'sync' : params.io_model === 'direct' ? 'libaio' : 'libaio');
  const rw = params.workload_profile || 'write';
  const direct = params.io_model === 'sync' ? '0' : '1';
  const iodepth = params.iodepth || (params.io_model === 'sync' ? '1' : params.concurrency || '1');

  const args = [
    'fio',
    `--name=${quoteShellArg(jobName)}`,
    `--filename=${quoteShellArg(params.device)}`,
    `--ioengine=${quoteShellArg(ioengine)}`,
    `--rw=${quoteShellArg(rw)}`,
    `--bs=${quoteShellArg(params.block_size || '4k')}`,
    `--numjobs=${quoteShellArg(params.concurrency || '1')}`,
    `--iodepth=${quoteShellArg(iodepth)}`,
    `--number_ios=${quoteShellArg(params.iterations || '1')}`,
    `--offset=${quoteShellArg(params.lba || '0')}`,
    `--direct=${direct}`,
    '--group_reporting=1',
  ];

  if (params.read_verify === 'true') {
    args.push('--verify=md5', '--verify_fatal=1');
  }

  return args.join(' ');
}

interface BenchmarkStore {
  agents: AgentStatus[];
  fetchAgents: () => Promise<void>;

  tasks: BenchmarkTask[];
  fetchTasks: () => Promise<void>;

  startTask: (payload: WriteTestPayload) => Promise<void>;
  startIOSession: (payload: WriteTestPayload) => Promise<void>;

  savedModels: IOModelConfig[];
  addModel: (model: IOModelConfig) => void;
  removeModel: (id: string) => void;
  setModels: (models: IOModelConfig[]) => void;

  // FIX-1: Shared topology state
  discoveredNodes: Record<string, NodeDisks>;
  setDiscoveredNodes: (nodes: Record<string, NodeDisks>) => void;
  isScanning: boolean;
  setIsScanning: (v: boolean) => void;

  // FIX-2: Agent ID mappings
  agentMappings: AgentMapping[];
  addAgentMapping: (m: AgentMapping) => void;
  removeAgentMapping: (sshSessionId: string) => void;
  updateAgentMapping: (sshSessionId: string, bbAgentId: string, label: string) => void;
  getBBAgentId: (sshSessionId: string) => string;

  // Business Orchestration
  businessTemplates: BusinessTemplate[];
  addBusinessTemplate: (template: BusinessTemplate) => void;
  removeBusinessTemplate: (id: string) => void;
  updateBusinessTemplate: (id: string, updates: Partial<BusinessTemplate>) => void;

  businessExecutions: BusinessExecution[];
  addBusinessExecution: (execution: BusinessExecution) => void;
  updateBusinessExecution: (id: string, updates: Partial<BusinessExecution>) => void;
  upsertBusinessExecutionStepResult: (
    executionId: string,
    nodeId: string,
    result: StepResult,
    sharedVars?: Record<string, string>
  ) => void;

  // Chaos Injection
  chaosFaults: ChaosFault[];
  chaosInjections: ChaosInjection[];
  addChaosFault: (fault: ChaosFault) => void;
  removeChaosFault: (id: string) => void;
  addChaosInjection: (injection: ChaosInjection) => void;
  updateChaosInjection: (id: string, updates: Partial<ChaosInjection>) => void;

  // Task Tracing
  tracedTasks: TracedTask[];
  addTracedTask: (task: Omit<TracedTask, 'id'>) => string;
  updateTracedTask: (id: string, updates: Partial<TracedTask>) => void;
  removeTracedTask: (id: string) => void;
  appendLogBuffer: (taskId: string, pathId: string, lines: string[]) => void;
  replaceLogBuffer: (taskId: string, pathId: string, lines: string[]) => void;

  // IO Monitoring
  ioSnapshots: IOMetricsSnapshot[];
  updateIOSnapshot: (key: string, metrics: IostatMetrics) => void;
  clearIOSnapshots: () => void;

  // Consistency Analysis
  consistencyChecks: ConsistencyCheck[];
  addConsistencyCheck: (check: ConsistencyCheck) => void;
  updateConsistencyCheck: (id: string, updates: Partial<ConsistencyCheck>) => void;
  removeConsistencyCheck: (id: string) => void;
}

export const useBenchmarkStore = create<BenchmarkStore>()(
  persist(
    (set, get) => ({
      agents: [],
      fetchAgents: async () => {
        set({ agents: buildAgentSnapshot(get().agentMappings) });
      },

      tasks: [],
      fetchTasks: async () => {
        const { execCommandOnSession } = useSSHStore.getState();
        const runningTasks = get().tasks.filter(
          (task) => task.status === 'running' && task.session_id && task.pid
        );

        if (runningTasks.length === 0) return;

        const updates = await Promise.all(
          runningTasks.map(async (task) => {
            try {
              const res = await execCommandOnSession(
                task.session_id!,
                `ps -p ${task.pid} > /dev/null; echo $?`,
                10000,
                { journal: false }
              );
              const probe = res.stdout.trim().split(/\s+/).pop();
              return {
                id: task.id,
                status: probe === '0' ? 'running' : 'completed',
                last_checked_at: new Date().toISOString(),
              };
            } catch {
              return {
                id: task.id,
                status: 'unknown',
                last_checked_at: new Date().toISOString(),
              };
            }
          })
        );

        set((state) => ({
          tasks: state.tasks.map((task) => {
            const update = updates.find((item) => item.id === task.id);
            return update ? { ...task, ...update } : task;
          }),
        }));
      },

      startTask: async (payload) => {
        const sessionId = resolveSessionIdForAgent(payload.agent_id, get().agentMappings);
        if (!sessionId) {
          throw new Error(`找不到 Agent ID ${payload.agent_id} 对应的 SSH 会话`);
        }

        const { execCommandOnSession } = useSSHStore.getState();
        const taskId = generateId();
        const logPath = `/tmp/devutility-benchmark-${taskId}.log`;
        const launchCmd = `nohup sh -lc ${quoteShellArg(buildBenchmarkCommand(payload))} > ${quoteShellArg(logPath)} 2>&1 & echo $!`;
        const res = await execCommandOnSession(sessionId, launchCmd, 15000);
        const pid = res.stdout.trim().split(/\s+/).pop() ?? '';

        if (!/^\d+$/.test(pid)) {
          throw new Error(`任务启动失败，未返回有效 PID: ${res.stdout.trim() || '(empty stdout)'}`);
        }

        const createdAt = new Date().toISOString();
        set((state) => ({
          tasks: [
            {
              id: taskId,
              agent_id: payload.agent_id,
              task_type: payload.params.workload_profile || payload.params.io_model,
              status: 'running',
              created_at: createdAt,
              session_id: sessionId,
              pid,
              device: payload.params.device,
              io_model: payload.params.io_model,
              business_name: payload.business_name,
              log_path: logPath,
              last_checked_at: createdAt,
            },
            ...state.tasks,
          ],
        }));
      },

      startIOSession: async (payload) => {
        await get().startTask(payload);
      },

      savedModels: [],
      addModel: (model) => set((s) => ({ savedModels: [...s.savedModels, model] })),
      removeModel: (id) => set((s) => ({ savedModels: s.savedModels.filter((m) => m.id !== id) })),
      setModels: (models) => set({ savedModels: models }),

      // FIX-1
      discoveredNodes: {},
      setDiscoveredNodes: (nodes) => set({ discoveredNodes: nodes }),
      isScanning: false,
      setIsScanning: (v) => set({ isScanning: v }),

      // FIX-2
      agentMappings: [],
      addAgentMapping: (m) =>
        set((s) => ({ agentMappings: [...s.agentMappings.filter((x) => x.sshSessionId !== m.sshSessionId), m] })),
      removeAgentMapping: (sshSessionId) =>
        set((s) => ({ agentMappings: s.agentMappings.filter((m) => m.sshSessionId !== sshSessionId) })),
      updateAgentMapping: (sshSessionId, bbAgentId, label) =>
        set((s) => ({
          agentMappings: s.agentMappings.map((m) =>
            m.sshSessionId === sshSessionId ? { ...m, bbAgentId, label } : m
          ),
        })),
      // Returns the Block Benchmark agent ID for a given SSH session, falls back to sessionId
      getBBAgentId: (sshSessionId) => {
        const mapping = get().agentMappings.find((m) => m.sshSessionId === sshSessionId);
        return mapping?.bbAgentId || sshSessionId;
      },

      // Business Orchestration
      businessTemplates: [],
      addBusinessTemplate: (template) =>
        set((s) => ({ businessTemplates: [...s.businessTemplates, template] })),
      removeBusinessTemplate: (id) =>
        set((s) => ({ businessTemplates: s.businessTemplates.filter((t) => t.id !== id) })),
      updateBusinessTemplate: (id, updates) =>
        set((s) => ({
          businessTemplates: s.businessTemplates.map((t) =>
            t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
          ),
        })),

      businessExecutions: [],
      addBusinessExecution: (execution) =>
        set((s) => ({ businessExecutions: [...s.businessExecutions, execution] })),
      updateBusinessExecution: (id, updates) =>
        set((s) => ({
          businessExecutions: s.businessExecutions.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),
      upsertBusinessExecutionStepResult: (executionId, nodeId, result, sharedVars) =>
        set((s) => ({
          businessExecutions: s.businessExecutions.map((execution) => {
            if (execution.id !== executionId) return execution;

            const nodeResults = execution.stepResults[nodeId] ?? [];
            const existingIndex = nodeResults.findIndex((item) => item.stepId === result.stepId);
            const nextNodeResults =
              existingIndex === -1
                ? [...nodeResults, result]
                : nodeResults.map((item, index) => (index === existingIndex ? result : item));

            return {
              ...execution,
              stepResults: {
                ...execution.stepResults,
                [nodeId]: nextNodeResults,
              },
              ...(sharedVars
                ? { sharedVars: { ...execution.sharedVars, ...sharedVars } }
                : {}),
            };
          }),
        })),

      // Chaos Injection
      chaosFaults: [...BUILTIN_CHAOS_FAULTS],
      chaosInjections: [],
      addChaosFault: (fault) =>
        set((s) => ({ chaosFaults: [...s.chaosFaults, fault] })),
      removeChaosFault: (id) =>
        set((s) => ({ chaosFaults: s.chaosFaults.filter((f) => f.id !== id) })),
      addChaosInjection: (injection) =>
        set((s) => ({ chaosInjections: [...s.chaosInjections, injection] })),
      updateChaosInjection: (id, updates) =>
        set((s) => ({
          chaosInjections: s.chaosInjections.map((i) =>
            i.id === id ? { ...i, ...updates } : i
          ),
        })),

      // Task Tracing
      tracedTasks: [],
      addTracedTask: (task) => {
        const id = generateId();
        set((s) => ({ tracedTasks: [...s.tracedTasks, { ...task, id }] }));
        return id;
      },
      updateTracedTask: (id, updates) =>
        set((s) => ({
          tracedTasks: s.tracedTasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        })),
      removeTracedTask: (id) =>
        set((s) => ({ tracedTasks: s.tracedTasks.filter((t) => t.id !== id) })),
      appendLogBuffer: (taskId, pathId, lines) =>
        set((s) => ({
          tracedTasks: s.tracedTasks.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              logPaths: t.logPaths.map((lp) => {
                if (lp.id !== pathId) return lp;
                const combined = [...(lp.buffer || []), ...lines];
                return { ...lp, buffer: combined.slice(-500) };
              }),
            };
          }),
        })),
      replaceLogBuffer: (taskId, pathId, lines) =>
        set((s) => ({
          tracedTasks: s.tracedTasks.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              logPaths: t.logPaths.map((lp) => (
                lp.id === pathId ? { ...lp, buffer: lines.slice(-500) } : lp
              )),
            };
          }),
        })),

      // IO Monitoring
      ioSnapshots: [],
      updateIOSnapshot: (key, metrics) =>
        set((s) => {
          const existingIndex = s.ioSnapshots.findIndex((x) => x.key === key);
          if (existingIndex === -1) {
            return {
              ioSnapshots: [
                ...s.ioSnapshots,
                {
                  key,
                  sessionId: key.split('::')[0] ?? '',
                  sessionName: '',
                  diskName: key.split('::')[1] ?? '',
                  latest: metrics,
                  history: [metrics],
                },
              ],
            };
          }
          const updated = s.ioSnapshots.map((x, i) => {
            if (i !== existingIndex) return x;
            const history = [...x.history, metrics];
            if (history.length > 120) history.shift();
            return {
              key,
              sessionId: x.sessionId,
              sessionName: x.sessionName,
              diskName: x.diskName,
              latest: metrics,
              history,
            };
          });
          return { ioSnapshots: updated };
        }),
      clearIOSnapshots: () => set({ ioSnapshots: [] }),

      // Consistency Analysis
      consistencyChecks: [...BUILTIN_CONSISTENCY_CHECKS],
      addConsistencyCheck: (check) =>
        set((s) => ({ consistencyChecks: [...s.consistencyChecks, check] })),
      updateConsistencyCheck: (id, updates) =>
        set((s) => ({
          consistencyChecks: s.consistencyChecks.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),
      removeConsistencyCheck: (id) =>
        set((s) => ({ consistencyChecks: s.consistencyChecks.filter((c) => c.id !== id) })),
    }),
    {
      name: 'benchmark-store',
      // Persist models and agent mappings, NOT the transient scan state
      partialize: (state) => ({
        savedModels: state.savedModels,
        agentMappings: state.agentMappings,
        businessTemplates: state.businessTemplates,
        chaosFaults: state.chaosFaults,
        consistencyChecks: state.consistencyChecks,
      }),
    }
  )
);
