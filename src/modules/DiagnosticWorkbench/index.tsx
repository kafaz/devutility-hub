import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CopyOutlined,
  CodeOutlined,
  DeleteOutlined,
  HistoryOutlined,
  PlusOutlined,
  PushpinOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import React, { useEffect, useMemo, useState } from 'react';
import ResizableOutput from '../../components/shared/ResizableOutput';
import { useClipboard } from '../../hooks/useClipboard';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { PROXY_HTTP_BASE } from '../../config/runtime';
import { useGlobalStore } from '../../store/globalStore';
import { useCommandStore } from '../CommandBuilder/store/commandStore';
import { useAnalyzerStore } from '../SSHManager/store/analyzerStore';
import {
  extractCLookupHints,
  type FunctionCandidateToken,
  type SourceLocationCandidate,
} from '../../utils/sourceLookupHints';
import { filterNoiseText, RISK_SIGNAL_RE, shouldSuppressSessionLog, type LogNoiseOptions } from '../../utils/logNoise';
import { highlightCLines } from '../CodeContextExplorer/cHighlight';
import { generateId } from '../../utils';
import {
  buildCollectionStepFromLibraryItem,
  buildCommandTemplateFromLibraryItem,
  buildEvidenceMarkdown,
  getScenarioCommandLibraryItems,
  SCENARIO_META,
  STEP_PHASE_META,
} from './scenarioLibrary';
import {
  getDiagnosticWorkbenchSections,
  type DiagnosticWorkbenchView,
} from './viewModel';
import { useEvidenceStore } from './store/evidenceStore';
import LocalizationDesk from './LocalizationDesk/LocalizationDesk';
import type {
  LocalizationDeskCodeContextSummary,
  LocalizationDeskSessionLogItem,
} from './LocalizationDesk/types.ts';
import type { ManualCommandRunInput } from './LocalizationDesk/useManualCommandRuns.ts';
import type { TimelineWhiteboardNode } from './LocalizationDesk/useTimelineWhiteboard.ts';
import {
  getFlowRunActiveCodeBinding,
  getFlowRunManualCommandRuns,
  getFlowRunTimelineWhiteboard,
  getLocalizationDeskStateKey,
  toCodeContextBindingDraft,
  type CodeContextBindingDraftInput,
} from './LocalizationDesk/workbenchPersistence.ts';
import {
  type DiagnosticAnalysisRule,
  type DiagnosticBusinessAction,
  type DiagnosticCollectionStep,
  type DiagnosticPlaybook,
  type DiagnosticScenarioType,
  useDiagnosticStore,
} from './store/diagnosticStore';
import FloatingSourceWindow from './FloatingSourceWindow';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const PROXY_HTTP = PROXY_HTTP_BASE;

interface SessionOption {
  sessionId: string;
  host: string;
  username: string;
}

type AgentSessionLogItem = LocalizationDeskSessionLogItem;

interface SessionLogNoiseBucket {
  id: string;
  kind: 'builtin' | 'custom';
  label: string;
  count: number;
  sampleText?: string;
}

interface SessionLogNoiseMeta {
  total: number;
  visibleCount: number;
  foldedNoiseCount: number;
  foldedNoiseStats: SessionLogNoiseBucket[];
}

interface SimilarCase {
  runId: string;
  title: string;
  score: number;
  matchedSignals: string[];
  reportSummary: string;
  topFindings: string[];
  startedAt?: number;
}

interface DiagnosticFinding {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  evidence: string;
  sourceStepId?: string;
  sourceStepName: string;
}

interface DiagnosticReport {
  summary: string;
  rootCauseHypothesis: string;
  recommendations: string[];
  nextActions: string[];
  similarCaseHint?: string;
  notes?: string;
}

interface DiagnosticContextSnapshot {
  impactScope: string;
  triggerAction: string;
  recentChange: string;
  expectedBehavior: string;
  observationWindow: string;
  logKeywords: string;
}

interface DiagnosticRunRecord {
  id: string;
  title: string;
  symptom: string;
  notes?: string;
  sessionId?: string;
  scenarioType?: DiagnosticScenarioType;
  objective?: string;
  successCriteria?: string;
  tags?: string[];
  contextSnapshot?: Partial<DiagnosticContextSnapshot>;
  status: string;
  startedAt: number;
  finishedAt?: number;
  sessionLabel?: string;
  findingCount?: number;
  summary?: string;
  collectionSteps?: Array<{
    id: string;
    name: string;
    command: string;
    resolvedCommand?: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    startedAt?: number;
    finishedAt?: number;
    phase?: string;
    expectedSignal?: string;
    continueOnFailure?: boolean;
    status: string;
    conclusion?: string;
  }>;
  businessActions?: Array<{
    id: string;
    name: string;
    scriptPath: string;
    resolvedPath?: string;
    args: string[];
    stdinPayload: string;
    runMode: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    startedAt?: number;
    finishedAt?: number;
    status: string;
  }>;
  findings?: DiagnosticFinding[];
  similarCases?: SimilarCase[];
  report?: DiagnosticReport;
  manualCommandRuns?: ManualCommandRunInput[];
  activeCodeBinding?: LocalizationDeskCodeContextSummary | null;
  timelineWhiteboard?: TimelineWhiteboardNode[];
  whiteboardSvg?: string;
}

interface LocalizationDeskDraft {
  manualCommandRuns?: ManualCommandRunInput[];
  activeCodeBinding?: LocalizationDeskCodeContextSummary | null;
  timelineWhiteboard?: TimelineWhiteboardNode[];
}

interface CommandPolicySnapshot {
  storeFile?: string;
  blockedBaseCommands: string[];
  defaultBlockedBaseCommands: string[];
  customAddedCommands: string[];
  customRemovedCommands: string[];
  blockedRules: Array<{
    id: string;
    reason: string;
  }>;
}

interface DerivedAnomaly {
  sourceType: 'finding' | 'collection_step' | 'business_action' | 'session_log';
  sourceId?: string;
  ts?: number;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  evidence: string;
  lookupText?: string;
  command?: string;
  sessionLabel?: string;
  tags: string[];
}

interface CodeContextBindingDraft {
  repo: string;
  branch: string;
  commit: string;
}

interface CodeContextBindingResult {
  contextId: string;
  repo: string;
  repoDisplayName: string;
  branch: string;
  branchRef: string;
  commit: string;
  worktreePath: string;
  symbolCount: number | null;
  searchStrategy?: 'on-demand' | 'indexed';
}

interface SymbolCandidate {
  id: string;
  name: string;
  path: string;
  line: number;
  language: string;
  kind?: string;
  signature: string;
  matchType: 'exact' | 'fuzzy';
  score: number;
}

interface RenderedSourceLine {
  lineNumber: number;
  text: string;
  inFunction: boolean;
  isDeclaration: boolean;
  isAnchor?: boolean;
}

interface RenderedSourcePayload {
  mode: 'symbol' | 'location';
  path: string;
  line: number;
  matchedBy?: string;
  symbol?: SymbolCandidate | null;
  signature: string;
  functionStartLine?: number | null;
  functionEndLine?: number | null;
  snippetStartLine: number;
  snippetEndLine: number;
  beforeContext: number;
  afterContext: number;
  totalLines: number;
  lines: RenderedSourceLine[];
}

interface SourceLookupRequest {
  title: string;
  summary: string;
  text: string;
  sourceType: string;
  command?: string;
}

interface SourcePreviewState {
  request: SourceLookupRequest;
  payload: RenderedSourcePayload;
  lookupMode: 'location' | 'function';
  locations: SourceLocationCandidate[];
  functions: FunctionCandidateToken[];
}

type SourcePreviewDisplayRow =
  | {
      type: 'line';
      key: string;
      line: RenderedSourceLine;
      html: string;
    }
  | {
      type: 'fold';
      key: string;
      label: string;
      hiddenCount: number;
    };

function normalizeCommandPolicySnapshot(snapshot: Partial<CommandPolicySnapshot> | null | undefined): CommandPolicySnapshot {
  return {
    storeFile: typeof snapshot?.storeFile === 'string' ? snapshot.storeFile : undefined,
    blockedBaseCommands: Array.isArray(snapshot?.blockedBaseCommands)
      ? snapshot.blockedBaseCommands.map((item) => String(item)).filter(Boolean)
      : [],
    defaultBlockedBaseCommands: Array.isArray(snapshot?.defaultBlockedBaseCommands)
      ? snapshot.defaultBlockedBaseCommands.map((item) => String(item)).filter(Boolean)
      : [],
    customAddedCommands: Array.isArray(snapshot?.customAddedCommands)
      ? snapshot.customAddedCommands.map((item) => String(item)).filter(Boolean)
      : [],
    customRemovedCommands: Array.isArray(snapshot?.customRemovedCommands)
      ? snapshot.customRemovedCommands.map((item) => String(item)).filter(Boolean)
      : [],
    blockedRules: Array.isArray(snapshot?.blockedRules)
      ? snapshot.blockedRules
          .map((rule) => ({
            id: String(rule?.id || ''),
            reason: String(rule?.reason || ''),
          }))
          .filter((rule) => rule.id && rule.reason)
      : [],
  };
}

const statusColorMap: Record<string, string> = {
  completed: 'success',
  attention: 'warning',
  failed: 'error',
  done: 'success',
  skipped: 'default',
};

const severityColorMap: Record<string, string> = {
  info: 'blue',
  warning: 'orange',
  critical: 'red',
};

const SOURCE_PREVIEW_BEFORE_CONTEXT = 12;
const SOURCE_PREVIEW_AFTER_CONTEXT = 28;
const DEFAULT_CONTEXT_SNAPSHOT: DiagnosticContextSnapshot = {
  impactScope: '',
  triggerAction: '',
  recentChange: '',
  expectedBehavior: '',
  observationWindow: '',
  logKeywords: '',
};

function clipText(value: string | undefined, limit = 240) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function toTagList(rawValue: string) {
  return Array.from(
    new Set(
      String(rawValue || '')
        .split(/[,\n，]+/g)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function formatTagInput(tags?: string[]) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function normalizeContextSnapshot(snapshot?: Partial<DiagnosticContextSnapshot>): DiagnosticContextSnapshot {
  return {
    impactScope: String(snapshot?.impactScope || ''),
    triggerAction: String(snapshot?.triggerAction || ''),
    recentChange: String(snapshot?.recentChange || ''),
    expectedBehavior: String(snapshot?.expectedBehavior || ''),
    observationWindow: String(snapshot?.observationWindow || ''),
    logKeywords: String(snapshot?.logKeywords || ''),
  };
}

function buildContextSummary(context: DiagnosticContextSnapshot) {
  return [
    context.impactScope ? `影响范围: ${context.impactScope}` : '',
    context.triggerAction ? `触发动作: ${context.triggerAction}` : '',
    context.recentChange ? `最近变更: ${context.recentChange}` : '',
    context.expectedBehavior ? `期望行为: ${context.expectedBehavior}` : '',
    context.observationWindow ? `观察窗口: ${context.observationWindow}` : '',
    context.logKeywords ? `日志关键词: ${context.logKeywords}` : '',
  ].filter(Boolean).join('；');
}

function collectEvidenceTags(texts: Array<string | undefined>, seedTags: string[] = []) {
  const bucket = new Set(seedTags.filter(Boolean));
  const joined = texts.join('\n').toLowerCase();
  const pairs: Array<[string, RegExp]> = [
    ['timeout', /timeout|timed out|超时/],
    ['refused', /refused|拒绝|unreachable/],
    ['io', /\bi\/o\b|nvme|scsi|blk|await|util/],
    ['network', /network|socket|tcp|port|connection/],
    ['crash', /panic|fatal|segfault|exception|assert/],
    ['recovery', /recover|rollback|恢复/],
  ];

  pairs.forEach(([tag, pattern]) => {
    if (pattern.test(joined)) bucket.add(tag);
  });

  return Array.from(bucket);
}

function isSuspiciousSessionLog(log: AgentSessionLogItem, noiseOptions: LogNoiseOptions = {}) {
  if (shouldSuppressSessionLog(log, noiseOptions)) return false;
  const rawText = [log.message, log.stdout, log.stderr, log.cmd].join('\n');
  const filteredText = buildSessionLogEvidence(log, noiseOptions) || rawText;
  return log.level === 'error'
    || log.level === 'warning'
    || (typeof log.exitCode === 'number' && log.exitCode !== 0)
    || RISK_SIGNAL_RE.test(filteredText);
}

function buildSessionLogEvidence(log: AgentSessionLogItem, noiseOptions: LogNoiseOptions = {}) {
  const combined = [log.message, log.stdout, log.stderr].filter(Boolean).join('\n').trim();
  return filterNoiseText(combined, noiseOptions).text;
}

function buildSourcePreviewDisplayRows(
  lines: RenderedSourceLine[],
  highlightedHtml: string[],
  compactMode: boolean
) {
  if (!compactMode) {
    return lines.map((line, index) => ({
      type: 'line' as const,
      key: `line-${line.lineNumber}`,
      line,
      html: highlightedHtml[index] || ' ',
    }));
  }

  const rows: SourcePreviewDisplayRow[] = [];
  let foldedStartIndex = -1;

  const flushFold = (endIndexExclusive: number) => {
    if (foldedStartIndex < 0) return;
    const hiddenCount = endIndexExclusive - foldedStartIndex;
    if (hiddenCount <= 1) {
      for (let index = foldedStartIndex; index < endIndexExclusive; index += 1) {
        rows.push({
          type: 'line',
          key: `line-${lines[index]?.lineNumber || index}`,
          line: lines[index],
          html: highlightedHtml[index] || ' ',
        });
      }
    } else if (hiddenCount > 0) {
      const firstLine = lines[foldedStartIndex];
      const lastLine = lines[endIndexExclusive - 1];
      const label = rows.length === 0
        ? `折叠前置上下文 ${hiddenCount} 行`
        : endIndexExclusive === lines.length
          ? `折叠后置上下文 ${hiddenCount} 行`
          : `折叠无关上下文 ${hiddenCount} 行`;
      rows.push({
        type: 'fold',
        key: `fold-${firstLine?.lineNumber || foldedStartIndex}-${lastLine?.lineNumber || endIndexExclusive}`,
        label,
        hiddenCount,
      });
    }
    foldedStartIndex = -1;
  };

  lines.forEach((line, index) => {
    const shouldFold = !line.inFunction && !line.isAnchor && !line.isDeclaration;
    if (shouldFold) {
      if (foldedStartIndex < 0) foldedStartIndex = index;
      return;
    }

    flushFold(index);
    rows.push({
      type: 'line',
      key: `line-${line.lineNumber}`,
      line,
      html: highlightedHtml[index] || ' ',
    });
  });

  flushFold(lines.length);
  return rows;
}

function inferFirstAnomaly(
  run: DiagnosticRunRecord | null,
  sessionLogs: AgentSessionLogItem[],
  noiseOptions: LogNoiseOptions = {}
): DerivedAnomaly | null {
  const candidates: Array<{ order: number; anomaly: DerivedAnomaly }> = [];

  if (run) {
    (run.collectionSteps || []).forEach((step, index) => {
      const combined = [step.stderr, step.stdout].filter(Boolean).join('\n');
      if ((step.exitCode ?? 0) === 0 && !RISK_SIGNAL_RE.test(combined)) return;

      candidates.push({
        order: 100 + index,
        anomaly: {
          sourceType: 'collection_step',
          sourceId: step.id,
          ts: step.startedAt,
          title: `采集步骤异常: ${step.name}`,
          severity: (step.exitCode ?? 0) !== 0 ? 'critical' : 'warning',
          summary: step.conclusion || step.expectedSignal || '采集输出出现异常信号',
          evidence: clipText(combined, 520),
          lookupText: buildLookupText([step.name, step.expectedSignal, step.conclusion, combined]),
          command: step.resolvedCommand || step.command,
          sessionLabel: run.sessionLabel,
          tags: collectEvidenceTags([combined, step.name, step.expectedSignal]),
        },
      });
    });

    (run.businessActions || []).forEach((action, index) => {
      const combined = [action.stderr, action.stdout].filter(Boolean).join('\n');
      if ((action.exitCode ?? 0) === 0 && !RISK_SIGNAL_RE.test(combined)) return;

      candidates.push({
        order: 200 + index,
        anomaly: {
          sourceType: 'business_action',
          sourceId: action.id,
          ts: action.startedAt,
          title: `业务动作异常: ${action.name}`,
          severity: (action.exitCode ?? 0) !== 0 ? 'critical' : 'warning',
          summary: `业务动作 ${action.runMode} 阶段输出了异常信号`,
          evidence: clipText(combined, 520),
          lookupText: buildLookupText([action.name, action.runMode, combined]),
          command: action.scriptPath,
          sessionLabel: run.sessionLabel,
          tags: collectEvidenceTags([combined, action.name, action.runMode]),
        },
      });
    });

    (run.findings || []).forEach((finding, index) => {
      candidates.push({
        order: 300 + index,
        anomaly: {
          sourceType: 'finding',
          sourceId: finding.id,
          title: finding.title,
          severity: finding.severity,
          summary: finding.summary,
          evidence: clipText(finding.evidence, 520),
          lookupText: buildLookupText([finding.title, finding.summary, finding.evidence]),
          sessionLabel: run.sessionLabel,
          tags: collectEvidenceTags([finding.title, finding.summary, finding.evidence]),
        },
      });
    });
  }

  const runFinishedAt = run?.finishedAt;
  const relevantLogs = run && typeof runFinishedAt === 'number'
    ? sessionLogs.filter((log) => log.ts >= run.startedAt - 60_000 && log.ts <= runFinishedAt + 60_000)
    : sessionLogs;

  relevantLogs
    .slice()
    .sort((left, right) => left.ts - right.ts)
    .forEach((log, index) => {
      if (!isSuspiciousSessionLog(log, noiseOptions)) return;
      const content = buildSessionLogEvidence(log, noiseOptions);
      candidates.push({
        order: 50 + index,
        anomaly: {
          sourceType: 'session_log',
          sourceId: log.id,
          ts: log.ts,
          title: `会话日志异常: ${log.type}`,
          severity: log.level === 'error' || (typeof log.exitCode === 'number' && log.exitCode !== 0) ? 'critical' : 'warning',
          summary: log.message || '会话运行日志出现 warning / error / 非零退出码',
          evidence: clipText(content, 520),
          lookupText: buildLookupText([log.type, log.message, log.stdout, log.stderr]),
          command: log.cmd,
          tags: collectEvidenceTags([content, log.type, log.cmd]),
        },
      });
    });

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return ['critical', 'warning', 'info'].indexOf(left.anomaly.severity) - ['critical', 'warning', 'info'].indexOf(right.anomaly.severity);
  });

  return candidates[0].anomaly;
}

function formatTs(ts?: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

function buildLookupText(parts: Array<string | undefined>) {
  return parts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

function formatSourceMatchLabel(matchedBy?: string) {
  const labels: Record<string, string> = {
    exact: '精确匹配',
    symbol: '函数定义',
    worktree: '本地工作树路径',
    absolute: '绝对路径',
    'repo-name': '仓库名裁剪',
    suffix: '路径后缀匹配',
  };
  return labels[String(matchedBy || '')] || '源码定位';
}

function hasCLookupText(text?: string) {
  return extractCLookupHints(String(text || '')).hasHints;
}

const DiagnosticWorkbench: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const { playbooks, activePlaybookId, setActivePlaybook, addPlaybook, updatePlaybook, deletePlaybook } = useDiagnosticStore();
  const analyzerBuiltinNoiseMode = useAnalyzerStore((state) => state.builtinNoiseMode);
  const analyzerNoiseKeywords = useAnalyzerStore((state) => state.noiseKeywords);
  const addTemplate = useCommandStore((state) => state.addTemplate);
  const { lockedEvidence, addEvidence, removeEvidence, clearEvidence } = useEvidenceStore();
  const { copy: copyEvidenceMarkdown } = useClipboard();
  const [savedCodeBinding, setSavedCodeBinding] = useLocalStorage<CodeContextBindingDraft>('devutility-code-context-binding', {
    repo: '',
    branch: '',
    commit: '',
  });
  const [messageApi, contextHolder] = message.useMessage();

  const safePlaybooks = Array.isArray(playbooks) ? playbooks : [];
  const activePlaybook = safePlaybooks.find((item) => item.id === activePlaybookId) || safePlaybooks[0];

  const [title, setTitle] = useState(activePlaybook?.name || '');
  const [symptom, setSymptom] = useState(activePlaybook?.symptomTemplate || '');
  const [contextSnapshot] = useState<DiagnosticContextSnapshot>(DEFAULT_CONTEXT_SNAPSHOT);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [historyRuns, setHistoryRuns] = useState<DiagnosticRunRecord[]>([]);
  const [activeRun, setActiveRun] = useState<DiagnosticRunRecord | null>(null);
  const [flowRun, setFlowRun] = useState<DiagnosticRunRecord | null>(null);
  const [, setMatches] = useState<SimilarCase[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [, setLoadingSessions] = useState(false);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [commandPolicy, setCommandPolicy] = useState<CommandPolicySnapshot | null>(null);
  const [newAllowedCommand, setNewAllowedCommand] = useState('');
  const [policyEditorValue, setPolicyEditorValue] = useState('');
  const [sessionLogs, setSessionLogs] = useState<AgentSessionLogItem[]>([]);
  const [sessionLogNoiseMeta, setSessionLogNoiseMeta] = useState<SessionLogNoiseMeta>({
    total: 0,
    visibleCount: 0,
    foldedNoiseCount: 0,
    foldedNoiseStats: [],
  });
  const [loadingSessionLogs, setLoadingSessionLogs] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [codeBinding, setCodeBinding] = useState<CodeContextBindingDraft>(savedCodeBinding);
  const [codeToken] = useState('');
  const [activeCodeContext, setActiveCodeContext] = useState<CodeContextBindingResult | null>(null);
  const [, setOpeningCodeContext] = useState(false);
  const [locatingSource, setLocatingSource] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewState | null>(null);
  const [codePreviewHistory, setCodePreviewHistory] = useState<SourcePreviewState[]>([]);
  const [compactSourcePreview, setCompactSourcePreview] = useState(true);
  const [activeWorkbenchView, setActiveWorkbenchView] = useState<DiagnosticWorkbenchView>('flow');
  const [sourceWindowOpen, setSourceWindowOpen] = useState(false);
  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const [showNoiseLogs, setShowNoiseLogs] = useState(false);
  const [localizationDeskDrafts, setLocalizationDeskDrafts] = useLocalStorage<Record<string, LocalizationDeskDraft>>(
    'devutility-diagnostic-localization-drafts',
    {}
  );

  useEffect(() => {
    if (!activePlaybook) return;
    setTitle(activePlaybook.name);
    setSymptom(activePlaybook.symptomTemplate);
    setMatches([]);
  }, [activePlaybook?.id]);

  const scenarioMeta = activePlaybook ? SCENARIO_META[activePlaybook.scenarioType] : null;
  const detailRun = activeRun;
  const localizationDeskStateKey = getLocalizationDeskStateKey(flowRun, selectedSessionId);
  const localizationDeskDraft = localizationDeskDrafts[localizationDeskStateKey] || null;
  const detailContextSnapshot = useMemo(
    () => normalizeContextSnapshot(detailRun?.contextSnapshot),
    [detailRun?.contextSnapshot]
  );
  const sessionNoiseOptions = useMemo<LogNoiseOptions>(
    () => ({
      builtinMode: analyzerBuiltinNoiseMode,
      customKeywords: analyzerNoiseKeywords,
    }),
    [analyzerBuiltinNoiseMode, analyzerNoiseKeywords]
  );
  const sessionNoiseQueryKey = useMemo(
    () => JSON.stringify({
      builtinMode: sessionNoiseOptions.builtinMode,
      customKeywords: sessionNoiseOptions.customKeywords || [],
      showNoiseLogs,
    }),
    [sessionNoiseOptions, showNoiseLogs]
  );
  const filteredSessionLogs = useMemo(
    () => sessionLogs.filter((log) => !shouldSuppressSessionLog(log, sessionNoiseOptions)),
    [sessionLogs, sessionNoiseOptions]
  );
  const firstAnomaly = useMemo(
    () => inferFirstAnomaly(detailRun, filteredSessionLogs, sessionNoiseOptions),
    [detailRun, filteredSessionLogs, sessionNoiseOptions]
  );
  const commandLibraryItems = useMemo(
    () => getScenarioCommandLibraryItems(
      activePlaybook?.scenarioType,
      [
        librarySearch,
        title,
        symptom,
        buildContextSummary(contextSnapshot),
        firstAnomaly?.summary,
        firstAnomaly?.evidence,
      ].filter(Boolean).join(' ')
    ).slice(0, 8),
    [activePlaybook?.scenarioType, contextSnapshot, firstAnomaly?.evidence, firstAnomaly?.summary, librarySearch, symptom, title]
  );
  const sourcePreviewHighlightedHtml = useMemo(() => {
    if (!sourcePreview?.payload.lines) return [];
    return highlightCLines(sourcePreview.payload.lines, isDark);
  }, [isDark, sourcePreview?.payload.lines]);
  const sourcePreviewDisplayRows = useMemo(
    () => buildSourcePreviewDisplayRows(sourcePreview?.payload.lines || [], sourcePreviewHighlightedHtml, compactSourcePreview),
    [compactSourcePreview, sourcePreview?.payload.lines, sourcePreviewHighlightedHtml]
  );
  const sourcePreviewFoldedLineCount = useMemo(
    () => sourcePreviewDisplayRows.reduce((sum, row) => sum + (row.type === 'fold' ? row.hiddenCount : 0), 0),
    [sourcePreviewDisplayRows]
  );
  const codeNavigationStack = useMemo(
    () =>
      codePreviewHistory.map((preview) => ({
        symbolId: preview.payload.symbol?.id || `${preview.payload.path}:${preview.payload.line}`,
        symbolName: preview.payload.symbol?.name || preview.request.title,
        filePath: preview.payload.path,
        line: preview.payload.functionStartLine || preview.payload.line,
        endLine: preview.payload.functionEndLine || undefined,
        signature: preview.payload.signature,
      })),
    [codePreviewHistory]
  );
  const codeCurrentFrame = useMemo(
    () =>
      sourcePreview
        ? {
            symbolId: sourcePreview.payload.symbol?.id || `${sourcePreview.payload.path}:${sourcePreview.payload.line}`,
            symbolName: sourcePreview.payload.symbol?.name || sourcePreview.request.title,
            filePath: sourcePreview.payload.path,
            line: sourcePreview.payload.functionStartLine || sourcePreview.payload.line,
            endLine: sourcePreview.payload.functionEndLine || undefined,
            signature: sourcePreview.payload.signature,
            summary: sourcePreview.request.summary,
            preview: sourcePreview.payload.lines
              .map((line) => `${String(line.lineNumber).padStart(4, ' ')}  ${line.text}`)
              .join('\n'),
          }
        : null,
    [sourcePreview]
  );
  const codeForwardTargets = useMemo(() => {
    if (!sourcePreview) return [];
    const currentSymbolName = sourcePreview.payload.symbol?.name;
    return sourcePreview.functions
      .filter((candidate) => candidate.query !== currentSymbolName)
      .map((candidate) => ({
        symbolId: candidate.query,
        symbolName: candidate.query,
        signature: candidate.sampleLine,
        summary: candidate.sampleLine,
        relationLabel: '日志线索',
      }));
  }, [sourcePreview]);
  const persistedFlowManualCommandRuns = useMemo(
    () =>
      Array.isArray(localizationDeskDraft?.manualCommandRuns)
        ? localizationDeskDraft.manualCommandRuns
        : getFlowRunManualCommandRuns(flowRun),
    [flowRun, localizationDeskDraft?.manualCommandRuns]
  );
  const persistedFlowTimelineWhiteboard = useMemo(
    () =>
      Array.isArray(localizationDeskDraft?.timelineWhiteboard)
        ? localizationDeskDraft.timelineWhiteboard
        : getFlowRunTimelineWhiteboard(flowRun),
    [flowRun, localizationDeskDraft?.timelineWhiteboard]
  );
  const persistedFlowCodeBinding = useMemo(
    () => localizationDeskDraft?.activeCodeBinding || getFlowRunActiveCodeBinding(flowRun),
    [flowRun, localizationDeskDraft?.activeCodeBinding]
  );
  const workbenchSections = useMemo(
    () => ({
      flow: getDiagnosticWorkbenchSections('flow'),
      config: getDiagnosticWorkbenchSections('config'),
      history: getDiagnosticWorkbenchSections('history'),
    }),
    []
  );

  useEffect(() => {
    void fetchSessions();
    void fetchRuns();
    void fetchCommandPolicy();
  }, []);

  useEffect(() => {
    if (!savedCodeBinding.repo || !savedCodeBinding.branch || !savedCodeBinding.commit) return;
    void openCodeContext(savedCodeBinding, true, {
      persistDraft: false,
    });
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionLogs([]);
      setSessionLogNoiseMeta({
        total: 0,
        visibleCount: 0,
        foldedNoiseCount: 0,
        foldedNoiseStats: [],
      });
      return;
    }
    void fetchSessionLogs(selectedSessionId, false);
    const timer = window.setInterval(() => {
      void fetchSessionLogs(selectedSessionId, false);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [selectedSessionId, sessionNoiseQueryKey]);

  async function fetchSessions() {
    setLoadingSessions(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/sessions`);
      const data = await response.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      if (!selectedSessionId && data.sessions?.[0]?.sessionId) {
        setSelectedSessionId(data.sessions[0].sessionId);
      }
    } catch {
      messageApi.warning('未获取到 SSH 会话，请确认代理服务已启动');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function fetchRuns() {
    setLoadingRuns(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/runs?limit=30`);
      const data = await response.json();
      setHistoryRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      messageApi.warning('未能加载诊断知识库历史记录');
    } finally {
      setLoadingRuns(false);
    }
  }

  async function fetchSessionLogs(sessionId: string, withLoading = true) {
    if (withLoading) setLoadingSessionLogs(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '120');
      params.set('builtinMode', sessionNoiseOptions.builtinMode || 'info');
      (sessionNoiseOptions.customKeywords || []).forEach((keyword) => params.append('customKeywords', keyword));
      if (showNoiseLogs) {
        params.set('showSuppressed', '1');
      }
      const response = await fetch(`${PROXY_HTTP}/api/agent/sessions/${encodeURIComponent(sessionId)}/logs?${params.toString()}`);
      const data = await response.json();
      if (!data.ok) {
        messageApi.warning(data.error || '会话日志拉取失败');
        return;
      }
      setSessionLogs(Array.isArray(data.data?.logs) ? data.data.logs : []);
      setSessionLogNoiseMeta({
        total: Number(data.data?.total || 0),
        visibleCount: Number(data.data?.visibleCount || 0),
        foldedNoiseCount: Number(data.data?.foldedNoiseCount || 0),
        foldedNoiseStats: Array.isArray(data.data?.foldedNoiseStats) ? data.data.foldedNoiseStats : [],
      });
    } catch {
      if (withLoading) {
        messageApi.warning('会话日志拉取失败');
      }
    } finally {
      if (withLoading) setLoadingSessionLogs(false);
    }
  }

  function updateLocalizationDeskDraft(patch: Partial<LocalizationDeskDraft>) {
    setLocalizationDeskDrafts((current) => ({
      ...current,
      [localizationDeskStateKey]: {
        ...(current[localizationDeskStateKey] || {}),
        ...patch,
      },
    }));
  }

  function buildCodeBindingSummary(context: CodeContextBindingResult): LocalizationDeskCodeContextSummary {
    return {
      repo: context.repo,
      repoDisplayName: context.repoDisplayName,
      branch: context.branch,
      commit: context.commit,
      worktreePath: context.worktreePath,
    };
  }

  async function openCodeContext(
    bindingOverride?: Partial<CodeContextBindingDraftInput>,
    silent = false,
    options?: {
      persistDraft?: boolean;
      saveAsDefault?: boolean;
    }
  ) {
    const persistDraft = options?.persistDraft ?? true;
    const saveAsDefault = options?.saveAsDefault ?? true;
    const nextBinding = {
      repo: String(bindingOverride?.repo ?? codeBinding.repo).trim(),
      branch: String(bindingOverride?.branch ?? codeBinding.branch).trim(),
      commit: String(bindingOverride?.commit ?? codeBinding.commit).trim(),
    };

    if (!nextBinding.repo || !nextBinding.branch || !nextBinding.commit) {
      if (!silent) {
        messageApi.warning('请先绑定 repo、branch 和 commit，C 源码定位才能工作');
      }
      return null;
    }

    if (
      activeCodeContext &&
      activeCodeContext.repo === nextBinding.repo &&
      activeCodeContext.branch === nextBinding.branch &&
      activeCodeContext.commit === nextBinding.commit
    ) {
      return activeCodeContext;
    }

    setOpeningCodeContext(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/code-context/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: nextBinding.repo,
          branch: nextBinding.branch,
          commit: nextBinding.commit,
          token: codeToken.trim(),
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        if (!silent) {
          messageApi.error(data.error || '代码上下文绑定失败');
        }
        return null;
      }

      const nextContext = data.data as CodeContextBindingResult;
      const normalizedBinding = {
        repo: nextContext.repo || nextBinding.repo,
        branch: nextContext.branch || nextBinding.branch,
        commit: nextContext.commit || nextBinding.commit,
      };

      setActiveCodeContext(nextContext);
      if (activeCodeContext?.contextId !== nextContext.contextId) {
        setSourcePreview(null);
        setCodePreviewHistory([]);
      }
      setCodeBinding(normalizedBinding);
      if (saveAsDefault) {
        setSavedCodeBinding(normalizedBinding);
      }
      if (persistDraft) {
        updateLocalizationDeskDraft({
          activeCodeBinding: buildCodeBindingSummary(nextContext),
        });
      }

      if (!silent) {
        messageApi.success(
          typeof nextContext.symbolCount === 'number'
            ? `已绑定 C 代码版本，符号索引 ${nextContext.symbolCount} 个`
            : '已绑定 C 代码版本，可直接从日志定位源码'
        );
      }
      return nextContext;
    } catch {
      if (!silent) {
        messageApi.error('代码上下文绑定失败');
      }
      return null;
    } finally {
      setOpeningCodeContext(false);
    }
  }

  async function searchSymbolCandidates(contextId: string, query: string) {
    const response = await fetch(
      `${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/symbols?q=${encodeURIComponent(query)}&limit=20`
    );
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || `符号搜索失败: ${query}`);
    }
    return Array.isArray(data.data) ? (data.data as SymbolCandidate[]) : [];
  }

  async function renderSymbolPreview(
    contextId: string,
    symbolId: string,
    beforeContext = SOURCE_PREVIEW_BEFORE_CONTEXT,
    afterContext = SOURCE_PREVIEW_AFTER_CONTEXT
  ) {
    const response = await fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbolId,
        beforeContext,
        afterContext,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || '函数源码渲染失败');
    }
    return data.data as RenderedSourcePayload;
  }

  async function renderLocationPreview(
    contextId: string,
    candidate: SourceLocationCandidate,
    beforeContext = SOURCE_PREVIEW_BEFORE_CONTEXT,
    afterContext = SOURCE_PREVIEW_AFTER_CONTEXT
  ) {
    const response = await fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/render-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: candidate.path,
        line: candidate.line,
        beforeContext,
        afterContext,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || `源码位置渲染失败: ${candidate.path}:${candidate.line}`);
    }
    return data.data as RenderedSourcePayload;
  }

  function buildSourcePreviewKey(preview: SourcePreviewState) {
    return preview.payload.symbol?.id || `${preview.payload.path}:${preview.payload.line}:${preview.lookupMode}`;
  }

  function replaceCurrentSourcePreview(nextPreview: SourcePreviewState) {
    setSourcePreview(nextPreview);
    setSourceWindowOpen(nextPreview.lookupMode === 'function');
    setCodePreviewHistory((current) =>
      current.length === 0 ? [nextPreview] : [...current.slice(0, -1), nextPreview]
    );
  }

  function activateSourcePreview(nextPreview: SourcePreviewState, navigationMode: 'replace' | 'append' = 'replace') {
    setSourcePreview(nextPreview);
    setSourceWindowOpen(nextPreview.lookupMode === 'function');
    setCodePreviewHistory((current) => {
      if (navigationMode === 'replace') {
        return [nextPreview];
      }

      const nextKey = buildSourcePreviewKey(nextPreview);
      const existingIndex = current.findIndex((item) => buildSourcePreviewKey(item) === nextKey);
      if (existingIndex >= 0) {
        return current.slice(0, existingIndex + 1);
      }
      return [...current, nextPreview];
    });
  }

  async function locateSourceFromRequest(
    request: SourceLookupRequest,
    preferred?: {
      location?: SourceLocationCandidate;
      functionCandidate?: FunctionCandidateToken;
    },
    options?: {
      navigationMode?: 'replace' | 'append';
    }
  ) {
    const lookupText = String(request.text || '').trim();
    const { locations, functions, hasHints } = extractCLookupHints(lookupText);
    const orderedLocations = preferred?.location
      ? [preferred.location, ...locations.filter((item) => `${item.path}:${item.line}` !== `${preferred.location?.path}:${preferred.location?.line}`)]
      : locations;
    const orderedFunctions = preferred?.functionCandidate
      ? [preferred.functionCandidate, ...functions.filter((item) => item.query !== preferred.functionCandidate?.query)]
      : functions;
    const canRenderFunction = Boolean(preferred?.functionCandidate);
    const tryFunctionsFirst = Boolean(preferred?.functionCandidate && !preferred?.location);

    if (!hasHints || (orderedLocations.length === 0 && orderedFunctions.length === 0)) {
      messageApi.warning('当前异常片段里没有提取到 C 源码路径或 C 函数名');
      return;
    }
    if (!canRenderFunction && orderedLocations.length === 0 && orderedFunctions.length > 0) {
      messageApi.warning('请选择具体函数线索后再打开源码浮窗');
      return;
    }

    const persistedBindingDraft = toCodeContextBindingDraft(persistedFlowCodeBinding);
    const context = await openCodeContext(persistedBindingDraft || undefined, false, {
      persistDraft: false,
      saveAsDefault: !persistedBindingDraft,
    });
    if (!context) return;

    setLocatingSource(true);
    let lastError = '';

    try {
      const tryOrderedLocationCandidates = async () => {
        for (const candidate of orderedLocations.slice(0, 6)) {
          try {
            const payload = await renderLocationPreview(context.contextId, candidate);
            activateSourcePreview({
              request,
              payload,
              lookupMode: 'location',
              locations: orderedLocations,
              functions: orderedFunctions,
            }, options?.navigationMode || 'replace');
            return true;
          } catch (error) {
            lastError = error instanceof Error ? error.message : '源码位置渲染失败';
          }
        }
        return false;
      };

      const tryOrderedFunctionCandidates = async () => {
        for (const candidate of orderedFunctions.slice(0, 6)) {
          try {
            const matches = await searchSymbolCandidates(context.contextId, candidate.query);
            if (matches.length === 0) {
              lastError = `没有找到函数定义: ${candidate.query}`;
              continue;
            }

            const payload = await renderSymbolPreview(context.contextId, matches[0].id);
            activateSourcePreview({
              request,
              payload,
              lookupMode: 'function',
              locations: orderedLocations,
              functions: orderedFunctions,
            }, options?.navigationMode || 'replace');
            return true;
          } catch (error) {
            lastError = error instanceof Error ? error.message : '函数源码渲染失败';
          }
        }
        return false;
      };

      if (tryFunctionsFirst) {
        if (await tryOrderedFunctionCandidates()) return;
        if (await tryOrderedLocationCandidates()) return;
      } else {
        if (await tryOrderedLocationCandidates()) return;
        if (canRenderFunction && await tryOrderedFunctionCandidates()) return;
      }

      messageApi.warning(lastError || '未能从当前证据里定位到 C 源码上下文');
    } finally {
      setLocatingSource(false);
    }
  }

  function locateSourceFromParts(
    request: Omit<SourceLookupRequest, 'text'> & { text?: string; parts?: Array<string | undefined> },
    preferred?: {
      location?: SourceLocationCandidate;
      functionCandidate?: FunctionCandidateToken;
    },
    options?: {
      navigationMode?: 'replace' | 'append';
    }
  ) {
    const lookupText = String(request.text || buildLookupText(request.parts || [])).trim();
    if (!lookupText) {
      messageApi.warning('当前内容为空，无法做 C 源码定位');
      return;
    }

    void locateSourceFromRequest(
      {
        title: request.title,
        summary: request.summary,
        sourceType: request.sourceType,
        command: request.command,
        text: lookupText,
      },
      preferred,
      options
    );
  }

  function handleSourcePreviewCodeClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!sourcePreview) return;
    const target = event.target as HTMLElement;
    const funcCall = target.closest('.code-func-call');
    const funcName = funcCall?.getAttribute('data-name');
    if (!funcName) return;

    const currentSymbolName = sourcePreview.payload.symbol?.name;
    if (funcName === currentSymbolName && sourcePreview.lookupMode === 'function') {
      return;
    }

    locateSourceFromParts(
      {
        ...sourcePreview.request,
      },
      {
        functionCandidate: {
          token: funcName,
          query: funcName,
          hits: 1,
          sampleLine: `代码内点击: ${funcName}`,
        },
      },
      {
        navigationMode: 'append',
      }
    );
  }

  async function rerenderCurrentSourcePreview(beforeContext: number, afterContext: number) {
    if (!sourcePreview) return;
    const persistedBindingDraft = toCodeContextBindingDraft(persistedFlowCodeBinding);
    const context = await openCodeContext(persistedBindingDraft || undefined, false, {
      persistDraft: false,
      saveAsDefault: !persistedBindingDraft,
    });
    if (!context) return;

    try {
      const payload = sourcePreview.payload.symbol?.id
        ? await renderSymbolPreview(context.contextId, sourcePreview.payload.symbol.id, beforeContext, afterContext)
        : await renderLocationPreview(
            context.contextId,
            {
              path: sourcePreview.payload.path,
              rawPath: sourcePreview.payload.path,
              line: sourcePreview.payload.line,
              hits: 1,
              sampleLine: sourcePreview.payload.signature || `${sourcePreview.payload.path}:${sourcePreview.payload.line}`,
            },
            beforeContext,
            afterContext
          );
      replaceCurrentSourcePreview({
        ...sourcePreview,
        payload,
      });
    } catch {
      messageApi.error('源码上下文展开失败');
    }
  }

  function jumpBackInCode(index: number) {
    setCodePreviewHistory((current) => {
      const nextHistory = current.slice(0, index + 1);
      const nextPreview = nextHistory[nextHistory.length - 1] || null;
      setSourcePreview(nextPreview);
      setSourceWindowOpen(Boolean(nextPreview && nextPreview.lookupMode === 'function'));
      return nextHistory;
    });
  }

  function navigateCodeForward(target: { symbolName: string; summary?: string }) {
    if (!sourcePreview) return;
    locateSourceFromParts(
      {
        ...sourcePreview.request,
      },
      {
        functionCandidate: {
          token: target.symbolName,
          query: target.symbolName,
          hits: 1,
          sampleLine: target.summary || `函数前进: ${target.symbolName}`,
        },
      },
      {
        navigationMode: 'append',
      }
    );
  }

  function syncPolicyState(snapshot: CommandPolicySnapshot) {
    const normalized = normalizeCommandPolicySnapshot(snapshot);
    setCommandPolicy(normalized);
    setPolicyEditorValue(normalized.blockedBaseCommands.join('\n'));
  }

  async function fetchCommandPolicy() {
    setLoadingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy`);
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '命令黑名单加载失败');
        return;
      }
      syncPolicyState(data.policy);
    } catch {
      messageApi.error('命令黑名单加载失败');
    } finally {
      setLoadingPolicy(false);
    }
  }

  async function addBlockedCommand() {
    const command = newAllowedCommand.trim();
    if (!command) {
      messageApi.warning('请输入要加入黑名单的命令名');
      return;
    }

    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '黑名单更新失败');
        return;
      }
      syncPolicyState(data.policy);
      setNewAllowedCommand('');
      messageApi.success(`已拦截命令 ${command}`);
    } catch {
      messageApi.error('黑名单更新失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function removeBlockedCommand(command: string) {
    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/block/${encodeURIComponent(command)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '移除黑名单命令失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success(`已放行命令 ${command}`);
    } catch {
      messageApi.error('移除黑名单命令失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveCommandPolicy() {
    const commands = Array.from(
      new Set(
        policyEditorValue
          .split(/[\n,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );

    if (commands.length === 0) {
      messageApi.warning('黑名单不能为空，至少保留基础防护');
      return;
    }

    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedBaseCommands: commands }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '黑名单保存失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success(`黑名单已保存，共 ${data.policy?.blockedBaseCommands?.length || commands.length} 条命令`);
    } catch {
      messageApi.error('黑名单保存失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function resetPolicyToDefault() {
    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/reset`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '黑名单重置失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success('黑名单已恢复默认策略');
    } catch {
      messageApi.error('黑名单重置失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function loadRun(runId: string) {
    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/runs/${runId}`);
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '诊断记录加载失败');
        return;
      }
      setActiveRun(data.run);
      setMatches(data.run.similarCases || []);
      setActiveWorkbenchView('history');
    } catch {
      messageApi.error('诊断记录加载失败');
    }
  }

  function continueRunInFlow(run: DiagnosticRunRecord) {
    setFlowRun(run);
    setLocalizationDeskDrafts((current) => ({
      ...current,
      [getLocalizationDeskStateKey(run, selectedSessionId)]: {
        manualCommandRuns: getFlowRunManualCommandRuns(run),
        activeCodeBinding: getFlowRunActiveCodeBinding(run),
        timelineWhiteboard: getFlowRunTimelineWhiteboard(run),
      },
    }));
    const bindingDraft = toCodeContextBindingDraft(getFlowRunActiveCodeBinding(run));
    if (bindingDraft) {
      setCodeBinding(bindingDraft);
    }
    setActiveWorkbenchView('flow');
  }

  function patchPlaybook(data: Partial<DiagnosticPlaybook>) {
    if (!activePlaybook) return;
    updatePlaybook(activePlaybook.id, data);
  }

  function updateCollectionStep(stepId: string, patch: Partial<DiagnosticCollectionStep>) {
    if (!activePlaybook) return;
    patchPlaybook({
      collectionPlan: activePlaybook.collectionPlan.map((step) =>
        step.id === stepId ? { ...step, ...patch } : step
      ),
    });
  }

  function updateAnalysisRule(ruleId: string, patch: Partial<DiagnosticAnalysisRule>) {
    if (!activePlaybook) return;
    patchPlaybook({
      analysisRules: activePlaybook.analysisRules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule
      ),
    });
  }

  function updateBusinessAction(actionId: string, patch: Partial<DiagnosticBusinessAction>) {
    if (!activePlaybook) return;
    patchPlaybook({
      businessActions: activePlaybook.businessActions.map((action) =>
        action.id === actionId ? { ...action, ...patch } : action
      ),
    });
  }

  function addCollectionStep() {
    if (!activePlaybook) return;
    patchPlaybook({
      collectionPlan: [
        ...activePlaybook.collectionPlan,
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
    });
  }

  function addAnalysisRule() {
    if (!activePlaybook) return;
    patchPlaybook({
      analysisRules: [
        ...activePlaybook.analysisRules,
        { id: generateId(), name: '新规则', pattern: 'error|failed', source: 'all', severity: 'warning', summary: '' },
      ],
    });
  }

  function addBusinessAction() {
    if (!activePlaybook) return;
    patchPlaybook({
      businessActions: [
        ...activePlaybook.businessActions,
        {
          id: generateId(),
          name: '新业务动作',
          scriptPath: '',
          argsText: '[]',
          stdinPayload: '',
          runMode: 'before_collection',
          timeoutMs: 15000,
        },
      ],
    });
  }

  function removeCollectionStep(stepId: string) {
    if (!activePlaybook) return;
    patchPlaybook({
      collectionPlan: activePlaybook.collectionPlan.filter((step) => step.id !== stepId),
    });
  }

  function removeAnalysisRule(ruleId: string) {
    if (!activePlaybook) return;
    patchPlaybook({
      analysisRules: activePlaybook.analysisRules.filter((rule) => rule.id !== ruleId),
    });
  }

  function removeBusinessAction(actionId: string) {
    if (!activePlaybook) return;
    patchPlaybook({
      businessActions: activePlaybook.businessActions.filter((action) => action.id !== actionId),
    });
  }

  function addLibraryItemToPlaybook(commandId: string) {
    if (!activePlaybook) return;
    const item = commandLibraryItems.find((entry) => entry.id === commandId);
    if (!item) return;

    patchPlaybook({
      collectionPlan: [...activePlaybook.collectionPlan, buildCollectionStepFromLibraryItem(item)],
    });
    messageApi.success(`已把「${item.name}」加入当前 Playbook`);
  }

  function saveLibraryItemToCommandBuilder(commandId: string) {
    const item = commandLibraryItems.find((entry) => entry.id === commandId);
    if (!item) return;

    addTemplate(buildCommandTemplateFromLibraryItem(item));
    messageApi.success(`已把「${item.name}」保存到命令生成器`);
  }

  function saveCommandAsTemplate(name: string, command: string, description: string, category = '诊断/现场命令') {
    if (!command.trim()) {
      messageApi.warning('当前没有可保存的命令');
      return;
    }
    addTemplate({
      name,
      category,
      description,
      template: command,
      variables: [],
    });
    messageApi.success(`已保存命令模板「${name}」`);
  }

  function lockEvidence(payload: {
    sourceType: 'first_anomaly' | 'finding' | 'collection_step' | 'business_action' | 'session_log';
    sourceId?: string;
    title: string;
    summary: string;
    content: string;
    lookupText?: string;
    command?: string;
    sessionLabel?: string;
    tags?: string[];
  }) {
    addEvidence({
      ...payload,
      tags: payload.tags || [],
    });
    messageApi.success(`已锁定证据：${payload.title}`);
  }

  async function copyEvidencePanel() {
    if (lockedEvidence.length === 0) {
      messageApi.warning('证据锁定面板还是空的');
      return;
    }
    const ok = await copyEvidenceMarkdown(buildEvidenceMarkdown(lockedEvidence));
    if (ok) {
      messageApi.success('证据面板已复制为 Markdown');
    } else {
      messageApi.error('证据面板复制失败');
    }
  }

  const currentSession = sessions.find((item) => item.sessionId === selectedSessionId);

  async function runManualCommandFromDesk(command: string): Promise<ManualCommandRunInput | null> {
    const trimmedCommand = command.trim();
    if (!selectedSessionId) {
      throw new Error('请先选择一个会话');
    }
    if (!trimmedCommand) {
      throw new Error('请输入要执行的命令');
    }

    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/sessions/${encodeURIComponent(selectedSessionId)}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd: trimmedCommand,
          mode: 'pty',
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || '手动命令执行失败');
      }

      const result = data.data || {};
      const durationMs = Math.max(0, Number(result.durationMs) || 0);
      const finishedAt = Date.now();
      void fetchSessionLogs(selectedSessionId, false);

      return {
        sessionId: selectedSessionId,
        command: trimmedCommand,
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
        exitCode:
          result.exitCode === null || result.exitCode === undefined
            ? null
            : Number.isFinite(Number(result.exitCode))
              ? Number(result.exitCode)
              : null,
        startedAt: finishedAt - durationMs,
        finishedAt,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('手动命令执行失败');
    }
  }

  const sourcePreviewContent = !sourcePreview ? (
    <Alert
      type="info"
      showIcon
      message="这里会显示异常关联的 C 源码片段"
      description="先绑定 C 代码版本，然后在首个异常、证据簇、证据篮或原始日志里点击“看源码”。工作台只会处理 C 源码路径和 C 函数线索。"
    />
  ) : (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text strong>{sourcePreview.request.title}</Text>
        <Tag>{sourcePreview.request.sourceType}</Tag>
        <Tag color={sourcePreview.lookupMode === 'location' ? 'processing' : 'geekblue'}>
          {sourcePreview.lookupMode === 'location' ? '路径定位' : '函数定位'}
        </Tag>
        <Tag color="default">{formatSourceMatchLabel(sourcePreview.payload.matchedBy)}</Tag>
      </div>
      <Text type="secondary">{sourcePreview.request.summary}</Text>
      <Text code>{sourcePreview.payload.path}:{sourcePreview.payload.line}</Text>
      {sourcePreview.request.command && <Text code>{sourcePreview.request.command}</Text>}
      <Text type="secondary">代码区内识别出的 C 函数名可直接点击跳转。</Text>
      {sourcePreview.payload.signature && (
        <Alert
          type="info"
          showIcon
          message={sourcePreview.payload.signature}
          description={
            sourcePreview.payload.functionStartLine && sourcePreview.payload.functionEndLine
              ? `函数范围 ${sourcePreview.payload.functionStartLine}-${sourcePreview.payload.functionEndLine}`
              : '当前按日志命中的 C 代码位置展示上下文'
          }
        />
      )}
      {sourcePreview.locations.length > 1 && (
        <div>
          <Text type="secondary">备选路径线索</Text>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {sourcePreview.locations.slice(0, 6).map((candidate) => (
              <Tag
                key={`${candidate.path}:${candidate.line}`}
                color={sourcePreview.payload.mode === 'location' && sourcePreview.payload.path === candidate.path && sourcePreview.payload.line === candidate.line ? 'processing' : 'default'}
                onClick={() => locateSourceFromParts(sourcePreview.request, { location: candidate })}
                style={{ cursor: 'pointer' }}
              >
                {candidate.path}:{candidate.line}
              </Tag>
            ))}
          </div>
        </div>
      )}
      {sourcePreview.functions.length > 0 && (
        <div>
          <Text type="secondary">函数线索</Text>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {sourcePreview.functions.slice(0, 8).map((candidate) => (
              <Tag
                key={`${candidate.query}-${candidate.hits}`}
                color={sourcePreview.payload.symbol?.name === candidate.query ? 'geekblue' : 'default'}
                onClick={() => locateSourceFromParts(sourcePreview.request, { functionCandidate: candidate }, { navigationMode: 'append' })}
                style={{ cursor: 'pointer' }}
              >
                {candidate.query}
              </Tag>
            ))}
          </div>
        </div>
      )}
      <div
        onClick={handleSourcePreviewCodeClick}
        style={{
          maxHeight: 'none',
          overflow: 'visible',
          borderRadius: 8,
          border: `1px solid ${isDark ? '#334155' : '#dbe2ea'}`,
          background: isDark ? '#0f172a' : '#f8fafc',
          padding: '8px 0',
        }}
      >
        {sourcePreviewDisplayRows.map((row) => {
          if (row.type === 'fold') {
            return (
              <div
                key={row.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 28,
                  padding: '4px 16px',
                }}
              >
                <Tag color="default">{row.label}</Tag>
              </div>
            );
          }

          const line = row.line;
          return (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '72px 1fr',
                gap: 12,
                padding: '0 16px',
                minHeight: 20,
                lineHeight: '20px',
                background: line.isAnchor
                  ? (isDark ? 'rgba(59, 130, 246, 0.26)' : 'rgba(59, 130, 246, 0.12)')
                  : line.isDeclaration
                    ? (isDark ? 'rgba(14, 116, 144, 0.24)' : 'rgba(14, 116, 144, 0.10)')
                    : line.inFunction
                      ? (isDark ? 'rgba(15, 23, 42, 0.42)' : 'rgba(226, 232, 240, 0.65)')
                      : 'transparent',
              }}
            >
              <Text
                type="secondary"
                style={{
                  userSelect: 'none',
                  textAlign: 'right',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  fontSize: 12,
                }}
              >
                {line.lineNumber}
              </Text>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  fontSize: 12,
                  color: isDark ? '#e5e7eb' : '#111827',
                }}
                dangerouslySetInnerHTML={{ __html: row.html }}
              />
            </div>
          );
        })}
      </div>
    </Space>
  );

  const evidenceDrawerContent = (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Button icon={<CopyOutlined />} disabled={lockedEvidence.length === 0} onClick={() => void copyEvidencePanel()}>
          复制 Markdown
        </Button>
        <Popconfirm title="清空所有锁定证据？" onConfirm={() => clearEvidence()}>
          <Button danger disabled={lockedEvidence.length === 0}>
            清空证据
          </Button>
        </Popconfirm>
      </Space>
      {lockedEvidence.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="还没有锁定证据"
          description="可以从首个异常、证据簇、执行结果和原始日志中，把关键现场固定到这里，后续直接导出给人或 Agent。"
        />
      ) : (
        <List
          dataSource={lockedEvidence}
          renderItem={(item) => {
            const canLocate = hasCLookupText(item.lookupText);
            return (
              <List.Item
                actions={[
                  ...(canLocate
                    ? [
                        <Button
                          key="source"
                          type="link"
                          icon={<CodeOutlined />}
                          onClick={() => locateSourceFromParts({
                            title: item.title,
                            summary: item.summary,
                            sourceType: item.sourceType,
                            text: item.lookupText,
                            parts: [item.title, item.summary, item.content],
                            command: item.command,
                          })}
                        >
                          看源码
                        </Button>,
                      ]
                    : []),
                  <Button key="remove" type="link" danger onClick={() => removeEvidence(item.id)}>
                    删除
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text strong>{item.title}</Text>
                      <Tag>{item.sourceType}</Tag>
                      {item.sessionLabel && <Tag color="processing">{item.sessionLabel}</Tag>}
                    </div>
                  }
                  description={
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Text type="secondary">{item.summary}</Text>
                      {item.command && <Text code>{item.command}</Text>}
                      <ResizableOutput
                        content={item.content}
                        isDark={isDark}
                        minHeight={56}
                        maxHeight={180}
                        onTextSelect={(text) => locateSourceFromParts({
                          title: `${item.title} - 手动选词`,
                          summary: item.summary,
                          sourceType: `${item.sourceType}_selection`,
                          text,
                          command: item.command,
                        })}
                      />
                      <div>
                        {item.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </div>
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Space>
  );

  const sessionLogsContent = !selectedSessionId ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择目标 SSH 会话" />
  ) : loadingSessionLogs && sessionLogs.length === 0 ? (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <Spin />
    </div>
  ) : sessionLogs.length === 0 && sessionLogNoiseMeta.foldedNoiseCount === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前会话暂无日志" />
  ) : (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {sessionLogNoiseMeta.foldedNoiseCount > 0 && (
        <Alert
          type={showNoiseLogs ? 'warning' : 'info'}
          showIcon
          message={showNoiseLogs
            ? `当前视图包含 ${sessionLogNoiseMeta.foldedNoiseCount} 条低价值噪音日志`
            : `已默认折叠 ${sessionLogNoiseMeta.foldedNoiseCount} 条低价值噪音日志`}
          description={
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text type="secondary">
                原始日志 {sessionLogNoiseMeta.total} 条，可定位日志 {sessionLogNoiseMeta.visibleCount} 条。
              </Text>
              {sessionLogNoiseMeta.foldedNoiseStats.length > 0 && (
                <Space wrap size={[8, 8]}>
                  {sessionLogNoiseMeta.foldedNoiseStats.slice(0, 3).map((item) => (
                    <Tag key={item.id} color={item.kind === 'builtin' ? 'cyan' : 'default'}>
                      {item.label} x {item.count}{item.sampleText ? ` · ${clipText(item.sampleText, 48)}` : ''}
                    </Tag>
                  ))}
                </Space>
              )}
            </Space>
          }
        />
      )}
      {sessionLogs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前会话仅有噪音日志，默认已折叠" />
      ) : (
        <List
          size="small"
          dataSource={[...sessionLogs].reverse()}
          renderItem={(item) => {
            const lookupText = buildLookupText([item.type, item.message, item.stdout, item.stderr]);
            const canLocate = hasCLookupText(lookupText);
            return (
              <List.Item
                actions={[
                  ...(canLocate
                    ? [
                        <Button
                          key="source"
                          type="link"
                          icon={<CodeOutlined />}
                          onClick={() => locateSourceFromParts({
                            title: `会话日志: ${item.type}`,
                            summary: item.message || `exit=${item.exitCode ?? '-'} / duration=${item.durationMs ?? '-'}ms`,
                            sourceType: 'session_log',
                            text: lookupText,
                            parts: [item.type, item.message, item.stdout, item.stderr],
                            command: item.cmd,
                          })}
                        >
                          看源码
                        </Button>,
                      ]
                    : []),
                  <Button
                    key="lock"
                    type="link"
                    icon={<PushpinOutlined />}
                    onClick={() => lockEvidence({
                      sourceType: 'session_log',
                      sourceId: item.id,
                      title: `会话日志: ${item.type}`,
                      summary: item.message || `exit=${item.exitCode ?? '-'} / duration=${item.durationMs ?? '-'}ms`,
                      content: buildSessionLogEvidence(item, sessionNoiseOptions),
                      lookupText,
                      command: item.cmd,
                      sessionLabel: currentSession ? `${currentSession.username}@${currentSession.host}` : undefined,
                      tags: collectEvidenceTags([item.message, item.stdout, item.stderr, item.cmd, item.type]),
                    })}
                  >
                    锁定
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text strong>{item.type}</Text>
                      <Tag color={item.level === 'error' ? 'red' : item.level === 'warning' ? 'orange' : 'blue'}>{item.level || 'info'}</Tag>
                      <Text type="secondary">{formatTs(item.ts)}</Text>
                      {typeof item.exitCode === 'number' && <Tag color={item.exitCode === 0 ? 'green' : 'red'}>exit {item.exitCode}</Tag>}
                      {typeof item.durationMs === 'number' && <Tag>{item.durationMs}ms</Tag>}
                      {item.mode && <Tag>{item.mode}</Tag>}
                    </div>
                  }
                  description={
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      {item.cmd && <Text code>{item.cmd}</Text>}
                      {item.message && <Text>{item.message}</Text>}
                      {item.stdout && (
                        <div>
                          <Text strong>stdout</Text>
                          <ResizableOutput
                            content={item.stdout}
                            isDark={isDark}
                            minHeight={56}
                            maxHeight={180}
                            onTextSelect={(text) => locateSourceFromParts({
                              title: `会话日志 stdout: ${item.type}`,
                              summary: item.message || '手动选取 stdout 中的线索',
                              sourceType: 'session_log_selection',
                              text,
                              command: item.cmd,
                            })}
                          />
                        </div>
                      )}
                      {item.stderr && (
                        <div>
                          <Text strong>stderr</Text>
                          <ResizableOutput
                            content={item.stderr}
                            isDark={isDark}
                            minHeight={56}
                            maxHeight={180}
                            onTextSelect={(text) => locateSourceFromParts({
                              title: `会话日志 stderr: ${item.type}`,
                              summary: item.message || '手动选取 stderr 中的线索',
                              sourceType: 'session_log_selection',
                              text,
                              command: item.cmd,
                            })}
                          />
                        </div>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Space>
  );

  const historyDetailContent = !detailRun ? (
    <Alert type="info" showIcon message="执行一次编排或点开历史 Run 后，这里会展示结构化详情。" />
  ) : (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        size="small"
        title={detailRun.title}
        extra={
          <Space wrap>
            <Tag color={statusColorMap[detailRun.status] || 'default'}>{detailRun.status}</Tag>
            <Button size="small" type="link" onClick={() => continueRunInFlow(detailRun)}>
              带回定位流
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {detailRun.scenarioType && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color={SCENARIO_META[detailRun.scenarioType]?.color || 'default'}>
                {SCENARIO_META[detailRun.scenarioType]?.label || detailRun.scenarioType}
              </Tag>
              {(detailRun.tags || []).map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}
          <Text type="secondary">故障现象：{detailRun.symptom}</Text>
          {detailRun.objective && <Text type="secondary">目标：{detailRun.objective}</Text>}
          {detailRun.successCriteria && <Text type="secondary">成功判据：{detailRun.successCriteria}</Text>}
          {buildContextSummary(detailContextSnapshot) && (
            <Text type="secondary">定位上下文：{buildContextSummary(detailContextSnapshot)}</Text>
          )}
          <Text type="secondary">运行时间：{formatTs(detailRun.startedAt)} {detailRun.finishedAt ? `- ${formatTs(detailRun.finishedAt)}` : ''}</Text>
          <Text type="secondary">目标会话：{detailRun.sessionLabel || '未绑定 SSH 会话'}</Text>
        </Space>
      </Card>

      {detailRun.report && (
        <Card size="small" title="报告归纳 Agent">
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Alert type="success" showIcon message={detailRun.report.summary} />
            <div>
              <Text strong>根因假设</Text>
              <Paragraph style={{ marginBottom: 0 }}>{detailRun.report.rootCauseHypothesis}</Paragraph>
            </div>
            {detailRun.report.similarCaseHint && (
              <Text type="secondary">{detailRun.report.similarCaseHint}</Text>
            )}
            {detailRun.report.recommendations?.length > 0 && (
              <div>
                <Text strong>建议动作</Text>
                <List
                  size="small"
                  dataSource={detailRun.report.recommendations}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </div>
            )}
            {detailRun.report.nextActions?.length > 0 && (
              <div>
                <Text strong>下一步</Text>
                <List
                  size="small"
                  dataSource={detailRun.report.nextActions}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </div>
            )}
          </Space>
        </Card>
      )}

      <Card size="small" title="日志分析 Agent Findings" extra={<Tag>{detailRun.findings?.length || 0}</Tag>}>
        {!detailRun.findings?.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次未提取到明确 Finding" />
        ) : (
          <List
            dataSource={detailRun.findings || []}
            renderItem={(finding) => (
              <List.Item
                actions={[
                  <Button
                    key="lock"
                    type="link"
                    icon={<PushpinOutlined />}
                    onClick={() => lockEvidence({
                      sourceType: 'finding',
                      sourceId: finding.id,
                      title: finding.title,
                      summary: finding.summary,
                      content: finding.evidence || '',
                      sessionLabel: detailRun.sessionLabel,
                      tags: collectEvidenceTags([finding.title, finding.summary, finding.evidence]),
                    })}
                  >
                    锁定证据
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text strong>{finding.title}</Text>
                      <Tag color={severityColorMap[finding.severity] || 'default'}>{finding.severity}</Tag>
                      <Tag>{finding.sourceStepName}</Tag>
                    </div>
                  }
                  description={
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Text>{finding.summary}</Text>
                      <ResizableOutput content={finding.evidence || ''} isDark={isDark} minHeight={52} maxHeight={180} />
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Collapse
        defaultActiveKey={['collector']}
        items={[
          {
            key: 'collector',
            label: `连接采集结果 (${detailRun.collectionSteps?.length || 0})`,
            children: !detailRun.collectionSteps?.length ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有采集步骤结果" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {(detailRun.collectionSteps || []).map((step) => (
                  <Card
                    key={step.id}
                    size="small"
                    title={
                      <Space wrap>
                        <Text strong>{step.name}</Text>
                        {step.phase && (
                          <Tag color={STEP_PHASE_META[step.phase as keyof typeof STEP_PHASE_META]?.color || 'default'}>
                            {STEP_PHASE_META[step.phase as keyof typeof STEP_PHASE_META]?.label || step.phase}
                          </Tag>
                        )}
                      </Space>
                    }
                    extra={<Tag color={statusColorMap[step.status] || 'default'}>{step.status}</Tag>}
                  >
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Text code>{step.resolvedCommand || step.command}</Text>
                      <Text type="secondary">
                        exit={step.exitCode} / duration={step.durationMs}ms
                        {step.startedAt ? ` / start=${formatTs(step.startedAt)}` : ''}
                      </Text>
                      {step.expectedSignal && (
                        <Text type="secondary">预期信号：{step.expectedSignal}</Text>
                      )}
                      <ResizableOutput content={step.stdout || step.stderr || ''} isDark={isDark} minHeight={84} maxHeight={260} />
                      {step.stderr && (
                        <>
                          <Text strong>stderr</Text>
                          <ResizableOutput content={step.stderr} isDark={isDark} minHeight={60} maxHeight={200} />
                        </>
                      )}
                      <Space wrap>
                        <Button
                          size="small"
                          icon={<PushpinOutlined />}
                          onClick={() => lockEvidence({
                            sourceType: 'collection_step',
                            sourceId: step.id,
                            title: `采集步骤: ${step.name}`,
                            summary: step.conclusion || step.expectedSignal || '采集输出已锁定',
                            content: [step.stdout, step.stderr].filter(Boolean).join('\n'),
                            command: step.resolvedCommand || step.command,
                            sessionLabel: detailRun.sessionLabel,
                            tags: collectEvidenceTags([step.name, step.expectedSignal, step.stdout, step.stderr]),
                          })}
                        >
                          锁定输出
                        </Button>
                        <Button
                          size="small"
                          icon={<SaveOutlined />}
                          onClick={() => saveCommandAsTemplate(
                            `${step.name} - 采集命令`,
                            step.resolvedCommand || step.command,
                            step.expectedSignal || step.conclusion || '来自诊断工作台的采集步骤',
                            '诊断/采集步骤'
                          )}
                        >
                          保存命令模板
                        </Button>
                      </Space>
                    </Space>
                  </Card>
                ))}
              </Space>
            ),
          },
          {
            key: 'biz-actions',
            label: `业务脚本结果 (${detailRun.businessActions?.length || 0})`,
            children: !detailRun.businessActions?.length ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有业务脚本执行结果" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {(detailRun.businessActions || []).map((action) => (
                  <Card key={action.id} size="small" title={action.name} extra={<Tag color={statusColorMap[action.status] || 'default'}>{action.status}</Tag>}>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Text code>{action.scriptPath}</Text>
                      <Text type="secondary">
                        phase={action.runMode} / exit={action.exitCode} / duration={action.durationMs}ms
                        {action.startedAt ? ` / start=${formatTs(action.startedAt)}` : ''}
                      </Text>
                      <ResizableOutput content={action.stdout || action.stderr || ''} isDark={isDark} minHeight={72} maxHeight={240} />
                      {action.stdinPayload && (
                        <>
                          <Text strong>stdin payload</Text>
                          <ResizableOutput content={action.stdinPayload} isDark={isDark} minHeight={52} maxHeight={180} />
                        </>
                      )}
                      <Button
                        size="small"
                        icon={<PushpinOutlined />}
                        onClick={() => lockEvidence({
                          sourceType: 'business_action',
                          sourceId: action.id,
                          title: `业务动作: ${action.name}`,
                          summary: `phase=${action.runMode} / exit=${action.exitCode}`,
                          content: [action.stdout, action.stderr].filter(Boolean).join('\n'),
                          command: action.scriptPath,
                          sessionLabel: detailRun.sessionLabel,
                          tags: collectEvidenceTags([action.name, action.runMode, action.stdout, action.stderr]),
                        })}
                      >
                        锁定输出
                      </Button>
                    </Space>
                  </Card>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>诊断工作台</Title>
            <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
              以定位为主链，把连接采集、证据收敛、时序复盘和结论归纳收在一条更短的漏斗里。
            </Paragraph>
          </div>
          <Space wrap>
            <Tag color="blue">{safePlaybooks.length} 个 Playbook</Tag>
            <Tag color={selectedSessionId ? 'processing' : 'default'}>
              {currentSession ? `${currentSession.username}@${currentSession.host}` : '未选会话'}
            </Tag>
            {flowRun ? <Tag color="processing">定位流来源: {flowRun.title}</Tag> : <Tag>定位流未绑定历史 Run</Tag>}
            {detailRun && detailRun.id !== flowRun?.id ? <Tag color="geekblue">详情 Run: {detailRun.title}</Tag> : null}
            <Tag color={lockedEvidence.length > 0 ? 'processing' : 'default'}>
              证据篮 {lockedEvidence.length}
            </Tag>
          </Space>
        </div>

        <Card size="small" styles={{ body: { paddingBlock: 12 } }}>
          <Space wrap size={[8, 8]}>
            {workbenchSections[activeWorkbenchView].map((section, index) => (
              <Tag key={section.id} color={activeWorkbenchView === 'flow' ? 'blue' : activeWorkbenchView === 'config' ? 'purple' : 'geekblue'}>
                {activeWorkbenchView === 'flow' ? `${index + 1}. ` : ''}{section.title}
              </Tag>
            ))}
          </Space>
        </Card>

        <Tabs
          activeKey={activeWorkbenchView}
          onChange={(value) => setActiveWorkbenchView(value as DiagnosticWorkbenchView)}
          items={[
            {
              key: 'flow',
              label: '定位流',
              children: (
                <LocalizationDesk
                  sessionLogs={sessionLogs}
                  selectedSessionId={selectedSessionId}
                  currentSessionLabel={currentSession ? `${currentSession.username}@${currentSession.host}` : undefined}
                  loadingSessionLogs={loadingSessionLogs}
                  evidenceCount={lockedEvidence.length}
                  isDark={isDark}
                  activeCodeContext={activeCodeContext}
                  persistedActiveCodeBinding={persistedFlowCodeBinding}
                  codeCurrentFrame={codeCurrentFrame}
                  codeNavigationStack={codeNavigationStack}
                  codeForwardTargets={codeForwardTargets}
                  manualCommandRuns={persistedFlowManualCommandRuns}
                  timelineWhiteboard={persistedFlowTimelineWhiteboard}
                  workbenchStateKey={localizationDeskStateKey}
                  canLocateSessionLogSource={hasCLookupText}
                  onOpenRawLogs={() => setLogsDrawerOpen(true)}
                  onOpenEvidenceBasket={() => setEvidenceDrawerOpen(true)}
                  onRunManualCommand={(command) => runManualCommandFromDesk(command)}
                  onExpandCodeAbove={() => {
                    if (!sourcePreview) return;
                    void rerenderCurrentSourcePreview(sourcePreview.payload.beforeContext + 20, sourcePreview.payload.afterContext);
                  }}
                  onExpandCodeBelow={() => {
                    if (!sourcePreview) return;
                    void rerenderCurrentSourcePreview(sourcePreview.payload.beforeContext, sourcePreview.payload.afterContext + 20);
                  }}
                  onOpenCodeFullFunction={() => {
                    if (!sourcePreview) return;
                    if (sourcePreview.payload.symbol?.id) {
                      void rerenderCurrentSourcePreview(0, 0);
                      return;
                    }
                    void rerenderCurrentSourcePreview(0, 0);
                  }}
                  onNavigateCodeForward={(target) => navigateCodeForward(target)}
                  onJumpBackInCode={(index) => jumpBackInCode(index)}
                  onManualCommandRunsChange={(runs) => {
                    updateLocalizationDeskDraft({ manualCommandRuns: runs });
                  }}
                  onTimelineWhiteboardChange={(items) => {
                    updateLocalizationDeskDraft({ timelineWhiteboard: items });
                  }}
                  onLockSessionLogEvidence={(item) => lockEvidence({
                    sourceType: 'session_log',
                    sourceId: item.id,
                    title: `会话日志: ${item.type}`,
                    summary: item.message || `exit=${item.exitCode ?? '-'} / duration=${item.durationMs ?? '-'}ms`,
                    content: buildSessionLogEvidence(item, sessionNoiseOptions),
                    lookupText: buildLookupText([item.type, item.message, item.stdout, item.stderr]),
                    command: item.cmd,
                    sessionLabel: currentSession ? `${currentSession.username}@${currentSession.host}` : undefined,
                    tags: collectEvidenceTags([item.message, item.stdout, item.stderr, item.cmd, item.type]),
                  })}
                  onLocateSessionLogSource={(request, preferred) => locateSourceFromParts(request, preferred)}
                />
              ),
            },
            {
              key: 'config',
              label: 'Playbook与策略',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card title="Playbook 与场景元信息" extra={<Tag color="processing">编辑专用</Tag>}>
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary">选择编排模板</Text>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <Select
                            style={{ flex: 1 }}
                            value={activePlaybook?.id}
                            options={safePlaybooks.map((playbook) => ({ label: playbook.name, value: playbook.id }))}
                            onChange={(value) => setActivePlaybook(String(value))}
                          />
                          <Button icon={<PlusOutlined />} onClick={() => addPlaybook()}>
                            新建
                          </Button>
                          <Popconfirm title="删除当前 Playbook？" onConfirm={() => activePlaybook && deletePlaybook(activePlaybook.id)}>
                            <Button danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                        <div>
                          <Text type="secondary">场景类型</Text>
                          <Select
                            style={{ width: '100%', marginTop: 8 }}
                            value={activePlaybook?.scenarioType}
                            options={Object.entries(SCENARIO_META).map(([value, meta]) => ({
                              value,
                              label: meta.label,
                            }))}
                            onChange={(value) => patchPlaybook({ scenarioType: value as DiagnosticScenarioType })}
                          />
                        </div>
                        <div>
                          <Text type="secondary">标签</Text>
                          <Input
                            value={formatTagInput(activePlaybook?.tags)}
                            onChange={(e) => patchPlaybook({ tags: toTagList(e.target.value) })}
                            placeholder="例如：timeout, io, journalctl"
                            style={{ marginTop: 8 }}
                          />
                        </div>
                      </div>

                      {scenarioMeta && <Text type="secondary">{scenarioMeta.description}</Text>}

                      <div>
                        <Text type="secondary">Playbook 描述</Text>
                        <Input
                          value={activePlaybook?.description}
                          onChange={(e) => patchPlaybook({ description: e.target.value })}
                          placeholder="描述这套诊断编排适用于什么故障"
                          style={{ marginTop: 8 }}
                          suffix={<SaveOutlined />}
                        />
                      </div>

                      <div>
                        <Text type="secondary">目标</Text>
                        <Input
                          value={activePlaybook?.objective}
                          onChange={(e) => patchPlaybook({ objective: e.target.value })}
                          placeholder="例如：先锁定首个异常，再明确下一跳验证命令"
                          style={{ marginTop: 8 }}
                        />
                      </div>

                      <div>
                        <Text type="secondary">成功判据</Text>
                        <TextArea
                          value={activePlaybook?.successCriteria}
                          onChange={(e) => patchPlaybook({ successCriteria: e.target.value })}
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          style={{ marginTop: 8 }}
                          placeholder="例如：抓到 timeout 日志、确认端口/进程状态、回滚后业务恢复"
                        />
                      </div>
                    </Space>
                  </Card>

                  <Card title="场景命令库" extra={scenarioMeta ? <Tag color={scenarioMeta.color}>{scenarioMeta.label}</Tag> : null}>
                    <Space direction="vertical" size={14} style={{ width: '100%' }}>
                      <Input
                        value={librarySearch}
                        onChange={(e) => setLibrarySearch(e.target.value)}
                        placeholder="按 timeout / io / recovery / network 等关键字过滤建议命令"
                        suffix={<SearchOutlined />}
                      />
                      {commandLibraryItems.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前场景下没有命中的建议命令" />
                      ) : (
                        <List
                          dataSource={commandLibraryItems}
                          renderItem={(item) => (
                            <List.Item
                              actions={[
                                <Button key="playbook" type="link" onClick={() => addLibraryItemToPlaybook(item.id)}>
                                  加入 Playbook
                                </Button>,
                                <Button key="builder" type="link" onClick={() => saveLibraryItemToCommandBuilder(item.id)}>
                                  存到命令生成器
                                </Button>,
                              ]}
                            >
                              <List.Item.Meta
                                title={
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <Text strong>{item.name}</Text>
                                    <Tag color={STEP_PHASE_META[item.phase].color}>{STEP_PHASE_META[item.phase].label}</Tag>
                                    <Tag color={item.riskLevel === 'mutation' ? 'orange' : 'green'}>
                                      {item.riskLevel === 'mutation' ? '变更型命令' : '只读命令'}
                                    </Tag>
                                  </div>
                                }
                                description={
                                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                    <Text type="secondary">{item.description}</Text>
                                    <Text code>{item.command}</Text>
                                    <Text type="secondary">预期信号：{item.expectedSignal}</Text>
                                  </Space>
                                }
                              />
                            </List.Item>
                          )}
                        />
                      )}
                    </Space>
                  </Card>

                  <Card title="命令白名单策略" extra={<Tag color="green">服务层实时生效</Tag>}>
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <Alert
                        type="warning"
                        showIcon
                        message="固定安全规则仍然生效"
                        description="这里仅管理基础命令白名单。危险模式拦截、只读限制和特殊命令约束仍由服务层强制执行，UI 不能关闭。"
                      />

                      {loadingPolicy ? (
                        <div style={{ textAlign: 'center', padding: '24px 0' }}>
                          <Spin />
                        </div>
                      ) : !commandPolicy ? (
                        <Alert type="error" showIcon message="未能加载命令策略" />
                      ) : (
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                            <Card size="small">
                              <Text type="secondary">当前阻止命令</Text>
                              <Title level={4} style={{ margin: '8px 0 0' }}>{commandPolicy.blockedBaseCommands.length}</Title>
                            </Card>
                            <Card size="small">
                              <Text type="secondary">动态新增</Text>
                              <Title level={4} style={{ margin: '8px 0 0' }}>{commandPolicy.customAddedCommands.length}</Title>
                            </Card>
                            <Card size="small">
                              <Text type="secondary">移出默认</Text>
                              <Title level={4} style={{ margin: '8px 0 0' }}>{commandPolicy.customRemovedCommands.length}</Title>
                            </Card>
                          </div>

                          <div>
                            <Text type="secondary">快速新增阻止命令</Text>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                              <Input
                                value={newAllowedCommand}
                                onChange={(e) => setNewAllowedCommand(e.target.value)}
                                placeholder="例如 rm"
                                style={{ flex: 1, minWidth: 220 }}
                                onPressEnter={() => void addBlockedCommand()}
                              />
                              <Button type="primary" danger icon={<PlusOutlined />} loading={savingPolicy} onClick={() => void addBlockedCommand()}>
                                加入黑名单
                              </Button>
                              <Button icon={<ReloadOutlined />} loading={loadingPolicy} onClick={() => void fetchCommandPolicy()}>
                                刷新策略
                              </Button>
                              <Popconfirm title="恢复默认黑名单？" onConfirm={() => void resetPolicyToDefault()}>
                                <Button loading={savingPolicy}>恢复默认</Button>
                              </Popconfirm>
                            </div>
                          </div>

                          <div>
                            <Text type="secondary">批量编辑基础命令黑名单</Text>
                            <TextArea
                              value={policyEditorValue}
                              onChange={(e) => setPolicyEditorValue(e.target.value)}
                              autoSize={{ minRows: 6, maxRows: 12 }}
                              style={{ marginTop: 8 }}
                              placeholder={'一行一个命令，例如\nrm\nmkfs\nreboot'}
                            />
                            <div style={{ marginTop: 8 }}>
                              <Button type="primary" danger icon={<SaveOutlined />} loading={savingPolicy} onClick={() => void saveCommandPolicy()}>
                                保存整套黑名单
                              </Button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {commandPolicy.blockedBaseCommands.map((command) => (
                              <Tag
                                key={command}
                                closable
                                onClose={(event) => {
                                  event.preventDefault();
                                  void removeBlockedCommand(command);
                                }}
                                color={commandPolicy.customAddedCommands.includes(command) ? 'volcano' : 'red'}
                                style={{ paddingInline: 10 }}
                              >
                                {command}
                              </Tag>
                            ))}
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {commandPolicy.blockedRules.map((rule) => (
                              <Tag key={rule.id} color="red">
                                {rule.id}: {rule.reason}
                              </Tag>
                            ))}
                          </div>
                        </Space>
                      )}
                    </Space>
                  </Card>

                  <Card title="Playbook 设计" extra={<Tag color="processing">可持久化复用</Tag>}>
                    {!activePlaybook ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可编辑 Playbook" />
                    ) : (
                      <Collapse
                        defaultActiveKey={['collection', 'rules']}
                        items={[
                          {
                            key: 'collection',
                            label: `连接采集 Agent (${activePlaybook.collectionPlan.length})`,
                            children: (
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {activePlaybook.collectionPlan.map((step) => (
                                  <Card
                                    key={step.id}
                                    size="small"
                                    title={
                                      <Space wrap>
                                        <Text strong>{step.name}</Text>
                                        <Tag color={STEP_PHASE_META[step.phase].color}>{STEP_PHASE_META[step.phase].label}</Tag>
                                      </Space>
                                    }
                                    extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeCollectionStep(step.id)} />}
                                  >
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                      <Input value={step.name} onChange={(e) => updateCollectionStep(step.id, { name: e.target.value })} placeholder="步骤名" />
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        <Select
                                          value={step.phase}
                                          options={Object.entries(STEP_PHASE_META).map(([value, meta]) => ({
                                            value,
                                            label: meta.label,
                                          }))}
                                          onChange={(value) => updateCollectionStep(step.id, { phase: value as DiagnosticCollectionStep['phase'] })}
                                        />
                                        <Select
                                          value={step.continueOnFailure ? 'continue' : 'stop'}
                                          options={[
                                            { label: '失败继续', value: 'continue' },
                                            { label: '失败停下', value: 'stop' },
                                          ]}
                                          onChange={(value) => updateCollectionStep(step.id, { continueOnFailure: value === 'continue' })}
                                        />
                                      </div>
                                      <TextArea
                                        value={step.command}
                                        onChange={(e) => updateCollectionStep(step.id, { command: e.target.value })}
                                        autoSize={{ minRows: 2, maxRows: 4 }}
                                        placeholder="填写远程采集命令"
                                      />
                                      <Input
                                        value={step.expectedSignal}
                                        onChange={(e) => updateCollectionStep(step.id, { expectedSignal: e.target.value })}
                                        placeholder="预期抓到什么信号，例如 timeout / iostat util 飙升 / 恢复完成"
                                      />
                                      <Input
                                        value={String(step.timeoutMs)}
                                        onChange={(e) => updateCollectionStep(step.id, { timeoutMs: Number(e.target.value || 0) })}
                                        placeholder="超时毫秒"
                                      />
                                    </Space>
                                  </Card>
                                ))}
                                <Button icon={<PlusOutlined />} onClick={addCollectionStep}>添加采集步骤</Button>
                              </Space>
                            ),
                          },
                          {
                            key: 'rules',
                            label: `日志分析 Agent (${activePlaybook.analysisRules.length})`,
                            children: (
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {activePlaybook.analysisRules.map((rule) => (
                                  <Card
                                    key={rule.id}
                                    size="small"
                                    title={rule.name}
                                    extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeAnalysisRule(rule.id)} />}
                                  >
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                      <Input value={rule.name} onChange={(e) => updateAnalysisRule(rule.id, { name: e.target.value })} placeholder="规则名称" />
                                      <Input value={rule.pattern} onChange={(e) => updateAnalysisRule(rule.id, { pattern: e.target.value })} placeholder="正则或关键词" />
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        <Select
                                          value={rule.source}
                                          options={[
                                            { label: 'stdout + stderr', value: 'all' },
                                            { label: '仅 stdout', value: 'stdout' },
                                            { label: '仅 stderr', value: 'stderr' },
                                          ]}
                                          onChange={(value) => updateAnalysisRule(rule.id, { source: value as DiagnosticAnalysisRule['source'] })}
                                        />
                                        <Select
                                          value={rule.severity}
                                          options={[
                                            { label: 'Info', value: 'info' },
                                            { label: 'Warning', value: 'warning' },
                                            { label: 'Critical', value: 'critical' },
                                          ]}
                                          onChange={(value) => updateAnalysisRule(rule.id, { severity: value as DiagnosticAnalysisRule['severity'] })}
                                        />
                                      </div>
                                      <Input value={rule.summary} onChange={(e) => updateAnalysisRule(rule.id, { summary: e.target.value })} placeholder="命中后的人类可读说明" />
                                    </Space>
                                  </Card>
                                ))}
                                <Button icon={<PlusOutlined />} onClick={addAnalysisRule}>添加分析规则</Button>
                              </Space>
                            ),
                          },
                          {
                            key: 'biz',
                            label: `业务测试控制 (${activePlaybook.businessActions.length})`,
                            children: (
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                <Alert
                                  type="warning"
                                  showIcon
                                  message="Python 业务脚本"
                                  description="参数支持 JSON 数组或空格分隔字符串；stdin 可传入 JSON 负载。脚本路径支持绝对路径、相对 server 目录路径，或仓库根目录相对路径。"
                                />
                                {activePlaybook.businessActions.map((action) => (
                                  <Card
                                    key={action.id}
                                    size="small"
                                    title={action.name}
                                    extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeBusinessAction(action.id)} />}
                                  >
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                      <Input value={action.name} onChange={(e) => updateBusinessAction(action.id, { name: e.target.value })} placeholder="动作名称" />
                                      <Input value={action.scriptPath} onChange={(e) => updateBusinessAction(action.id, { scriptPath: e.target.value })} placeholder="Python 脚本路径" />
                                      <Input value={action.argsText} onChange={(e) => updateBusinessAction(action.id, { argsText: e.target.value })} placeholder='例如 ["--action","health-check"]' />
                                      <TextArea
                                        value={action.stdinPayload}
                                        onChange={(e) => updateBusinessAction(action.id, { stdinPayload: e.target.value })}
                                        autoSize={{ minRows: 2, maxRows: 4 }}
                                        placeholder="传给脚本 stdin 的内容，可为空"
                                      />
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        <Select
                                          value={action.runMode}
                                          options={[
                                            { label: '采集前执行', value: 'before_collection' },
                                            { label: '采集后执行', value: 'after_collection' },
                                          ]}
                                          onChange={(value) => updateBusinessAction(action.id, { runMode: value as DiagnosticBusinessAction['runMode'] })}
                                        />
                                        <Input
                                          value={String(action.timeoutMs)}
                                          onChange={(e) => updateBusinessAction(action.id, { timeoutMs: Number(e.target.value || 0) })}
                                          placeholder="超时毫秒"
                                        />
                                      </div>
                                    </Space>
                                  </Card>
                                ))}
                                <Button icon={<PlusOutlined />} onClick={addBusinessAction}>添加业务动作</Button>
                              </Space>
                            ),
                          },
                        ]}
                      />
                    )}
                  </Card>
                </Space>
              ),
            },
            {
              key: 'history',
              label: '历史复盘',
              children: (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 0.9fr) minmax(420px, 1.1fr)', gap: 16, alignItems: 'start' }}>
                  <Card title="历史 Run" extra={<HistoryOutlined />}>
                    {loadingRuns ? (
                      <div style={{ textAlign: 'center', padding: '24px 0' }}>
                        <Spin />
                      </div>
                    ) : historyRuns.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="知识库还没有历史 Run" />
                    ) : (
                      <List
                        size="small"
                        dataSource={historyRuns}
                        renderItem={(run) => (
                          <List.Item
                            actions={[
                              <Button key="view" type="link" onClick={() => void loadRun(run.id)}>
                                查看详情
                              </Button>,
                            ]}
                          >
                            <List.Item.Meta
                              title={
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <Text strong>{run.title}</Text>
                                  <Tag color={statusColorMap[run.status] || 'default'}>{run.status}</Tag>
                                </div>
                              }
                              description={
                                <Space direction="vertical" size={2}>
                                  <Text type="secondary">{run.summary || run.symptom}</Text>
                                  <Text type="secondary">{formatTs(run.startedAt)}</Text>
                                </Space>
                              }
                            />
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>

                  <Card title="Run 详情" extra={detailRun ? <Tag color={statusColorMap[detailRun.status] || 'default'}>{detailRun.status}</Tag> : null}>
                    {historyDetailContent}
                  </Card>
                </div>
              ),
            },
          ]}
        />

        <Alert
          type="warning"
          showIcon
          icon={<ThunderboltOutlined />}
          message="MVP 范围说明"
          description="当前实现采用本地 JSON 知识库和可解释关键词召回，不依赖外部向量库或大模型；重点是先把每次 run 的结构化沉淀和编排闭环跑通。"
        />
      </Space>

      <FloatingSourceWindow
        title="C 源码上下文"
        subtitle={sourcePreview ? `${sourcePreview.payload.path}:${sourcePreview.payload.line}` : undefined}
        open={sourceWindowOpen && sourcePreview?.lookupMode === 'function'}
        onClose={() => setSourceWindowOpen(false)}
        isDark={isDark}
        extra={
          <Space size={8} wrap>
            {sourcePreview && (
              <Button size="small" onClick={() => setCompactSourcePreview((value) => !value)}>
                {compactSourcePreview ? '展开全部上下文' : '折叠无关上下文'}
              </Button>
            )}
            {compactSourcePreview && sourcePreviewFoldedLineCount > 0 && (
              <Tag color="default">已折叠 {sourcePreviewFoldedLineCount} 行</Tag>
            )}
            {locatingSource
              ? <Tag color="processing">定位中</Tag>
              : sourcePreview
                ? <Tag color="blue">{sourcePreview.lookupMode === 'location' ? 'path:line' : 'function'}</Tag>
                : null}
          </Space>
        }
      >
        {sourcePreviewContent}
      </FloatingSourceWindow>

      <Drawer
        title="原始会话日志"
        placement="bottom"
        height="72vh"
        open={logsDrawerOpen}
        onClose={() => setLogsDrawerOpen(false)}
        extra={
          <Space>
            <Tag color={selectedSessionId ? 'processing' : 'default'}>{selectedSessionId || '未选择会话'}</Tag>
            {sessionLogNoiseMeta.foldedNoiseCount > 0 && !showNoiseLogs && (
              <Tag color="cyan">已折叠 {sessionLogNoiseMeta.foldedNoiseCount}</Tag>
            )}
            <Button
              size="small"
              disabled={!selectedSessionId}
              onClick={() => setShowNoiseLogs((value) => !value)}
            >
              {showNoiseLogs ? '隐藏噪音' : '显示噪音'}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              size="small"
              disabled={!selectedSessionId}
              onClick={() => selectedSessionId && void fetchSessionLogs(selectedSessionId, true)}
            >
              刷新日志
            </Button>
          </Space>
        }
      >
        {sessionLogsContent}
      </Drawer>

      <Drawer
        title="证据篮"
        placement="right"
        width={720}
        open={evidenceDrawerOpen}
        onClose={() => setEvidenceDrawerOpen(false)}
        extra={<Tag color={lockedEvidence.length > 0 ? 'processing' : 'default'}>{lockedEvidence.length} 条</Tag>}
      >
        {evidenceDrawerContent}
      </Drawer>
    </div>
  );
};

export default DiagnosticWorkbench;
