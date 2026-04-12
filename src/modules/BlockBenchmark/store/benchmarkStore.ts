import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

interface BenchmarkStore {
  agents: AgentStatus[];
  fetchAgents: () => Promise<void>;

  tasks: BenchmarkTask[];
  fetchTasks: () => Promise<void>;

  startTask: (payload: any) => Promise<void>;
  startIOSession: (payload: any) => Promise<void>;

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
        } catch (e) {
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
        } catch (e) {}
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
    }),
    {
      name: 'benchmark-store',
      // Persist models and agent mappings, NOT the transient scan state
      partialize: (state) => ({
        savedModels: state.savedModels,
        agentMappings: state.agentMappings,
      }),
    }
  )
);
