import type { CommandTemplate } from '../../types';
import { generateId } from '../../utils';
import type { LockedEvidence } from './store/evidenceStore';
import type {
  DiagnosticCollectionStep,
  DiagnosticScenarioType,
  DiagnosticStepPhase,
} from './store/diagnosticStore';

export interface ScenarioMeta {
  label: string;
  color: string;
  description: string;
}

export interface PhaseMeta {
  label: string;
  color: string;
}

export interface ScenarioCommandLibraryItem {
  id: string;
  name: string;
  description: string;
  scenarioTypes: DiagnosticScenarioType[];
  phase: DiagnosticStepPhase;
  riskLevel: 'read_only' | 'mutation';
  command: string;
  expectedSignal: string;
  tags: string[];
}

export const SCENARIO_META: Record<DiagnosticScenarioType, ScenarioMeta> = {
  problem_localization: {
    label: '问题定位',
    color: 'blue',
    description: '围绕日志、进程、端口和依赖链快速收敛首个异常点。',
  },
  chaos_validation: {
    label: '混沌演练',
    color: 'volcano',
    description: '在注入前后对齐基线、异常窗口和恢复结果。',
  },
  io_validation: {
    label: 'IO 验证',
    color: 'geekblue',
    description: '把设备层、文件系统层和业务层的 IO 信号对齐分析。',
  },
  fault_injection: {
    label: '故障注入',
    color: 'magenta',
    description: '记录注入动作、影响范围和回滚验证闭环。',
  },
};

export const STEP_PHASE_META: Record<DiagnosticStepPhase, PhaseMeta> = {
  prepare: { label: '准备', color: 'default' },
  trigger: { label: '触发', color: 'orange' },
  observe: { label: '观测', color: 'processing' },
  collect: { label: '采集', color: 'cyan' },
  recover: { label: '恢复', color: 'green' },
};

export const DIAGNOSTIC_COMMAND_LIBRARY: ScenarioCommandLibraryItem[] = [
  {
    id: 'cmd-journal-errors',
    name: '错误日志窗口',
    description: '统一抓最近错误、异常和 timeout 日志，适合作为首轮证据。',
    scenarioTypes: ['problem_localization', 'chaos_validation', 'io_validation', 'fault_injection'],
    phase: 'collect',
    riskLevel: 'read_only',
    command: 'journalctl -n 200 --no-pager | grep -Ei "error|exception|panic|fatal|timeout|refused|reset" || true',
    expectedSignal: '拿到最新错误日志窗口，供后续定位和证据锁定。',
    tags: ['error', 'timeout', 'panic', 'journalctl'],
  },
  {
    id: 'cmd-port-health',
    name: '端口与连接健康',
    description: '优先确认监听状态和连接积压，适合 timeout / refused 场景。',
    scenarioTypes: ['problem_localization', 'chaos_validation', 'fault_injection'],
    phase: 'observe',
    riskLevel: 'read_only',
    command: 'ss -tlnp && ss -s',
    expectedSignal: '确认端口监听、连接数和连接状态是否异常。',
    tags: ['timeout', 'refused', 'port', 'network'],
  },
  {
    id: 'cmd-process-top',
    name: '热点进程快照',
    description: '看进程维度的 CPU / MEM 压力，排除被打满或僵死的进程。',
    scenarioTypes: ['problem_localization', 'chaos_validation', 'fault_injection'],
    phase: 'observe',
    riskLevel: 'read_only',
    command: 'ps aux --sort=-%cpu | head -20 && ps aux --sort=-%mem | head -20',
    expectedSignal: '识别高负载、重启中的进程或异常资源占用。',
    tags: ['cpu', 'memory', 'process', 'hang'],
  },
  {
    id: 'cmd-grep-context',
    name: '日志上下文 grep',
    description: '带上下文过滤问题关键字，适合把错误前后文一并抓出。',
    scenarioTypes: ['problem_localization', 'io_validation', 'fault_injection'],
    phase: 'collect',
    riskLevel: 'read_only',
    command: 'grep -RinC 3 -E "error|timeout|panic|fatal|refused" /var/log 2>/dev/null | head -200',
    expectedSignal: '获取错误前后文，减少人工二次 grep。',
    tags: ['grep', 'context', 'error', 'timeout'],
  },
  {
    id: 'cmd-iostat',
    name: 'iostat 观测',
    description: '标准设备延迟和利用率采集，适合 IO 抖动或阻塞场景。',
    scenarioTypes: ['io_validation'],
    phase: 'observe',
    riskLevel: 'read_only',
    command: 'iostat -dx 1 5',
    expectedSignal: '对齐 util、await、avgqu-sz、svctm 等指标窗口。',
    tags: ['io', 'latency', 'await', 'util'],
  },
  {
    id: 'cmd-dmesg-io',
    name: '内核 I/O 错误窗口',
    description: '从内核日志里抓 reset、超时和设备异常。',
    scenarioTypes: ['io_validation', 'fault_injection'],
    phase: 'collect',
    riskLevel: 'read_only',
    command: 'dmesg | tail -160 | grep -Ei "nvme|blk|scsi|i/o|reset|timeout|error" || true',
    expectedSignal: '确认是否存在设备层或驱动层异常。',
    tags: ['io', 'nvme', 'blk', 'reset', 'timeout'],
  },
  {
    id: 'cmd-pidstat-io',
    name: '进程 IO 压力观察',
    description: '识别到底是哪类进程在拖高 IO 队列或吞吐。',
    scenarioTypes: ['io_validation'],
    phase: 'observe',
    riskLevel: 'read_only',
    command: 'pidstat -d 1 5 | head -120',
    expectedSignal: '对齐热点进程和 IO 指标峰值。',
    tags: ['io', 'pidstat', 'process', 'throughput'],
  },
  {
    id: 'cmd-fio-smoke',
    name: 'FIO 冒烟模板',
    description: '用于手工发起一轮可控 IO 压测，适合对照业务回压验证。',
    scenarioTypes: ['io_validation'],
    phase: 'trigger',
    riskLevel: 'mutation',
    command: 'fio --name=devutility-smoke --filename=/tmp/devutility-fio.bin --rw=randwrite --bs=4k --iodepth=16 --numjobs=1 --size=256m --runtime=30 --time_based=1 --group_reporting',
    expectedSignal: '产生一段受控 IO 压力，观察业务和系统是否同步异常。',
    tags: ['fio', 'io', 'smoke', 'pressure'],
  },
  {
    id: 'cmd-netem-delay',
    name: '网络抖动注入',
    description: '标准 netem delay 模板，用于混沌或故障注入前编辑后执行。',
    scenarioTypes: ['chaos_validation', 'fault_injection'],
    phase: 'trigger',
    riskLevel: 'mutation',
    command: 'tc qdisc add dev eth0 root netem delay 200ms 50ms',
    expectedSignal: '注入网络抖动后，日志和业务健康应能体现影响。',
    tags: ['netem', 'network', 'delay', 'chaos'],
  },
  {
    id: 'cmd-netem-recover',
    name: '网络抖动恢复',
    description: '与 netem delay 配套的恢复命令。',
    scenarioTypes: ['chaos_validation', 'fault_injection'],
    phase: 'recover',
    riskLevel: 'mutation',
    command: 'tc qdisc del dev eth0 root netem',
    expectedSignal: '恢复命令执行后，业务健康和错误日志应回落。',
    tags: ['netem', 'recover', 'network', 'rollback'],
  },
  {
    id: 'cmd-stress-cpu',
    name: 'CPU 压力注入',
    description: '用于验证 CPU 打满时服务行为和回滚路径。',
    scenarioTypes: ['chaos_validation', 'fault_injection'],
    phase: 'trigger',
    riskLevel: 'mutation',
    command: 'stress-ng --cpu 4 --timeout 60s --metrics-brief',
    expectedSignal: '触发 CPU 争抢，观察服务超时、队列积压和恢复情况。',
    tags: ['stress-ng', 'cpu', 'chaos', 'saturation'],
  },
  {
    id: 'cmd-kill-process',
    name: '进程故障注入',
    description: '用于验证关键进程被杀后的重启策略和日志可观测性。',
    scenarioTypes: ['fault_injection'],
    phase: 'trigger',
    riskLevel: 'mutation',
    command: 'pkill -9 -f your-service-name',
    expectedSignal: '触发进程故障后，日志中应出现退出、拉起或告警信号。',
    tags: ['kill', 'process', 'fault', 'restart'],
  },
  {
    id: 'cmd-system-health',
    name: '系统基线体征',
    description: '统一看时间、负载、内存和磁盘使用率，适合作为演练前后基线。',
    scenarioTypes: ['problem_localization', 'chaos_validation', 'io_validation', 'fault_injection'],
    phase: 'prepare',
    riskLevel: 'read_only',
    command: 'date && hostname && uptime && free -m && df -h',
    expectedSignal: '建立统一基线，后续所有异常都能对照这一刻的系统状态。',
    tags: ['baseline', 'uptime', 'memory', 'disk'],
  },
];

function tokenizeSearchText(input: string) {
  return String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fff]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getScenarioCommandLibraryItems(
  scenarioType?: DiagnosticScenarioType,
  searchText = ''
) {
  const tokens = tokenizeSearchText(searchText);

  return DIAGNOSTIC_COMMAND_LIBRARY
    .filter((item) => !scenarioType || item.scenarioTypes.includes(scenarioType))
    .map((item) => {
      const haystack = [
        item.name,
        item.description,
        item.command,
        item.expectedSignal,
        item.tags.join(' '),
      ].join(' ').toLowerCase();

      const score = tokens.reduce((sum, token) => (
        haystack.includes(token) ? sum + 1 : sum
      ), 0);

      return { item, score };
    })
    .sort((left, right) => (
      right.score - left.score ||
      Number(left.item.riskLevel === 'mutation') - Number(right.item.riskLevel === 'mutation') ||
      left.item.name.localeCompare(right.item.name)
    ))
    .map((entry) => entry.item);
}

export function buildCollectionStepFromLibraryItem(item: ScenarioCommandLibraryItem): DiagnosticCollectionStep {
  return {
    id: generateId(),
    name: item.name,
    command: item.command,
    timeoutMs: item.riskLevel === 'mutation' ? 60000 : 20000,
    phase: item.phase,
    expectedSignal: item.expectedSignal,
    continueOnFailure: item.riskLevel === 'read_only',
  };
}

export function buildCommandTemplateFromLibraryItem(
  item: ScenarioCommandLibraryItem
): Omit<CommandTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  const firstScenario = item.scenarioTypes[0] || 'problem_localization';
  return {
    name: item.name,
    category: `诊断/${SCENARIO_META[firstScenario].label}`,
    description: item.description,
    template: item.command,
    variables: [],
  };
}

export function buildEvidenceMarkdown(items: LockedEvidence[]) {
  const lines = ['# 证据锁定面板', ''];

  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.title}`);
    lines.push(`- 来源: ${item.sourceType}`);
    if (item.sessionLabel) lines.push(`- 会话: ${item.sessionLabel}`);
    if (item.command) lines.push(`- 命令: \`${item.command}\``);
    if (item.tags.length) lines.push(`- 标签: ${item.tags.join(', ')}`);
    lines.push(`- 摘要: ${item.summary || '无'}`);
    lines.push('');
    lines.push('```text');
    lines.push(item.content || '');
    lines.push('```');
    lines.push('');
  });

  return lines.join('\n').trim();
}
