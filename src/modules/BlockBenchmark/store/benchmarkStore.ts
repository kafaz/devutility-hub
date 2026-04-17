import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';
import type {
  BusinessTemplate,
  BusinessExecution,
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
        try {
          const res = await fetch('/benchmark-api/agents');
          if (!res.ok) return;
          const data = await res.json();
          set({ agents: Array.isArray(data) ? data : [] });
        } catch {
          // controller not reachable
        }
      },

      tasks: [],
      fetchTasks: async () => {
        try {
          const res = await fetch('/benchmark-api/dashboard');
          if (!res.ok) return;
          const data = await res.json();
          set({ tasks: data.recent_tasks || [] });
        } catch {
          // ignore fetch errors
        }
      },

      startTask: async (payload) => {
        const res = await fetch('/benchmark-api/tasks/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Task start failed');
      },

      startIOSession: async (payload) => {
        const res = await fetch('/benchmark-api/io/sessions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Session start failed');
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
