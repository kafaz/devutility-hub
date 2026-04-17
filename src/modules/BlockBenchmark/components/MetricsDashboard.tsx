import { PlusOutlined } from '@ant-design/icons';
import { Button, Divider, Typography } from 'antd';
import React, { useState } from 'react';
import { useBenchmarkStore } from '../store/benchmarkStore';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import type { ConsistencyCheck, ConsistencyResult, InconsistencyItem } from '../types';
import AnalysisCheckList from './AnalysisCheckList';
import AnalysisReportPanel from './AnalysisReportPanel';
import AnalysisCheckModal from './AnalysisCheckModal';
import { generateId } from '../../../utils';

const { Title } = Typography;

const BUILTIN_IDS = new Set(['crc_check', 'lba_cmp', 'meta_cmp']);

function resolveCmd(template: string, params: Record<string, string>): string {
  let cmd = template;
  Object.entries(params).forEach(([key, value]) => {
    cmd = cmd.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
  });
  return cmd;
}

function getFirstWord(stdout: string): string {
  return stdout.trim().split(/\s+/)[0] ?? '';
}

function tryParseJSON(stdout: string): unknown | null {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const MetricsDashboard: React.FC = () => {
  const {
    consistencyChecks,
    addConsistencyCheck,
    updateConsistencyCheck,
    removeConsistencyCheck,
  } = useBenchmarkStore();

  const { execCommandOnSession, sessions } = useSSHStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCheck, setEditingCheck] = useState<ConsistencyCheck | undefined>(undefined);

  const selectedCheck = consistencyChecks.find((c) => c.id === selectedId) ?? null;

  const handleRunCheck = async (check: ConsistencyCheck) => {
    const targetNodeIds = check.nodeIds.length > 0 ? check.nodeIds : sessions.map((s) => s.id);
    if (targetNodeIds.length === 0) {
      updateConsistencyCheck(check.id, {
        status: 'error',
        result: {
          summary: '没有可用的目标节点',
          inconsistencies: [],
          rawOutputs: {},
        },
        completedAt: Date.now(),
      });
      return;
    }

    updateConsistencyCheck(check.id, {
      status: 'running',
      triggeredAt: Date.now(),
      triggeredBy: 'manual',
      result: undefined,
      completedAt: undefined,
    });

    const cmd = resolveCmd(check.cmdTemplate, check.params);
    const rawOutputs: ConsistencyResult['rawOutputs'] = {};
    const nodeOutputs: Record<string, string> = {};
    let anyError = false;

    await Promise.all(
      targetNodeIds.map(async (nodeId) => {
        try {
          const res = await execCommandOnSession(nodeId, cmd, 30000);
          rawOutputs[nodeId] = {
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exitCode,
          };
          if (res.exitCode !== 0) {
            anyError = true;
          }
          nodeOutputs[nodeId] = res.stdout;
        } catch {
          rawOutputs[nodeId] = { stdout: '', stderr: '执行异常', exitCode: -1 };
          anyError = true;
        }
      })
    );

    if (anyError) {
      const inconsistencies: InconsistencyItem[] = [];
      Object.entries(rawOutputs).forEach(([nodeId, output]) => {
        if (output.exitCode !== 0) {
          inconsistencies.push({
            type: 'custom',
            description: `节点 ${nodeId} 命令执行失败`,
            nodeIds: [nodeId],
            expected: 'exit 0',
            actual: { [nodeId]: `exit ${output.exitCode}` },
          });
        }
      });
      updateConsistencyCheck(check.id, {
        status: 'error',
        result: {
          summary: `执行出错，${inconsistencies.length} 个节点失败`,
          inconsistencies,
          rawOutputs,
        },
        completedAt: Date.now(),
      });
      return;
    }

    const inconsistencies: InconsistencyItem[] = [];
    let status: ConsistencyCheck['status'] = 'pass';

    if (check.checkType === 'crc' || check.checkType === 'lba_range') {
      const values = Object.entries(nodeOutputs).map(([nodeId, stdout]) => ({
        nodeId,
        hash: getFirstWord(stdout),
      }));
      const first = values[0];
      const mismatches = values.filter((v) => v.hash !== first?.hash);
      if (mismatches.length > 0) {
        status = 'fail';
        inconsistencies.push({
          type: check.checkType === 'crc' ? 'crc_mismatch' : 'lba_diverge',
          description: `${check.checkType === 'crc' ? 'CRC' : 'LBA 范围'} 哈希值不一致`,
          nodeIds: values.map((v) => v.nodeId),
          expected: first?.hash,
          actual: Object.fromEntries(values.map((v) => [v.nodeId, v.hash])),
        });
      }
    } else if (check.checkType === 'metadata') {
      const parsedEntries = Object.entries(nodeOutputs).map(([nodeId, stdout]) => ({
        nodeId,
        data: tryParseJSON(stdout),
      }));
      const first = parsedEntries[0];
      const mismatches = parsedEntries.filter(
        (v) => !deepEqual(v.data, first?.data)
      );
      if (mismatches.length > 0) {
        status = 'fail';
        inconsistencies.push({
          type: 'metadata_diff',
          description: '元数据 JSON 不一致',
          nodeIds: parsedEntries.map((v) => v.nodeId),
          expected: first?.data ? JSON.stringify(first.data) : undefined,
          actual: Object.fromEntries(
            parsedEntries.map((v) => [v.nodeId, v.data ? JSON.stringify(v.data) : ''])
          ),
        });
      }
    } else {
      const first = Object.entries(nodeOutputs)[0];
      const mismatches = Object.entries(nodeOutputs).filter(
        ([, stdout]) => stdout !== first?.[1]
      );
      if (mismatches.length > 0) {
        status = 'fail';
        inconsistencies.push({
          type: 'custom',
          description: '自定义命令输出不一致',
          nodeIds: Object.keys(nodeOutputs),
          expected: first?.[1],
          actual: nodeOutputs,
        });
      }
    }

    updateConsistencyCheck(check.id, {
      status,
      result: {
        summary:
          status === 'pass'
            ? `全部 ${targetNodeIds.length} 个节点一致`
            : `发现 ${inconsistencies.length} 处不一致`,
        inconsistencies,
        rawOutputs,
      },
      completedAt: Date.now(),
    });
  };

  const handleDelete = (id: string) => {
    if (BUILTIN_IDS.has(id)) return;
    removeConsistencyCheck(id);
    if (selectedId === id) setSelectedId(null);
  };

  const handleEdit = (check: ConsistencyCheck) => {
    setEditingCheck(check);
    setModalOpen(true);
  };

  const handleNew = () => {
    setEditingCheck(undefined);
    setModalOpen(true);
  };

  const handleModalOk = (values: Omit<ConsistencyCheck, 'id' | 'triggeredAt'>) => {
    if (editingCheck) {
      updateConsistencyCheck(editingCheck.id, {
        ...values,
        status: 'pending',
        result: undefined,
        triggeredAt: 0,
        completedAt: undefined,
      });
    } else {
      addConsistencyCheck({
        ...values,
        id: generateId(),
        triggeredAt: 0,
      });
    }
    setModalOpen(false);
    setEditingCheck(undefined);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={5} style={{ margin: 0 }}>一致性分析</Title>
        <Button icon={<PlusOutlined />} type="primary" onClick={handleNew}>
          新建检测规则
        </Button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', border: '1px solid #f0f0f0', borderRadius: 8 }}>
        <div style={{ width: 320, borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
          <AnalysisCheckList
            checks={consistencyChecks}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRun={handleRunCheck}
            onDelete={handleDelete}
            onEdit={handleEdit}
          />
        </div>
        <Divider type="vertical" style={{ height: '100%', margin: 0 }} />
        <div style={{ flex: 1, overflow: 'auto' }}>
          <AnalysisReportPanel check={selectedCheck} />
        </div>
      </div>

      <AnalysisCheckModal
        open={modalOpen}
        initial={editingCheck}
        onOk={handleModalOk}
        onCancel={() => {
          setModalOpen(false);
          setEditingCheck(undefined);
        }}
      />
    </div>
  );
};

export default MetricsDashboard;
