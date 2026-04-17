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
