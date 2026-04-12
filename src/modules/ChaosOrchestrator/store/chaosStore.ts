/**
 * chaosStore.ts
 * Zustand store for the ChaosOrchestrator module.
 *
 * A ChaosScenario is an ordered list of Steps executed sequentially by ScenarioRunner.
 * Step types:
 *   background   — launch a nohup SSH job (returns a bgjob id stored in bgJobRef)
 *   inject       — run a fault injection command (from FaultBuilder template or raw)
 *   wait         — sleep N seconds
 *   verify       — run a command, apply VerifyRules, produce PASS / FAIL
 *   recover      — run a recovery command
 *   kill_bg      — stop a background job by bgJobRef
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JobMode } from '../../SSHManager/store/backgroundJobStore';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StepType = 'background' | 'inject' | 'wait' | 'verify' | 'recover' | 'kill_bg';
export type VerifyType = 'contains' | 'not_contains' | 'regex' | 'exit_code_zero';

export interface VerifyRule {
  id: string;
  type: VerifyType;
  value: string;            // pattern / keyword / ignored for exit_code_zero
}

export interface ScenarioStep {
  id: string;
  type: StepType;
  label: string;

  // Applicable to: background, inject, verify, recover
  sessionIds: string[];     // target SSH session IDs

  // background
  bgCmd?: string;
  bgMode?: JobMode;
  bgInterval?: number;      // seconds (watch mode)
  bgAlertPattern?: string;

  // inject / recover (can reference a FaultBuilder template or be raw cmd)
  faultTemplateId?: string;
  faultParams?: Record<string, string | number>;
  rawCmd?: string;          // overrides template-generated cmd if present
  recoverCmd?: string;      // for inject steps: auto-generated recovery

  // wait
  waitSeconds?: number;

  // verify
  verifyCmd?: string;
  verifyRules?: VerifyRule[];
  continueOnFail?: boolean; // if false (default), scenario aborts on FAIL

  // kill_bg
  bgJobStepRef?: string;    // id of the background step whose job to kill
}

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'error';

export interface StepResult {
  stepId: string;
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  verifyDetails?: { rule: VerifyRule; passed: boolean }[];
  errorMsg?: string;
  bgJobId?: string;         // populated when step type=background
}

export type ScenarioStatus = 'idle' | 'running' | 'done' | 'aborted';

export interface ChaosScenario {
  id: string;
  name: string;
  description?: string;
  steps: ScenarioStep[];
  status: ScenarioStatus;
  currentStepIndex: number;
  stepResults: Record<string, StepResult>;
  startedAt?: number;
  endedAt?: number;
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface ChaosStore {
  scenarios: ChaosScenario[];

  // CRUD
  addScenario: (name: string, description?: string) => string;
  removeScenario: (id: string) => void;
  updateScenario: (id: string, patch: Partial<Pick<ChaosScenario, 'name' | 'description'>>) => void;

  // Step CRUD
  addStep: (scenarioId: string, step: Omit<ScenarioStep, 'id'>) => string;
  removeStep: (scenarioId: string, stepId: string) => void;
  updateStep: (scenarioId: string, stepId: string, patch: Partial<ScenarioStep>) => void;
  moveStep: (scenarioId: string, fromIndex: number, toIndex: number) => void;

  // Runner state mutations
  setScenarioStatus: (scenarioId: string, status: ScenarioStatus, currentStepIndex?: number) => void;
  setStepResult: (scenarioId: string, result: StepResult) => void;
  resetScenario: (scenarioId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_STEP: Omit<ScenarioStep, 'id' | 'type' | 'label'> = {
  sessionIds: [],
  waitSeconds: 10,
  bgMode: 'once',
  bgInterval: 2,
  continueOnFail: false,
};

// ─── Built-in scenario templates ─────────────────────────────────────────────

export function createBuiltinScenario(templateKey: 'disk_hang' | 'net_partition' | 'oom'): Omit<ChaosScenario, 'id'> {
  const makeStep = (type: StepType, label: string, extra: Partial<ScenarioStep> = {}): ScenarioStep => ({
    ...DEFAULT_STEP,
    id: uid(),
    type,
    label,
    ...extra,
  });

  const steps: ScenarioStep[] = {
    disk_hang: [
      makeStep('background', '启动卡IO嗅探（后台）', { bgCmd: "iostat -xd 2 | awk '/^Device/{h=1;next}h&&NF>=14{d=$1;r=$2;w=$8;u=$NF;if(u+0>5&&r+0<0.1&&w+0<0.1)printf \"[%s] STUCK_IO dev=%s util=%.1f%%\\n\",strftime(\"%H:%M:%S\"),d,u+0}'", bgMode: 'once', bgAlertPattern: 'STUCK_IO' }),
      makeStep('inject', '注入磁盘 Hang 故障', { faultTemplateId: 'blk-timeout', faultParams: { disk: 'vdb' }, recoverCmd: 'echo "running" > /sys/block/vdb/device/state' }),
      makeStep('wait', '等待故障传播 30 秒', { waitSeconds: 30 }),
      makeStep('verify', '校验 dmesg 中是否出现 I/O error', { verifyCmd: 'dmesg | tail -40', verifyRules: [{ id: uid(), type: 'contains', value: 'I/O error' }] }),
      makeStep('recover', '恢复磁盘 Hang 故障', { rawCmd: 'echo "running" > /sys/block/vdb/device/state' }),
      makeStep('kill_bg', '停止后台嗅探', { bgJobStepRef: '' }),
    ],
    net_partition: [
      makeStep('background', '启动 IO 业务压测（后台）', { bgCmd: 'fio --name=randwrite --ioengine=libaio --rw=randwrite --direct=1 --bs=4k --iodepth=32 --filename=/dev/vdb --runtime=300 --time_based', bgMode: 'once' }),
      makeStep('inject', '注入网络分区（iptables DROP）', { faultTemplateId: 'net-partition', faultParams: { targetIp: '192.168.1.100' }, recoverCmd: 'iptables -D INPUT -s 192.168.1.100 -j DROP; iptables -D OUTPUT -d 192.168.1.100 -j DROP' }),
      makeStep('wait', '等待 20 秒', { waitSeconds: 20 }),
      makeStep('verify', '校验服务心跳是否中断', { verifyCmd: 'curl -s --connect-timeout 5 http://192.168.1.100:8080/health', verifyRules: [{ id: uid(), type: 'not_contains', value: 'ok' }] }),
      makeStep('recover', '恢复网络分区', { rawCmd: 'iptables -D INPUT -s 192.168.1.100 -j DROP; iptables -D OUTPUT -d 192.168.1.100 -j DROP' }),
      makeStep('kill_bg', '停止后台压测', { bgJobStepRef: '' }),
    ],
    oom: [
      makeStep('inject', '触发急速 OOM', { faultTemplateId: 'os-oom', faultParams: { size: 4 } }),
      makeStep('wait', '等待 10 秒', { waitSeconds: 10 }),
      makeStep('verify', '校验 OOM Killer 是否触发', { verifyCmd: 'dmesg | grep -i "oom killer"', verifyRules: [{ id: uid(), type: 'contains', value: 'oom killer' }] }),
      makeStep('recover', '清理内存占用', { rawCmd: 'rm -f /tmp/oom_test/bloat 2>/dev/null; umount /tmp/oom_test 2>/dev/null; true' }),
    ],
  }[templateKey];

  const names = { disk_hang: '磁盘Hang + IO校验', net_partition: 'IO业务 + 网络分区注入', oom: 'OOM触发 + Killer校验' };
  return {
    name: names[templateKey],
    steps,
    status: 'idle',
    currentStepIndex: 0,
    stepResults: {},
  };
}

// ─── Store Implementation ─────────────────────────────────────────────────────

export const useChaosStore = create<ChaosStore>()(
  persist(
    (set) => ({
      scenarios: [],

      addScenario: (name, description) => {
        const id = uid();
        set(s => ({ scenarios: [...s.scenarios, { id, name, description, steps: [], status: 'idle', currentStepIndex: 0, stepResults: {} }] }));
        return id;
      },

      removeScenario: (id) =>
        set(s => ({ scenarios: s.scenarios.filter(sc => sc.id !== id) })),

      updateScenario: (id, patch) =>
        set(s => ({ scenarios: s.scenarios.map(sc => sc.id === id ? { ...sc, ...patch } : sc) })),

      addStep: (scenarioId, step) => {
        const id = uid();
        set(s => ({
          scenarios: s.scenarios.map(sc => sc.id === scenarioId
            ? { ...sc, steps: [...sc.steps, { ...DEFAULT_STEP, ...step, id }] }
            : sc
          )
        }));
        return id;
      },

      removeStep: (scenarioId, stepId) =>
        set(s => ({
          scenarios: s.scenarios.map(sc => sc.id === scenarioId
            ? { ...sc, steps: sc.steps.filter(st => st.id !== stepId) }
            : sc
          )
        })),

      updateStep: (scenarioId, stepId, patch) =>
        set(s => ({
          scenarios: s.scenarios.map(sc => sc.id === scenarioId
            ? { ...sc, steps: sc.steps.map(st => st.id === stepId ? { ...st, ...patch } : st) }
            : sc
          )
        })),

      moveStep: (scenarioId, fromIndex, toIndex) =>
        set(s => ({
          scenarios: s.scenarios.map(sc => {
            if (sc.id !== scenarioId) return sc;
            const steps = [...sc.steps];
            const [moved] = steps.splice(fromIndex, 1);
            steps.splice(toIndex, 0, moved);
            return { ...sc, steps };
          })
        })),

      setScenarioStatus: (scenarioId, status, currentStepIndex) =>
        set(s => ({
          scenarios: s.scenarios.map(sc => sc.id === scenarioId
            ? { ...sc, status, ...(currentStepIndex !== undefined ? { currentStepIndex } : {}), ...(status === 'running' ? { startedAt: Date.now() } : {}), ...(status === 'done' || status === 'aborted' ? { endedAt: Date.now() } : {}) }
            : sc
          )
        })),

      setStepResult: (scenarioId, result) =>
        set(s => ({
          scenarios: s.scenarios.map(sc => sc.id === scenarioId
            ? { ...sc, stepResults: { ...sc.stepResults, [result.stepId]: result } }
            : sc
          )
        })),

      resetScenario: (scenarioId) =>
        set(s => ({
          scenarios: s.scenarios.map(sc => sc.id === scenarioId
            ? { ...sc, status: 'idle', currentStepIndex: 0, stepResults: {}, startedAt: undefined, endedAt: undefined }
            : sc
          )
        })),
    }),
    {
      name: 'chaos-store',
      partialize: (s) => ({
        scenarios: s.scenarios.map(sc => ({
          ...sc,
          status: 'idle' as ScenarioStatus,
          currentStepIndex: 0,
          stepResults: {},
        })),
      }),
    }
  )
);
