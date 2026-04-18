import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../../../utils';

export type DiagnosticScenarioType =
  | 'problem_localization'
  | 'chaos_validation'
  | 'io_validation'
  | 'fault_injection';

export type FindingSeverity = 'info' | 'warning' | 'critical';
export type RuleSource = 'all' | 'stdout' | 'stderr';
export type BizRunMode = 'before_collection' | 'after_collection';
export type DiagnosticStepPhase = 'prepare' | 'trigger' | 'observe' | 'collect' | 'recover';

export interface DiagnosticCollectionStep {
  id: string;
  name: string;
  command: string;
  timeoutMs: number;
  phase: DiagnosticStepPhase;
  expectedSignal: string;
  continueOnFailure: boolean;
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
  scenarioType: DiagnosticScenarioType;
  objective: string;
  successCriteria: string;
  tags: string[];
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

export const BUILTIN_DIAGNOSTIC_PLAYBOOKS: DiagnosticPlaybook[] = [
  {
    id: 'playbook-web-diagnosis',
    name: '服务超时诊断编排',
    description: '适合服务抖动、接口超时、节点异常时做一次最小闭环采集与归纳。',
    scenarioType: 'problem_localization',
    objective: '先拿到首个异常点，再补足依赖、端口和日志证据。',
    successCriteria: '明确服务侧、依赖侧还是节点侧异常，并产出下一跳验证命令。',
    tags: ['timeout', 'service', 'journalctl', 'port'],
    symptomTemplate: '示例：订单服务超时，部分节点出现 502，怀疑应用或依赖异常。',
    collectionPlan: [
      {
        id: 'step-date',
        name: '采集时间与节点',
        command: 'date && hostname && uptime',
        timeoutMs: 10000,
        phase: 'prepare',
        expectedSignal: '确认节点时间、主机身份和当前负载基线',
        continueOnFailure: false,
      },
      {
        id: 'step-process',
        name: '检查关键进程',
        command: 'ps aux | grep -E "java|node|nginx" | grep -v grep | head -20',
        timeoutMs: 15000,
        phase: 'observe',
        expectedSignal: '确认进程是否存活，是否存在异常 CPU / MEM 占用',
        continueOnFailure: true,
      },
      {
        id: 'step-port',
        name: '检查监听端口',
        command: 'ss -tlnp | head -40',
        timeoutMs: 15000,
        phase: 'observe',
        expectedSignal: '确认端口是否监听，异常连接是否堆积',
        continueOnFailure: true,
      },
      {
        id: 'step-log',
        name: '采集最近错误日志',
        command: 'journalctl -n 120 --no-pager',
        timeoutMs: 20000,
        phase: 'collect',
        expectedSignal: '抓到 timeout / refused / exception 等高风险日志',
        continueOnFailure: true,
      },
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
  },
  {
    id: 'playbook-io-validation',
    name: 'IO 抖动与阻塞定位',
    description: '围绕设备延迟、系统回压和内核错误快速确认 IO 路径上的首个异常。',
    scenarioType: 'io_validation',
    objective: '把设备层、文件系统层和业务层的异常窗口对齐到同一条证据链。',
    successCriteria: '确认是否存在 util / await 飙升、内核 I/O 错误或业务回压日志。',
    tags: ['io', 'latency', 'iostat', 'dmesg'],
    symptomTemplate: '示例：块存储 IO 延迟抖动，业务写入偶发 timeout，怀疑磁盘或内核侧异常。',
    collectionPlan: [
      {
        id: 'step-io-base',
        name: '采集 IO 基线',
        command: 'date && hostname && lsblk',
        timeoutMs: 12000,
        phase: 'prepare',
        expectedSignal: '确认设备拓扑、节点和当前时间窗',
        continueOnFailure: false,
      },
      {
        id: 'step-io-iostat',
        name: '采集 iostat',
        command: 'iostat -dx 1 3',
        timeoutMs: 20000,
        phase: 'observe',
        expectedSignal: '观察 util、await、svctm 等是否异常',
        continueOnFailure: true,
      },
      {
        id: 'step-io-pidstat',
        name: '采集 pidstat IO',
        command: 'pidstat -d 1 3 | head -80',
        timeoutMs: 20000,
        phase: 'observe',
        expectedSignal: '确认是否是单进程打满 IO 或出现明显回压',
        continueOnFailure: true,
      },
      {
        id: 'step-io-dmesg',
        name: '采集内核 I/O 日志',
        command: 'dmesg | tail -120',
        timeoutMs: 15000,
        phase: 'collect',
        expectedSignal: '抓取 reset、timeout、I/O error 等内核侧异常',
        continueOnFailure: true,
      },
      {
        id: 'step-io-journal',
        name: '过滤系统错误日志',
        command: 'journalctl -n 150 --no-pager | grep -Ei "blk|nvme|scsi|i/o|timeout|reset|error" || true',
        timeoutMs: 20000,
        phase: 'collect',
        expectedSignal: '把磁盘、文件系统和驱动异常集中到同一窗口',
        continueOnFailure: true,
      },
    ],
    analysisRules: [
      { id: 'rule-io-timeout', name: 'I/O Timeout', pattern: 'I/O error|timed out|timeout|reset', source: 'all', severity: 'critical', summary: '存在设备或内核侧 I/O 超时/重置特征' },
      { id: 'rule-io-readonly', name: '只读文件系统', pattern: 'read-only file system|readonly|ro filesystem', source: 'all', severity: 'critical', summary: '文件系统可能已进入只读保护模式' },
      { id: 'rule-io-latency', name: '高延迟信号', pattern: 'await|util|avgqu-sz', source: 'stdout', severity: 'warning', summary: '采集输出中出现 IO 延迟或队列堆积指标' },
    ],
    businessActions: [
      {
        id: 'biz-io-smoke',
        name: 'IO 冒烟验证',
        scriptPath: 'examples/business_smoke_test.py',
        argsText: '["--action","io-smoke","--target","shared-volume"]',
        stdinPayload: '{\n  "scene": "io-validation",\n  "expect": "stable"\n}',
        runMode: 'before_collection',
        timeoutMs: 15000,
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'playbook-chaos-regression',
    name: '混沌演练回归闭环',
    description: '适合在注入前后快速比对业务健康、错误日志和恢复结果。',
    scenarioType: 'chaos_validation',
    objective: '建立注入前基线、注入后异常证据、恢复后回归结果三段式闭环。',
    successCriteria: '能明确注入影响面、关键错误日志以及恢复后的健康状态。',
    tags: ['chaos', 'baseline', 'regression', 'recovery'],
    symptomTemplate: '示例：计划对节点执行网络抖动/CPU 压榨等混沌演练，需要在同一工作台看基线、注入和恢复结果。',
    collectionPlan: [
      {
        id: 'step-chaos-base',
        name: '采集演练前基线',
        command: 'date && hostname && uptime',
        timeoutMs: 10000,
        phase: 'prepare',
        expectedSignal: '记录注入前节点状态和时间',
        continueOnFailure: false,
      },
      {
        id: 'step-chaos-precheck',
        name: '预检服务健康',
        command: 'ss -s && ps aux --sort=-%cpu | head -15',
        timeoutMs: 15000,
        phase: 'prepare',
        expectedSignal: '确认注入前连接和进程状态正常',
        continueOnFailure: true,
      },
      {
        id: 'step-chaos-trigger',
        name: '注入命令占位',
        command: 'echo "[inject] replace with tc / stress-ng / iptables / kill command"',
        timeoutMs: 10000,
        phase: 'trigger',
        expectedSignal: '替换为真正的混沌注入命令后再执行',
        continueOnFailure: true,
      },
      {
        id: 'step-chaos-observe',
        name: '观察演练窗口日志',
        command: 'journalctl -n 160 --no-pager',
        timeoutMs: 20000,
        phase: 'observe',
        expectedSignal: '抓取 timeout / refused / panic / restart 等异常',
        continueOnFailure: true,
      },
      {
        id: 'step-chaos-recover',
        name: '恢复命令占位',
        command: 'echo "[recover] replace with rollback / recover command"',
        timeoutMs: 10000,
        phase: 'recover',
        expectedSignal: '替换为恢复命令并在恢复后再次执行健康检查',
        continueOnFailure: true,
      },
    ],
    analysisRules: [
      { id: 'rule-chaos-timeout', name: '演练窗口超时', pattern: 'timeout|timed out|超时', source: 'all', severity: 'critical', summary: '演练窗口出现明显超时或阻塞' },
      { id: 'rule-chaos-refused', name: '连接拒绝', pattern: 'connection refused|refused|连接被拒绝', source: 'all', severity: 'critical', summary: '演练后依赖侧连接可能断开或不可达' },
      { id: 'rule-chaos-restart', name: '服务重启/崩溃', pattern: 'panic|fatal|segfault|restarted|crash', source: 'all', severity: 'critical', summary: '演练期间出现服务重启或程序崩溃特征' },
    ],
    businessActions: [
      {
        id: 'biz-chaos-before',
        name: '演练前健康校验',
        scriptPath: 'examples/business_smoke_test.py',
        argsText: '["--action","health-check","--target","chaos-baseline"]',
        stdinPayload: '{\n  "stage": "before-chaos",\n  "expect": "healthy"\n}',
        runMode: 'before_collection',
        timeoutMs: 12000,
      },
      {
        id: 'biz-chaos-after',
        name: '演练后回归校验',
        scriptPath: 'examples/business_smoke_test.py',
        argsText: '["--action","health-check","--target","chaos-recovery"]',
        stdinPayload: '{\n  "stage": "after-chaos",\n  "expect": "recovered"\n}',
        runMode: 'after_collection',
        timeoutMs: 12000,
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'playbook-fault-injection',
    name: '故障注入与回滚验证',
    description: '用于把故障注入命令、日志观测和回滚结果放在一个编排里复盘。',
    scenarioType: 'fault_injection',
    objective: '记录注入动作本身、影响窗口日志和回滚后的验证结果。',
    successCriteria: '注入命令可复现、日志可定位、回滚后有明确恢复结论。',
    tags: ['fault', 'inject', 'rollback', 'verification'],
    symptomTemplate: '示例：需要验证进程 kill、网络限流、磁盘异常等故障注入动作是否被业务正确感知与恢复。',
    collectionPlan: [
      {
        id: 'step-fault-base',
        name: '采集注入前上下文',
        command: 'date && hostname && whoami',
        timeoutMs: 10000,
        phase: 'prepare',
        expectedSignal: '记录注入前身份、节点和时间',
        continueOnFailure: false,
      },
      {
        id: 'step-fault-trigger',
        name: '故障注入命令占位',
        command: 'echo "[inject] replace with process / network / disk fault command"',
        timeoutMs: 10000,
        phase: 'trigger',
        expectedSignal: '注入真实故障命令后，重点观察业务报错与恢复路径',
        continueOnFailure: true,
      },
      {
        id: 'step-fault-log',
        name: '采集错误日志窗口',
        command: 'journalctl -n 180 --no-pager | grep -Ei "error|panic|fatal|timeout|refused|reset" || true',
        timeoutMs: 20000,
        phase: 'collect',
        expectedSignal: '抓到故障注入后的关键报错和时间窗',
        continueOnFailure: true,
      },
      {
        id: 'step-fault-recover',
        name: '回滚命令占位',
        command: 'echo "[recover] replace with cleanup / rollback command"',
        timeoutMs: 10000,
        phase: 'recover',
        expectedSignal: '执行回滚后再次采集状态，确认恢复路径有效',
        continueOnFailure: true,
      },
    ],
    analysisRules: [
      { id: 'rule-fault-fatal', name: '致命错误', pattern: 'panic|fatal|segfault|assert', source: 'all', severity: 'critical', summary: '注入后出现程序级崩溃特征' },
      { id: 'rule-fault-timeout', name: '级联超时', pattern: 'timeout|timed out|超时', source: 'all', severity: 'critical', summary: '故障注入触发了级联超时或阻塞' },
      { id: 'rule-fault-refused', name: '连接不可达', pattern: 'connection refused|no route|network is unreachable', source: 'all', severity: 'warning', summary: '故障注入后依赖连接不可达' },
    ],
    businessActions: [
      {
        id: 'biz-fault-before',
        name: '注入前业务校验',
        scriptPath: 'examples/business_smoke_test.py',
        argsText: '["--action","health-check","--target","fault-baseline"]',
        stdinPayload: '{\n  "stage": "before-fault",\n  "expect": "healthy"\n}',
        runMode: 'before_collection',
        timeoutMs: 12000,
      },
      {
        id: 'biz-fault-after',
        name: '回滚后业务校验',
        scriptPath: 'examples/business_smoke_test.py',
        argsText: '["--action","health-check","--target","fault-recovery"]',
        stdinPayload: '{\n  "stage": "after-fault",\n  "expect": "recovered"\n}',
        runMode: 'after_collection',
        timeoutMs: 12000,
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
];

const defaultPlaybook = BUILTIN_DIAGNOSTIC_PLAYBOOKS[0];

function normalizeScenarioType(value: unknown): DiagnosticScenarioType {
  if (
    value === 'chaos_validation' ||
    value === 'io_validation' ||
    value === 'fault_injection'
  ) {
    return value;
  }
  return 'problem_localization';
}

function normalizeStepPhase(value: unknown): DiagnosticStepPhase {
  if (
    value === 'trigger' ||
    value === 'observe' ||
    value === 'collect' ||
    value === 'recover'
  ) {
    return value;
  }
  return 'prepare';
}

function normalizeCollectionStep(step: Partial<DiagnosticCollectionStep> | undefined, index: number): DiagnosticCollectionStep {
  return {
    id: String(step?.id || generateId()),
    name: String(step?.name || `采集步骤 ${index + 1}`),
    command: String(step?.command || 'echo "replace me"'),
    timeoutMs: Number(step?.timeoutMs || 15000),
    phase: normalizeStepPhase(step?.phase),
    expectedSignal: String(step?.expectedSignal || ''),
    continueOnFailure: Boolean(step?.continueOnFailure),
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
    scenarioType: normalizeScenarioType(playbook?.scenarioType),
    objective: String(playbook?.objective || ''),
    successCriteria: String(playbook?.successCriteria || ''),
    tags: Array.isArray(playbook?.tags)
      ? playbook.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [],
    symptomTemplate: String(playbook?.symptomTemplate || ''),
    collectionPlan,
    analysisRules,
    businessActions,
    createdAt: Number(playbook?.createdAt || Date.now()),
    updatedAt: Number(playbook?.updatedAt || Date.now()),
  };
}

function normalizePlaybooks(playbooks: unknown): DiagnosticPlaybook[] {
  const builtin = BUILTIN_DIAGNOSTIC_PLAYBOOKS.map((playbook, index) => normalizePlaybook(playbook, index));
  if (!Array.isArray(playbooks) || playbooks.length === 0) {
    return builtin;
  }

  const merged = [...builtin];
  playbooks
    .map((playbook, index) => normalizePlaybook(playbook as Partial<DiagnosticPlaybook>, index))
    .forEach((playbook) => {
      const existingIndex = merged.findIndex((item) => item.id === playbook.id);
      if (existingIndex >= 0) {
        merged[existingIndex] = playbook;
      } else {
        merged.push(playbook);
      }
    });

  return merged;
}

export const useDiagnosticStore = create<DiagnosticStore>()(
  persist(
    (set) => ({
      playbooks: normalizePlaybooks(BUILTIN_DIAGNOSTIC_PLAYBOOKS),
      activePlaybookId: defaultPlaybook.id,

      addPlaybook: () => {
        const id = generateId();
        const timestamp = Date.now();
        const next: DiagnosticPlaybook = {
          id,
          name: '新诊断编排',
          description: '',
          scenarioType: 'problem_localization',
          objective: '',
          successCriteria: '',
          tags: [],
          symptomTemplate: '',
          collectionPlan: [
            {
              id: generateId(),
              name: '新采集步骤',
              command: 'echo "replace me"',
              timeoutMs: 15000,
              phase: 'prepare',
              expectedSignal: '',
              continueOnFailure: false,
            },
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
