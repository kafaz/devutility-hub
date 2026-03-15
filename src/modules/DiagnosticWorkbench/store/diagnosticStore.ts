import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';

export type FindingSeverity = 'info' | 'warning' | 'critical';
export type RuleSource = 'all' | 'stdout' | 'stderr';
export type BizRunMode = 'before_collection' | 'after_collection';

export interface DiagnosticCollectionStep {
  id: string;
  name: string;
  command: string;
  timeoutMs: number;
}

export interface DiagnosticAnalysisRule {
  id: string;
  name: string;
  pattern: string;
  source: RuleSource;
  severity: FindingSeverity;
  summary: string;
}

export interface DiagnosticBusinessAction {
  id: string;
  name: string;
  scriptPath: string;
  argsText: string;
  stdinPayload: string;
  runMode: BizRunMode;
  timeoutMs: number;
}

export interface DiagnosticPlaybook {
  id: string;
  name: string;
  description: string;
  symptomTemplate: string;
  collectionPlan: DiagnosticCollectionStep[];
  analysisRules: DiagnosticAnalysisRule[];
  businessActions: DiagnosticBusinessAction[];
  createdAt: number;
  updatedAt: number;
}

interface DiagnosticStore {
  playbooks: DiagnosticPlaybook[];
  activePlaybookId: string | null;
  addPlaybook: () => string;
  updatePlaybook: (id: string, data: Partial<DiagnosticPlaybook>) => void;
  deletePlaybook: (id: string) => void;
  setActivePlaybook: (id: string | null) => void;
}

const now = Date.now();

const defaultPlaybook: DiagnosticPlaybook = {
  id: 'playbook-web-diagnosis',
  name: '服务超时诊断编排',
  description: '适合服务抖动、接口超时、节点异常时做一次最小闭环采集与归纳。',
  symptomTemplate: '示例：订单服务超时，部分节点出现 502，怀疑应用或依赖异常。',
  collectionPlan: [
    { id: 'step-date', name: '采集时间与节点', command: 'date && hostname && uptime', timeoutMs: 10000 },
    { id: 'step-process', name: '检查关键进程', command: 'ps aux | grep -E "java|node|nginx" | grep -v grep | head -20', timeoutMs: 15000 },
    { id: 'step-port', name: '检查监听端口', command: 'ss -tlnp | head -40', timeoutMs: 15000 },
    { id: 'step-log', name: '采集最近错误日志', command: 'journalctl -n 120 --no-pager', timeoutMs: 20000 },
  ],
  analysisRules: [
    { id: 'rule-timeout', name: '超时特征', pattern: 'timeout|timed out|超时', source: 'all', severity: 'critical', summary: '输出中出现超时或阻塞信号' },
    { id: 'rule-refused', name: '连接拒绝', pattern: 'connection refused|refused|连接被拒绝', source: 'all', severity: 'critical', summary: '疑似端口未监听或依赖不可达' },
    { id: 'rule-error', name: 'ERROR 关键字', pattern: '\\berror\\b|exception|panic|fatal', source: 'all', severity: 'warning', summary: '日志中出现通用错误特征' },
  ],
  businessActions: [
    {
      id: 'biz-smoke',
      name: '业务冒烟脚本',
      scriptPath: 'examples/business_smoke_test.py',
      argsText: '["--action","health-check","--target","order-service"]',
      stdinPayload: '{\n  "scene": "order-check",\n  "expect": "200"\n}',
      runMode: 'before_collection',
      timeoutMs: 15000,
    },
  ],
  createdAt: now,
  updatedAt: now,
};

function normalizeCollectionStep(step: Partial<DiagnosticCollectionStep> | undefined, index: number): DiagnosticCollectionStep {
  return {
    id: String(step?.id || generateId()),
    name: String(step?.name || `采集步骤 ${index + 1}`),
    command: String(step?.command || 'echo "replace me"'),
    timeoutMs: Number(step?.timeoutMs || 15000),
  };
}

function normalizeAnalysisRule(rule: Partial<DiagnosticAnalysisRule> | undefined, index: number): DiagnosticAnalysisRule {
  const source = rule?.source === 'stdout' || rule?.source === 'stderr' ? rule.source : 'all';
  const severity = rule?.severity === 'info' || rule?.severity === 'critical' ? rule.severity : 'warning';

  return {
    id: String(rule?.id || generateId()),
    name: String(rule?.name || `分析规则 ${index + 1}`),
    pattern: String(rule?.pattern || 'error|failed'),
    source,
    severity,
    summary: String(rule?.summary || ''),
  };
}

function normalizeBusinessAction(action: Partial<DiagnosticBusinessAction> | undefined, index: number): DiagnosticBusinessAction {
  return {
    id: String(action?.id || generateId()),
    name: String(action?.name || `业务动作 ${index + 1}`),
    scriptPath: String(action?.scriptPath || ''),
    argsText: String(action?.argsText || '[]'),
    stdinPayload: String(action?.stdinPayload || ''),
    runMode: action?.runMode === 'after_collection' ? 'after_collection' : 'before_collection',
    timeoutMs: Number(action?.timeoutMs || 15000),
  };
}

function normalizePlaybook(playbook: Partial<DiagnosticPlaybook> | undefined, index: number): DiagnosticPlaybook {
  const collectionPlan = Array.isArray(playbook?.collectionPlan) && playbook.collectionPlan.length > 0
    ? playbook.collectionPlan.map((step, stepIndex) => normalizeCollectionStep(step, stepIndex))
    : defaultPlaybook.collectionPlan.map((step, stepIndex) => normalizeCollectionStep(step, stepIndex));

  const analysisRules = Array.isArray(playbook?.analysisRules) && playbook.analysisRules.length > 0
    ? playbook.analysisRules.map((rule, ruleIndex) => normalizeAnalysisRule(rule, ruleIndex))
    : defaultPlaybook.analysisRules.map((rule, ruleIndex) => normalizeAnalysisRule(rule, ruleIndex));

  const businessActions = Array.isArray(playbook?.businessActions)
    ? playbook.businessActions.map((action, actionIndex) => normalizeBusinessAction(action, actionIndex))
    : [];

  return {
    id: String(playbook?.id || `diagnostic-playbook-${index + 1}`),
    name: String(playbook?.name || `诊断编排 ${index + 1}`),
    description: String(playbook?.description || ''),
    symptomTemplate: String(playbook?.symptomTemplate || ''),
    collectionPlan,
    analysisRules,
    businessActions,
    createdAt: Number(playbook?.createdAt || Date.now()),
    updatedAt: Number(playbook?.updatedAt || Date.now()),
  };
}

function normalizePlaybooks(playbooks: unknown): DiagnosticPlaybook[] {
  if (!Array.isArray(playbooks) || playbooks.length === 0) {
    return [normalizePlaybook(defaultPlaybook, 0)];
  }

  return playbooks.map((playbook, index) => normalizePlaybook(playbook as Partial<DiagnosticPlaybook>, index));
}

export const useDiagnosticStore = create<DiagnosticStore>()(
  persist(
    (set) => ({
      playbooks: [normalizePlaybook(defaultPlaybook, 0)],
      activePlaybookId: defaultPlaybook.id,

      addPlaybook: () => {
        const id = generateId();
        const timestamp = Date.now();
        const next: DiagnosticPlaybook = {
          id,
          name: '新诊断编排',
          description: '',
          symptomTemplate: '',
          collectionPlan: [
            { id: generateId(), name: '新采集步骤', command: 'echo "replace me"', timeoutMs: 15000 },
          ],
          analysisRules: [
            { id: generateId(), name: '新分析规则', pattern: 'error|failed', source: 'all', severity: 'warning', summary: '' },
          ],
          businessActions: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => ({
          playbooks: [...state.playbooks, next],
          activePlaybookId: id,
        }));
        return id;
      },

      updatePlaybook: (id, data) => set((state) => ({
        playbooks: state.playbooks.map((playbook) =>
          playbook.id === id
            ? { ...playbook, ...data, updatedAt: Date.now() }
            : playbook
        ),
      })),

      deletePlaybook: (id) => set((state) => {
        const nextPlaybooks = state.playbooks.filter((playbook) => playbook.id !== id);
        return {
          playbooks: nextPlaybooks.length ? nextPlaybooks : [defaultPlaybook],
          activePlaybookId:
            state.activePlaybookId === id
              ? (nextPlaybooks[0]?.id || defaultPlaybook.id)
              : state.activePlaybookId,
        };
      }),

      setActivePlaybook: (id) => set({ activePlaybookId: id }),
    }),
    {
      name: 'devutility-diagnostic-playbooks',
      partialize: (state) => ({
        playbooks: state.playbooks,
        activePlaybookId: state.activePlaybookId,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<DiagnosticStore>) || {};
        const playbooks = normalizePlaybooks(persisted.playbooks);
        const activePlaybookId = playbooks.some((playbook) => playbook.id === persisted.activePlaybookId)
          ? persisted.activePlaybookId || playbooks[0].id
          : playbooks[0].id;

        return {
          ...currentState,
          ...persisted,
          playbooks,
          activePlaybookId,
        };
      },
    }
  )
);
