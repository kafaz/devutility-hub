const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(STORE_DIR, 'diagnostic-kb.json');

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'then', 'than',
  'true', 'false', 'null', 'none', 'not', 'are', 'was', 'were', 'have', 'has',
  'http', 'https', 'api', 'json', 'info', 'warn', 'warning', 'debug', 'trace',
  '日志', '进行', '当前', '因为', '以及', '需要', '可以', '通过', '一次', '出现',
  '问题', '排查', '服务', '业务', '脚本', '执行', '诊断', '工作台', '节点',
]);

function ensureStore() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ runs: [] }, null, 2), 'utf8');
  }
}

function loadStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    return { runs: [] };
  }
}

function saveStore(store) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function clipText(text, limit = 1600) {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tokenizeText(text) {
  const matches = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9_./:-]+|[\u4e00-\u9fff]{2,}/g) || [];

  return unique(
    matches
      .map((token) => token.replace(/^[./:_-]+|[./:_-]+$/g, ''))
      .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
  );
}

function intersectionRatio(a, b) {
  const left = new Set(a || []);
  const right = new Set(b || []);
  if (!left.size || !right.size) return 0;

  let overlap = 0;
  for (const item of left) {
    if (right.has(item)) overlap += 1;
  }

  return overlap / Math.max(left.size, right.size);
}

function intersectValues(a, b) {
  const right = new Set(b || []);
  return unique((a || []).filter((item) => right.has(item)));
}

function buildSignals(runLike) {
  const symptomKeywords = tokenizeText([
    runLike.symptom,
    runLike.title,
    runLike.notes,
  ].join('\n'));

  const findingKeywords = tokenizeText([
    ...(runLike.findings || []).map((finding) => [
      finding.title,
      finding.summary,
      finding.evidence,
      finding.matchedPattern,
    ].join('\n')),
    runLike.report?.summary,
    runLike.report?.rootCauseHypothesis,
  ].join('\n'));

  const commandKeywords = tokenizeText([
    ...(runLike.collectionSteps || []).map((step) => [
      step.name,
      step.command,
      step.resolvedCommand,
    ].join('\n')),
    ...(runLike.businessActions || []).map((action) => [
      action.name,
      action.scriptPath,
      ...(action.args || []),
    ].join('\n')),
  ].join('\n'));

  return {
    symptomKeywords,
    findingKeywords,
    commandKeywords,
  };
}

function pickEvidence(text, pattern) {
  if (!text) return '';
  const safePattern = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'im');
  const lines = String(text).split(/\r?\n/);
  const hit = lines.find((line) => safePattern.test(line));
  return clipText(hit || lines[0] || '', 300);
}

function buildHeuristicFindings({ collectionSteps = [], businessActions = [], analysisRules = [] }) {
  const findings = [];
  const seen = new Set();

  const addFinding = (finding) => {
    const key = `${finding.sourceStepId || 'na'}::${finding.title}::${finding.matchedPattern || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  for (const step of collectionSteps) {
    const stdout = String(step.stdout || '');
    const stderr = String(step.stderr || '');
    const allText = `${stdout}\n${stderr}`;

    for (const rule of analysisRules) {
      if (!rule.pattern) continue;

      let regex;
      try {
        regex = new RegExp(rule.pattern, 'im');
      } catch {
        continue;
      }

      const sourceText =
        rule.source === 'stderr' ? stderr :
        rule.source === 'stdout' ? stdout :
        allText;

      if (!regex.test(sourceText)) continue;

      addFinding({
        id: `${step.id}-${findings.length + 1}`,
        title: rule.name || `规则命中: ${rule.pattern}`,
        severity: rule.severity || 'warning',
        summary: rule.summary || `在步骤「${step.name}」中命中了分析规则`,
        evidence: pickEvidence(sourceText, regex),
        matchedPattern: rule.pattern,
        sourceStepId: step.id,
        sourceStepName: step.name,
      });
    }

    if ((step.exitCode ?? 0) !== 0) {
      addFinding({
        id: `${step.id}-exit`,
        title: `命令执行失败: ${step.name}`,
        severity: 'critical',
        summary: `命令退出码为 ${step.exitCode}，需要优先确认该步骤是否是根因或现场阻断点`,
        evidence: clipText(stderr || stdout, 300),
        matchedPattern: `exit:${step.exitCode}`,
        sourceStepId: step.id,
        sourceStepName: step.name,
      });
    }

    const heuristicPatterns = [
      { pattern: /(oom|out of memory|killed process)/i, severity: 'critical', title: '疑似内存耗尽' },
      { pattern: /(timeout|timed out|超时)/i, severity: 'critical', title: '疑似超时或阻塞' },
      { pattern: /(connection refused|refused|连接被拒绝)/i, severity: 'critical', title: '疑似端口未监听或被拒绝' },
      { pattern: /(exception|traceback|panic|fatal|segfault|assert)/i, severity: 'critical', title: '疑似程序级异常' },
      { pattern: /\b(502|503|504)\b/i, severity: 'warning', title: '疑似网关或上游异常' },
      { pattern: /(error|failed|failure|异常)/i, severity: 'warning', title: '发现错误特征' },
    ];

    for (const rule of heuristicPatterns) {
      if (!rule.pattern.test(allText)) continue;
      addFinding({
        id: `${step.id}-${rule.title}`,
        title: rule.title,
        severity: rule.severity,
        summary: `在步骤「${step.name}」输出中发现高风险关键词`,
        evidence: pickEvidence(allText, rule.pattern),
        matchedPattern: String(rule.pattern),
        sourceStepId: step.id,
        sourceStepName: step.name,
      });
    }
  }

  for (const action of businessActions) {
    if ((action.exitCode ?? 0) === 0) continue;
    addFinding({
      id: `${action.id}-biz-exit`,
      title: `业务脚本执行失败: ${action.name}`,
      severity: 'critical',
      summary: `业务测试控制脚本退出码为 ${action.exitCode}`,
      evidence: clipText(action.stderr || action.stdout, 300),
      matchedPattern: `biz-exit:${action.exitCode}`,
      sourceStepId: action.id,
      sourceStepName: action.name,
    });
  }

  return findings;
}

function buildDiagnosticReport({ title, symptom, notes, collectionSteps = [], businessActions = [], findings = [], similarCases = [] }) {
  const failedSteps = collectionSteps.filter((step) => (step.exitCode ?? 0) !== 0);
  const criticalFindings = findings.filter((finding) => finding.severity === 'critical');
  const topFinding = criticalFindings[0] || findings[0] || null;
  const strongestCase = similarCases[0] || null;

  const summaryParts = [
    `本次诊断执行了 ${collectionSteps.length} 个采集步骤`,
    failedSteps.length ? `其中 ${failedSteps.length} 个步骤退出非零` : '所有采集步骤均完成',
    businessActions.length ? `执行业务脚本 ${businessActions.length} 个` : null,
    findings.length ? `共识别 ${findings.length} 条分析结论` : '未识别到明确异常特征',
    strongestCase ? `召回到 ${similarCases.length} 条历史相似案例` : '未召回到高相似历史案例',
  ].filter(Boolean).join('，');

  const rootCauseHypothesis = topFinding
    ? `${topFinding.title}。${topFinding.summary}`
    : '当前未形成明确根因假设，建议补充更针对性的采集命令或分析规则。';

  const recommendations = unique([
    topFinding ? `优先核查步骤「${topFinding.sourceStepName}」相关组件、配置和依赖状态` : '',
    failedSteps[0] ? `复核失败命令「${failedSteps[0].name}」的执行环境和权限` : '',
    strongestCase ? `参考历史案例「${strongestCase.title}」的处理路径` : '',
    notes ? '结合本次备注继续补充业务上下文和修复动作' : '',
  ]).filter(Boolean);

  const nextActions = unique([
    ...criticalFindings.slice(0, 3).map((finding) => `围绕「${finding.sourceStepName}」补充二跳验证和上下游依赖检查`),
    businessActions.some((action) => (action.exitCode ?? 0) !== 0) ? '修正业务测试脚本或目标环境后重新回归' : '',
    !findings.length ? '补充日志关键字规则，减少人工阅读原始输出' : '',
  ]).filter(Boolean);

  return {
    summary: summaryParts,
    rootCauseHypothesis,
    recommendations,
    nextActions,
    notes: notes || '',
    similarCaseHint: strongestCase
      ? `最相似历史案例：${strongestCase.title}（得分 ${strongestCase.score}）`
      : '',
  };
}

function recallSimilarRuns(queryLike, runs, limit = 5) {
  const querySignals = buildSignals(queryLike);

  return runs
    .map((run) => {
      const candidateSignals = run.signals || buildSignals(run);
      const symptomScore = intersectionRatio(querySignals.symptomKeywords, candidateSignals.symptomKeywords);
      const findingScore = intersectionRatio(querySignals.findingKeywords, candidateSignals.findingKeywords);
      const commandScore = intersectionRatio(querySignals.commandKeywords, candidateSignals.commandKeywords);
      const score = Number((symptomScore * 0.45 + findingScore * 0.35 + commandScore * 0.20).toFixed(3));

      return {
        runId: run.id,
        title: run.title,
        score,
        matchedSignals: unique([
          ...intersectValues(querySignals.symptomKeywords, candidateSignals.symptomKeywords),
          ...intersectValues(querySignals.findingKeywords, candidateSignals.findingKeywords),
          ...intersectValues(querySignals.commandKeywords, candidateSignals.commandKeywords),
        ]).slice(0, 8),
        reportSummary: run.report?.summary || '',
        topFindings: (run.findings || []).slice(0, 3).map((finding) => finding.title),
        startedAt: run.startedAt,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, limit);
}

function appendRun(run) {
  const store = loadStore();
  store.runs.unshift(run);
  saveStore(store);
  return run;
}

function listRuns() {
  return loadStore().runs;
}

function getRunById(id) {
  return loadStore().runs.find((run) => run.id === id) || null;
}

module.exports = {
  STORE_FILE,
  appendRun,
  buildDiagnosticReport,
  buildHeuristicFindings,
  buildSignals,
  getRunById,
  listRuns,
  loadStore,
  recallSimilarRuns,
};
