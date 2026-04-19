const EXPECTED_DIAGNOSTIC_TOOLS = [
  'journalctl',
  'dmesg',
  'ss',
  'ps',
  'top',
  'iostat',
  'vmstat',
  'tail',
  'grep',
  'awk',
  'sed',
];

export interface PrepareInsightStep {
  name: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number;
  status: 'done' | 'failed';
  statusReason?: string;
}

export interface PrepareInsightSummary {
  durationMs: number;
  readyLine: string;
  shell: string;
  slowestStepName: string;
  slowestStepDurationMs: number;
  warmedToolCount: number;
  missingTools: string[];
  failureReasons: string[];
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function summarizePrepareRun(steps: PrepareInsightStep[]): PrepareInsightSummary {
  const combinedOutput = steps
    .flatMap((step) => [step.stdout, step.stderr])
    .filter(Boolean)
    .join('\n');

  const readyMatch = combinedOutput.match(/READY user=([^\s]+)\s+host=([^\s]+)\s+pwd=(.+)/);
  const readyLine = readyMatch
    ? `${readyMatch[1]} @ ${readyMatch[2]} · ${readyMatch[3].trim()}`
    : '等待 READY 上下文';

  const shellMatch = combinedOutput.match(/shell=([^\n]+)/);
  const shell = shellMatch?.[1]?.trim() || 'unknown';

  const warmedTools = unique(
    Array.from(combinedOutput.matchAll(/\[tool\]\s+([a-z0-9._-]+)=/gi)).map((match) => match[1])
  );
  const missingTools = EXPECTED_DIAGNOSTIC_TOOLS.filter((tool) => !warmedTools.includes(tool));

  const totalDurationMs = steps.reduce((sum, step) => sum + (Number(step.durationMs) || 0), 0);
  const slowestStep = steps.reduce<PrepareInsightStep | null>((current, step) => {
    if (!current) return step;
    return Number(step.durationMs) > Number(current.durationMs) ? step : current;
  }, null);

  const failureReasons = unique(
    steps
      .filter((step) => step.status === 'failed' || step.exitCode !== 0)
      .map((step) => step.statusReason || `${step.name} exit=${step.exitCode}`)
  );

  return {
    durationMs: totalDurationMs,
    readyLine,
    shell,
    slowestStepName: slowestStep?.name || 'n/a',
    slowestStepDurationMs: Number(slowestStep?.durationMs || 0),
    warmedToolCount: warmedTools.length,
    missingTools,
    failureReasons,
  };
}
