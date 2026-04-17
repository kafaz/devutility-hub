import { Button, Checkbox, Collapse, Input, Progress, Space, Tag, Typography, message } from 'antd';
import React, { useMemo, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import type { BusinessExecution, BusinessTemplate } from '../types';
import { replaceTemplateVars, validateExecutionVars, makeExecution } from '../engine/businessEngine';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Text, Title } = Typography;
const { Panel } = Collapse;

interface Props {
  template: BusinessTemplate | null;
}

const BusinessExecutionPanel: React.FC<Props> = ({ template }) => {
  const { sessions } = useSSHStore();
  const { addBusinessExecution, updateBusinessExecution, addTracedTask } = useBenchmarkStore();

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

    // Register traced tasks for each node
    selectedNodeIds.forEach((nodeId) => {
      const sess = connectedSessions.find((s) => s.id === nodeId);
      addTracedTask({
        name: `${template.name} @ ${sess?.name ?? nodeId}`,
        nodeId,
        nodeName: sess?.name ?? nodeId,
        source: { type: 'business', refId: exec.id },
        status: 'running',
        logPaths: [],
        startedAt: Date.now(),
      });
    });

    const { execCommandOnSession } = useSSHStore.getState();
    let sharedVars: Record<string, string> = {};

    for (const step of template.steps) {
      const targetNodes = step.target === 'all' ? selectedNodeIds : step.target;
      const validTargets = targetNodes.filter((id) => selectedNodeIds.includes(id));

      updateBusinessExecution(exec.id, { status: 'running' });

      const stepPromises = validTargets.map(async (nodeId) => {
        const session = connectedSessions.find((s) => s.id === nodeId);
        if (!session) return;

        const nodeVars = perNodeVars[nodeId] ?? {};
        const resolvedCmd = replaceTemplateVars(
          step.cmd,
          globalVars,
          nodeVars,
          sharedVars,
          { name: session.name, ip: '' }
        );

        const stepResult = {
          stepId: step.id,
          stepName: step.name,
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 0,
          status: 'running' as const,
        };

        // Update to running
        updateBusinessExecution(exec.id, {
          stepResults: {
            ...exec.stepResults,
            [nodeId]: [...(exec.stepResults[nodeId] ?? []), stepResult],
          },
        });

        const start = Date.now();
        try {
          const res = await execCommandOnSession(nodeId, resolvedCmd, step.timeout);
          const durationMs = Date.now() - start;

          if (step.captureVar) {
            const match = res.stdout.match(new RegExp(step.captureVar.pattern));
            if (match && match[1]) {
              sharedVars[step.captureVar.name] = match[1];
            }
          }

          const finalResult = {
            ...stepResult,
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exitCode,
            durationMs,
            status: res.exitCode === 0 ? ('done' as const) : ('fail' as const),
            capturedVar: step.captureVar && sharedVars[step.captureVar.name]
              ? { name: step.captureVar.name, value: sharedVars[step.captureVar.name] }
              : undefined,
          };

          updateBusinessExecution(exec.id, {
            stepResults: {
              ...exec.stepResults,
              [nodeId]: [...(exec.stepResults[nodeId] ?? []).slice(0, -1), finalResult],
            },
            sharedVars: { ...sharedVars },
          });
        } catch (e: unknown) {
          const finalResult = {
            ...stepResult,
            stderr: e instanceof Error ? e.message : String(e),
            exitCode: -1,
            durationMs: Date.now() - start,
            status: 'fail' as const,
          };
          updateBusinessExecution(exec.id, {
            stepResults: {
              ...exec.stepResults,
              [nodeId]: [...(exec.stepResults[nodeId] ?? []).slice(0, -1), finalResult],
            },
          });
        }
      });

      if (step.blocking) {
        await Promise.allSettled(stepPromises);
      } else {
        Promise.allSettled(stepPromises);
      }
    }

    // Determine final status
    const allResults = Object.values(
      useBenchmarkStore.getState().businessExecutions.find((e) => e.id === exec.id)?.stepResults ?? {}
    ).flat();
    const hasFail = allResults.some((r) => r.status === 'fail');
    const hasDone = allResults.some((r) => r.status === 'done');
    const finalStatus: BusinessExecution['status'] = hasFail
      ? hasDone
        ? 'partial_fail'
        : 'fail'
      : 'done';

    updateBusinessExecution(exec.id, { status: finalStatus, doneAt: Date.now() });
    setRunning(false);
    message.success(`业务执行完成: ${finalStatus}`);
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
