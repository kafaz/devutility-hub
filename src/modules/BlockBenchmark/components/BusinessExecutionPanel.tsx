import { Button, Checkbox, Collapse, Input, Progress, Space, Tag, Typography, message } from 'antd';
import React, { useMemo, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import type { BusinessExecution, BusinessTemplate, StepResult } from '../types';
import { replaceTemplateVars, validateExecutionVars, makeExecution } from '../engine/businessEngine';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Text, Title } = Typography;
const { Panel } = Collapse;

interface Props {
  template: BusinessTemplate | null;
}

const BusinessExecutionPanel: React.FC<Props> = ({ template }) => {
  const { sessions, profiles } = useSSHStore();
  const {
    addBusinessExecution,
    updateBusinessExecution,
    addTracedTask,
    updateTracedTask,
    upsertBusinessExecutionStepResult,
  } = useBenchmarkStore();

  const connectedSessions = sessions.filter((s) => s.status === 'connected');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [globalVars, setGlobalVars] = useState<Record<string, string>>({});
  const [perNodeVars, setPerNodeVars] = useState<Record<string, Record<string, string>>>({});
  const [currentExecution, setCurrentExecution] = useState<BusinessExecution | null>(null);
  const [running, setRunning] = useState(false);

  const nodeOptions = useMemo(
    () => connectedSessions.map((s) => ({ label: s.name, value: s.id })),
    [connectedSessions]
  );

  const globalVariables = useMemo(
    () => template?.variables.filter((v) => v.scope === 'global') ?? [],
    [template]
  );
  const perNodeVariables = useMemo(
    () => template?.variables.filter((v) => v.scope === 'perNode') ?? [],
    [template]
  );

  const handleRun = async () => {
    if (!template) return;
    if (selectedNodeIds.length === 0) {
      message.warning('请至少选择一个目标节点');
      return;
    }
    const err = validateExecutionVars(template, { global: globalVars, perNode: perNodeVars }, selectedNodeIds);
    if (err) {
      message.error(err);
      return;
    }

    const exec = makeExecution(template, selectedNodeIds, { global: globalVars, perNode: perNodeVars });
    addBusinessExecution(exec);
    setCurrentExecution(exec);
    setRunning(true);
    const tracedTaskIds = new Map<string, string>();

    // Register traced tasks for each node
    selectedNodeIds.forEach((nodeId) => {
      const sess = connectedSessions.find((s) => s.id === nodeId);
      const tracedTaskId = addTracedTask({
        name: `${template.name} @ ${sess?.name ?? nodeId}`,
        nodeId,
        nodeName: sess?.name ?? nodeId,
        source: { type: 'business', refId: exec.id },
        status: 'running',
        logPaths: [],
        startedAt: Date.now(),
      });
      tracedTaskIds.set(nodeId, tracedTaskId);
    });

    const { execCommandOnSession } = useSSHStore.getState();
    const sharedVars: Record<string, string> = {};
    const nonBlockingBatches: Array<Promise<PromiseSettledResult<void>[]>> = [];

    try {
      for (const step of template.steps) {
        const targetNodes = step.target === 'all' ? selectedNodeIds : step.target;
        const validTargets = targetNodes.filter((id) => selectedNodeIds.includes(id));

        updateBusinessExecution(exec.id, { status: 'running' });

        const stepPromises = validTargets.map(async (nodeId) => {
          const session = connectedSessions.find((s) => s.id === nodeId);
          if (!session) return;
          const profile = profiles.find((item) => item.id === session.profileId);

          const nodeVars = perNodeVars[nodeId] ?? {};
          const resolvedCmd = replaceTemplateVars(
            step.cmd,
            globalVars,
            nodeVars,
            sharedVars,
            { name: session.name, ip: profile?.host ?? '' }
          );

          const stepResult: StepResult = {
            stepId: step.id,
            stepName: step.name,
            stdout: '',
            stderr: '',
            exitCode: 0,
            durationMs: 0,
            status: 'running',
          };

          upsertBusinessExecutionStepResult(exec.id, nodeId, stepResult);

          const start = Date.now();
          try {
            const res = await execCommandOnSession(nodeId, resolvedCmd, step.timeout);
            const durationMs = Date.now() - start;
            let capturedVarUpdate: Record<string, string> | undefined;

            if (step.captureVar) {
              const match = res.stdout.match(new RegExp(step.captureVar.pattern));
              if (match && match[1]) {
                sharedVars[step.captureVar.name] = match[1];
                capturedVarUpdate = { [step.captureVar.name]: match[1] };
              }
            }

            const finalResult: StepResult = {
              ...stepResult,
              stdout: res.stdout,
              stderr: res.stderr,
              exitCode: res.exitCode,
              durationMs,
              status: res.exitCode === 0 ? 'done' : 'fail',
              capturedVar: step.captureVar && sharedVars[step.captureVar.name]
                ? { name: step.captureVar.name, value: sharedVars[step.captureVar.name] }
                : undefined,
            };

            upsertBusinessExecutionStepResult(exec.id, nodeId, finalResult, capturedVarUpdate);
          } catch (e: unknown) {
            const finalResult: StepResult = {
              ...stepResult,
              stderr: e instanceof Error ? e.message : String(e),
              exitCode: -1,
              durationMs: Date.now() - start,
              status: 'fail',
            };
            upsertBusinessExecutionStepResult(exec.id, nodeId, finalResult);
          }
        });

        const batch = Promise.allSettled(stepPromises);
        if (step.blocking) {
          await batch;
        } else {
          nonBlockingBatches.push(batch);
        }
      }

      if (nonBlockingBatches.length > 0) {
        await Promise.allSettled(nonBlockingBatches);
      }

      const finalExecution =
        useBenchmarkStore.getState().businessExecutions.find((item) => item.id === exec.id) ?? exec;
      const allResults = Object.values(finalExecution.stepResults).flat();
      const hasFail = allResults.some((result) => result.status === 'fail');
      const hasDone = allResults.some((result) => result.status === 'done');
      const finalStatus: BusinessExecution['status'] = hasFail
        ? hasDone
          ? 'partial_fail'
          : 'fail'
        : 'done';

      updateBusinessExecution(exec.id, { status: finalStatus, doneAt: Date.now() });

      selectedNodeIds.forEach((nodeId) => {
        const tracedTaskId = tracedTaskIds.get(nodeId);
        if (!tracedTaskId) return;

        const nodeResults = finalExecution.stepResults[nodeId] ?? [];
        updateTracedTask(tracedTaskId, {
          status: nodeResults.some((result) => result.status === 'fail') ? 'failed' : 'completed',
        });
      });

      if (finalStatus === 'done') {
        message.success('业务执行完成');
      } else if (finalStatus === 'partial_fail') {
        message.warning('业务执行完成，但存在失败步骤');
      } else {
        message.error('业务执行失败');
      }
    } catch (e: unknown) {
      updateBusinessExecution(exec.id, { status: 'fail', doneAt: Date.now() });
      tracedTaskIds.forEach((taskId) => {
        updateTracedTask(taskId, { status: 'failed' });
      });
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const liveExec = useBenchmarkStore(
    (s) => s.businessExecutions.find((e) => e.id === currentExecution?.id) ?? currentExecution
  );

  if (!template) {
    return <Text type="secondary">请先从左侧选择一个模板</Text>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Title level={5} style={{ margin: 0 }}>执行配置</Title>

      <div>
        <Text strong>目标节点</Text>
        <Checkbox.Group
          options={nodeOptions}
          value={selectedNodeIds}
          onChange={(v) => setSelectedNodeIds(v as string[])}
        />
      </div>

      {globalVariables.length > 0 && (
        <div>
          <Text strong>全局变量</Text>
          <Space direction="vertical" style={{ width: '100%' }}>
            {globalVariables.map((v) => (
              <div key={v.name}>
                <Text>{v.label}</Text>
                <Input
                  value={globalVars[v.name] ?? v.defaultValue ?? ''}
                  onChange={(e) => setGlobalVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  placeholder={v.required ? '必填' : '可选'}
                />
              </div>
            ))}
          </Space>
        </div>
      )}

      {perNodeVariables.length > 0 && selectedNodeIds.length > 0 && (
        <div>
          <Text strong>节点变量</Text>
          <Collapse size="small">
            {selectedNodeIds.map((nodeId) => {
              const sess = connectedSessions.find((s) => s.id === nodeId);
              return (
                <Panel header={sess?.name ?? nodeId} key={nodeId}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {perNodeVariables.map((v) => (
                      <div key={v.name}>
                        <Text>{v.label}</Text>
                        <Input
                          value={perNodeVars[nodeId]?.[v.name] ?? v.defaultValue ?? ''}
                          onChange={(e) =>
                            setPerNodeVars((prev) => ({
                              ...prev,
                              [nodeId]: { ...prev[nodeId], [v.name]: e.target.value },
                            }))
                          }
                          placeholder={v.required ? '必填' : '可选'}
                        />
                      </div>
                    ))}
                  </Space>
                </Panel>
              );
            })}
          </Collapse>
        </div>
      )}

      <Button type="primary" onClick={handleRun} loading={running} disabled={selectedNodeIds.length === 0}>
        一键下发
      </Button>

      {liveExec && (
        <div>
          <Text strong>执行进度 — {liveExec.status}</Text>
          {selectedNodeIds.map((nodeId) => {
            const sess = connectedSessions.find((s) => s.id === nodeId);
            const results = liveExec.stepResults[nodeId] ?? [];
            const doneCount = results.filter((r) => r.status === 'done' || r.status === 'fail').length;
            const totalSteps = template.steps.length;
            const percent = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;
            const hasFail = results.some((r) => r.status === 'fail');

            return (
              <div key={nodeId} style={{ marginBottom: 8 }}>
                <Space>
                  <Text>{sess?.name ?? nodeId}</Text>
                  {hasFail && <Tag color="error">失败</Tag>}
                </Space>
                <Progress percent={percent} size="small" status={hasFail ? 'exception' : 'active'} />
              </div>
            );
          })}

          <Collapse size="small">
            {selectedNodeIds.map((nodeId) => {
              const results = liveExec.stepResults[nodeId] ?? [];
              if (results.length === 0) return null;
              const sess = connectedSessions.find((s) => s.id === nodeId);
              return (
                <Panel header={`${sess?.name ?? nodeId} 输出`} key={nodeId}>
                  {results.map((r, idx) => (
                    <div key={idx} style={{ marginBottom: 8 }}>
                      <Tag color={r.status === 'done' ? 'success' : r.status === 'fail' ? 'error' : 'processing'}>
                        {r.stepName}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>exit={r.exitCode} {r.durationMs}ms</Text>
                      {r.stdout && (
                        <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                          {r.stdout}
                        </pre>
                      )}
                      {r.stderr && (
                        <pre style={{ fontSize: 11, background: '#fff2f0', padding: 8, borderRadius: 4, color: '#cf1322' }}>
                          {r.stderr}
                        </pre>
                      )}
                    </div>
                  ))}
                </Panel>
              );
            })}
          </Collapse>
        </div>
      )}
    </div>
  );
};

export default BusinessExecutionPanel;
