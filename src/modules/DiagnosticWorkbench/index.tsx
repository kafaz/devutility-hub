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
  RobotOutlined,
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
  buildEvidenceDrawerSummary,
  getDiagnosticWorkbenchSections,
  type DiagnosticWorkbenchView,
} from './viewModel';
import { useEvidenceStore } from './store/evidenceStore';
import {
  type DiagnosticAnalysisRule,
  type DiagnosticBusinessAction,
  type DiagnosticCollectionStep,
  type DiagnosticPlaybook,
  type DiagnosticScenarioType,
  useDiagnosticStore,
} from './store/diagnosticStore';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const PROXY_HTTP = PROXY_HTTP_BASE;

interface SessionOption {
  sessionId: string;
  host: string;
  username: string;
}

interface AgentSessionLogItem {
  id: string;
  ts: number;
  type: string;
  level?: 'info' | 'warning' | 'error';
  cmd?: string;
  mode?: 'pty' | 'exec' | string;
  message?: string;
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
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
}

interface CommandPolicySnapshot {
  storeFile?: string;
  allowedBaseCommands: string[];
  defaultAllowedBaseCommands: string[];
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

interface TimelineEvent {
  id: string;
  ts: number;
  title: string;
  source: 'run' | 'business_action' | 'collection_step' | 'session_log';
  status: string;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
  command?: string;
  durationMs?: number;
}

interface EffectiveErrorLog {
  id: string;
  source: 'session_log' | 'collection_step' | 'business_action' | 'finding';
  title: string;
  reason: string;
  excerpt: string;
  lookupText?: string;
  ts?: number;
  severity: 'info' | 'warning' | 'critical';
  command?: string;
  tags: string[];
}

interface EffectiveErrorCluster {
  id: string;
  fingerprint: string;
  representative: EffectiveErrorLog;
  items: EffectiveErrorLog[];
  severity: 'info' | 'warning' | 'critical';
  count: number;
  firstTs?: number;
  lastTs?: number;
  tags: string[];
  sourceTypes: Array<EffectiveErrorLog['source']>;
  keepReasons: string[];
  score: number;
  hasCLookup: boolean;
  matchesFocusKeywords: string[];
  baselineSeenCount: number;
  baselineStatus: 'new' | 'known' | 'unknown';
  matchedNoiseRules: NoiseSuppressionRule[];
}

interface EffectiveErrorNoiseView {
  visibleClusters: EffectiveErrorCluster[];
  foldedClusters: EffectiveErrorCluster[];
  totalItems: number;
  totalClusters: number;
  foldedItems: number;
}

interface NoiseSuppressionRule {
  id: string;
  type: 'fingerprint' | 'keyword';
  value: string;
  reason: string;
  createdAt: number;
}

interface BaselineReferenceSummary {
  runs: DiagnosticRunRecord[];
  fingerprintCounts: Map<string, number>;
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
    allowedBaseCommands: Array.isArray(snapshot?.allowedBaseCommands)
      ? snapshot.allowedBaseCommands.map((item) => String(item)).filter(Boolean)
      : [],
    defaultAllowedBaseCommands: Array.isArray(snapshot?.defaultAllowedBaseCommands)
      ? snapshot.defaultAllowedBaseCommands.map((item) => String(item)).filter(Boolean)
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

function toKeywordList(rawValue: string) {
  return Array.from(
    new Set(
      String(rawValue || '')
        .split(/[\s,\n，]+/g)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length >= 2)
    )
  );
}

function inferSeverityFromText(text: string, fallback: EffectiveErrorLog['severity'] = 'warning') {
  if (/panic|fatal|segfault|oom|readonly|read-only|i\/o error|connection refused|timed out|timeout|超时|拒绝/i.test(text)) {
    return 'critical';
  }
  if (/error|failed|failure|warning|异常|失败|reset|unreachable/i.test(text)) {
    return 'warning';
  }
  return fallback;
}

function buildFocusedExcerpt(text: string, focusKeywords: string[], maxLines = 3) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) return '';

  const loweredKeywords = focusKeywords.map((item) => item.toLowerCase());
  const matchIndex = lines.findIndex((line) => {
    const lowered = line.toLowerCase();
    return loweredKeywords.some((keyword) => lowered.includes(keyword)) || RISK_SIGNAL_RE.test(line);
  });

  if (matchIndex < 0) {
    return clipText(lines.slice(0, maxLines).join('\n'), 520);
  }

  const start = Math.max(0, matchIndex - 1);
  const end = Math.min(lines.length, matchIndex + 2);
  return clipText(lines.slice(start, end).join('\n'), 520);
}

function normalizeNoiseFingerprint(value: string) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?\b/g, '<ts>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/\b[a-f0-9]{8,}\b/g, '<id>')
    .replace(/\/(?:[^/\s:]+\/)+[^/\s:]+/g, '<path>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.slice(0, 240);
}

function buildEffectiveErrorFingerprint(item: Pick<EffectiveErrorLog, 'id' | 'title' | 'reason' | 'excerpt'>) {
  return normalizeNoiseFingerprint([item.title, item.reason, item.excerpt].filter(Boolean).join('\n')) || item.id;
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

function doesNoiseRuleMatchCluster(cluster: Pick<EffectiveErrorCluster, 'fingerprint' | 'representative' | 'tags'>, rule: NoiseSuppressionRule) {
  const normalizedValue = String(rule.value || '').trim().toLowerCase();
  if (!normalizedValue) return false;

  if (rule.type === 'fingerprint') {
    return cluster.fingerprint === normalizedValue;
  }

  const haystack = [
    cluster.representative.title,
    cluster.representative.reason,
    cluster.representative.excerpt,
    cluster.tags.join(' '),
  ].join('\n').toLowerCase();

  return haystack.includes(normalizedValue);
}

function pickBaselineRuns(historyRuns: DiagnosticRunRecord[], currentRun: DiagnosticRunRecord | null) {
  if (!currentRun) return [] as DiagnosticRunRecord[];

  const currentTags = new Set((currentRun.tags || []).map((item) => item.toLowerCase()));
  const completedRuns = historyRuns.filter((run) => run.id !== currentRun.id && run.status === 'completed');
  const ranked = completedRuns
    .map((run) => {
      let score = 0;
      if (run.scenarioType && run.scenarioType === currentRun.scenarioType) score += 4;
      if (run.sessionLabel && currentRun.sessionLabel && run.sessionLabel === currentRun.sessionLabel) score += 3;
      if (run.title === currentRun.title) score += 2;
      const overlap = (run.tags || []).reduce((sum, tag) => sum + (currentTags.has(String(tag).toLowerCase()) ? 1 : 0), 0);
      score += Math.min(overlap, 3);
      return { run, score };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return (right.run.startedAt || 0) - (left.run.startedAt || 0);
    });

  const scored = ranked.filter((item) => item.score > 0).slice(0, 5).map((item) => item.run);
  if (scored.length > 0) return scored;
  return ranked.slice(0, 3).map((item) => item.run);
}

function buildBaselineReferenceSummary(historyRuns: DiagnosticRunRecord[], currentRun: DiagnosticRunRecord | null) {
  const baselineRuns = pickBaselineRuns(historyRuns, currentRun);
  const fingerprintCounts = new Map<string, number>();

  baselineRuns.forEach((run) => {
    const context = normalizeContextSnapshot(run.contextSnapshot);
    const seenInRun = new Set<string>();
    extractEffectiveErrorLogs(run, [], context).forEach((item) => {
      const fingerprint = buildEffectiveErrorFingerprint(item);
      if (!fingerprint || seenInRun.has(fingerprint)) return;
      seenInRun.add(fingerprint);
      fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) || 0) + 1);
    });
  });

  return {
    runs: baselineRuns,
    fingerprintCounts,
  } satisfies BaselineReferenceSummary;
}

function chooseRepresentativeLog(items: EffectiveErrorLog[]) {
  const severityRank: Record<EffectiveErrorLog['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return items
    .slice()
    .sort((left, right) => {
      const severityDiff = severityRank[left.severity] - severityRank[right.severity];
      if (severityDiff !== 0) return severityDiff;
      const tsDiff = (left.ts || Number.MAX_SAFE_INTEGER) - (right.ts || Number.MAX_SAFE_INTEGER);
      if (tsDiff !== 0) return tsDiff;
      return right.excerpt.length - left.excerpt.length;
    })[0];
}

function computeClusterScore(
  cluster: Omit<EffectiveErrorCluster, 'keepReasons' | 'score'>,
  anchorTs?: number
) {
  let score = 0;
  const keepReasons: string[] = [];

  if (cluster.severity === 'critical') {
    score += 4;
    keepReasons.push('包含 critical 级风险信号');
  } else if (cluster.severity === 'warning') {
    score += 2;
    keepReasons.push('命中 warning/error 风险模式');
  }

  if (cluster.count > 1) {
    score += 1;
    keepReasons.push(`同类信号重复出现 ${cluster.count} 次`);
  }

  if (cluster.sourceTypes.length > 1) {
    score += 1;
    keepReasons.push(`跨 ${cluster.sourceTypes.length} 类来源重复出现`);
  }

  if (cluster.items.some((item) => item.source === 'finding')) {
    score += 1;
    keepReasons.push('诊断 Finding 已确认这个信号');
  }

  if (cluster.hasCLookup) {
    score += 1;
    keepReasons.push('带有 C 源码线索，可继续追代码');
  }

  if (cluster.matchesFocusKeywords.length > 0) {
    score += 2;
    keepReasons.push(`命中关键字: ${cluster.matchesFocusKeywords.slice(0, 3).join(', ')}`);
  }

  if (anchorTs && cluster.firstTs) {
    const distance = Math.abs(cluster.firstTs - anchorTs);
    if (distance <= 120_000) {
      score += 2;
      keepReasons.push('位于首个异常前后 2 分钟窗口');
    } else if (distance <= 300_000) {
      score += 1;
      keepReasons.push('接近首个异常窗口');
    }
  }

  return { score, keepReasons };
}

function buildEffectiveErrorNoiseView(
  items: EffectiveErrorLog[],
  focusKeywords: string[],
  firstAnomaly?: DerivedAnomaly | null,
  baselineSummary?: BaselineReferenceSummary,
  noiseRules: NoiseSuppressionRule[] = []
) {
  if (items.length === 0) {
    return {
      visibleClusters: [],
      foldedClusters: [],
      totalItems: 0,
      totalClusters: 0,
      foldedItems: 0,
    } as EffectiveErrorNoiseView;
  }

  const clusterMap = new Map<string, EffectiveErrorLog[]>();
  items.forEach((item) => {
    const fingerprint = buildEffectiveErrorFingerprint(item);
    const bucket = clusterMap.get(fingerprint);
    if (bucket) {
      bucket.push(item);
    } else {
      clusterMap.set(fingerprint, [item]);
    }
  });

  const clusters = Array.from(clusterMap.entries()).map(([fingerprint, clusterItems], index) => {
    const representative = chooseRepresentativeLog(clusterItems);
    const severity = clusterItems.reduce<EffectiveErrorLog['severity']>((current, item) => {
      if (current === 'critical' || item.severity === current) return current;
      if (item.severity === 'critical') return 'critical';
      if (item.severity === 'warning' || current === 'info') return 'warning';
      return current;
    }, representative.severity);
    const tsValues = clusterItems.map((item) => item.ts).filter((item): item is number => typeof item === 'number');
    const tags = Array.from(new Set(clusterItems.flatMap((item) => item.tags)));
    const sourceTypes = Array.from(new Set(clusterItems.map((item) => item.source)));
    const hasCLookup = clusterItems.some((item) => hasCLookupText(item.lookupText));
    const loweredText = clusterItems.map((item) => `${item.title}\n${item.reason}\n${item.excerpt}`.toLowerCase()).join('\n');
    const matchesFocusKeywords = focusKeywords.filter((keyword) => loweredText.includes(keyword));
    const baselineSeenCount = baselineSummary?.fingerprintCounts.get(fingerprint) || 0;
    const baselineStatus: EffectiveErrorCluster['baselineStatus'] = baselineSeenCount > 0
      ? 'known'
      : baselineSummary && baselineSummary.runs.length > 0
        ? 'new'
        : 'unknown';
    const baseCluster = {
      id: `cluster-${index}-${representative.id}`,
      fingerprint,
      representative,
      items: clusterItems
        .slice()
        .sort((left, right) => (left.ts || 0) - (right.ts || 0)),
      severity,
      count: clusterItems.length,
      firstTs: tsValues.length > 0 ? Math.min(...tsValues) : undefined,
      lastTs: tsValues.length > 0 ? Math.max(...tsValues) : undefined,
      tags,
      sourceTypes,
      hasCLookup,
      matchesFocusKeywords,
      baselineSeenCount,
      baselineStatus,
      matchedNoiseRules: [] as NoiseSuppressionRule[],
    };
    const matchedNoiseRules = noiseRules.filter((rule) => doesNoiseRuleMatchCluster(baseCluster, rule));
    const scoreResult = computeClusterScore(baseCluster, firstAnomaly?.ts);
    let adjustedScore = scoreResult.score;
    const keepReasons = scoreResult.keepReasons.slice();

    if (baselineStatus === 'new') {
      adjustedScore += 2;
      keepReasons.push('相对稳定基线新增');
    } else if (baselineStatus === 'known') {
      adjustedScore -= 2;
      keepReasons.push(`历史稳定 Run 中出现 ${baselineSeenCount} 次`);
    }

    if (matchedNoiseRules.length > 0) {
      adjustedScore -= 6;
      keepReasons.push(`命中噪音规则: ${matchedNoiseRules.map((rule) => rule.reason || rule.value).slice(0, 2).join('；')}`);
    }

    return {
      ...baseCluster,
      score: adjustedScore,
      keepReasons,
      matchedNoiseRules,
    } satisfies EffectiveErrorCluster;
  });

  clusters.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    const severityRank = { critical: 0, warning: 1, info: 2 };
    const severityDiff = severityRank[left.severity] - severityRank[right.severity];
    if (severityDiff !== 0) return severityDiff;
    return (left.firstTs || 0) - (right.firstTs || 0);
  });

  const visibleClusters = clusters
    .filter((cluster, index) => cluster.matchedNoiseRules.length === 0 && (cluster.score >= 3 || cluster.severity === 'critical' || index < 4))
    .slice(0, 8);
  const visibleIds = new Set(visibleClusters.map((cluster) => cluster.id));
  const foldedClusters = clusters.filter((cluster) => !visibleIds.has(cluster.id));

  return {
    visibleClusters,
    foldedClusters,
    totalItems: items.length,
    totalClusters: clusters.length,
    foldedItems: foldedClusters.reduce((sum, cluster) => sum + cluster.count, 0),
  } satisfies EffectiveErrorNoiseView;
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

function buildExecutionTimeline(
  run: DiagnosticRunRecord | null,
  sessionLogs: AgentSessionLogItem[],
  noiseOptions: LogNoiseOptions = {}
) {
  if (!run) return [] as TimelineEvent[];

  const events: TimelineEvent[] = [
    {
      id: `${run.id}-start`,
      ts: run.startedAt,
      title: '诊断 Run 开始',
      source: 'run',
      status: 'started',
      severity: 'info',
      detail: run.title,
    },
  ];

  (run.businessActions || []).forEach((action) => {
    events.push({
      id: `biz-${action.id}`,
      ts: action.startedAt || run.startedAt,
      title: `业务动作: ${action.name}`,
      source: 'business_action',
      status: action.status,
      severity: (action.exitCode ?? 0) !== 0 ? 'critical' : inferSeverityFromText([action.stdout, action.stderr].join('\n'), 'info'),
      detail: `阶段=${action.runMode} / exit=${action.exitCode} / ${clipText(action.stderr || action.stdout, 180)}`,
      command: action.scriptPath,
      durationMs: action.durationMs,
    });
  });

  (run.collectionSteps || []).forEach((step) => {
    const combined = [step.stderr, step.stdout].filter(Boolean).join('\n');
    events.push({
      id: `step-${step.id}`,
      ts: step.startedAt || run.startedAt,
      title: `采集步骤: ${step.name}`,
      source: 'collection_step',
      status: step.status,
      severity: step.status === 'failed'
        ? 'critical'
        : step.status === 'skipped'
          ? 'info'
          : inferSeverityFromText(combined, 'info'),
      detail: `${step.phase ? `${STEP_PHASE_META[step.phase as keyof typeof STEP_PHASE_META]?.label || step.phase} / ` : ''}${step.conclusion || clipText(combined, 180) || '无异常输出'}`,
      command: step.resolvedCommand || step.command,
      durationMs: step.durationMs,
    });
  });

  const runEnd = run.finishedAt || Date.now();
  sessionLogs
    .filter((log) => log.ts >= run.startedAt - 60_000 && log.ts <= runEnd + 60_000)
    .filter((log) => isSuspiciousSessionLog(log, noiseOptions))
    .slice()
    .sort((left, right) => left.ts - right.ts)
    .slice(0, 20)
    .forEach((log) => {
      const content = buildSessionLogEvidence(log, noiseOptions);
      events.push({
        id: `log-${log.id}`,
        ts: log.ts,
        title: `会话日志: ${log.type}`,
        source: 'session_log',
        status: log.level || (typeof log.exitCode === 'number' ? `exit ${log.exitCode}` : 'info'),
        severity: inferSeverityFromText(content, log.level === 'error' ? 'critical' : 'warning'),
        detail: clipText(log.message || content, 180) || '命中风险日志',
        command: log.cmd,
        durationMs: log.durationMs,
      });
    });

  events.push({
    id: `${run.id}-end`,
    ts: run.finishedAt || run.startedAt,
    title: '诊断 Run 结束',
    source: 'run',
    status: run.status,
    severity: run.status === 'attention' ? 'warning' : 'info',
    detail: run.report?.summary || run.symptom,
  });

  return events.sort((left, right) => left.ts - right.ts);
}

function extractEffectiveErrorLogs(
  run: DiagnosticRunRecord | null,
  sessionLogs: AgentSessionLogItem[],
  context: DiagnosticContextSnapshot,
  noiseOptions: LogNoiseOptions = {}
) {
  if (!run) return [] as EffectiveErrorLog[];

  const focusKeywords = [
    ...toKeywordList(context.logKeywords),
    ...(run.tags || []).map((item) => item.toLowerCase()),
  ];
  const seen = new Set<string>();
  const items: EffectiveErrorLog[] = [];

  const pushItem = (item: EffectiveErrorLog) => {
    const fingerprint = `${item.source}::${item.excerpt.toLowerCase()}`;
    if (!item.excerpt || seen.has(fingerprint)) return;
    seen.add(fingerprint);
    items.push(item);
  };

  (run.collectionSteps || []).forEach((step) => {
    const combined = [step.stderr, step.stdout].filter(Boolean).join('\n');
    if (!combined || (step.status === 'done' && !RISK_SIGNAL_RE.test(combined) && focusKeywords.every((keyword) => !combined.toLowerCase().includes(keyword)))) {
      return;
    }
    pushItem({
      id: `effective-step-${step.id}`,
      source: 'collection_step',
      title: step.name,
      reason: step.expectedSignal || step.conclusion || '采集步骤输出命中风险信号',
      excerpt: buildFocusedExcerpt(combined, focusKeywords),
      lookupText: buildLookupText([step.name, step.expectedSignal, step.conclusion, combined]),
      ts: step.startedAt,
      severity: step.status === 'failed' ? 'critical' : inferSeverityFromText(combined, 'warning'),
      command: step.resolvedCommand || step.command,
      tags: collectEvidenceTags([combined, step.name, step.expectedSignal], run.tags || []),
    });
  });

  (run.businessActions || []).forEach((action) => {
    const combined = [action.stderr, action.stdout].filter(Boolean).join('\n');
    if (!combined || ((action.exitCode ?? 0) === 0 && !RISK_SIGNAL_RE.test(combined) && focusKeywords.every((keyword) => !combined.toLowerCase().includes(keyword)))) {
      return;
    }
    pushItem({
      id: `effective-biz-${action.id}`,
      source: 'business_action',
      title: action.name,
      reason: `业务动作 ${action.runMode} 阶段输出了高风险信号`,
      excerpt: buildFocusedExcerpt(combined, focusKeywords),
      lookupText: buildLookupText([action.name, action.runMode, combined]),
      ts: action.startedAt,
      severity: (action.exitCode ?? 0) !== 0 ? 'critical' : inferSeverityFromText(combined, 'warning'),
      command: action.scriptPath,
      tags: collectEvidenceTags([combined, action.name, action.runMode], run.tags || []),
    });
  });

  (run.findings || []).forEach((finding) => {
    pushItem({
      id: `effective-finding-${finding.id}`,
      source: 'finding',
      title: finding.title,
      reason: finding.summary,
      excerpt: buildFocusedExcerpt(finding.evidence, focusKeywords),
      lookupText: buildLookupText([finding.title, finding.summary, finding.evidence]),
      severity: finding.severity,
      tags: collectEvidenceTags([finding.title, finding.summary, finding.evidence], run.tags || []),
    });
  });

  const runEnd = run.finishedAt || Date.now();
  sessionLogs
    .filter((log) => log.ts >= run.startedAt - 60_000 && log.ts <= runEnd + 60_000)
    .filter((log) => isSuspiciousSessionLog(log, noiseOptions))
    .forEach((log) => {
      const content = buildSessionLogEvidence(log, noiseOptions);
      pushItem({
        id: `effective-log-${log.id}`,
        source: 'session_log',
        title: log.type,
        reason: log.message || '会话日志命中 warning / error / 非零退出码',
        excerpt: buildFocusedExcerpt(content, focusKeywords),
        lookupText: buildLookupText([log.type, log.message, log.stdout, log.stderr]),
        ts: log.ts,
        severity: inferSeverityFromText(content, log.level === 'error' ? 'critical' : 'warning'),
        command: log.cmd,
        tags: collectEvidenceTags([content, log.type, log.cmd], run.tags || []),
      });
    });

  return items
    .sort((left, right) => {
      const severityRank = { critical: 0, warning: 1, info: 2 };
      const severityDiff = severityRank[left.severity] - severityRank[right.severity];
      if (severityDiff !== 0) return severityDiff;
      return (left.ts || 0) - (right.ts || 0);
    })
    .slice(0, 36);
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
  const [savedNoiseRules, setSavedNoiseRules] = useLocalStorage<NoiseSuppressionRule[]>('devutility-diagnostic-noise-rules', []);
  const [messageApi, contextHolder] = message.useMessage();

  const safePlaybooks = Array.isArray(playbooks) ? playbooks : [];
  const activePlaybook = safePlaybooks.find((item) => item.id === activePlaybookId) || safePlaybooks[0];

  const [title, setTitle] = useState(activePlaybook?.name || '');
  const [symptom, setSymptom] = useState(activePlaybook?.symptomTemplate || '');
  const [notes, setNotes] = useState('');
  const [contextSnapshot, setContextSnapshot] = useState<DiagnosticContextSnapshot>(DEFAULT_CONTEXT_SNAPSHOT);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [historyRuns, setHistoryRuns] = useState<DiagnosticRunRecord[]>([]);
  const [activeRun, setActiveRun] = useState<DiagnosticRunRecord | null>(null);
  const [matches, setMatches] = useState<SimilarCase[]>([]);
  const [running, setRunning] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [commandPolicy, setCommandPolicy] = useState<CommandPolicySnapshot | null>(null);
  const [newAllowedCommand, setNewAllowedCommand] = useState('');
  const [policyEditorValue, setPolicyEditorValue] = useState('');
  const [sessionLogs, setSessionLogs] = useState<AgentSessionLogItem[]>([]);
  const [loadingSessionLogs, setLoadingSessionLogs] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [codeBinding, setCodeBinding] = useState<CodeContextBindingDraft>(savedCodeBinding);
  const [codeToken, setCodeToken] = useState('');
  const [activeCodeContext, setActiveCodeContext] = useState<CodeContextBindingResult | null>(null);
  const [openingCodeContext, setOpeningCodeContext] = useState(false);
  const [locatingSource, setLocatingSource] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewState | null>(null);
  const [compactSourcePreview, setCompactSourcePreview] = useState(true);
  const [noiseKeywordDraft, setNoiseKeywordDraft] = useState('');
  const [activeWorkbenchView, setActiveWorkbenchView] = useState<DiagnosticWorkbenchView>('flow');
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);

  useEffect(() => {
    if (!activePlaybook) return;
    setTitle(activePlaybook.name);
    setSymptom(activePlaybook.symptomTemplate);
    setMatches([]);
  }, [activePlaybook?.id]);

  const scenarioMeta = activePlaybook ? SCENARIO_META[activePlaybook.scenarioType] : null;
  const detailRun = activeRun;
  const noiseRules = useMemo<NoiseSuppressionRule[]>(
    () => (Array.isArray(savedNoiseRules) ? savedNoiseRules : [])
      .map((rule) => ({
        id: String(rule?.id || generateId()),
        type: (rule?.type === 'fingerprint' ? 'fingerprint' : 'keyword') as NoiseSuppressionRule['type'],
        value: String(rule?.value || '').trim().toLowerCase(),
        reason: String(rule?.reason || '').trim(),
        createdAt: Number(rule?.createdAt || Date.now()),
      }))
      .filter((rule) => rule.value),
    [savedNoiseRules]
  );
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
  const filteredSessionLogs = useMemo(
    () => sessionLogs.filter((log) => !shouldSuppressSessionLog(log, sessionNoiseOptions)),
    [sessionLogs, sessionNoiseOptions]
  );
  const firstAnomaly = useMemo(
    () => inferFirstAnomaly(detailRun, filteredSessionLogs, sessionNoiseOptions),
    [detailRun, filteredSessionLogs, sessionNoiseOptions]
  );
  const executionTimeline = useMemo(
    () => buildExecutionTimeline(detailRun, filteredSessionLogs, sessionNoiseOptions),
    [detailRun, filteredSessionLogs, sessionNoiseOptions]
  );
  const effectiveErrorLogs = useMemo(
    () => extractEffectiveErrorLogs(
      detailRun,
      filteredSessionLogs,
      detailRun ? detailContextSnapshot : contextSnapshot,
      sessionNoiseOptions
    ),
    [contextSnapshot, detailContextSnapshot, detailRun, filteredSessionLogs, sessionNoiseOptions]
  );
  const baselineReferenceSummary = useMemo(
    () => buildBaselineReferenceSummary(historyRuns, detailRun),
    [detailRun, historyRuns]
  );
  const effectiveErrorNoiseView = useMemo(
    () => buildEffectiveErrorNoiseView(
      effectiveErrorLogs,
      [
        ...toKeywordList((detailRun ? detailContextSnapshot : contextSnapshot).logKeywords),
        ...(firstAnomaly?.tags || []).map((item) => item.toLowerCase()),
        ...((detailRun?.tags || []).map((item) => item.toLowerCase())),
      ],
      firstAnomaly,
      baselineReferenceSummary,
      noiseRules
    ),
    [baselineReferenceSummary, contextSnapshot, detailContextSnapshot, detailRun?.tags, effectiveErrorLogs, firstAnomaly, noiseRules]
  );
  const effectiveErrorNoiseSummary = useMemo(() => {
    const allClusters = [...effectiveErrorNoiseView.visibleClusters, ...effectiveErrorNoiseView.foldedClusters];
    return {
      newCount: allClusters.filter((cluster) => cluster.baselineStatus === 'new').length,
      knownCount: allClusters.filter((cluster) => cluster.baselineStatus === 'known').length,
      suppressedCount: allClusters.filter((cluster) => cluster.matchedNoiseRules.length > 0).length,
    };
  }, [effectiveErrorNoiseView.foldedClusters, effectiveErrorNoiseView.visibleClusters]);
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
  const phaseCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (activePlaybook?.collectionPlan || []).forEach((step) => {
      counts.set(step.phase, (counts.get(step.phase) || 0) + 1);
    });
    return Array.from(counts.entries());
  }, [activePlaybook?.collectionPlan]);
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
  const evidenceDrawerSummary = useMemo(
    () => buildEvidenceDrawerSummary(lockedEvidence.map((item) => ({ id: item.id, title: item.title }))),
    [lockedEvidence]
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
    void openCodeContext(savedCodeBinding, true);
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionLogs([]);
      return;
    }
    void fetchSessionLogs(selectedSessionId, false);
    const timer = window.setInterval(() => {
      void fetchSessionLogs(selectedSessionId, false);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [selectedSessionId]);

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
      const response = await fetch(`${PROXY_HTTP}/api/agent/sessions/${encodeURIComponent(sessionId)}/logs?limit=120`);
      const data = await response.json();
      if (!data.ok) {
        messageApi.warning(data.error || '会话日志拉取失败');
        return;
      }
      setSessionLogs(Array.isArray(data.data?.logs) ? data.data.logs : []);
    } catch {
      if (withLoading) {
        messageApi.warning('会话日志拉取失败');
      }
    } finally {
      if (withLoading) setLoadingSessionLogs(false);
    }
  }

  function patchCodeBinding(field: keyof CodeContextBindingDraft, value: string) {
    setCodeBinding((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function openCodeContext(bindingOverride?: Partial<CodeContextBindingDraft>, silent = false) {
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
      }
      setCodeBinding(normalizedBinding);
      setSavedCodeBinding(normalizedBinding);

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

  async function renderSymbolPreview(contextId: string, symbolId: string) {
    const response = await fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbolId,
        beforeContext: SOURCE_PREVIEW_BEFORE_CONTEXT,
        afterContext: SOURCE_PREVIEW_AFTER_CONTEXT,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || '函数源码渲染失败');
    }
    return data.data as RenderedSourcePayload;
  }

  async function renderLocationPreview(contextId: string, candidate: SourceLocationCandidate) {
    const response = await fetch(`${PROXY_HTTP}/api/code-context/${encodeURIComponent(contextId)}/render-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: candidate.path,
        line: candidate.line,
        beforeContext: SOURCE_PREVIEW_BEFORE_CONTEXT,
        afterContext: SOURCE_PREVIEW_AFTER_CONTEXT,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || `源码位置渲染失败: ${candidate.path}:${candidate.line}`);
    }
    return data.data as RenderedSourcePayload;
  }

  async function locateSourceFromRequest(
    request: SourceLookupRequest,
    preferred?: {
      location?: SourceLocationCandidate;
      functionCandidate?: FunctionCandidateToken;
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
    const tryFunctionsFirst = Boolean(preferred?.functionCandidate && !preferred?.location);

    if (!hasHints || (orderedLocations.length === 0 && orderedFunctions.length === 0)) {
      messageApi.warning('当前异常片段里没有提取到 C 源码路径或 C 函数名');
      return;
    }

    const context = await openCodeContext(undefined, false);
    if (!context) return;

    setLocatingSource(true);
    let lastError = '';

    try {
      const tryOrderedLocationCandidates = async () => {
        for (const candidate of orderedLocations.slice(0, 6)) {
          try {
            const payload = await renderLocationPreview(context.contextId, candidate);
            setSourcePreview({
              request,
              payload,
              lookupMode: 'location',
              locations: orderedLocations,
              functions: orderedFunctions,
            });
            setSourceDrawerOpen(true);
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
            setSourcePreview({
              request,
              payload,
              lookupMode: 'function',
              locations: orderedLocations,
              functions: orderedFunctions,
            });
            setSourceDrawerOpen(true);
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
        if (await tryOrderedFunctionCandidates()) return;
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
      preferred
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
      }
    );
  }

  function addNoiseRule(rule: NoiseSuppressionRule) {
    setSavedNoiseRules((current) => {
      const normalized = Array.isArray(current) ? current : [];
      if (normalized.some((item) => item.type === rule.type && String(item.value || '').trim().toLowerCase() === rule.value)) {
        return normalized;
      }
      return [rule, ...normalized].slice(0, 40);
    });
  }

  function addKeywordNoiseRule() {
    const value = noiseKeywordDraft.trim().toLowerCase();
    if (!value) {
      messageApi.warning('请先输入要折叠的噪音关键词');
      return;
    }

    addNoiseRule({
      id: generateId(),
      type: 'keyword',
      value,
      reason: `手动标记关键词噪音: ${value}`,
      createdAt: Date.now(),
    });
    setNoiseKeywordDraft('');
    messageApi.success(`已新增噪音关键词：${value}`);
  }

  function addFingerprintNoiseRule(cluster: EffectiveErrorCluster) {
    addNoiseRule({
      id: generateId(),
      type: 'fingerprint',
      value: cluster.fingerprint,
      reason: `手动折叠同类日志: ${cluster.representative.title}`,
      createdAt: Date.now(),
    });
    messageApi.success(`已将「${cluster.representative.title}」标记为噪音簇`);
  }

  function removeNoiseRule(ruleId: string) {
    setSavedNoiseRules((current) => (Array.isArray(current) ? current.filter((item) => item.id !== ruleId) : []));
  }

  function syncPolicyState(snapshot: CommandPolicySnapshot) {
    const normalized = normalizeCommandPolicySnapshot(snapshot);
    setCommandPolicy(normalized);
    setPolicyEditorValue(normalized.allowedBaseCommands.join('\n'));
  }

  async function fetchCommandPolicy() {
    setLoadingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy`);
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '命令白名单加载失败');
        return;
      }
      syncPolicyState(data.policy);
    } catch {
      messageApi.error('命令白名单加载失败');
    } finally {
      setLoadingPolicy(false);
    }
  }

  async function addAllowedCommand() {
    const command = newAllowedCommand.trim();
    if (!command) {
      messageApi.warning('请输入要加入白名单的命令名');
      return;
    }

    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/allow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '白名单更新失败');
        return;
      }
      syncPolicyState(data.policy);
      setNewAllowedCommand('');
      messageApi.success(`已允许命令 ${command}`);
    } catch {
      messageApi.error('白名单更新失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function removeAllowedCommand(command: string) {
    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/allow/${encodeURIComponent(command)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '移除白名单命令失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success(`已移除命令 ${command}`);
    } catch {
      messageApi.error('移除白名单命令失败');
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
      messageApi.warning('白名单不能为空');
      return;
    }

    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedBaseCommands: commands }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '白名单保存失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success(`白名单已保存，共 ${data.policy?.allowedBaseCommands?.length || commands.length} 条命令`);
    } catch {
      messageApi.error('白名单保存失败');
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
        messageApi.error(data.error || '白名单重置失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success('白名单已恢复默认策略');
    } catch {
      messageApi.error('白名单重置失败');
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

  function patchPlaybook(data: Partial<DiagnosticPlaybook>) {
    if (!activePlaybook) return;
    updatePlaybook(activePlaybook.id, data);
  }

  function patchContextSnapshot(field: keyof DiagnosticContextSnapshot, value: string) {
    setContextSnapshot((current) => ({
      ...current,
      [field]: value,
    }));
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

  async function runRecall() {
    if (!activePlaybook) return;
    if (!title.trim() || !symptom.trim()) {
      messageApi.warning('请输入本次诊断标题和故障现象');
      return;
    }

    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          symptom,
          notes,
          contextSnapshot,
          scenarioType: activePlaybook.scenarioType,
          objective: activePlaybook.objective,
          successCriteria: activePlaybook.successCriteria,
          tags: activePlaybook.tags,
          collectionPlan: activePlaybook.collectionPlan,
          businessActions: activePlaybook.businessActions.map((action) => ({
            ...action,
            args: action.argsText,
          })),
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '预召回失败');
        return;
      }
      setMatches(data.matches || []);
      messageApi.success(`已召回 ${data.matches?.length || 0} 条相似案例`);
    } catch {
      messageApi.error('预召回失败');
    }
  }

  async function runOrchestration() {
    if (!activePlaybook) return;
    if (!title.trim() || !symptom.trim()) {
      messageApi.warning('请输入本次诊断标题和故障现象');
      return;
    }

    if (activePlaybook.collectionPlan.length > 0 && !selectedSessionId) {
      messageApi.warning('当前编排包含采集步骤，需要选择 SSH 会话');
      return;
    }

    setRunning(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          symptom,
          notes,
          contextSnapshot,
          sessionId: selectedSessionId,
          scenarioType: activePlaybook.scenarioType,
          objective: activePlaybook.objective,
          successCriteria: activePlaybook.successCriteria,
          tags: activePlaybook.tags,
          collectionPlan: activePlaybook.collectionPlan,
          analysisRules: activePlaybook.analysisRules,
          businessActions: activePlaybook.businessActions.map((action) => ({
            ...action,
            args: action.argsText,
          })),
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '诊断编排执行失败');
        return;
      }
      setActiveRun(data.run);
      setMatches(data.run.similarCases || []);
      setActiveWorkbenchView('flow');
      await fetchRuns();
      messageApi.success('诊断编排执行完成，结果已归档入知识库');
    } catch {
      messageApi.error('诊断编排执行失败');
    } finally {
      setRunning(false);
    }
  }

  const currentSession = sessions.find((item) => item.sessionId === selectedSessionId);
  const similarCaseReferences = (detailRun?.similarCases?.length ? detailRun.similarCases : matches).slice(0, 3);

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
                onClick={() => locateSourceFromParts(sourcePreview.request, { functionCandidate: candidate })}
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
          maxHeight: 520,
          overflow: 'auto',
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
  ) : sessionLogs.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前会话暂无日志" />
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
            <Button size="small" type="link" onClick={() => setActiveWorkbenchView('flow')}>
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
            <Tag color={detailRun ? 'processing' : 'default'}>
              {detailRun ? `当前 Run: ${detailRun.title}` : '当前无 Run'}
            </Tag>
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
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card title="1. 定位上下文" extra={<Tag color="blue">定位优先</Tag>}>
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                        <div>
                          <Text type="secondary">本次 Run 标题</Text>
                          <Input value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginTop: 8 }} placeholder="例如：订单接口超时诊断" />
                        </div>
                        <div>
                          <Text type="secondary">目标 SSH 会话</Text>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <Select
                              style={{ flex: 1 }}
                              loading={loadingSessions}
                              value={selectedSessionId}
                              placeholder="选择一个已连接 SSH 会话"
                              options={sessions.map((session) => ({
                                value: session.sessionId,
                                label: `${session.username}@${session.host}`,
                              }))}
                              onChange={(value) => setSelectedSessionId(String(value))}
                            />
                            <Button onClick={() => void fetchSessions()}>刷新会话</Button>
                          </div>
                        </div>
                      </div>

                      <div>
                        <Text type="secondary">故障现象</Text>
                        <TextArea
                          value={symptom}
                          onChange={(e) => setSymptom(e.target.value)}
                          autoSize={{ minRows: 3, maxRows: 5 }}
                          style={{ marginTop: 8 }}
                          placeholder="描述现象、影响范围、怀疑方向"
                        />
                      </div>

                      <div>
                        <Text type="secondary">补充备注</Text>
                        <TextArea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 4 }}
                          style={{ marginTop: 8 }}
                          placeholder="例如：刚做过发布、只影响某个 AZ、业务验证点等"
                        />
                      </div>

                      <Card size="small" title="结构化定位上下文" styles={{ body: { padding: 12 } }}>
                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                          <Input
                            value={contextSnapshot.impactScope}
                            onChange={(e) => patchContextSnapshot('impactScope', e.target.value)}
                            placeholder="影响范围，例如：仅某 AZ、某租户、某节点、某卷"
                          />
                          <Input
                            value={contextSnapshot.triggerAction}
                            onChange={(e) => patchContextSnapshot('triggerAction', e.target.value)}
                            placeholder="执行时序起点，例如：发布后 / 注入后 / 压测第 3 分钟开始异常"
                          />
                          <Input
                            value={contextSnapshot.recentChange}
                            onChange={(e) => patchContextSnapshot('recentChange', e.target.value)}
                            placeholder="最近变更，例如：发布、参数修改、节点重启、限流调整"
                          />
                          <Input
                            value={contextSnapshot.expectedBehavior}
                            onChange={(e) => patchContextSnapshot('expectedBehavior', e.target.value)}
                            placeholder="期望行为，例如：请求 200、IO 延迟稳定、回滚后恢复"
                          />
                          <Input
                            value={contextSnapshot.observationWindow}
                            onChange={(e) => patchContextSnapshot('observationWindow', e.target.value)}
                            placeholder="观察窗口，例如：10:21-10:25 / 注入后 60s"
                          />
                          <Input
                            value={contextSnapshot.logKeywords}
                            onChange={(e) => patchContextSnapshot('logKeywords', e.target.value)}
                            placeholder="关键日志词，例如：timeout refused nvme reset"
                          />
                          <Text type="secondary">
                            {buildContextSummary(contextSnapshot) || '上下文越清晰，时序和有效错误日志提纯越准。'}
                          </Text>
                        </Space>
                      </Card>

                      <Card
                        size="small"
                        title="C 代码定位绑定"
                        extra={activeCodeContext ? <Tag color="success">已绑定</Tag> : <Tag color="default">未绑定</Tag>}
                        styles={{ body: { padding: 12 } }}
                      >
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                            <Input
                              value={codeBinding.repo}
                              onChange={(e) => patchCodeBinding('repo', e.target.value)}
                              placeholder="repo，本地路径或远端 Git URL"
                            />
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                              <Input
                                value={codeBinding.branch}
                                onChange={(e) => patchCodeBinding('branch', e.target.value)}
                                placeholder="branch"
                              />
                              <Input
                                value={codeBinding.commit}
                                onChange={(e) => patchCodeBinding('commit', e.target.value)}
                                placeholder="commit"
                              />
                            </div>
                            <Input
                              value={codeToken}
                              onChange={(e) => setCodeToken(e.target.value)}
                              placeholder="可选 Git token，私有仓库需要时再填"
                            />
                          </div>
                          <Space wrap>
                            <Button type="primary" icon={<CodeOutlined />} loading={openingCodeContext} onClick={() => void openCodeContext()}>
                              绑定 C 代码版本
                            </Button>
                            {activeCodeContext && (
                              <>
                                <Tag color="processing">{activeCodeContext.repoDisplayName}</Tag>
                                <Tag>{activeCodeContext.branch}</Tag>
                                <Tag>{activeCodeContext.commit.slice(0, 12)}</Tag>
                              </>
                            )}
                          </Space>
                          {activeCodeContext && (
                            <Text type="secondary">
                              当前工作树：{activeCodeContext.worktreePath}
                            </Text>
                          )}
                        </Space>
                      </Card>
                    </Space>
                  </Card>

                  <Card
                    title="2. 执行与采集"
                    extra={
                      <Space wrap>
                        <Button icon={<SearchOutlined />} onClick={() => void runRecall()}>
                          召回
                        </Button>
                        <Button type="primary" icon={<RobotOutlined />} loading={running} onClick={() => void runOrchestration()}>
                          执行编排
                        </Button>
                      </Space>
                    }
                  >
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) auto', gap: 8, alignItems: 'end' }}>
                        <div>
                          <Text type="secondary">当前 Playbook</Text>
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <Select
                              style={{ flex: 1 }}
                              value={activePlaybook?.id}
                              options={safePlaybooks.map((playbook) => ({ label: playbook.name, value: playbook.id }))}
                              onChange={(value) => setActivePlaybook(String(value))}
                            />
                            <Popconfirm title="删除当前 Playbook？" onConfirm={() => activePlaybook && deletePlaybook(activePlaybook.id)}>
                              <Button danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </div>
                        </div>
                        <Button icon={<PlusOutlined />} onClick={() => addPlaybook()}>
                          新建 Playbook
                        </Button>
                      </div>

                      {activePlaybook ? (
                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {scenarioMeta && <Tag color={scenarioMeta.color}>{scenarioMeta.label}</Tag>}
                            {(activePlaybook.tags || []).map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
                            ))}
                            {phaseCounts.map(([phase, count]) => (
                              <Tag key={phase} color={STEP_PHASE_META[phase as keyof typeof STEP_PHASE_META]?.color || 'default'}>
                                {STEP_PHASE_META[phase as keyof typeof STEP_PHASE_META]?.label || phase}: {count}
                              </Tag>
                            ))}
                          </div>
                          <Text type="secondary">{activePlaybook.description || '当前 Playbook 还没有补充描述。'}</Text>
                        </Space>
                      ) : (
                        <Alert type="warning" showIcon message="当前没有可用 Playbook" />
                      )}

                      <Alert
                        type="info"
                        showIcon
                        message="运行方式"
                        description="业务脚本会先执行 before_collection，再执行远程采集，最后执行 after_collection。日志分析与报告归纳在全部动作结束后统一生成。"
                      />

                      <Space wrap>
                        <Button type="link" onClick={() => setActiveWorkbenchView('config')}>
                          进入 Playbook 与策略
                        </Button>
                        <Tag color={matches.length > 0 ? 'processing' : 'default'}>
                          可参考案例 {matches.length}
                        </Tag>
                      </Space>
                    </Space>
                  </Card>

                  <Card
                    title="3. 关键证据"
                    extra={
                      <Space wrap>
                        <Button size="small" onClick={() => setLogsDrawerOpen(true)} disabled={!selectedSessionId}>
                          查看原始日志
                        </Button>
                        <Button size="small" onClick={() => setEvidenceDrawerOpen(true)}>
                          打开证据篮
                        </Button>
                      </Space>
                    }
                  >
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <Card
                        size="small"
                        title="首个异常"
                        extra={firstAnomaly ? <Tag color={severityColorMap[firstAnomaly.severity] || 'default'}>{firstAnomaly.severity}</Tag> : null}
                      >
                        {!firstAnomaly ? (
                          <Alert
                            type="info"
                            showIcon
                            message="还没有明确的首个异常"
                            description="执行一次编排或等待会话日志出现 warning / error / 非零退出码后，这里会自动收敛最先出现的高风险异常。"
                          />
                        ) : (
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Text strong>{firstAnomaly.title}</Text>
                            <Text type="secondary">{firstAnomaly.summary}</Text>
                            {firstAnomaly.command && <Text code>{firstAnomaly.command}</Text>}
                            <ResizableOutput
                              content={firstAnomaly.evidence}
                              isDark={isDark}
                              minHeight={72}
                              maxHeight={220}
                              onTextSelect={(text) => locateSourceFromParts({
                                title: `${firstAnomaly.title} - 手动选词`,
                                summary: firstAnomaly.summary,
                                sourceType: `${firstAnomaly.sourceType}_selection`,
                                text,
                                command: firstAnomaly.command,
                              })}
                            />
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {firstAnomaly.tags.map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                              ))}
                            </div>
                            <Space wrap>
                              {hasCLookupText(firstAnomaly.lookupText) && (
                                <Button
                                  icon={<CodeOutlined />}
                                  loading={locatingSource}
                                  onClick={() => locateSourceFromParts({
                                    title: firstAnomaly.title,
                                    summary: firstAnomaly.summary,
                                    sourceType: firstAnomaly.sourceType,
                                    text: firstAnomaly.lookupText,
                                    parts: [firstAnomaly.title, firstAnomaly.summary, firstAnomaly.evidence],
                                    command: firstAnomaly.command,
                                  })}
                                >
                                  看源码
                                </Button>
                              )}
                              <Button
                                icon={<PushpinOutlined />}
                                onClick={() => lockEvidence({
                                  sourceType: 'first_anomaly',
                                  sourceId: firstAnomaly.sourceId,
                                  title: firstAnomaly.title,
                                  summary: firstAnomaly.summary,
                                  content: firstAnomaly.evidence,
                                  lookupText: firstAnomaly.lookupText,
                                  command: firstAnomaly.command,
                                  sessionLabel: firstAnomaly.sessionLabel,
                                  tags: firstAnomaly.tags,
                                })}
                              >
                                锁定首个异常
                              </Button>
                              {firstAnomaly.command && (
                                <Button
                                  icon={<SaveOutlined />}
                                  onClick={() => saveCommandAsTemplate(
                                    `${firstAnomaly.title} - 现场命令`,
                                    firstAnomaly.command || '',
                                    firstAnomaly.summary,
                                    '诊断/异常定位'
                                  )}
                                >
                                  保存命令模板
                                </Button>
                              )}
                            </Space>
                          </Space>
                        )}
                      </Card>

                      <Card
                        size="small"
                        title="证据簇"
                        extra={
                          <Space size={8} wrap>
                            <Tag color={effectiveErrorNoiseView.visibleClusters.length > 0 ? 'warning' : 'default'}>
                              保留 {effectiveErrorNoiseView.visibleClusters.length} 簇
                            </Tag>
                            {effectiveErrorNoiseView.foldedClusters.length > 0 && (
                              <Tag color="default">
                                折叠 {effectiveErrorNoiseView.foldedClusters.length} 簇 / {effectiveErrorNoiseView.foldedItems} 条
                              </Tag>
                            )}
                          </Space>
                        }
                      >
                        {effectiveErrorNoiseView.totalItems === 0 ? (
                          <Alert
                            type="info"
                            showIcon
                            message="还没有提纯出关键日志"
                            description="补充定位上下文里的观察窗口和关键日志词，或执行一次编排后，这里会优先给出真正影响定位的错误日志片段。"
                          />
                        ) : (
                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Alert
                              type="info"
                              showIcon
                              message={`从 ${effectiveErrorNoiseView.totalItems} 条候选日志里收敛出 ${effectiveErrorNoiseView.totalClusters} 个证据簇`}
                              description="默认只保留分值更高、靠近首个异常、能复现或能继续追代码的簇，其余噪音会折叠到下面。"
                            />
                            <Alert
                              type={baselineReferenceSummary.runs.length > 0 ? 'success' : 'warning'}
                              showIcon
                              message={
                                baselineReferenceSummary.runs.length > 0
                                  ? `已加载 ${baselineReferenceSummary.runs.length} 个稳定基线 Run`
                                  : '还没有可用的稳定基线 Run'
                              }
                              description={
                                baselineReferenceSummary.runs.length > 0
                                  ? `当前簇里 ${effectiveErrorNoiseSummary.newCount} 个是相对基线新增，${effectiveErrorNoiseSummary.knownCount} 个在历史稳定 Run 中也出现过，${effectiveErrorNoiseSummary.suppressedCount} 个命中用户噪音规则。`
                                  : '后续有更多 completed 状态的历史 Run 时，这里会自动比较“当前新增”和“历史常见”信号。'
                              }
                            />
                            <Space.Compact style={{ width: '100%' }}>
                              <Input
                                value={noiseKeywordDraft}
                                onChange={(event) => setNoiseKeywordDraft(event.target.value)}
                                placeholder="输入噪音关键词，例如 heartbeat / retrying / health check"
                                onPressEnter={() => addKeywordNoiseRule()}
                              />
                              <Button icon={<SearchOutlined />} onClick={addKeywordNoiseRule}>
                                新增关键词规则
                              </Button>
                            </Space.Compact>
                            {noiseRules.length > 0 && (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {noiseRules.map((rule) => (
                                  <Tag
                                    key={rule.id}
                                    closable
                                    color={rule.type === 'fingerprint' ? 'purple' : 'default'}
                                    onClose={(event) => {
                                      event.preventDefault();
                                      removeNoiseRule(rule.id);
                                    }}
                                  >
                                    {rule.type === 'fingerprint' ? '簇规则' : '关键词'}: {rule.reason || rule.value}
                                  </Tag>
                                ))}
                              </div>
                            )}

                            <List
                              dataSource={effectiveErrorNoiseView.visibleClusters}
                              renderItem={(cluster) => {
                                const item = cluster.representative;
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
                                                title: `${item.title} - 证据簇`,
                                                summary: cluster.keepReasons.join('；') || item.reason,
                                                sourceType: item.source,
                                                text: item.lookupText,
                                                parts: [item.title, item.reason, item.excerpt],
                                                command: item.command,
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
                                          sourceType: item.source === 'finding'
                                            ? 'finding'
                                            : item.source === 'business_action'
                                              ? 'business_action'
                                              : item.source === 'collection_step'
                                                ? 'collection_step'
                                                : 'session_log',
                                          sourceId: item.id,
                                          title: `${item.title} - 证据簇`,
                                          summary: cluster.keepReasons.join('；') || item.reason,
                                          content: item.excerpt,
                                          lookupText: item.lookupText,
                                          command: item.command,
                                          sessionLabel: detailRun?.sessionLabel,
                                          tags: cluster.tags,
                                        })}
                                      >
                                        锁定
                                      </Button>,
                                      <Button key="noise" type="link" onClick={() => addFingerprintNoiseRule(cluster)}>
                                        标记噪音
                                      </Button>,
                                    ]}
                                  >
                                    <List.Item.Meta
                                      title={
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                          <Text strong>{item.title}</Text>
                                          <Tag color={severityColorMap[cluster.severity] || 'default'}>{cluster.severity}</Tag>
                                          <Tag>{cluster.sourceTypes.join(' / ')}</Tag>
                                          <Tag color="processing">保留分 {cluster.score}</Tag>
                                          {cluster.baselineStatus === 'new' && <Tag color="success">基线新增</Tag>}
                                          {cluster.baselineStatus === 'known' && <Tag color="default">历史常见</Tag>}
                                          {cluster.count > 1 && <Tag color="default">簇内 {cluster.count} 条</Tag>}
                                        </div>
                                      }
                                      description={
                                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                            {cluster.keepReasons.map((reason) => (
                                              <Tag key={reason} color="blue">{reason}</Tag>
                                            ))}
                                          </div>
                                          <Text type="secondary">{item.reason}</Text>
                                          {item.command && <Text code>{item.command}</Text>}
                                          <ResizableOutput
                                            content={item.excerpt}
                                            isDark={isDark}
                                            minHeight={56}
                                            maxHeight={160}
                                            onTextSelect={(text) => locateSourceFromParts({
                                              title: `${item.title} - 手动选词`,
                                              summary: cluster.keepReasons.join('；') || item.reason,
                                              sourceType: `${item.source}_selection`,
                                              text,
                                              command: item.command,
                                            })}
                                          />
                                        </Space>
                                      }
                                    />
                                  </List.Item>
                                );
                              }}
                            />

                            {effectiveErrorNoiseView.foldedClusters.length > 0 && (
                              <Collapse
                                size="small"
                                items={[
                                  {
                                    key: 'folded-noise',
                                    label: `已折叠的干扰簇 (${effectiveErrorNoiseView.foldedClusters.length} 簇 / ${effectiveErrorNoiseView.foldedItems} 条)`,
                                    children: (
                                      <List
                                        size="small"
                                        dataSource={effectiveErrorNoiseView.foldedClusters}
                                        renderItem={(cluster) => (
                                          <List.Item>
                                            <List.Item.Meta
                                              title={
                                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                                  <Text>{cluster.representative.title}</Text>
                                                  <Tag>{cluster.sourceTypes.join(' / ')}</Tag>
                                                  <Tag color="default">簇内 {cluster.count} 条</Tag>
                                                  <Tag color="default">分值 {cluster.score}</Tag>
                                                </div>
                                              }
                                              description={
                                                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                                  <Text type="secondary">
                                                    {cluster.keepReasons.length > 0
                                                      ? `折叠原因：相对保留簇优先级更低。命中因子：${cluster.keepReasons.join('；')}`
                                                      : '折叠原因：未命中足够多的关键字、异常窗口或源码线索。'}
                                                  </Text>
                                                  <ResizableOutput
                                                    content={cluster.representative.excerpt}
                                                    isDark={isDark}
                                                    minHeight={48}
                                                    maxHeight={120}
                                                  />
                                                </Space>
                                              }
                                            />
                                          </List.Item>
                                        )}
                                      />
                                    ),
                                  },
                                ]}
                              />
                            )}
                          </Space>
                        )}
                      </Card>

                      <Card
                        size="small"
                        title="关键时序"
                        extra={<Tag color={executionTimeline.length > 0 ? 'processing' : 'default'}>{executionTimeline.length} 个事件</Tag>}
                      >
                        {executionTimeline.length === 0 ? (
                          <Alert
                            type="info"
                            showIcon
                            message="执行后这里会生成统一时序"
                            description="会把业务动作、采集步骤和关键会话日志按时间统一展开，帮助用户理解异常是在哪个动作之后、哪一步之前出现的。"
                          />
                        ) : (
                          <List
                            size="small"
                            dataSource={executionTimeline}
                            renderItem={(item) => (
                              <List.Item>
                                <List.Item.Meta
                                  title={
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                      <Text strong>{item.title}</Text>
                                      <Tag color={severityColorMap[item.severity] || 'default'}>{item.severity}</Tag>
                                      <Tag>{item.source}</Tag>
                                      <Text type="secondary">{formatTs(item.ts)}</Text>
                                      {typeof item.durationMs === 'number' && item.durationMs > 0 && <Tag>{item.durationMs}ms</Tag>}
                                    </div>
                                  }
                                  description={
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                      <Text type="secondary">状态：{item.status}</Text>
                                      <Text>{item.detail}</Text>
                                      {item.command && <Text code>{item.command}</Text>}
                                    </Space>
                                  }
                                />
                              </List.Item>
                            )}
                          />
                        )}
                      </Card>

                      <Card size="small" title="证据篮摘要" extra={<Tag color={lockedEvidence.length > 0 ? 'processing' : 'default'}>{lockedEvidence.length} 条</Tag>}>
                        {lockedEvidence.length === 0 ? (
                          <Alert type="info" showIcon message="还没有锁定证据" description="从首个异常、证据簇或原始日志中把关键现场固定到证据篮。" />
                        ) : (
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Text type="secondary">最近锁定</Text>
                            {evidenceDrawerSummary.recentTitles.map((titleItem) => (
                              <Tag key={titleItem} color="processing">{titleItem}</Tag>
                            ))}
                            <Space wrap>
                              <Button icon={<PushpinOutlined />} onClick={() => setEvidenceDrawerOpen(true)}>
                                打开证据篮
                              </Button>
                              <Button icon={<CopyOutlined />} onClick={() => void copyEvidencePanel()} disabled={lockedEvidence.length === 0}>
                                复制 Markdown
                              </Button>
                            </Space>
                          </Space>
                        )}
                      </Card>
                    </Space>
                  </Card>

                  <Card title="4. 诊断结论" extra={<Tag color={detailRun?.status ? statusColorMap[detailRun.status] || 'default' : 'default'}>{detailRun?.status || '未生成'}</Tag>}>
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      {!detailRun?.report ? (
                        <Alert
                          type="info"
                          showIcon
                          message="执行编排后这里会出现结构化结论"
                          description="当前会保留可参考案例摘要；完整历史和旧 run 详情请切到“历史复盘”。"
                        />
                      ) : (
                        <>
                          <Alert type="success" showIcon message={detailRun.report.summary} />
                          <div>
                            <Text strong>根因假设</Text>
                            <Paragraph style={{ marginBottom: 0 }}>{detailRun.report.rootCauseHypothesis}</Paragraph>
                          </div>
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
                        </>
                      )}

                      <Card size="small" title="可参考案例" extra={<Tag>{similarCaseReferences.length}</Tag>}>
                        {similarCaseReferences.length === 0 ? (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可参考案例" />
                        ) : (
                          <List
                            size="small"
                            dataSource={similarCaseReferences}
                            renderItem={(item) => (
                              <List.Item
                                actions={[
                                  <Button
                                    key="open-history"
                                    type="link"
                                    onClick={() => {
                                      void loadRun(item.runId);
                                      setActiveWorkbenchView('history');
                                    }}
                                  >
                                    在历史复盘中打开
                                  </Button>,
                                ]}
                              >
                                <List.Item.Meta
                                  title={
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                      <Text strong>{item.title}</Text>
                                      <Tag color="geekblue">相似度 {item.score}</Tag>
                                    </div>
                                  }
                                  description={
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                      <Text type="secondary">{item.reportSummary || '暂无摘要'}</Text>
                                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {item.matchedSignals?.slice(0, 6).map((signal) => (
                                          <Tag key={signal}>{signal}</Tag>
                                        ))}
                                      </div>
                                    </Space>
                                  }
                                />
                              </List.Item>
                            )}
                          />
                        )}
                      </Card>
                    </Space>
                  </Card>
                </Space>
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
                              <Text type="secondary">当前允许命令</Text>
                              <Title level={4} style={{ margin: '8px 0 0' }}>{commandPolicy.allowedBaseCommands.length}</Title>
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
                            <Text type="secondary">快速新增允许命令</Text>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                              <Input
                                value={newAllowedCommand}
                                onChange={(e) => setNewAllowedCommand(e.target.value)}
                                placeholder="例如 kubectl"
                                style={{ flex: 1, minWidth: 220 }}
                                onPressEnter={() => void addAllowedCommand()}
                              />
                              <Button type="primary" icon={<PlusOutlined />} loading={savingPolicy} onClick={() => void addAllowedCommand()}>
                                加入白名单
                              </Button>
                              <Button icon={<ReloadOutlined />} loading={loadingPolicy} onClick={() => void fetchCommandPolicy()}>
                                刷新策略
                              </Button>
                              <Popconfirm title="恢复默认白名单？" onConfirm={() => void resetPolicyToDefault()}>
                                <Button loading={savingPolicy}>恢复默认</Button>
                              </Popconfirm>
                            </div>
                          </div>

                          <div>
                            <Text type="secondary">批量编辑基础命令白名单</Text>
                            <TextArea
                              value={policyEditorValue}
                              onChange={(e) => setPolicyEditorValue(e.target.value)}
                              autoSize={{ minRows: 6, maxRows: 12 }}
                              style={{ marginTop: 8 }}
                              placeholder={'一行一个命令，例如\ncurl\njournalctl\nkubectl'}
                            />
                            <div style={{ marginTop: 8 }}>
                              <Button type="primary" icon={<SaveOutlined />} loading={savingPolicy} onClick={() => void saveCommandPolicy()}>
                                保存整套白名单
                              </Button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {commandPolicy.allowedBaseCommands.map((command) => (
                              <Tag
                                key={command}
                                closable
                                onClose={(event) => {
                                  event.preventDefault();
                                  void removeAllowedCommand(command);
                                }}
                                color={commandPolicy.customAddedCommands.includes(command) ? 'green' : 'blue'}
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

      <Drawer
        title="C 源码上下文"
        placement="right"
        width={900}
        open={sourceDrawerOpen}
        onClose={() => setSourceDrawerOpen(false)}
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
      </Drawer>

      <Drawer
        title="原始会话日志"
        placement="bottom"
        height="72vh"
        open={logsDrawerOpen}
        onClose={() => setLogsDrawerOpen(false)}
        extra={
          <Space>
            <Tag color={selectedSessionId ? 'processing' : 'default'}>{selectedSessionId || '未选择会话'}</Tag>
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
