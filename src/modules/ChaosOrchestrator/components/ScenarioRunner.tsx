/**
 * ScenarioRunner.tsx
 *
 * Execution engine for ChaosScenario. Runs steps sequentially.
 * Renders a real-time pipeline view while the scenario executes.
 */
import {
    CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
    PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined,
} from '@ant-design/icons';
import {
    Badge, Button,
    Collapse,
    Progress, Space, Spin, Steps, Tag,
    Typography
} from 'antd';
import React, { useCallback, useRef, useState } from 'react';
import { useBackgroundJobStore } from '../../SSHManager/store/backgroundJobStore';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { FAULT_TEMPLATES } from '../components/faultTemplates';
import {
    useChaosStore,
    type ChaosScenario,
    type ScenarioStep,
    type StepResult,
    type VerifyRule,
} from '../store/chaosStore';

const { Text } = Typography;
const { Panel } = Collapse;

function sleep(ms: number) {
  return new Promise<void>(res => setTimeout(res, ms));
}

function applyVerifyRule(stdout: string, exitCode: number, rule: VerifyRule): boolean {
  switch (rule.type) {
    case 'contains': return stdout.includes(rule.value);
    case 'not_contains': return !stdout.includes(rule.value);
    case 'regex': try { return new RegExp(rule.value, 'im').test(stdout); } catch { return false; }
    case 'exit_code_zero': return exitCode === 0;
    default: return false;
  }
}

function VerifyRuleTag({ rule, passed }: { rule: VerifyRule; passed?: boolean }) {
  const icons: Record<string, string> = { contains: '⊃', not_contains: '⊅', regex: 'R/', exit_code_zero: '=$0' };
  return (
    <Tag color={passed === undefined ? 'default' : passed ? 'success' : 'error'} style={{ fontSize: 11 }}>
      {icons[rule.type]} {rule.value || '(exit=0)'}
    </Tag>
  );
}

const STATUS_COLOR: Record<string, any> = {
  pending: 'default', running: 'processing', passed: 'success',
  failed: 'error', skipped: 'default', error: 'error',
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: null, running: <Spin size="small" />,
  passed: <CheckCircleOutlined style={{ color: '#22c55e' }} />,
  failed: <CloseCircleOutlined style={{ color: '#ef4444' }} />,
  skipped: <PauseCircleOutlined style={{ color: '#888' }} />,
  error: <ExclamationCircleOutlined style={{ color: '#f97316' }} />,
};

interface Props { scenario: ChaosScenario; }

export const ScenarioRunner: React.FC<Props> = ({ scenario }) => {
  const { setScenarioStatus, setStepResult, resetScenario } = useChaosStore();
  const { sessions, execCommandOnSession } = useSSHStore();
  const { createJob, killJob } = useBackgroundJobStore();
  const abortRef = useRef(false);
  const [runLog, setRunLog] = useState<string[]>([]);

  const log = useCallback((msg: string) => {
    setRunLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const runStep = useCallback(async (step: ScenarioStep, bgJobMap: Record<string, string>): Promise<StepResult> => {
    const result: StepResult = { stepId: step.id, status: 'running', startedAt: Date.now() };

    try {
      if (step.type === 'wait') {
        log(`⏳ [${step.label}] 等待 ${step.waitSeconds}s`);
        await sleep((step.waitSeconds ?? 10) * 1000);
        return { ...result, status: 'passed', endedAt: Date.now() };
      }

      if (step.type === 'kill_bg') {
        const refId = step.bgJobStepRef;
        const jobId = refId ? bgJobMap[refId] : undefined;
        if (jobId) {
          await killJob(jobId, execCommandOnSession);
          log(`⏸ [${step.label}] 已终止后台任务 ${jobId}`);
        } else {
          log(`⚠ [${step.label}] 找不到对应的后台任务 ID，跳过`);
        }
        return { ...result, status: 'passed', endedAt: Date.now() };
      }

      // Steps that need a session
      const sessionId = step.sessionIds?.[0];
      const sess = sessions.find(s => s.id === sessionId);
      if (!sess) {
        return { ...result, status: 'error', errorMsg: `找不到 SSH 会话: ${sessionId || '未设置'}`, endedAt: Date.now() };
      }

      if (step.type === 'background') {
        const bgId = await createJob(
          { sessionId, sessionName: sess.name, cmd: step.bgCmd || '', mode: step.bgMode || 'once', watchInterval: step.bgInterval ?? 2, alertPattern: step.bgAlertPattern },
          execCommandOnSession
        );
        bgJobMap[step.id] = bgId;
        log(`🔵 [${step.label}] 后台任务已启动 → jobId=${bgId}`);
        return { ...result, status: 'passed', endedAt: Date.now(), bgJobId: bgId };
      }

      // inject / recover / verify → derive cmd
      let cmd = step.rawCmd || '';
      if (!cmd && step.faultTemplateId) {
        const tmpl = FAULT_TEMPLATES.find((t: any) => t.id === step.faultTemplateId);
        if (tmpl) cmd = step.type === 'recover' ? (step.recoverCmd || '') : tmpl.generateCmd(step.faultParams || {});
      }
      if (step.type === 'recover' && step.recoverCmd) cmd = step.recoverCmd;

      if (!cmd.trim()) {
        return { ...result, status: 'skipped', endedAt: Date.now(), errorMsg: '命令为空，跳过' };
      }

      log(`🔧 [${step.label}] 执行: ${cmd.slice(0, 80)}${cmd.length > 80 ? '…' : ''}`);

      // Support multiple target sessions
      const targetSessions = step.sessionIds?.length ? step.sessionIds : [sessionId];
      let lastStdout = '';
      let lastExitCode = 0;

      for (const sid of targetSessions) {
        const r = await execCommandOnSession(sid, cmd, 30000);
        lastStdout = r.stdout;
        lastExitCode = r.exitCode;
        log(`  → node[${sessions.find(s => s.id === sid)?.name || sid}] exitCode=${r.exitCode}`);
      }

      if (step.type === 'verify') {
        const rules = step.verifyRules || [];
        const verifyDetails = rules.map(rule => ({ rule, passed: applyVerifyRule(lastStdout, lastExitCode, rule) }));
        const allPassed = verifyDetails.every(d => d.passed);
        log(`${allPassed ? '✅' : '❌'} [${step.label}] 校验 ${allPassed ? 'PASS' : 'FAIL'}`);
        return {
          ...result,
          status: allPassed ? 'passed' : 'failed',
          stdout: lastStdout,
          exitCode: lastExitCode,
          verifyDetails,
          endedAt: Date.now(),
        };
      }

      return { ...result, status: 'passed', stdout: lastStdout, exitCode: lastExitCode, endedAt: Date.now() };

    } catch (e: any) {
      log(`💥 [${step.label}] 异常: ${e.message}`);
      return { ...result, status: 'error', errorMsg: e.message, endedAt: Date.now() };
    }
  }, [sessions, execCommandOnSession, createJob, killJob, log]);

  const handleRun = useCallback(async () => {
    if (scenario.status === 'running') return;
    abortRef.current = false;
    setRunLog([]);
    resetScenario(scenario.id);
    setScenarioStatus(scenario.id, 'running', 0);
    log(`🚀 场景「${scenario.name}」开始执行`);

    const bgJobMap: Record<string, string> = {};

    for (let i = 0; i < scenario.steps.length; i++) {
      if (abortRef.current) {
        log('⛔ 用户中止场景。');
        setScenarioStatus(scenario.id, 'aborted');
        return;
      }
      const step = scenario.steps[i];
      setScenarioStatus(scenario.id, 'running', i);
      setStepResult(scenario.id, { stepId: step.id, status: 'running', startedAt: Date.now() });

      const result = await runStep(step, bgJobMap);
      setStepResult(scenario.id, result);

      if (result.status === 'failed' && !step.continueOnFail) {
        log(`❌ 步骤「${step.label}」FAIL，场景中止。`);
        setScenarioStatus(scenario.id, 'aborted');
        return;
      }
    }

    log(`✅ 场景「${scenario.name}」全部步骤执行完成！`);
    setScenarioStatus(scenario.id, 'done');
  }, [scenario, runStep, resetScenario, setScenarioStatus, setStepResult, log]);

  const handleAbort = () => { abortRef.current = true; };

  const isRunning = scenario.status === 'running';
  const passCount = scenario.steps.filter(st => scenario.stepResults[st.id]?.status === 'passed').length;
  const failCount = scenario.steps.filter(st => ['failed', 'error'].includes(scenario.stepResults[st.id]?.status || '')).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Control Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          {!isRunning ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRun} disabled={!scenario.steps.length}>
              执行场景
            </Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={handleAbort}>中止</Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => resetScenario(scenario.id)} disabled={isRunning}>
            重置
          </Button>
        </Space>
        <Space>
          {passCount > 0 && <Tag color="success">✅ PASS ×{passCount}</Tag>}
          {failCount > 0 && <Tag color="error">❌ FAIL ×{failCount}</Tag>}
          {scenario.status === 'done' && <Tag color="green">全部完成</Tag>}
          {scenario.status === 'aborted' && <Tag color="orange">已中止</Tag>}
        </Space>
      </div>

      {/* Progress */}
      {isRunning && (
        <Progress
          percent={Math.round(((scenario.currentStepIndex) / scenario.steps.length) * 100)}
          status="active"
          size="small"
        />
      )}

      {/* Step Pipeline View */}
      <Collapse size="small" defaultActiveKey={['steps']}>
        <Panel key="steps" header="步骤流水线">
          <Steps
            direction="vertical"
            size="small"
            current={isRunning ? scenario.currentStepIndex : -1}
            items={scenario.steps.map((step) => {
              const res = scenario.stepResults[step.id];
              return {
                title: (
                  <Space>
                    <Text style={{ fontSize: 13 }}>{step.label}</Text>
                    <Tag>{step.type}</Tag>
                    {res && STATUS_ICON[res.status]}
                    {res?.status && <Badge status={STATUS_COLOR[res.status]} text={res.status} />}
                  </Space>
                ),
                description: res && (
                  <div style={{ marginTop: 4 }}>
                    {res.verifyDetails && (
                      <Space wrap>
                        {res.verifyDetails.map(v => <VerifyRuleTag key={v.rule.id} rule={v.rule} passed={v.passed} />)}
                      </Space>
                    )}
                    {res.stdout && (
                      <pre style={{ fontSize: 10, background: '#1e1e1e', color: '#d4d4d4', padding: '4px 8px', borderRadius: 4, maxHeight: 100, overflow: 'auto', margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {res.stdout.slice(0, 500)}{res.stdout.length > 500 ? '\n…(truncated)' : ''}
                      </pre>
                    )}
                    {res.errorMsg && <Text type="danger" style={{ fontSize: 11 }}>{res.errorMsg}</Text>}
                  </div>
                ),
              };
            })}
          />
        </Panel>

        {/* Execution Log */}
        {runLog.length > 0 && (
          <Panel key="log" header={`执行日志 (${runLog.length} 条)`}>
            <pre style={{ fontSize: 11, background: '#0d1117', color: '#e6edf3', padding: 10, borderRadius: 6, maxHeight: 200, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
              {runLog.join('\n')}
            </pre>
          </Panel>
        )}
      </Collapse>
    </div>
  );
};

export default ScenarioRunner;
