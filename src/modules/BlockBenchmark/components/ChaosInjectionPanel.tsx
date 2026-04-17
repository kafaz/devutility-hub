import { Button, Card, Checkbox, Collapse, Input, InputNumber, Space, Tag, Typography, message } from 'antd';
import React, { useMemo, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';
import { replaceFaultVars, buildInjection, buildDelayedRecoveryScript } from '../engine/chaosEngine';
import type { ChaosFault, ChaosInjection } from '../types';
import ChaosFaultLibrary from './ChaosFaultLibrary';

const { Text } = Typography;
const { Panel } = Collapse;

const ChaosInjectionPanel: React.FC = () => {
  const { sessions, execCommandOnSession } = useSSHStore();
  const { chaosFaults, chaosInjections, addChaosInjection, updateChaosInjection, addTracedTask } = useBenchmarkStore();

  const connectedSessions = sessions.filter((s) => s.status === 'connected');

  const [selectedFault, setSelectedFault] = useState<ChaosFault | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [durationSec, setDurationSec] = useState<number>(60);
  const [injecting, setInjecting] = useState(false);
  const [recoveringIds, setRecoveringIds] = useState<Set<string>>(new Set());

  const nodeOptions = useMemo(
    () => connectedSessions.map((s) => ({ label: s.name, value: s.id })),
    [connectedSessions]
  );

  const handleSelectFault = (fault: ChaosFault) => {
    setSelectedFault(fault);
    const defaults: Record<string, string> = {};
    for (const p of fault.params) {
      if (p.defaultValue !== undefined) defaults[p.name] = p.defaultValue;
    }
    setParamValues(defaults);
    setDurationSec(fault.defaultDurationSec);
  };

  const handleInject = async () => {
    if (!selectedFault) {
      message.warning('请先从左侧选择一个故障');
      return;
    }
    if (selectedNodeIds.length === 0) {
      message.warning('请至少选择一个目标节点');
      return;
    }

    const injection = buildInjection(selectedFault, selectedNodeIds, paramValues, durationSec);
    addChaosInjection(injection);
    setInjecting(true);
    updateChaosInjection(injection.id, { status: 'injecting' });

    // Register traced tasks for each selected node
    selectedNodeIds.forEach((nodeId) => {
      const sess = connectedSessions.find((s) => s.id === nodeId);
      addTracedTask({
        name: `${selectedFault.name} @ ${sess?.name ?? nodeId}`,
        nodeId,
        nodeName: sess?.name ?? nodeId,
        source: { type: 'chaos', refId: injection.id },
        status: 'running',
        logPaths: [],
        startedAt: Date.now(),
      });
    });

    const injectCmd = replaceFaultVars(selectedFault.cmdTemplate, paramValues);
    const recoveryScript = buildDelayedRecoveryScript(selectedFault, paramValues, durationSec, injection.id);

    const results: { nodeId: string; stdout: string; stderr: string; exitCode: number }[] = [];

    await Promise.allSettled(
      selectedNodeIds.map(async (nodeId) => {
        try {
          const res = await execCommandOnSession(nodeId, injectCmd, 30000);
          results.push({ nodeId, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode });

          // If fault has recovery and duration > 0, send delayed recovery script
          if (recoveryScript && durationSec > 0) {
            await execCommandOnSession(nodeId, recoveryScript, 30000);
          }
        } catch (e: unknown) {
          const err = e instanceof Error ? e.message : String(e);
          results.push({ nodeId, stdout: '', stderr: err, exitCode: -1 });
        }
      })
    );

    const hasFail = results.some((r) => r.exitCode !== 0);
    const logLines = results
      .map((r) => {
        const sess = connectedSessions.find((s) => s.id === r.nodeId);
        const name = sess?.name ?? r.nodeId;
        return `[${name}] exit=${r.exitCode}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
      })
      .join('\n---\n');

    updateChaosInjection(injection.id, {
      status: hasFail ? 'fail' : 'injected',
      injectedAt: Date.now(),
      log: logLines,
    });

    setInjecting(false);
    message[hasFail ? 'error' : 'success'](`注入${hasFail ? '部分失败' : '成功'}: ${selectedFault.name}`);
  };

  const handleRecover = async (injection: ChaosInjection) => {
    const fault = chaosFaults.find((f) => f.id === injection.faultId);
    if (!fault || !fault.recoveryCmdTemplate) {
      message.warning('该故障没有配置恢复命令');
      return;
    }

    setRecoveringIds((prev) => new Set(prev).add(injection.id));
    updateChaosInjection(injection.id, { status: 'recovering' });

    const recoveryCmd = replaceFaultVars(fault.recoveryCmdTemplate, injection.paramValues);

    await Promise.allSettled(
      injection.nodeIds.map(async (nodeId) => {
        try {
          await execCommandOnSession(nodeId, recoveryCmd, 30000);
        } catch {
          // ignore individual recovery errors
        }
      })
    );

    // eslint-disable-next-line react-hooks/purity -- timestamp for event handler side-effect
    const recoveredAt = Date.now();
    updateChaosInjection(injection.id, {
      status: 'recovered',
      recoveredAt,
    });

    setRecoveringIds((prev) => {
      const next = new Set(prev);
      next.delete(injection.id);
      return next;
    });

    message.success(`已触发恢复: ${injection.faultName}`);
  };

  const statusColor: Record<ChaosInjection['status'], string> = {
    pending: 'default',
    injecting: 'processing',
    injected: 'success',
    recovering: 'warning',
    recovered: 'blue',
    fail: 'error',
  };

  const statusLabel: Record<ChaosInjection['status'], string> = {
    pending: '待注入',
    injecting: '注入中',
    injected: '已注入',
    recovering: '恢复中',
    recovered: '已恢复',
    fail: '失败',
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left: Fault Library */}
      <Card
        title="故障库"
        style={{ width: 320, minWidth: 320, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, overflowY: 'auto' } }}
      >
        <ChaosFaultLibrary
          faults={chaosFaults}
          selectedId={selectedFault?.id ?? null}
          onSelect={handleSelectFault}
        />
      </Card>

      {/* Right: Config + History */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <Card title="注入配置">
          {!selectedFault ? (
            <Text type="secondary">请从左侧选择一个故障模板</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <Text strong>目标节点</Text>
                <Checkbox.Group
                  options={nodeOptions}
                  value={selectedNodeIds}
                  onChange={(v) => setSelectedNodeIds(v as string[])}
                />
              </div>

              {selectedFault.params.length > 0 && (
                <div>
                  <Text strong>参数</Text>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {selectedFault.params.map((p) => (
                      <div key={p.name}>
                        <Text>{p.label}</Text>
                        <Input
                          value={paramValues[p.name] ?? p.defaultValue ?? ''}
                          onChange={(e) =>
                            setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))
                          }
                          placeholder={p.required ? '必填' : '可选'}
                        />
                      </div>
                    ))}
                  </Space>
                </div>
              )}

              <div>
                <Text strong>持续时间 (秒)</Text>
                <InputNumber
                  min={0}
                  value={durationSec}
                  onChange={(v) => setDurationSec(v ?? 0)}
                  style={{ width: '100%' }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  0 表示不自动恢复；大于 0 时会在节点上启动后台定时恢复脚本
                </Text>
              </div>

              <Button
                type="primary"
                danger
                onClick={handleInject}
                loading={injecting}
                disabled={selectedNodeIds.length === 0}
              >
                执行注入
              </Button>
            </div>
          )}
        </Card>

        <Card
          title="注入历史"
          style={{ flex: 1 }}
          styles={{ body: { overflowY: 'auto' } }}
        >
          {chaosInjections.length === 0 ? (
            <Text type="secondary">暂无注入记录</Text>
          ) : (
            <Collapse size="small">
              {chaosInjections.map((inj) => {
                const isRecovering = recoveringIds.has(inj.id);
                return (
                  <Panel
                    key={inj.id}
                    header={
                      <Space>
                        <Text strong>{inj.faultName}</Text>
                        <Tag color={statusColor[inj.status]}>{statusLabel[inj.status]}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {inj.nodeIds.length} 节点 · {inj.durationSec}s
                        </Text>
                      </Space>
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        节点: {inj.nodeIds.map((nid) => {
                          const s = connectedSessions.find((x) => x.id === nid);
                          return s?.name ?? nid;
                        }).join(', ')}
                      </Text>
                      {inj.injectedAt && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          注入时间: {new Date(inj.injectedAt).toLocaleString('zh-CN')}
                        </Text>
                      )}
                      {inj.recoveredAt && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          恢复时间: {new Date(inj.recoveredAt).toLocaleString('zh-CN')}
                        </Text>
                      )}
                      {inj.log && (
                        <pre
                          style={{
                            fontSize: 11,
                            background: '#f5f5f5',
                            padding: 8,
                            borderRadius: 4,
                            maxHeight: 200,
                            overflow: 'auto',
                          }}
                        >
                          {inj.log}
                        </pre>
                      )}
                      {(inj.status === 'injected' || inj.status === 'fail') && (
                        <Button
                          size="small"
                          onClick={() => handleRecover(inj)}
                          loading={isRecovering}
                        >
                          立即恢复
                        </Button>
                      )}
                    </Space>
                  </Panel>
                );
              })}
            </Collapse>
          )}
        </Card>
      </div>
    </div>
  );
};

export default ChaosInjectionPanel;
