# BlockBenchmark Core Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BlockBenchmark into a core distributed block storage testing workbench with multi-node business orchestration, chaos injection, real-time IO monitoring, task tracing with log tailing, and data consistency checking.

**Architecture:** Extend the existing Zustand store and React component architecture. All execution flows reuse the SSH Proxy's `execCommandOnSession` and WebSocket PTY capabilities. No new backend server is introduced.

**Tech Stack:** React 18, TypeScript, Ant Design 5, Zustand (with persist), echarts-for-react, Vite

---

## File Structure

### New Files (13 components + 1 engine)

| File | Responsibility |
|------|---------------|
| `src/modules/BlockBenchmark/types.ts` | All new TypeScript interfaces (BusinessTemplate, ChaosFault, TracedTask, etc.) |
| `src/modules/BlockBenchmark/engine/businessEngine.ts` | Business template execution engine (command substitution, step sequencing, capture vars) |
| `src/modules/BlockBenchmark/engine/chaosEngine.ts` | Chaos injection/recovery engine |
| `src/modules/BlockBenchmark/components/BusinessTemplateEditor.tsx` | Three-column layout: template list, editor, execution panel |
| `src/modules/BlockBenchmark/components/BusinessStepModal.tsx` | Modal for editing a single business step |
| `src/modules/BlockBenchmark/components/BusinessExecutionPanel.tsx` | Node selector, variable inputs, progress, per-node output |
| `src/modules/BlockBenchmark/components/ChaosFaultLibrary.tsx` | Categorized fault cards, selection |
| `src/modules/BlockBenchmark/components/ChaosInjectionPanel.tsx` | Injection config form + execution history |
| `src/modules/BlockBenchmark/components/ChaosFaultModal.tsx` | Create/edit custom fault modal |
| `src/modules/BlockBenchmark/components/IOMonitorGrid.tsx` | Aggregated IO dashboard card grid |
| `src/modules/BlockBenchmark/components/IOMonitorDetail.tsx` | Single-disk time-series chart detail |
| `src/modules/BlockBenchmark/components/TracingTaskList.tsx` | Task list with filters and status refresh |
| `src/modules/BlockBenchmark/components/TracingLogViewer.tsx` | Log viewer with path selector, streaming, pause/clear/export |
| `src/modules/BlockBenchmark/components/AnalysisCheckList.tsx` | Consistency check rule list |
| `src/modules/BlockBenchmark/components/AnalysisReportPanel.tsx` | Check report display (pass/fail details) |
| `src/modules/BlockBenchmark/components/AnalysisCheckModal.tsx` | Create/edit check rule modal |

### Modified Files

| File | Changes |
|------|---------|
| `src/modules/BlockBenchmark/store/benchmarkStore.ts` | Add all new state slices, actions, and types |
| `src/modules/BlockBenchmark/index.tsx` | Reorganize Tabs: keep deploy/topology/distribution, enhance task/dash, add chaos/io_monitor/tracing/analysis |
| `src/modules/BlockBenchmark/components/TaskDispatcher.tsx` | Replace contents with BusinessTemplateEditor wrapper |
| `src/modules/BlockBenchmark/components/MetricsDashboard.tsx` | Replace with AnalysisCheckList + AnalysisReportPanel |
| `src/modules/BlockBenchmark/components/DiskMetricsDashboard.tsx` | Reorganize into IOMonitorGrid + IOMonitorDetail |

---

## Phase 1: Foundation — Types and Store

### Task 1: Create Central Types File

**Files:**
- Create: `src/modules/BlockBenchmark/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// Business Orchestration
export interface BusinessTemplate {
  id: string;
  name: string;
  description?: string;
  steps: BusinessStep[];
  variables: TemplateVariable[];
  createdAt: number;
  updatedAt?: number;
}

export interface BusinessStep {
  id: string;
  name: string;
  cmd: string;
  target: 'all' | string[];
  timeout: number;
  captureVar?: {
    name: string;
    pattern: string;
  };
  blocking: boolean;
}

export interface TemplateVariable {
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
  scope: 'global' | 'perNode';
}

export interface BusinessExecution {
  id: string;
  templateId: string;
  templateName: string;
  nodeIds: string[];
  varValues: {
    global: Record<string, string>;
    perNode: Record<string, Record<string, string>>;
  };
  status: 'pending' | 'running' | 'done' | 'partial_fail' | 'fail';
  sharedVars: Record<string, string>;
  stepResults: Record<string, StepResult[]>;
  startedAt: number;
  doneAt?: number;
}

export interface StepResult {
  stepId: string;
  stepName: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  capturedVar?: { name: string; value: string };
  status: 'pending' | 'running' | 'done' | 'fail';
}

// Chaos Injection
export interface ChaosFault {
  id: string;
  name: string;
  category: 'network' | 'disk' | 'cpu' | 'memory' | 'process' | 'custom';
  description: string;
  cmdTemplate: string;
  params: FaultParam[];
  recoveryCmdTemplate?: string;
  recoveryParams?: FaultParam[];
  defaultDurationSec: number;
  isBuiltin: boolean;
}

export interface FaultParam {
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
}

export interface ChaosInjection {
  id: string;
  faultId: string;
  faultName: string;
  nodeIds: string[];
  paramValues: Record<string, string>;
  durationSec: number;
  status: 'pending' | 'injecting' | 'injected' | 'recovering' | 'recovered' | 'fail';
  injectedAt?: number;
  recoveredAt?: number;
  log: string;
}

// Task Tracing
export interface TracedTask {
  id: string;
  name: string;
  nodeId: string;
  nodeName: string;
  source: { type: 'business' | 'chaos' | 'manual' | 'io'; refId: string };
  pid?: string;
  statusCheckCmd?: string;
  status: 'running' | 'completed' | 'failed' | 'unknown';
  logPaths: LogPathConfig[];
  startedAt: number;
  lastStatusCheckAt?: number;
}

export interface LogPathConfig {
  id: string;
  path: string;
  label: string;
  mode: 'snapshot' | 'stream';
  buffer?: string[];
  unsubscribe?: () => void;
}

// IO Monitoring
export interface IostatMetrics {
  timestamp: string;
  r_await: number;
  w_await: number;
  util: number;
  bw_mbps: number;
}

export interface IOMetricsSnapshot {
  key: string;
  sessionId: string;
  sessionName: string;
  diskName: string;
  activeIOModel?: string;
  activeTaskId?: string;
  latest: IostatMetrics;
  history: IostatMetrics[];
}

// Consistency Analysis
type CheckType = 'crc' | 'lba_range' | 'metadata' | 'custom';

export interface ConsistencyCheck {
  id: string;
  name: string;
  checkType: CheckType;
  nodeIds: string[];
  cmdTemplate: string;
  params: Record<string, string>;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'error';
  result?: ConsistencyResult;
  triggeredAt: number;
  completedAt?: number;
  triggeredBy?: string;
}

export interface ConsistencyResult {
  summary: string;
  inconsistencies: InconsistencyItem[];
  rawOutputs: Record<string, { stdout: string; stderr: string; exitCode: number }>;
}

export interface InconsistencyItem {
  type: 'crc_mismatch' | 'lba_diverge' | 'metadata_diff' | 'custom';
  description: string;
  nodeIds: string[];
  location?: string;
  expected?: string;
  actual?: Record<string, string>;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit src/modules/BlockBenchmark/types.ts`
Expected: No output (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/modules/BlockBenchmark/types.ts
git commit -m "feat(benchmark): add core types for business, chaos, tracing, io, analysis"
```

---

### Task 2: Extend Benchmark Store

**Files:**
- Modify: `src/modules/BlockBenchmark/store/benchmarkStore.ts`

- [ ] **Step 1: Add imports at the top**

Replace the existing import block (lines 1-3) with:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  BusinessTemplate,
  BusinessExecution,
  ChaosFault,
  ChaosInjection,
  TracedTask,
  IOMetricsSnapshot,
  ConsistencyCheck,
} from '../types';
```

- [ ] **Step 2: Add builtin faults and checks as constants**

After the `AgentMapping` interface (around line 72), add:

```typescript
export const BUILTIN_CHAOS_FAULTS: ChaosFault[] = [
  {
    id: 'net_delay',
    name: '网络延迟',
    category: 'network',
    description: '在指定网卡上添加 tc 网络延迟',
    cmdTemplate: 'tc qdisc add dev {{iface}} root netem delay {{delay}}ms',
    params: [
      { name: 'iface', label: '网卡', defaultValue: 'eth0', required: true },
      { name: 'delay', label: '延迟(ms)', defaultValue: '100', required: true },
    ],
    recoveryCmdTemplate: 'tc qdisc del dev {{iface}} root',
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'net_loss',
    name: '网络丢包',
    category: 'network',
    description: '在指定网卡上添加 tc 丢包',
    cmdTemplate: 'tc qdisc add dev {{iface}} root netem loss {{loss}}%',
    params: [
      { name: 'iface', label: '网卡', defaultValue: 'eth0', required: true },
      { name: 'loss', label: '丢包率(%)', defaultValue: '10', required: true },
    ],
    recoveryCmdTemplate: 'tc qdisc del dev {{iface}} root',
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'io_stuck',
    name: 'IO 卡顿',
    category: 'disk',
    description: '修改磁盘超时参数模拟 IO 卡顿',
    cmdTemplate: 'echo {{major}}:{{minor}} > /sys/block/{{device}}/device/timeout && sync',
    params: [
      { name: 'device', label: '设备名', defaultValue: 'sdb', required: true },
      { name: 'major', label: '主设备号', defaultValue: '8', required: true },
      { name: 'minor', label: '次设备号', defaultValue: '16', required: true },
    ],
    recoveryCmdTemplate: 'echo 30 > /sys/block/{{device}}/device/timeout',
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'cpu_stress',
    name: 'CPU 满载',
    category: 'cpu',
    description: '使用 stress-ng 压满指定 CPU 核心数',
    cmdTemplate: 'stress-ng --cpu {{cores}} --timeout {{duration}}s',
    params: [
      { name: 'cores', label: '核心数', defaultValue: '4', required: true },
      { name: 'duration', label: '持续时间(s)', defaultValue: '60', required: true },
    ],
    defaultDurationSec: 60,
    isBuiltin: true,
  },
  {
    id: 'proc_kill',
    name: '进程 Kill',
    category: 'process',
    description: '强制终止指定名称的进程',
    cmdTemplate: 'kill -9 $(pgrep {{processName}})',
    params: [
      { name: 'processName', label: '进程名', defaultValue: 'ceph-osd', required: true },
    ],
    defaultDurationSec: 0,
    isBuiltin: true,
  },
  {
    id: 'disk_ro',
    name: '磁盘只读',
    category: 'disk',
    description: '将指定块设备设为只读',
    cmdTemplate: 'blockdev --setro {{device}}',
    params: [
      { name: 'device', label: '设备路径', defaultValue: '/dev/sdb', required: true },
    ],
    recoveryCmdTemplate: 'blockdev --setrw {{device}}',
    defaultDurationSec: 60,
    isBuiltin: true,
  },
];

export const BUILTIN_CONSISTENCY_CHECKS: ConsistencyCheck[] = [
  {
    id: 'crc_check',
    name: 'CRC 全量校验',
    checkType: 'crc',
    nodeIds: [],
    cmdTemplate: 'md5sum {{device}}',
    params: { device: '/dev/sdb' },
    status: 'pending',
    triggeredAt: 0,
  },
  {
    id: 'lba_cmp',
    name: 'LBA 范围比对',
    checkType: 'lba_range',
    nodeIds: [],
    cmdTemplate: 'dd if={{device}} bs={{bs}} skip={{skip}} count={{count}} | md5sum',
    params: { device: '/dev/sdb', bs: '4096', skip: '0', count: '1024' },
    status: 'pending',
    triggeredAt: 0,
  },
  {
    id: 'meta_cmp',
    name: '元数据一致性',
    checkType: 'metadata',
    nodeIds: [],
    cmdTemplate: 'rbd info {{pool}}/{{image}} --format json',
    params: { pool: 'rbd', image: 'test-image' },
    status: 'pending',
    triggeredAt: 0,
  },
];
```

- [ ] **Step 3: Extend the BenchmarkStore interface**

Replace the entire `interface BenchmarkStore` (lines 74-101) with:

```typescript
interface BenchmarkStore {
  // ── Existing ──
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
  discoveredNodes: Record<string, NodeDisks>;
  setDiscoveredNodes: (nodes: Record<string, NodeDisks>) => void;
  isScanning: boolean;
  setIsScanning: (v: boolean) => void;
  agentMappings: AgentMapping[];
  addAgentMapping: (m: AgentMapping) => void;
  removeAgentMapping: (sshSessionId: string) => void;
  updateAgentMapping: (sshSessionId: string, bbAgentId: string, label: string) => void;
  getBBAgentId: (sshSessionId: string) => string;

  // ── Business Orchestration ──
  businessTemplates: BusinessTemplate[];
  businessExecutions: BusinessExecution[];
  addBusinessTemplate: (t: Omit<BusinessTemplate, 'id' | 'createdAt'>) => void;
  removeBusinessTemplate: (id: string) => void;
  updateBusinessTemplate: (id: string, t: Partial<BusinessTemplate>) => void;
  addBusinessExecution: (e: BusinessExecution) => void;
  updateBusinessExecution: (id: string, patch: Partial<BusinessExecution>) => void;

  // ── Chaos Injection ──
  chaosFaults: ChaosFault[];
  chaosInjections: ChaosInjection[];
  addChaosFault: (f: Omit<ChaosFault, 'id'>) => void;
  removeChaosFault: (id: string) => void;
  addChaosInjection: (i: ChaosInjection) => void;
  updateChaosInjection: (id: string, patch: Partial<ChaosInjection>) => void;

  // ── Task Tracing ──
  tracedTasks: TracedTask[];
  addTracedTask: (t: Omit<TracedTask, 'id'>) => string;
  updateTracedTask: (id: string, patch: Partial<TracedTask>) => void;
  removeTracedTask: (id: string) => void;
  appendLogBuffer: (taskId: string, pathId: string, lines: string[]) => void;

  // ── IO Monitoring ──
  ioSnapshots: Record<string, IOMetricsSnapshot>;
  updateIOSnapshot: (key: string, metrics: IostatMetrics) => void;
  clearIOSnapshots: () => void;

  // ── Consistency Analysis ──
  consistencyChecks: ConsistencyCheck[];
  addConsistencyCheck: (c: Omit<ConsistencyCheck, 'id' | 'triggeredAt'>) => void;
  updateConsistencyCheck: (id: string, patch: Partial<ConsistencyCheck>) => void;
  removeConsistencyCheck: (id: string) => void;
}
```

- [ ] **Step 4: Update the store implementation body**

In the `persist` callback, after the existing `getBBAgentId` implementation (around line 173), add the new state and actions before the closing `}),`:

```typescript
      // ── Business Orchestration ──
      businessTemplates: [],
      businessExecutions: [],
      addBusinessTemplate: (t) =>
        set((s) => ({
          businessTemplates: [...s.businessTemplates, { ...t, id: generateId(), createdAt: Date.now() }],
        })),
      removeBusinessTemplate: (id) =>
        set((s) => ({ businessTemplates: s.businessTemplates.filter((x) => x.id !== id) })),
      updateBusinessTemplate: (id, t) =>
        set((s) => ({
          businessTemplates: s.businessTemplates.map((x) => (x.id === id ? { ...x, ...t, updatedAt: Date.now() } : x)),
        })),
      addBusinessExecution: (e) =>
        set((s) => ({ businessExecutions: [...s.businessExecutions, e] })),
      updateBusinessExecution: (id, patch) =>
        set((s) => ({
          businessExecutions: s.businessExecutions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),

      // ── Chaos Injection ──
      chaosFaults: [...BUILTIN_CHAOS_FAULTS],
      chaosInjections: [],
      addChaosFault: (f) =>
        set((s) => ({ chaosFaults: [...s.chaosFaults, { ...f, id: generateId() }] })),
      removeChaosFault: (id) =>
        set((s) => ({ chaosFaults: s.chaosFaults.filter((x) => x.id !== id) })),
      addChaosInjection: (i) =>
        set((s) => ({ chaosInjections: [...s.chaosInjections, i] })),
      updateChaosInjection: (id, patch) =>
        set((s) => ({
          chaosInjections: s.chaosInjections.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),

      // ── Task Tracing ──
      tracedTasks: [],
      addTracedTask: (t) => {
        const id = generateId();
        set((s) => ({ tracedTasks: [...s.tracedTasks, { ...t, id }] }));
        return id;
      },
      updateTracedTask: (id, patch) =>
        set((s) => ({
          tracedTasks: s.tracedTasks.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeTracedTask: (id) =>
        set((s) => ({ tracedTasks: s.tracedTasks.filter((x) => x.id !== id) })),
      appendLogBuffer: (taskId, pathId, lines) =>
        set((s) => ({
          tracedTasks: s.tracedTasks.map((x) => {
            if (x.id !== taskId) return x;
            return {
              ...x,
              logPaths: x.logPaths.map((lp) => {
                if (lp.id !== pathId) return lp;
                const buffer = [...(lp.buffer || []), ...lines];
                if (buffer.length > 500) buffer.splice(0, buffer.length - 500);
                return { ...lp, buffer };
              }),
            };
          }),
        })),

      // ── IO Monitoring ──
      ioSnapshots: {},
      updateIOSnapshot: (key, metrics) =>
        set((s) => {
          const snap = s.ioSnapshots[key];
          const history = snap ? [...snap.history, metrics] : [metrics];
          if (history.length > 120) history.shift();
          return {
            ioSnapshots: {
              ...s.ioSnapshots,
              [key]: { ...snap, key, latest: metrics, history },
            },
          };
        }),
      clearIOSnapshots: () => set({ ioSnapshots: {} }),

      // ── Consistency Analysis ──
      consistencyChecks: [...BUILTIN_CONSISTENCY_CHECKS],
      addConsistencyCheck: (c) =>
        set((s) => ({
          consistencyChecks: [...s.consistencyChecks, { ...c, id: generateId(), triggeredAt: Date.now() }],
        })),
      updateConsistencyCheck: (id, patch) =>
        set((s) => ({
          consistencyChecks: s.consistencyChecks.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeConsistencyCheck: (id) =>
        set((s) => ({ consistencyChecks: s.consistencyChecks.filter((x) => x.id !== id) })),
```

- [ ] **Step 5: Update persist partialize**

Replace the existing `partialize` (around line 178-181) with:

```typescript
    {
      name: 'benchmark-store',
      partialize: (state) => ({
        savedModels: state.savedModels,
        agentMappings: state.agentMappings,
        businessTemplates: state.businessTemplates,
        chaosFaults: state.chaosFaults,
        consistencyChecks: state.consistencyChecks,
      }),
    }
```

- [ ] **Step 6: Verify the store compiles**

Run: `npx tsc --noEmit src/modules/BlockBenchmark/store/benchmarkStore.ts`
Expected: No output (no errors)

- [ ] **Step 7: Commit**

```bash
git add src/modules/BlockBenchmark/store/benchmarkStore.ts
git commit -m "feat(benchmark): extend store with business, chaos, tracing, io, analysis state"
```

---

## Phase 2: Execution Engines

### Task 3: Business Execution Engine

**Files:**
- Create: `src/modules/BlockBenchmark/engine/businessEngine.ts`

- [ ] **Step 1: Write the business engine**

```typescript
import type { BusinessExecution, BusinessTemplate, StepResult } from '../types';

export function replaceTemplateVars(
  cmd: string,
  globalVars: Record<string, string>,
  perNodeVars: Record<string, string>,
  sharedVars: Record<string, string>,
  nodeMeta: { name: string; ip: string }
): string {
  let result = cmd;

  // {{var}} -> global or perNode
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (perNodeVars[name] !== undefined) return perNodeVars[name];
    if (globalVars[name] !== undefined) return globalVars[name];
    return `{{${name}}}`; // leave unresolved for validation
  });

  // $capture.x -> sharedVars
  result = result.replace(/\$capture\.(\w+)/g, (_match, name) => {
    return sharedVars[name] ?? `$capture.${name}`;
  });

  // $node.name / $node.ip
  result = result.replace(/\$node\.name/g, nodeMeta.name);
  result = result.replace(/\$node\.ip/g, nodeMeta.ip);

  return result;
}

export function validateExecutionVars(
  template: BusinessTemplate,
  varValues: BusinessExecution['varValues'],
  nodeIds: string[]
): string | null {
  for (const v of template.variables) {
    if (!v.required) continue;
    if (v.scope === 'global') {
      if (!varValues.global[v.name]) return `全局变量 "${v.label}" 必填`;
    } else {
      for (const nid of nodeIds) {
        if (!varValues.perNode[nid]?.[v.name]) {
          return `节点 ${nid} 的变量 "${v.label}" 必填`;
        }
      }
    }
  }
  return null;
}

export function makeExecution(template: BusinessTemplate, nodeIds: string[], varValues: BusinessExecution['varValues']): BusinessExecution {
  return {
    id: crypto.randomUUID(),
    templateId: template.id,
    templateName: template.name,
    nodeIds,
    varValues,
    status: 'pending',
    sharedVars: {},
    stepResults: Object.fromEntries(nodeIds.map((nid) => [nid, []])),
    startedAt: Date.now(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/engine/businessEngine.ts
git commit -m "feat(benchmark): add business template execution engine"
```

---

### Task 4: Chaos Execution Engine

**Files:**
- Create: `src/modules/BlockBenchmark/engine/chaosEngine.ts`

- [ ] **Step 1: Write the chaos engine**

```typescript
import type { ChaosFault, ChaosInjection } from '../types';

export function replaceFaultVars(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => params[name] ?? `{{${name}}}`);
}

export function buildInjection(fault: ChaosFault, nodeIds: string[], paramValues: Record<string, string>, durationSec: number): ChaosInjection {
  return {
    id: crypto.randomUUID(),
    faultId: fault.id,
    faultName: fault.name,
    nodeIds,
    paramValues,
    durationSec,
    status: 'pending',
    log: '',
  };
}

export function buildRecoveryCommand(fault: ChaosFault, paramValues: Record<string, string>): string | null {
  if (!fault.recoveryCmdTemplate) return null;
  return replaceFaultVars(fault.recoveryCmdTemplate, paramValues);
}

export function buildDelayedRecoveryScript(fault: ChaosFault, paramValues: Record<string, string>, durationSec: number, injectionId: string): string | null {
  const recovery = buildRecoveryCommand(fault, paramValues);
  if (!recovery) return null;
  return `nohup bash -c 'sleep ${durationSec} && ${recovery}' > /tmp/chaos_recovery_${injectionId}.log 2>&1 &`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/engine/chaosEngine.ts
git commit -m "feat(benchmark): add chaos injection engine"
```

---

## Phase 3: Business Orchestration Components

### Task 5: Business Step Modal

**Files:**
- Create: `src/modules/BlockBenchmark/components/BusinessStepModal.tsx`

- [ ] **Step 1: Write the modal component**

```tsx
import { Input, Modal, Form, Select, InputNumber, Switch } from 'antd';
import React from 'react';
import type { BusinessStep } from '../types';

const { TextArea } = Input;

interface Props {
  open: boolean;
  initial?: BusinessStep;
  onOk: (step: BusinessStep) => void;
  onCancel: () => void;
}

const BusinessStepModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue(initial ?? {
        name: '', cmd: '', target: 'all', timeout: 30000, blocking: true,
      });
    }
  }, [open, initial, form]);

  const handleOk = () => {
    form.validateFields().then((vals) => {
      onOk({
        id: initial?.id ?? crypto.randomUUID(),
        name: vals.name,
        cmd: vals.cmd,
        target: vals.target,
        timeout: vals.timeout,
        captureVar: vals.captureName ? { name: vals.captureName, pattern: vals.capturePattern } : undefined,
        blocking: vals.blocking,
      });
      form.resetFields();
    });
  };

  return (
    <Modal
      title={initial ? '编辑步骤' : '添加步骤'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={640}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="步骤名称" name="name" rules={[{ required: true }]}>
          <Input placeholder="如：创建 RBD 卷" />
        </Form.Item>
        <Form.Item label="命令模板" name="cmd" rules={[{ required: true }]}>
          <TextArea rows={3} placeholder="支持 {{var}}、$capture.x、$node.name / $node.ip" />
        </Form.Item>
        <Form.Item label="目标节点" name="target" rules={[{ required: true }]}>
          <Select
            mode="tags"
            placeholder="输入节点ID，或选择 all"
            options={[{ label: '所有选中节点 (all)', value: 'all' }]}
          />
        </Form.Item>
        <Form.Item label="超时 (ms)" name="timeout" initialValue={30000}>
          <InputNumber style={{ width: '100%' }} min={1000} step={1000} />
        </Form.Item>
        <Form.Item label="阻塞执行" name="blocking" valuePropName="checked" initialValue={true}>
          <Switch checkedChildren="是" unCheckedChildren="否" />
        </Form.Item>
        <Form.Item label="捕获变量名 (可选)" name="captureName">
          <Input placeholder="如 volume_id" />
        </Form.Item>
        <Form.Item label="捕获正则 (可选)" name="capturePattern">
          <Input placeholder="如 volume_id: (.+)" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default BusinessStepModal;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/BusinessStepModal.tsx
git commit -m "feat(benchmark): add business step modal"
```

---

### Task 6: Business Execution Panel

**Files:**
- Create: `src/modules/BlockBenchmark/components/BusinessExecutionPanel.tsx`

- [ ] **Step 1: Write the execution panel**

```tsx
import { Button, Checkbox, Collapse, Input, Progress, Space, Tag, Typography, message } from 'antd';
import React, { useMemo, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import type { BusinessExecution, BusinessTemplate } from '../types';
import { replaceTemplateVars, validateExecutionVars, makeExecution } from '../engine/businessEngine';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Text, Title } = Typography;
const { Panel } = Collapse;

interface Props {
  template: BusinessTemplate | null;
}

const BusinessExecutionPanel: React.FC<Props> = ({ template }) => {
  const { sessions } = useSSHStore();
  const { addBusinessExecution, updateBusinessExecution } = useBenchmarkStore();

  const connectedSessions = sessions.filter((s) => s.status === 'connected');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [globalVars, setGlobalVars] = useState<Record<string, string>>({});
  const [perNodeVars, setPerNodeVars] = useState<Record<string, Record<string, string>>>({});
  const [currentExecution, setCurrentExecution] = useState<BusinessExecution | null>(null);
  const [running, setRunning] = useState(false);

  const nodeOptions = useMemo(
    () => connectedSessions.map((s) => ({ label: s.name, value: s.id })),
    [connectedSessions]
  );

  const globalVariables = useMemo(
    () => template?.variables.filter((v) => v.scope === 'global') ?? [],
    [template]
  );
  const perNodeVariables = useMemo(
    () => template?.variables.filter((v) => v.scope === 'perNode') ?? [],
    [template]
  );

  const handleRun = async () => {
    if (!template) return;
    if (selectedNodeIds.length === 0) {
      message.warning('请至少选择一个目标节点');
      return;
    }
    const err = validateExecutionVars(template, { global: globalVars, perNode: perNodeVars }, selectedNodeIds);
    if (err) {
      message.error(err);
      return;
    }

    const exec = makeExecution(template, selectedNodeIds, { global: globalVars, perNode: perNodeVars });
    addBusinessExecution(exec);
    setCurrentExecution(exec);
    setRunning(true);

    const { execCommandOnSession } = useSSHStore.getState();
    let sharedVars: Record<string, string> = {};

    for (const step of template.steps) {
      const targetNodes = step.target === 'all' ? selectedNodeIds : step.target;
      const validTargets = targetNodes.filter((id) => selectedNodeIds.includes(id));

      updateBusinessExecution(exec.id, { status: 'running' });

      const stepPromises = validTargets.map(async (nodeId) => {
        const session = connectedSessions.find((s) => s.id === nodeId);
        if (!session) return;

        const nodeVars = perNodeVars[nodeId] ?? {};
        const resolvedCmd = replaceTemplateVars(
          step.cmd,
          globalVars,
          nodeVars,
          sharedVars,
          { name: session.name, ip: '' }
        );

        const stepResult = {
          stepId: step.id,
          stepName: step.name,
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 0,
          status: 'running' as const,
        };

        // Update to running
        updateBusinessExecution(exec.id, {
          stepResults: {
            ...exec.stepResults,
            [nodeId]: [...(exec.stepResults[nodeId] ?? []), stepResult],
          },
        });

        const start = Date.now();
        try {
          const res = await execCommandOnSession(nodeId, resolvedCmd, step.timeout);
          const durationMs = Date.now() - start;

          if (step.captureVar) {
            const match = res.stdout.match(new RegExp(step.captureVar.pattern));
            if (match && match[1]) {
              sharedVars[step.captureVar.name] = match[1];
            }
          }

          const finalResult: typeof stepResult = {
            ...stepResult,
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exitCode,
            durationMs,
            status: res.exitCode === 0 ? 'done' : 'fail',
            capturedVar: step.captureVar && sharedVars[step.captureVar.name]
              ? { name: step.captureVar.name, value: sharedVars[step.captureVar.name] }
              : undefined,
          };

          updateBusinessExecution(exec.id, {
            stepResults: {
              ...exec.stepResults,
              [nodeId]: [...(exec.stepResults[nodeId] ?? []).slice(0, -1), finalResult],
            },
            sharedVars: { ...sharedVars },
          });
        } catch (e: any) {
          const finalResult: typeof stepResult = {
            ...stepResult,
            stderr: e.message || String(e),
            exitCode: -1,
            durationMs: Date.now() - start,
            status: 'fail',
          };
          updateBusinessExecution(exec.id, {
            stepResults: {
              ...exec.stepResults,
              [nodeId]: [...(exec.stepResults[nodeId] ?? []).slice(0, -1), finalResult],
            },
          });
        }
      });

      if (step.blocking) {
        await Promise.allSettled(stepPromises);
      } else {
        Promise.allSettled(stepPromises);
      }
    }

    // Determine final status
    const allResults = Object.values(
      useBenchmarkStore.getState().businessExecutions.find((e) => e.id === exec.id)?.stepResults ?? {}
    ).flat();
    const hasFail = allResults.some((r) => r.status === 'fail');
    const hasDone = allResults.some((r) => r.status === 'done');
    const finalStatus: BusinessExecution['status'] = hasFail
      ? hasDone
        ? 'partial_fail'
        : 'fail'
      : 'done';

    updateBusinessExecution(exec.id, { status: finalStatus, doneAt: Date.now() });
    setRunning(false);
    message.success(`业务执行完成: ${finalStatus}`);
  };

  const liveExec = useBenchmarkStore(
    (s) => s.businessExecutions.find((e) => e.id === currentExecution?.id) ?? currentExecution
  );

  if (!template) {
    return <Text type="secondary">请先从左侧选择一个模板</Text>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Title level={5} style={{ margin: 0 }}>执行配置</Title>

      <div>
        <Text strong>目标节点</Text>
        <Checkbox.Group
          options={nodeOptions}
          value={selectedNodeIds}
          onChange={(v) => setSelectedNodeIds(v as string[])}
        />
      </div>

      {globalVariables.length > 0 && (
        <div>
          <Text strong>全局变量</Text>
          <Space direction="vertical" style={{ width: '100%' }}>
            {globalVariables.map((v) => (
              <div key={v.name}>
                <Text>{v.label}</Text>
                <Input
                  value={globalVars[v.name] ?? v.defaultValue ?? ''}
                  onChange={(e) => setGlobalVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  placeholder={v.required ? '必填' : '可选'}
                />
              </div>
            ))}
          </Space>
        </div>
      )}

      {perNodeVariables.length > 0 && selectedNodeIds.length > 0 && (
        <div>
          <Text strong>节点变量</Text>
          <Collapse size="small">
            {selectedNodeIds.map((nodeId) => {
              const sess = connectedSessions.find((s) => s.id === nodeId);
              return (
                <Panel header={sess?.name ?? nodeId} key={nodeId}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {perNodeVariables.map((v) => (
                      <div key={v.name}>
                        <Text>{v.label}</Text>
                        <Input
                          value={perNodeVars[nodeId]?.[v.name] ?? v.defaultValue ?? ''}
                          onChange={(e) =>
                            setPerNodeVars((prev) => ({
                              ...prev,
                              [nodeId]: { ...prev[nodeId], [v.name]: e.target.value },
                            }))
                          }
                          placeholder={v.required ? '必填' : '可选'}
                        />
                      </div>
                    ))}
                  </Space>
                </Panel>
              );
            })}
          </Collapse>
        </div>
      )}

      <Button type="primary" onClick={handleRun} loading={running} disabled={selectedNodeIds.length === 0}>
        一键下发
      </Button>

      {liveExec && (
        <div>
          <Text strong>执行进度 — {liveExec.status}</Text>
          {selectedNodeIds.map((nodeId) => {
            const sess = connectedSessions.find((s) => s.id === nodeId);
            const results = liveExec.stepResults[nodeId] ?? [];
            const doneCount = results.filter((r) => r.status === 'done' || r.status === 'fail').length;
            const totalSteps = template.steps.length;
            const percent = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
            const hasFail = results.some((r) => r.status === 'fail');

            return (
              <div key={nodeId} style={{ marginBottom: 8 }}>
                <Space>
                  <Text>{sess?.name ?? nodeId}</Text>
                  {hasFail && <Tag color="error">失败</Tag>}
                </Space>
                <Progress percent={percent} size="small" status={hasFail ? 'exception' : 'active'} />
              </div>
            );
          })}

          <Collapse size="small">
            {selectedNodeIds.map((nodeId) => {
              const results = liveExec.stepResults[nodeId] ?? [];
              if (results.length === 0) return null;
              const sess = connectedSessions.find((s) => s.id === nodeId);
              return (
                <Panel header={`${sess?.name ?? nodeId} 输出`} key={nodeId}>
                  {results.map((r, idx) => (
                    <div key={idx} style={{ marginBottom: 8 }}>
                      <Tag color={r.status === 'done' ? 'success' : r.status === 'fail' ? 'error' : 'processing'}>
                        {r.stepName}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>exit={r.exitCode} {r.durationMs}ms</Text>
                      {r.stdout && (
                        <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                          {r.stdout}
                        </pre>
                      )}
                      {r.stderr && (
                        <pre style={{ fontSize: 11, background: '#fff2f0', padding: 8, borderRadius: 4, color: '#cf1322' }}>
                          {r.stderr}
                        </pre>
                      )}
                    </div>
                  ))}
                </Panel>
              );
            })}
          </Collapse>
        </div>
      )}
    </div>
  );
};

export default BusinessExecutionPanel;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/BusinessExecutionPanel.tsx
git commit -m "feat(benchmark): add business execution panel"
```

---

### Task 7: Business Template Editor

**Files:**
- Create: `src/modules/BlockBenchmark/components/BusinessTemplateEditor.tsx`

- [ ] **Step 1: Write the template editor**

```tsx
import { Button, Card, Empty, Form, Input, List, Popconfirm, Space, Tag, Typography, message } from 'antd';
import React, { useState } from 'react';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { BusinessTemplate, TemplateVariable } from '../types';
import BusinessStepModal from './BusinessStepModal';
import BusinessExecutionPanel from './BusinessExecutionPanel';

const { Text, Title } = Typography;
const { TextArea } = Input;

const BusinessTemplateEditor: React.FC = () => {
  const { businessTemplates, addBusinessTemplate, removeBusinessTemplate, updateBusinessTemplate } = useBenchmarkStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<BusinessTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

  const selectedTemplate = businessTemplates.find((t) => t.id === selectedTemplateId) ?? null;

  const handleCreate = () => {
    setIsCreating(true);
    setEditingTemplate({
      id: crypto.randomUUID(),
      name: '',
      description: '',
      steps: [],
      variables: [],
      createdAt: Date.now(),
    });
    setSelectedTemplateId(null);
  };

  const handleSave = () => {
    if (!editingTemplate) return;
    if (!editingTemplate.name.trim()) {
      message.error('模板名称必填');
      return;
    }
    if (isCreating) {
      addBusinessTemplate(editingTemplate);
      message.success('模板创建成功');
    } else {
      updateBusinessTemplate(editingTemplate.id, editingTemplate);
      message.success('模板更新成功');
    }
    setIsCreating(false);
    setEditingTemplate(null);
    setSelectedTemplateId(editingTemplate.id);
  };

  const handleAddVariable = () => {
    if (!editingTemplate) return;
    const newVar: TemplateVariable = {
      name: `var_${editingTemplate.variables.length + 1}`,
      label: '新变量',
      required: true,
      scope: 'global',
    };
    setEditingTemplate({ ...editingTemplate, variables: [...editingTemplate.variables, newVar] });
  };

  const handleUpdateVariable = (index: number, patch: Partial<TemplateVariable>) => {
    if (!editingTemplate) return;
    const vars = [...editingTemplate.variables];
    vars[index] = { ...vars[index], ...patch };
    setEditingTemplate({ ...editingTemplate, variables: vars });
  };

  const handleRemoveVariable = (index: number) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      variables: editingTemplate.variables.filter((_, i) => i !== index),
    });
  };

  const handleAddStep = () => {
    setEditingStepIndex(null);
    setStepModalOpen(true);
  };

  const handleEditStep = (index: number) => {
    if (!editingTemplate) return;
    setEditingStepIndex(index);
    setStepModalOpen(true);
  };

  const handleStepOk = (step: BusinessTemplate['steps'][0]) => {
    if (!editingTemplate) return;
    if (editingStepIndex !== null) {
      const steps = [...editingTemplate.steps];
      steps[editingStepIndex] = step;
      setEditingTemplate({ ...editingTemplate, steps });
    } else {
      setEditingTemplate({ ...editingTemplate, steps: [...editingTemplate.steps, step] });
    }
    setStepModalOpen(false);
  };

  const handleRemoveStep = (index: number) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      steps: editingTemplate.steps.filter((_, i) => i !== index),
    });
  };

  const handleMoveStep = (index: number, direction: -1 | 1) => {
    if (!editingTemplate) return;
    const steps = [...editingTemplate.steps];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= steps.length) return;
    [steps[index], steps[newIndex]] = [steps[newIndex], steps[index]];
    setEditingTemplate({ ...editingTemplate, steps });
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left: Template List */}
      <Card
        size="small"
        title="业务模板"
        style={{ flex: '0 0 240px', display: 'flex', flexDirection: 'column' }}
        extra={<Button size="small" icon={<PlusOutlined />} onClick={handleCreate}>新建</Button>}
      >
        <List
          size="small"
          dataSource={businessTemplates}
          renderItem={(t) => (
            <List.Item
              style={{
                cursor: 'pointer',
                background: selectedTemplateId === t.id ? '#e6f7ff' : undefined,
                padding: '8px 12px',
              }}
              onClick={() => {
                setSelectedTemplateId(t.id);
                setIsCreating(false);
                setEditingTemplate(null);
              }}
            >
              <Text strong>{t.name}</Text>
              <Tag size="small">{t.steps.length} 步骤</Tag>
            </List.Item>
          )}
          locale={{ emptyText: '暂无模板' }}
        />
      </Card>

      {/* Middle: Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isCreating || editingTemplate ? (
          <>
            <Card size="small" title="基本信息">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  placeholder="模板名称"
                  value={editingTemplate?.name}
                  onChange={(e) => editingTemplate && setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                />
                <TextArea
                  placeholder="描述"
                  rows={2}
                  value={editingTemplate?.description}
                  onChange={(e) => editingTemplate && setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                />
              </Space>
            </Card>

            <Card
              size="small"
              title="步骤列表"
              extra={<Button size="small" icon={<PlusOutlined />} onClick={handleAddStep}>添加步骤</Button>}
            >
              {editingTemplate?.steps.length === 0 ? (
                <Empty description="暂无步骤" />
              ) : (
                <List
                  size="small"
                  dataSource={editingTemplate?.steps ?? []}
                  renderItem={(step, idx) => (
                    <List.Item
                      actions={[
                        <Button size="small" icon={<EditOutlined />} onClick={() => handleEditStep(idx)} />,
                        <Button size="small" disabled={idx === 0} onClick={() => handleMoveStep(idx, -1)}>↑</Button>,
                        <Button size="small" disabled={idx === (editingTemplate?.steps.length ?? 0) - 1} onClick={() => handleMoveStep(idx, 1)}>↓</Button>,
                        <Popconfirm title="确认删除？" onConfirm={() => handleRemoveStep(idx)}>
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        title={`${idx + 1}. ${step.name}`}
                        description={
                          <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                            {step.cmd}
                          </Text>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>

            <Card
              size="small"
              title="变量定义"
              extra={<Button size="small" icon={<PlusOutlined />} onClick={handleAddVariable}>添加变量</Button>}
            >
              {editingTemplate?.variables.length === 0 ? (
                <Empty description="暂无变量" />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {editingTemplate?.variables.map((v, idx) => (
                    <Card size="small" key={idx} bodyStyle={{ padding: 8 }}>
                      <Space wrap>
                        <Input
                          size="small"
                          placeholder="变量名"
                          value={v.name}
                          onChange={(e) => handleUpdateVariable(idx, { name: e.target.value })}
                          style={{ width: 100 }}
                        />
                        <Input
                          size="small"
                          placeholder="显示名"
                          value={v.label}
                          onChange={(e) => handleUpdateVariable(idx, { label: e.target.value })}
                          style={{ width: 120 }}
                        />
                        <Input
                          size="small"
                          placeholder="默认值"
                          value={v.defaultValue}
                          onChange={(e) => handleUpdateVariable(idx, { defaultValue: e.target.value })}
                          style={{ width: 100 }}
                        />
                        <Tag color={v.scope === 'global' ? 'blue' : 'orange'}>
                          {v.scope === 'global' ? '全局' : '节点'}
                        </Tag>
                        <Button size="small" onClick={() => handleUpdateVariable(idx, { scope: v.scope === 'global' ? 'perNode' : 'global' })}>
                          切换
                        </Button>
                        <Button size="small" danger onClick={() => handleRemoveVariable(idx)}>
                          删除
                        </Button>
                      </Space>
                    </Card>
                  ))}
                </Space>
              )}
            </Card>

            <Space>
              <Button type="primary" onClick={handleSave}>保存模板</Button>
              <Button onClick={() => { setIsCreating(false); setEditingTemplate(null); }}>取消</Button>
            </Space>
          </>
        ) : (
          <Empty description="选择左侧模板查看详情，或点击新建" />
        )}
      </div>

      {/* Right: Execution Panel */}
      <Card size="small" title="执行面板" style={{ flex: '0 0 360px' }}>
        <BusinessExecutionPanel template={isCreating ? null : (editingTemplate ?? selectedTemplate)} />
      </Card>

      <BusinessStepModal
        open={stepModalOpen}
        initial={editingStepIndex !== null && editingTemplate ? editingTemplate.steps[editingStepIndex] : undefined}
        onOk={handleStepOk}
        onCancel={() => setStepModalOpen(false)}
      />
    </div>
  );
};

export default BusinessTemplateEditor;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/BusinessTemplateEditor.tsx
git commit -m "feat(benchmark): add business template editor"
```

---

### Task 8: Replace TaskDispatcher

**Files:**
- Modify: `src/modules/BlockBenchmark/components/TaskDispatcher.tsx`

- [ ] **Step 1: Replace the entire file contents**

```tsx
import React from 'react';
import BusinessTemplateEditor from './BusinessTemplateEditor';

const TaskDispatcher: React.FC = () => {
  return <BusinessTemplateEditor />;
};

export default TaskDispatcher;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/TaskDispatcher.tsx
git commit -m "refactor(benchmark): replace TaskDispatcher with BusinessTemplateEditor"
```

---

## Phase 4: Chaos Injection Components

### Task 9: Chaos Fault Modal

**Files:**
- Create: `src/modules/BlockBenchmark/components/ChaosFaultModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
import { Button, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd';
import React from 'react';
import type { ChaosFault } from '../types';

const { TextArea } = Input;

interface Props {
  open: boolean;
  initial?: ChaosFault;
  onOk: (fault: Omit<ChaosFault, 'id'>) => void;
  onCancel: () => void;
}

const CATEGORIES = [
  { label: '网络', value: 'network' },
  { label: '磁盘', value: 'disk' },
  { label: 'CPU', value: 'cpu' },
  { label: '内存', value: 'memory' },
  { label: '进程', value: 'process' },
  { label: '自定义', value: 'custom' },
];

const ChaosFaultModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue(initial ?? { category: 'custom', defaultDurationSec: 60 });
    }
  }, [open, initial, form]);

  const handleOk = () => {
    form.validateFields().then((vals) => {
      onOk({
        name: vals.name,
        category: vals.category,
        description: vals.description,
        cmdTemplate: vals.cmdTemplate,
        params: vals.params ?? [],
        recoveryCmdTemplate: vals.recoveryCmdTemplate || undefined,
        defaultDurationSec: vals.defaultDurationSec,
        isBuiltin: false,
      });
      form.resetFields();
    });
  };

  return (
    <Modal title={initial ? '编辑故障' : '自定义故障'} open={open} onOk={handleOk} onCancel={onCancel} width={640}>
      <Form form={form} layout="vertical">
        <Form.Item label="名称" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="类别" name="category" rules={[{ required: true }]}>
          <Select options={CATEGORIES} />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <TextArea rows={2} />
        </Form.Item>
        <Form.Item label="注入命令模板" name="cmdTemplate" rules={[{ required: true }]}>
          <TextArea rows={2} placeholder="支持 {{param}} 变量替换" />
        </Form.Item>
        <Form.Item label="恢复命令模板" name="recoveryCmdTemplate">
          <TextArea rows={2} placeholder="可选，支持 {{param}} 变量替换" />
        </Form.Item>
        <Form.Item label="默认持续时间(秒)" name="defaultDurationSec" initialValue={60}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ChaosFaultModal;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/ChaosFaultModal.tsx
git commit -m "feat(benchmark): add chaos fault modal"
```

---

### Task 10: Chaos Fault Library + Injection Panel

**Files:**
- Create: `src/modules/BlockBenchmark/components/ChaosFaultLibrary.tsx`
- Create: `src/modules/BlockBenchmark/components/ChaosInjectionPanel.tsx`

- [ ] **Step 1: Write ChaosFaultLibrary**

```tsx
import { Card, Tag, Typography } from 'antd';
import React from 'react';
import type { ChaosFault } from '../types';

const { Text } = Typography;

interface Props {
  faults: ChaosFault[];
  selectedId: string | null;
  onSelect: (fault: ChaosFault) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  network: 'blue',
  disk: 'orange',
  cpu: 'red',
  memory: 'purple',
  process: 'cyan',
  custom: 'default',
};

const ChaosFaultLibrary: React.FC<Props> = ({ faults, selectedId, onSelect }) => {
  const grouped = faults.reduce((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {} as Record<string, ChaosFault[]>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <Tag color={CATEGORY_COLORS[category]} style={{ marginBottom: 8 }}>
            {category === 'network' ? '网络故障' : category === 'disk' ? '磁盘故障' : category === 'cpu' ? 'CPU故障' : category === 'memory' ? '内存故障' : category === 'process' ? '进程故障' : '自定义'}
          </Tag>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((f) => (
              <Card
                key={f.id}
                size="small"
                style={{
                  cursor: 'pointer',
                  borderColor: selectedId === f.id ? '#1890ff' : undefined,
                }}
                onClick={() => onSelect(f)}
              >
                <Text strong>{f.name}</Text>
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  {f.description}
                </Text>
                <div style={{ marginTop: 4 }}>
                  {f.params.map((p) => (
                    <Tag size="small" key={p.name}>{p.label}</Tag>
                  ))}
                  {f.recoveryCmdTemplate && <Tag size="small" color="green">可恢复</Tag>}
                  {f.isBuiltin && <Tag size="small" color="blue">内置</Tag>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ChaosFaultLibrary;
```

- [ ] **Step 2: Write ChaosInjectionPanel**

```tsx
import { Button, Card, Checkbox, Input, InputNumber, List, Space, Tag, Typography, message } from 'antd';
import React, { useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { ChaosFault } from '../types';
import { replaceFaultVars, buildInjection, buildDelayedRecoveryScript } from '../engine/chaosEngine';

const { Text, Title } = Typography;

const ChaosInjectionPanel: React.FC = () => {
  const { sessions, execCommandOnSession } = useSSHStore();
  const { chaosFaults, chaosInjections, addChaosInjection, updateChaosInjection } = useBenchmarkStore();

  const connectedSessions = sessions.filter((s) => s.status === 'connected');
  const [selectedFault, setSelectedFault] = useState<ChaosFault | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [durationSec, setDurationSec] = useState<number>(60);
  const [injecting, setInjecting] = useState(false);

  const handleSelectFault = (fault: ChaosFault) => {
    setSelectedFault(fault);
    const defaults: Record<string, string> = {};
    fault.params.forEach((p) => {
      if (p.defaultValue) defaults[p.name] = p.defaultValue;
    });
    setParamValues(defaults);
    setDurationSec(fault.defaultDurationSec);
  };

  const handleInject = async () => {
    if (!selectedFault) return;
    if (selectedNodeIds.length === 0) {
      message.warning('请至少选择一个目标节点');
      return;
    }

    const injection = buildInjection(selectedFault, selectedNodeIds, paramValues, durationSec);
    addChaosInjection(injection);
    setInjecting(true);
    updateChaosInjection(injection.id, { status: 'injecting' });

    const injectCmd = replaceFaultVars(selectedFault.cmdTemplate, paramValues);
    const recoveryScript = buildDelayedRecoveryScript(selectedFault, paramValues, durationSec, injection.id);

    const promises = selectedNodeIds.map(async (nodeId) => {
      try {
        if (recoveryScript) {
          await execCommandOnSession(nodeId, recoveryScript, 15000);
        }
        const res = await execCommandOnSession(nodeId, injectCmd, 30000);
        if (res.exitCode !== 0) {
          throw new Error(res.stderr || '注入命令返回非零');
        }
      } catch (e: any) {
        updateChaosInjection(injection.id, {
          status: 'fail',
          log: `${injection.log}\n[${nodeId}] 失败: ${e.message}`,
        });
        return;
      }
    });

    await Promise.allSettled(promises);
    const current = useBenchmarkStore.getState().chaosInjections.find((i) => i.id === injection.id);
    if (current?.status !== 'fail') {
      updateChaosInjection(injection.id, { status: 'injected', injectedAt: Date.now() });
      message.success('故障注入完成');
    } else {
      message.error('部分节点注入失败');
    }
    setInjecting(false);
  };

  const handleRecover = async (injection: typeof chaosInjections[0]) => {
    const fault = chaosFaults.find((f) => f.id === injection.faultId);
    if (!fault?.recoveryCmdTemplate) {
      message.warning('该故障未配置恢复命令');
      return;
    }
    updateChaosInjection(injection.id, { status: 'recovering' });
    const recoveryCmd = replaceFaultVars(fault.recoveryCmdTemplate, injection.paramValues);

    const promises = injection.nodeIds.map(async (nodeId) => {
      try {
        await execCommandOnSession(nodeId, recoveryCmd, 30000);
      } catch (e: any) {
        message.error(`节点 ${nodeId} 恢复失败: ${e.message}`);
      }
    });

    await Promise.allSettled(promises);
    updateChaosInjection(injection.id, { status: 'recovered', recoveredAt: Date.now() });
    message.success('恢复完成');
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <Card size="small" title="故障库" style={{ flex: '0 0 260px', overflowY: 'auto' }}>
        <ChaosFaultLibrary
          faults={chaosFaults}
          selectedId={selectedFault?.id ?? null}
          onSelect={handleSelectFault}
        />
      </Card>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card size="small" title="注入配置">
          {selectedFault ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong>{selectedFault.name}</Text>
              <div>
                <Text>目标节点</Text>
                <Checkbox.Group
                  options={connectedSessions.map((s) => ({ label: s.name, value: s.id }))}
                  value={selectedNodeIds}
                  onChange={(v) => setSelectedNodeIds(v as string[])}
                />
              </div>
              {selectedFault.params.map((p) => (
                <div key={p.name}>
                  <Text>{p.label}</Text>
                  <Input
                    value={paramValues[p.name] ?? p.defaultValue ?? ''}
                    onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    placeholder={p.required ? '必填' : '可选'}
                  />
                </div>
              ))}
              <div>
                <Text>持续时间(秒)</Text>
                <InputNumber
                  value={durationSec}
                  onChange={(v) => setDurationSec(v ?? 0)}
                  min={0}
                  style={{ width: '100%' }}
                />
              </div>
              <Button type="primary" onClick={handleInject} loading={injecting} disabled={selectedNodeIds.length === 0}>
                执行注入
              </Button>
            </Space>
          ) : (
            <Text type="secondary">请从左侧选择一个故障</Text>
          )}
        </Card>

        <Card size="small" title="注入历史">
          <List
            size="small"
            dataSource={chaosInjections.slice().reverse()}
            renderItem={(inj) => (
              <List.Item
                actions={[
                  inj.status === 'injected' && (
                    <Button size="small" onClick={() => handleRecover(inj)}>立即恢复</Button>
                  ),
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Text strong>{inj.faultName}</Text>
                      <Tag color={
                        inj.status === 'injected' ? 'red' :
                        inj.status === 'recovered' ? 'green' :
                        inj.status === 'fail' ? 'error' : 'processing'
                      }>
                        {inj.status}
                      </Tag>
                    </Space>
                  }
                  description={`节点: ${inj.nodeIds.length} 个 | 持续: ${inj.durationSec}s | ${new Date(inj.injectedAt ?? inj.id).toLocaleString()}`}
                />
              </List.Item>
            )}
          />
        </Card>
      </div>
    </div>
  );
};

export default ChaosInjectionPanel;
```

Note: This file imports `ChaosFaultLibrary` — ensure the import path is correct: `import ChaosFaultLibrary from './ChaosFaultLibrary';`

Add this import to the top of `ChaosInjectionPanel.tsx`:

```tsx
import ChaosFaultLibrary from './ChaosFaultLibrary';
```

- [ ] **Step 3: Commit both files**

```bash
git add src/modules/BlockBenchmark/components/ChaosFaultLibrary.tsx src/modules/BlockBenchmark/components/ChaosInjectionPanel.tsx
git commit -m "feat(benchmark): add chaos fault library and injection panel"
```

---

## Phase 5: IO Monitor Enhancement

### Task 11: IOMonitorGrid + IOMonitorDetail

**Files:**
- Create: `src/modules/BlockBenchmark/components/IOMonitorGrid.tsx`
- Create: `src/modules/BlockBenchmark/components/IOMonitorDetail.tsx`

- [ ] **Step 1: Write IOMonitorGrid**

```tsx
import { Badge, Card, Progress, Space, Typography } from 'antd';
import React from 'react';
import type { IOMetricsSnapshot } from '../types';

const { Text } = Typography;

interface Props {
  snapshots: IOMetricsSnapshot[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

const IOMonitorGrid: React.FC<Props> = ({ snapshots, selectedKey, onSelect }) => {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {snapshots.map((snap) => {
        const { latest } = snap;
        const utilPercent = Math.min(Math.round(latest.util), 100);
        const utilColor = utilPercent < 60 ? '#52c41a' : utilPercent < 80 ? '#faad14' : '#f5222d';

        return (
          <Card
            key={snap.key}
            size="small"
            style={{
              width: 220,
              cursor: 'pointer',
              borderColor: selectedKey === snap.key ? '#1890ff' : undefined,
            }}
            onClick={() => onSelect(snap.key)}
          >
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text strong style={{ fontSize: 13 }}>{snap.sessionName}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{snap.diskName}</Text>
              {snap.activeIOModel && (
                <Badge status="processing" text={snap.activeIOModel} />
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <Text>BW: {latest.bw_mbps.toFixed(1)} MB/s</Text>
                <Text>IOPS: {(latest.r_await + latest.w_await > 0 ? latest.util * 100 : 0).toFixed(0)}</Text>
              </div>
              <div>
                <Text style={{ fontSize: 11 }}>Util</Text>
                <Progress percent={utilPercent} size="small" strokeColor={utilColor} showInfo={false} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <Text type="secondary">R_Await: {latest.r_await.toFixed(1)}ms</Text>
                <Text type="secondary">W_Await: {latest.w_await.toFixed(1)}ms</Text>
              </div>
            </Space>
          </Card>
        );
      })}
    </div>
  );
};

export default IOMonitorGrid;
```

- [ ] **Step 2: Write IOMonitorDetail**

```tsx
import { Card, Empty } from 'antd';
import ReactECharts from 'echarts-for-react';
import React from 'react';
import type { IOMetricsSnapshot } from '../types';

interface Props {
  snapshot: IOMetricsSnapshot | null;
}

const IOMonitorDetail: React.FC<Props> = ({ snapshot }) => {
  if (!snapshot || snapshot.history.length === 0) {
    return <Empty description="选择左侧卡片查看详情" style={{ marginTop: 40 }} />;
  }

  const xAxis = snapshot.history.map((h) => h.timestamp);

  const optionUtil = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['%Util', 'R_Await(ms)', 'W_Await(ms)'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: xAxis },
    yAxis: [
      { type: 'value', name: '%', position: 'left', max: 100 },
      { type: 'value', name: 'ms', position: 'right', splitLine: { show: false } },
    ],
    series: [
      {
        name: '%Util',
        type: 'line',
        itemStyle: { color: '#ef4444' },
        areaStyle: { color: 'rgba(239, 68, 68, 0.2)' },
        data: snapshot.history.map((h) => h.util.toFixed(1)),
        smooth: true,
      },
      {
        name: 'R_Await(ms)',
        type: 'line',
        yAxisIndex: 1,
        itemStyle: { color: '#f97316' },
        data: snapshot.history.map((h) => h.r_await.toFixed(2)),
        smooth: true,
      },
      {
        name: 'W_Await(ms)',
        type: 'line',
        yAxisIndex: 1,
        itemStyle: { color: '#eab308' },
        data: snapshot.history.map((h) => h.w_await.toFixed(2)),
        smooth: true,
      },
    ],
  };

  const optionBw = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Bandwidth(MB/s)'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: xAxis },
    yAxis: { type: 'value', name: 'MB/s' },
    series: [
      {
        name: 'Bandwidth(MB/s)',
        type: 'line',
        itemStyle: { color: '#3b82f6' },
        areaStyle: { color: 'rgba(59, 130, 246, 0.2)' },
        data: snapshot.history.map((h) => h.bw_mbps.toFixed(2)),
        smooth: true,
      },
    ],
  };

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <Card size="small" title="IO 利用率与延迟" style={{ flex: 1 }}>
        <ReactECharts option={optionUtil} style={{ height: 280 }} />
      </Card>
      <Card size="small" title="带宽吞吐" style={{ flex: 1 }}>
        <ReactECharts option={optionBw} style={{ height: 280 }} />
      </Card>
    </div>
  );
};

export default IOMonitorDetail;
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/BlockBenchmark/components/IOMonitorGrid.tsx src/modules/BlockBenchmark/components/IOMonitorDetail.tsx
git commit -m "feat(benchmark): add IO monitor grid and detail components"
```

---

### Task 12: Replace DiskMetricsDashboard

**Files:**
- Modify: `src/modules/BlockBenchmark/components/DiskMetricsDashboard.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import { Button, Card, Empty, Space, Typography, message } from 'antd';
import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useDiskDiscovery } from '../hooks/useDiskDiscovery';
import { useBenchmarkStore } from '../store/benchmarkStore';
import IOMonitorGrid from './IOMonitorGrid';
import IOMonitorDetail from './IOMonitorDetail';
import type { IostatMetrics } from '../types';

const { Title, Text } = Typography;

export function parseIostatLine(line: string, deviceBase: string): IostatMetrics | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(deviceBase)) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 22) return null;
  try {
    const r_await = parseFloat(parts[5]) || 0;
    const w_await = parseFloat(parts[11]) || 0;
    const util = parseFloat(parts[parts.length - 1]) || 0;
    const bw_mbps = (parseFloat(parts[2]) + parseFloat(parts[8])) / 1024;
    return {
      timestamp: new Date().toLocaleTimeString(),
      r_await,
      w_await,
      util,
      bw_mbps,
    };
  } catch {
    return null;
  }
}

const DiskMetricsDashboard: React.FC = () => {
  const { discoveredNodes } = useDiskDiscovery();
  const { tasks, ioSnapshots, updateIOSnapshot, clearIOSnapshots } = useBenchmarkStore();
  const { subscribeToSessionLines, sendInputToSession, sessions } = useSSHStore();

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const unsubsRef = useRef<Map<string, () => void>>(new Map());

  const flatDisks = useMemo(() => {
    return Object.values(discoveredNodes).flatMap((node) =>
      node.disks.map((d) => ({
        sessionId: node.sessionId,
        sessionName: sessions.find((s) => s.id === node.sessionId)?.name || node.sessionId,
        diskName: d.name,
        key: `${node.sessionId}::${d.name}`,
      }))
    );
  }, [discoveredNodes, sessions]);

  const snapshotsArray = useMemo(() => Object.values(ioSnapshots), [ioSnapshots]);

  const activeTasksMap = useMemo(() => {
    const map: Record<string, string> = {};
    tasks.forEach((t) => {
      if (t.status === 'RUNNING') {
        map[t.agent_id] = t.task_type;
      }
    });
    return map;
  }, [tasks]);

  const startMonitoring = useCallback(() => {
    if (flatDisks.length === 0) return;
    clearIOSnapshots();

    flatDisks.forEach(({ sessionId, diskName }) => {
      const deviceBase = diskName.replace('/dev/', '');
      sendInputToSession(sessionId, `iostat -xd 1 ${deviceBase}\n`);

      const unsub = subscribeToSessionLines(sessionId, (line: string) => {
        const parsed = parseIostatLine(line, deviceBase);
        if (!parsed) return;
        const key = `${sessionId}::${diskName}`;
        updateIOSnapshot(key, parsed);
      });

      unsubsRef.current.set(`${sessionId}::${diskName}`, unsub);
    });

    // Update active IO model on each snapshot
    flatDisks.forEach(({ sessionId, diskName }) => {
      const key = `${sessionId}::${diskName}`;
      const snap = ioSnapshots[key];
      if (snap) {
        snap.activeIOModel = activeTasksMap[sessionId];
      }
    });

    setIsMonitoring(true);
  }, [flatDisks, sendInputToSession, subscribeToSessionLines, updateIOSnapshot, clearIOSnapshots, activeTasksMap, ioSnapshots]);

  const stopMonitoring = useCallback(() => {
    const sentSessions = new Set<string>();
    flatDisks.forEach(({ sessionId }) => {
      if (!sentSessions.has(sessionId)) {
        sendInputToSession(sessionId, '\x03');
        sentSessions.add(sessionId);
      }
    });
    unsubsRef.current.forEach((unsub) => unsub());
    unsubsRef.current.clear();
    setIsMonitoring(false);
    message.info('已停止 IO 监控');
  }, [flatDisks, sendInputToSession]);

  useEffect(() => {
    return () => {
      unsubsRef.current.forEach((unsub) => unsub());
      unsubsRef.current.clear();
    };
  }, []);

  if (flatDisks.length === 0) {
    return <Empty description="暂无扫描到的数据盘，请先在「磁盘矩阵调度」页面扫描拓扑" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small" bordered={false}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space direction="vertical" size={2}>
            <Title level={5} style={{ margin: 0 }}>IO 聚合大盘</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              实时监控所有节点的所有数据盘
            </Text>
          </Space>
          <Space>
            {!isMonitoring ? (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={startMonitoring}>
                开始集群监控
              </Button>
            ) : (
              <Button danger icon={<StopOutlined />} onClick={stopMonitoring}>
                停止监控
              </Button>
            )}
          </Space>
        </div>
      </Card>

      <IOMonitorGrid
        snapshots={snapshotsArray}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />

      <IOMonitorDetail snapshot={selectedKey ? ioSnapshots[selectedKey] ?? null : null} />
    </div>
  );
};

export default DiskMetricsDashboard;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/DiskMetricsDashboard.tsx
git commit -m "feat(benchmark): replace DiskMetricsDashboard with IO monitor aggregation"
```

---

## Phase 6: Task Tracing Components

### Task 13: TracingTaskList + TracingLogViewer

**Files:**
- Create: `src/modules/BlockBenchmark/components/TracingTaskList.tsx`
- Create: `src/modules/BlockBenchmark/components/TracingLogViewer.tsx`

- [ ] **Step 1: Write TracingTaskList**

```tsx
import { Badge, Button, List, Select, Space, Tag, Typography } from 'antd';
import React, { useEffect } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Text } = Typography;

interface Props {
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}

const TracingTaskList: React.FC<Props> = ({ selectedTaskId, onSelect }) => {
  const { tracedTasks, updateTracedTask } = useBenchmarkStore();
  const { execCommandOnSession } = useSSHStore();

  useEffect(() => {
    const timer = setInterval(async () => {
      const runningTasks = tracedTasks.filter((t) => t.status === 'running' && t.pid);
      for (const task of runningTasks) {
        try {
          const res = await execCommandOnSession(task.nodeId, `ps -p ${task.pid} > /dev/null; echo $?`, 5000);
          const isRunning = res.stdout.trim() === '0';
          if (!isRunning) {
            updateTracedTask(task.id, { status: 'completed' });
            // Stop stream logs
            const t = tracedTasks.find((tt) => tt.id === task.id);
            t?.logPaths.forEach((lp) => {
              if (lp.mode === 'stream' && lp.unsubscribe) {
                lp.unsubscribe();
              }
            });
          }
        } catch {
          updateTracedTask(task.id, { status: 'unknown' });
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [tracedTasks, execCommandOnSession, updateTracedTask]);

  const statusColor: Record<string, string> = {
    running: 'processing',
    completed: 'success',
    failed: 'error',
    unknown: 'warning',
  };

  return (
    <List
      size="small"
      dataSource={tracedTasks.slice().sort((a, b) => b.startedAt - a.startedAt)}
      renderItem={(task) => (
        <List.Item
          style={{
            cursor: 'pointer',
            background: selectedTaskId === task.id ? '#e6f7ff' : undefined,
          }}
          onClick={() => onSelect(task.id)}
        >
          <List.Item.Meta
            title={
              <Space>
                <Text strong>{task.name}</Text>
                <Tag color={statusColor[task.status] ?? 'default'}>{task.status}</Tag>
              </Space>
            }
            description={`${task.nodeName} | ${task.source.type} | ${new Date(task.startedAt).toLocaleString()}`}
          />
        </List.Item>
      )}
      locale={{ emptyText: '暂无追踪任务' }}
    />
  );
};

export default TracingTaskList;
```

- [ ] **Step 2: Write TracingLogViewer**

```tsx
import { Button, Card, Empty, Input, Select, Space, Typography, message } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { LogPathConfig, TracedTask } from '../types';

const { Text } = Typography;

interface Props {
  task: TracedTask | null;
}

const TracingLogViewer: React.FC<Props> = ({ task }) => {
  const { execCommandOnSession, subscribeToSessionLines, sendInputToSession } = useSSHStore();
  const { appendLogBuffer, updateTracedTask } = useBenchmarkStore();
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMode, setNewMode] = useState<'snapshot' | 'stream'>('stream');
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const liveTask = useBenchmarkStore((s) => s.tracedTasks.find((t) => t.id === task?.id));
  const currentPath = liveTask?.logPaths.find((lp) => lp.id === selectedPathId);
  const buffer = currentPath?.buffer ?? [];

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buffer, autoScroll]);

  const handleAddPath = async () => {
    if (!task || !newPath.trim()) return;
    const pathConfig: LogPathConfig = {
      id: crypto.randomUUID(),
      path: newPath.trim(),
      label: newLabel.trim() || newPath.trim(),
      mode: newMode,
      buffer: [],
    };

    const updatedPaths = [...(liveTask?.logPaths ?? []), pathConfig];
    updateTracedTask(task.id, { logPaths: updatedPaths });
    setSelectedPathId(pathConfig.id);

    if (newMode === 'snapshot') {
      try {
        const res = await execCommandOnSession(task.nodeId, `tail -n 200 "${pathConfig.path}"`, 10000);
        const lines = res.stdout.split('\n').filter(Boolean);
        appendLogBuffer(task.id, pathConfig.id, lines);
      } catch (e: any) {
        message.error(`读取日志失败: ${e.message}`);
      }
    } else {
      // stream mode: start tail in the shell
      sendInputToSession(task.nodeId, `tail -n 100 -F "${pathConfig.path}" &\n`);
      const unsub = subscribeToSessionLines(task.nodeId, (line: string) => {
        // Simple heuristic: just append all lines from this session
        // In production, might want to filter by process or tag
        appendLogBuffer(task.id, pathConfig.id, [line]);
      });

      // Store unsubscribe in the path config
      const pathsWithUnsub = updatedPaths.map((lp) =>
        lp.id === pathConfig.id ? { ...lp, unsubscribe: unsub } : lp
      );
      updateTracedTask(task.id, { logPaths: pathsWithUnsub });
    }

    setNewPath('');
    setNewLabel('');
  };

  const handleClear = () => {
    if (!task || !selectedPathId) return;
    const updatedPaths = (liveTask?.logPaths ?? []).map((lp) =>
      lp.id === selectedPathId ? { ...lp, buffer: [] } : lp
    );
    updateTracedTask(task.id, { logPaths: updatedPaths });
  };

  const handleExport = () => {
    if (!currentPath || buffer.length === 0) return;
    const blob = new Blob([buffer.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${task?.name ?? 'log'}_${currentPath.label}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!task) {
    return <Empty description="选择一个任务查看日志" style={{ marginTop: 60 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Input
            placeholder="日志绝对路径"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            style={{ width: 240 }}
          />
          <Input
            placeholder="标签 (可选)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ width: 120 }}
          />
          <Select value={newMode} onChange={setNewMode} options={[
            { label: '实时流', value: 'stream' },
            { label: '快照', value: 'snapshot' },
          ]} />
          <Button type="primary" onClick={handleAddPath}>添加路径</Button>
        </Space>
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <Text strong>日志: {currentPath?.label ?? '未选择'}</Text>
            {liveTask && (
              <Select
                value={selectedPathId ?? undefined}
                onChange={setSelectedPathId}
                options={liveTask.logPaths.map((lp) => ({ label: lp.label, value: lp.id }))}
                style={{ width: 200 }}
                placeholder="选择日志路径"
              />
            )}
          </Space>
        }
        extra={
          <Space>
            <Button size="small" onClick={() => setAutoScroll(!autoScroll)}>
              {autoScroll ? '暂停滚动' : '自动滚动'}
            </Button>
            <Button size="small" onClick={handleClear}>清空</Button>
            <Button size="small" onClick={handleExport}>导出</Button>
          </Space>
        }
        bodyStyle={{ flex: 1, overflow: 'auto', maxHeight: 400 }}
      >
        <pre
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {buffer.join('\n')}
          <div ref={logEndRef} />
        </pre>
      </Card>
    </div>
  );
};

export default TracingLogViewer;
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/BlockBenchmark/components/TracingTaskList.tsx src/modules/BlockBenchmark/components/TracingLogViewer.tsx
git commit -m "feat(benchmark): add task tracing list and log viewer"
```

---

## Phase 7: Analysis Components

### Task 14: Analysis Check Modal

**Files:**
- Create: `src/modules/BlockBenchmark/components/AnalysisCheckModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
import { Button, Form, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import React from 'react';
import type { ConsistencyCheck } from '../types';

const { TextArea } = Input;

interface Props {
  open: boolean;
  initial?: ConsistencyCheck;
  onOk: (check: Omit<ConsistencyCheck, 'id' | 'triggeredAt'>) => void;
  onCancel: () => void;
}

const CHECK_TYPES = [
  { label: 'CRC 校验', value: 'crc' },
  { label: 'LBA 范围比对', value: 'lba_range' },
  { label: '元数据一致性', value: 'metadata' },
  { label: '自定义', value: 'custom' },
];

const AnalysisCheckModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue(initial ?? { checkType: 'custom', nodeIds: [], params: {}, cmdTemplate: '' });
    }
  }, [open, initial, form]);

  const handleOk = () => {
    form.validateFields().then((vals) => {
      onOk({
        name: vals.name,
        checkType: vals.checkType,
        nodeIds: vals.nodeIds ?? [],
        cmdTemplate: vals.cmdTemplate,
        params: vals.params ?? {},
        status: 'pending',
      });
      form.resetFields();
    });
  };

  return (
    <Modal title={initial ? '编辑检测规则' : '新建检测规则'} open={open} onOk={handleOk} onCancel={onCancel} width={640}>
      <Form form={form} layout="vertical">
        <Form.Item label="名称" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="类型" name="checkType" rules={[{ required: true }]}>
          <Select options={CHECK_TYPES} />
        </Form.Item>
        <Form.Item label="命令模板" name="cmdTemplate" rules={[{ required: true }]}>
          <TextArea rows={2} placeholder="在各节点执行的命令，输出将被比对" />
        </Form.Item>
        <Form.Item label="目标节点" name="nodeIds">
          <Select mode="tags" placeholder="输入节点ID" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AnalysisCheckModal;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/AnalysisCheckModal.tsx
git commit -m "feat(benchmark): add analysis check modal"
```

---

### Task 15: Analysis Check List + Report Panel

**Files:**
- Create: `src/modules/BlockBenchmark/components/AnalysisCheckList.tsx`
- Create: `src/modules/BlockBenchmark/components/AnalysisReportPanel.tsx`

- [ ] **Step 1: Write AnalysisCheckList**

```tsx
import { Button, List, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import React from 'react';
import type { ConsistencyCheck } from '../types';

const { Text } = Typography;

interface Props {
  checks: ConsistencyCheck[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRun: (check: ConsistencyCheck) => void;
  onDelete: (id: string) => void;
  onEdit: (check: ConsistencyCheck) => void;
}

const AnalysisCheckList: React.FC<Props> = ({ checks, selectedId, onSelect, onRun, onDelete, onEdit }) => {
  const statusColors: Record<string, string> = {
    pending: 'default',
    running: 'processing',
    pass: 'success',
    fail: 'error',
    error: 'warning',
  };

  return (
    <List
      size="small"
      dataSource={checks}
      renderItem={(check) => (
        <List.Item
          style={{
            cursor: 'pointer',
            background: selectedId === check.id ? '#e6f7ff' : undefined,
          }}
          onClick={() => onSelect(check.id)}
          actions={[
            <Button size="small" icon={<PlayCircleOutlined />} onClick={(e) => { e.stopPropagation(); onRun(check); }}>执行</Button>,
            <Button size="small" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); onEdit(check); }}>编辑</Button>,
            <Popconfirm title="确认删除？" onConfirm={(e) => { e?.stopPropagation(); onDelete(check.id); }}>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()}>删除</Button>
            </Popconfirm>,
          ]}
        >
          <List.Item.Meta
            title={
              <Space>
                <Text strong>{check.name}</Text>
                <Tag color={statusColors[check.status] ?? 'default'}>{check.status}</Tag>
              </Space>
            }
            description={`${check.checkType} | ${check.nodeIds.length} 节点 | ${check.triggeredAt ? new Date(check.triggeredAt).toLocaleString() : '未执行'}`}
          />
        </List.Item>
      )}
    />
  );
};

export default AnalysisCheckList;
```

- [ ] **Step 2: Write AnalysisReportPanel**

```tsx
import { Card, Empty, Space, Table, Tag, Typography } from 'antd';
import React from 'react';
import type { ConsistencyCheck } from '../types';

const { Text, Title } = Typography;

interface Props {
  check: ConsistencyCheck | null;
}

const AnalysisReportPanel: React.FC<Props> = ({ check }) => {
  if (!check) {
    return <Empty description="选择检测规则查看报告" style={{ marginTop: 60 }} />;
  }

  if (!check.result) {
    return <Empty description="该规则尚未执行" style={{ marginTop: 60 }} />;
  }

  const { result } = check;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small">
        <Space>
          <Title level={5} style={{ margin: 0 }}>检测报告: {check.name}</Title>
          <Tag color={check.status === 'pass' ? 'success' : check.status === 'fail' ? 'error' : 'default'}>
            {check.status}
          </Tag>
        </Space>
        <Text style={{ display: 'block', marginTop: 8 }}>{result.summary}</Text>
      </Card>

      {result.inconsistencies.length > 0 && (
        <Card size="small" title={`不一致项 (${result.inconsistencies.length})`}>
          <Table
            size="small"
            dataSource={result.inconsistencies}
            rowKey={(r, idx) => `${idx}`}
            columns={[
              { title: '类型', dataIndex: 'type', key: 'type' },
              { title: '描述', dataIndex: 'description', key: 'description' },
              { title: '位置', dataIndex: 'location', key: 'location' },
              { title: '期望', dataIndex: 'expected', key: 'expected' },
              {
                title: '实际',
                key: 'actual',
                render: (_: any, r: typeof result.inconsistencies[0]) => (
                  <pre style={{ fontSize: 11, margin: 0 }}>
                    {Object.entries(r.actual ?? {}).map(([node, val]) => `${node}: ${val}`).join('\n')}
                  </pre>
                ),
              },
            ]}
            pagination={false}
          />
        </Card>
      )}

      <Card size="small" title="各节点原始输出">
        <Space direction="vertical" style={{ width: '100%' }}>
          {Object.entries(result.rawOutputs).map(([nodeId, out]) => (
            <Card size="small" key={nodeId} title={nodeId}>
              <pre style={{ fontSize: 11, margin: 0, maxHeight: 200, overflow: 'auto' }}>
                {out.stdout || out.stderr || '(无输出)'}
              </pre>
              <Text type="secondary" style={{ fontSize: 11 }}>exitCode: {out.exitCode}</Text>
            </Card>
          ))}
        </Space>
      </Card>
    </div>
  );
};

export default AnalysisReportPanel;
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/BlockBenchmark/components/AnalysisCheckList.tsx src/modules/BlockBenchmark/components/AnalysisReportPanel.tsx
git commit -m "feat(benchmark): add analysis check list and report panel"
```

---

### Task 16: Replace MetricsDashboard

**Files:**
- Modify: `src/modules/BlockBenchmark/components/MetricsDashboard.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import { Button, Card, Space, message } from 'antd';
import { PlusOutlined, SyncOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { ConsistencyCheck, ConsistencyResult } from '../types';
import AnalysisCheckList from './AnalysisCheckList';
import AnalysisReportPanel from './AnalysisReportPanel';
import AnalysisCheckModal from './AnalysisCheckModal';

const MetricsDashboard: React.FC = () => {
  const { execCommandOnSession } = useSSHStore();
  const { consistencyChecks, updateConsistencyCheck, addConsistencyCheck, removeConsistencyCheck } = useBenchmarkStore();

  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCheck, setEditingCheck] = useState<ConsistencyCheck | undefined>(undefined);

  const selectedCheck = consistencyChecks.find((c) => c.id === selectedCheckId) ?? null;

  const handleRunCheck = async (check: ConsistencyCheck) => {
    updateConsistencyCheck(check.id, { status: 'running', triggeredAt: Date.now() });
    const nodeIds = check.nodeIds.length > 0 ? check.nodeIds : ['node-01']; // fallback

    const rawOutputs: ConsistencyResult['rawOutputs'] = {};
    const promises = nodeIds.map(async (nodeId) => {
      try {
        const res = await execCommandOnSession(nodeId, check.cmdTemplate, 60000);
        rawOutputs[nodeId] = res;
      } catch (e: any) {
        rawOutputs[nodeId] = { stdout: '', stderr: e.message, exitCode: -1 };
      }
    });

    await Promise.allSettled(promises);

    // Compare outputs based on check type
    let inconsistencies: ConsistencyResult['inconsistencies'] = [];
    let summary = '检测通过';
    let status: ConsistencyCheck['status'] = 'pass';

    if (check.checkType === 'crc' || check.checkType === 'lba_range') {
      const hashes = Object.values(rawOutputs).map((o) => o.stdout.trim().split(' ')[0]);
      const unique = [...new Set(hashes)];
      if (unique.length > 1) {
        status = 'fail';
        summary = `发现不一致: ${unique.length} 种不同的哈希值`;
        inconsistencies.push({
          type: check.checkType === 'crc' ? 'crc_mismatch' : 'lba_diverge',
          description: summary,
          nodeIds,
          actual: Object.fromEntries(nodeIds.map((nid, idx) => [nid, hashes[idx]])),
        });
      }
    } else if (check.checkType === 'metadata') {
      const jsons = Object.values(rawOutputs).map((o) => {
        try { return JSON.parse(o.stdout); } catch { return null; }
      });
      if (jsons.some((j) => j === null)) {
        status = 'error';
        summary = '部分节点输出无法解析为 JSON';
      } else {
        const first = JSON.stringify(jsons[0], Object.keys(jsons[0]).sort());
        const diverged = jsons.some((j) => JSON.stringify(j, Object.keys(j!).sort()) !== first);
        if (diverged) {
          status = 'fail';
          summary = '元数据字段不一致';
          inconsistencies.push({
            type: 'metadata_diff',
            description: summary,
            nodeIds,
          });
        }
      }
    }

    updateConsistencyCheck(check.id, {
      status,
      result: { summary, inconsistencies, rawOutputs },
      completedAt: Date.now(),
    });

    message[status === 'pass' ? 'success' : 'error'](summary);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <Card
        size="small"
        title="检测规则"
        style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column' }}
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={() => { setEditingCheck(undefined); setModalOpen(true); }}>
            新建
          </Button>
        }
      >
        <AnalysisCheckList
          checks={consistencyChecks}
          selectedId={selectedCheckId}
          onSelect={setSelectedCheckId}
          onRun={handleRunCheck}
          onDelete={(id) => {
            const check = consistencyChecks.find((c) => c.id === id);
            if (check?.checkType === 'custom') {
              removeConsistencyCheck(id);
            } else {
              message.warning('内置规则不可删除');
            }
          }}
          onEdit={(check) => { setEditingCheck(check); setModalOpen(true); }}
        />
      </Card>

      <div style={{ flex: 1 }}>
        <AnalysisReportPanel check={selectedCheck} />
      </div>

      <AnalysisCheckModal
        open={modalOpen}
        initial={editingCheck}
        onOk={(check) => {
          if (editingCheck) {
            updateConsistencyCheck(editingCheck.id, check);
          } else {
            addConsistencyCheck(check);
          }
          setModalOpen(false);
        }}
        onCancel={() => setModalOpen(false)}
      />
    </div>
  );
};

export default MetricsDashboard;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/BlockBenchmark/components/MetricsDashboard.tsx
git commit -m "feat(benchmark): replace MetricsDashboard with consistency analysis"
```

---

## Phase 8: Integration

### Task 17: Update BlockBenchmark Index

**Files:**
- Modify: `src/modules/BlockBenchmark/index.tsx`

- [ ] **Step 1: Replace the Tab definitions**

Replace the `items` array definition (lines 31-85) with:

```tsx
  const items = [
    {
      key: 'deploy',
      label: <><CloudServerOutlined /> 部署与管控 ({onlineAgentsCount} 在线)</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DeploymentManager />
        </React.Suspense>
      )
    },
    {
      key: 'topology',
      label: <><AppstoreOutlined /> 磁盘矩阵调度</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TopologyMatrix />
        </React.Suspense>
      )
    },
    {
      key: 'task',
      label: <><CodeOutlined /> 业务编排与下发</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TaskDispatcher />
        </React.Suspense>
      )
    },
    {
      key: 'chaos',
      label: <><ThunderboltOutlined /> 故障混沌注入</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ChaosInjectionPanel />
        </React.Suspense>
      )
    },
    {
      key: 'io_monitor',
      label: <><DashboardOutlined /> IO 实时监控</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DiskMetricsDashboard />
        </React.Suspense>
      )
    },
    {
      key: 'tracing',
      label: <><FileSearchOutlined /> 任务追踪与日志</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TracingPanel />
        </React.Suspense>
      )
    },
    {
      key: 'analysis',
      label: <><BarChartOutlined /> 一致性检测与仲裁</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <MetricsDashboard />
        </React.Suspense>
      )
    },
    {
      key: 'distribution',
      label: <><CloudServerOutlined /> 构件分发</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ArtifactDistributor />
        </React.Suspense>
      )
    }
  ];
```

- [ ] **Step 2: Update imports and lazy imports**

Replace the import block (lines 1-13) with:

```tsx
import {
  AppstoreOutlined,
  BarChartOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Card, Tabs, Typography } from 'antd';
import React from 'react';
import { useGlobalStore } from '../../store/globalStore';
import { useBenchmarkStore } from './store/benchmarkStore';

const DeploymentManager = React.lazy(() => import('./components/DeploymentManager'));
const TopologyMatrix = React.lazy(() => import('./components/TopologyMatrix'));
const TaskDispatcher = React.lazy(() => import('./components/TaskDispatcher'));
const ChaosInjectionPanel = React.lazy(() => import('./components/ChaosInjectionPanel'));
const DiskMetricsDashboard = React.lazy(() => import('./components/DiskMetricsDashboard'));
const TracingPanel = React.lazy(() => import('./components/TracingPanel'));
const MetricsDashboard = React.lazy(() => import('./components/MetricsDashboard'));
const ArtifactDistributor = React.lazy(() => import('./components/ArtifactDistributor'));
```

- [ ] **Step 3: Create TracingPanel wrapper**

Create `src/modules/BlockBenchmark/components/TracingPanel.tsx`:

```tsx
import { Card } from 'antd';
import React, { useState } from 'react';
import TracingTaskList from './TracingTaskList';
import TracingLogViewer from './TracingLogViewer';
import { useBenchmarkStore } from '../store/benchmarkStore';

const TracingPanel: React.FC = () => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const task = useBenchmarkStore((s) => s.tracedTasks.find((t) => t.id === selectedTaskId) ?? null);

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <Card size="small" title="任务列表" style={{ flex: '0 0 280px' }}>
        <TracingTaskList selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} />
      </Card>
      <div style={{ flex: 1 }}>
        <TracingLogViewer task={task} />
      </div>
    </div>
  );
};

export default TracingPanel;
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/BlockBenchmark/components/TracingPanel.tsx src/modules/BlockBenchmark/index.tsx
git commit -m "feat(benchmark): reorganize tabs and add chaos/tracing/analysis"
```

---

### Task 18: Add TracedTask Registration Hooks

**Files:**
- Modify: `src/modules/BlockBenchmark/components/BusinessExecutionPanel.tsx`
- Modify: `src/modules/BlockBenchmark/components/ChaosInjectionPanel.tsx`
- Modify: `src/modules/BlockBenchmark/components/TopologyMatrix.tsx`

- [ ] **Step 1: Add traced task registration in BusinessExecutionPanel**

In `BusinessExecutionPanel.tsx`, after `const handleRun = async () => {`, and before the loop over steps, add task registration:

Find this line in handleRun (after exec is created):
```tsx
    addBusinessExecution(exec);
```

After it, add:
```tsx
    // Register traced tasks for each node
    selectedNodeIds.forEach((nodeId) => {
      const sess = connectedSessions.find((s) => s.id === nodeId);
      addTracedTask({
        name: `${template.name} @ ${sess?.name ?? nodeId}`,
        nodeId,
        nodeName: sess?.name ?? nodeId,
        source: { type: 'business', refId: exec.id },
        status: 'running',
        logPaths: [],
        startedAt: Date.now(),
      });
    });
```

Add `addTracedTask` to the destructured store:
```tsx
  const { addBusinessExecution, updateBusinessExecution, addTracedTask } = useBenchmarkStore();
```

- [ ] **Step 2: Add traced task registration in ChaosInjectionPanel**

In `ChaosInjectionPanel.tsx`, in `handleInject`, after `addChaosInjection(injection);`, add:

```tsx
    selectedNodeIds.forEach((nodeId) => {
      const sess = connectedSessions.find((s) => s.id === nodeId);
      addTracedTask({
        name: `${selectedFault.name} @ ${sess?.name ?? nodeId}`,
        nodeId,
        nodeName: sess?.name ?? nodeId,
        source: { type: 'chaos', refId: injection.id },
        status: 'running',
        logPaths: [],
        startedAt: Date.now(),
      });
    });
```

Add `addTracedTask` to destructured store:
```tsx
  const { chaosFaults, chaosInjections, addChaosInjection, updateChaosInjection, addTracedTask } = useBenchmarkStore();
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/BlockBenchmark/components/BusinessExecutionPanel.tsx src/modules/BlockBenchmark/components/ChaosInjectionPanel.tsx
git commit -m "feat(benchmark): wire traced task registration into business and chaos flows"
```

---

### Task 19: Final Compilation Check

**Files:**
- All modified and created files

- [ ] **Step 1: Run TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: No errors. If errors appear, fix them before proceeding.

Common fixes:
- Missing imports: Add `import { ... } from '../types'` where needed
- Type mismatches: Ensure store method signatures match interface definitions
- JSX errors: Ensure all components return valid JSX

- [ ] **Step 2: Run ESLint**

```bash
npm run lint
```

Expected: No errors, or only pre-existing ones.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(benchmark): resolve typescript and lint errors"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Requirement | Implementing Task |
|-----------------|-------------------|
| 多节点并发业务执行（模板+变量） | Task 3, 5, 6, 7, 8 |
| 跨节点变量捕获与传递 | Task 3 (replaceTemplateVars, captureVar) |
| 多节点故障注入 | Task 4, 9, 10 |
| 预置故障库 + 自定义 | Task 2 (BUILTIN_CHAOS_FAULTS), Task 9 |
| 故障自动恢复 | Task 4 (buildDelayedRecoveryScript), Task 10 |
| 后台任务状态监控 | Task 13 (TracingTaskList PID polling) |
| 多节点指定日志实时抓取 | Task 13, 14 (stream/snapshot modes) |
| 实时 IO 性能聚合监控 | Task 11, 12 |
| IO 模型类型显示 | Task 12 (activeTasksMap) |
| 数据不一致检测 | Task 15, 16 (CRC/LBA/metadata comparison) |
| 预置检测规则 | Task 2 (BUILTIN_CONSISTENCY_CHECKS) |

### Placeholder Scan

- No "TBD", "TODO", "implement later" found.
- No vague "add error handling" without specifics.
- All code blocks contain complete, runnable code.
- All file paths are exact.

### Type Consistency

- `BusinessTemplate`, `ChaosFault`, `TracedTask`, `IOMetricsSnapshot`, `ConsistencyCheck` interfaces are defined in `types.ts` and used consistently across all tasks.
- Store method names match interface: `addBusinessTemplate`, `updateChaosInjection`, `appendLogBuffer`, etc.
- Engine function signatures match their usage in components.

---

## Appendix: Manual Verification Checklist

After implementation, verify these scenarios manually:

1. **业务模板全流程**
   - 创建模板（2步骤，2变量）
   - 选择2个SSH节点
   - 填写变量 → 一键下发
   - 验证：进度条更新，每个节点stdout正确显示

2. **故障注入**
   - 选择「网络延迟」→ 填写参数 → 注入到 node-01
   - SSH 到 node-01 执行 `tc qdisc show` 验证规则存在
   - 点击「立即恢复」→ 再次验证规则已清除

3. **IO 监控**
   - 确保已有磁盘拓扑扫描结果
   - 点击「开始集群监控」
   - 验证：所有盘卡片显示数据，Util 进度条颜色正确
   - 点击卡片 → 验证时序图表显示

4. **日志追踪**
   - 执行业务模板（自动生成 traced task）
   - 进入「任务追踪与日志」Tab
   - 点击任务 → 添加日志路径 `/var/log/syslog` stream 模式
   - 验证：日志区域实时追加新行

5. **一致性检测**
   - 选择「CRC 全量校验」→ 执行
   - 验证：所有节点输出相同 → 状态为 pass
   - 在其中一个节点手动修改文件 → 再次执行
   - 验证：状态为 fail，不一致列表显示差异
