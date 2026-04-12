import { EditOutlined, PlayCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import React, { useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useDiskDiscovery } from '../hooks/useDiskDiscovery';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Title, Text } = Typography;

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const TopologyMatrix: React.FC = () => {
  const { savedModels, startTask, agentMappings, addAgentMapping, getBBAgentId } = useBenchmarkStore();
  const { sessions } = useSSHStore();
  const { discoveredNodes, isScanning, scanAllNodes } = useDiskDiscovery();

  const [matrixConfig, setMatrixConfig] = useState<Record<string, string>>({});
  const [isDispatching, setIsDispatching] = useState(false);

  // FIX-2: Agent mapping modal state
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string>('');
  const [editingBBId, setEditingBBId] = useState<string>('');

  const handleSaveMapping = () => {
    if (!editingBBId.trim()) {
      message.warning('请输入 Block Benchmark Agent ID（如 node-a）');
      return;
    }
    const sess = sessions.find(s => s.id === editingSessionId);
    addAgentMapping({
      sshSessionId: editingSessionId,
      bbAgentId: editingBBId.trim(),
      label: sess?.name || editingSessionId,
    });
    message.success(`节点映射已保存: ${sess?.name} → ${editingBBId.trim()}`);
    setMappingModalOpen(false);
  };

  const flatDisks = Object.values(discoveredNodes).flatMap(node =>
    node.disks.map(d => ({
      sessionId: node.sessionId,
      // FIX-5: use sessionName, not sessionId
      sessionName: sessions.find(s => s.id === node.sessionId)?.name || node.sessionId,
      bbAgentId: getBBAgentId(node.sessionId),
      diskName: d.name,
      size: d.size,
      model: d.model || '—',
      key: `${node.sessionId}::${d.name}`,
    }))
  );

  const handleStartMatrix = async () => {
    const selectedKeys = Object.entries(matrixConfig).filter(([_, modelId]) => !!modelId);
    if (selectedKeys.length === 0) {
      message.warning('请至少为一块盘指定测试模型！');
      return;
    }

    // FIX-2: Warn if any disk has unmapped agent
    const unmapped = selectedKeys.filter(([key]) => {
      const sessionId = key.split('::')[0];
      return !agentMappings.find(m => m.sshSessionId === sessionId);
    });
    if (unmapped.length > 0) {
      message.error('存在未配置 Block Benchmark Agent ID 的节点，请先点击"配置 Agent ID 映射"按钮完成绑定！');
      return;
    }

    setIsDispatching(true);
    let successCount = 0;

    try {
      const promises = selectedKeys.map(async ([key, modelId]) => {
        const [sessionId, diskName] = key.split('::');
        const model = savedModels.find(m => m.id === modelId);
        if (!model) return;

        // FIX-2: Use the mapped BB agent ID
        const bbAgentId = getBBAgentId(sessionId);
        // FIX-6: volume_id uses disk name to scope LBA arbitration correctly
        const volumeId = `vol-${diskName.replace('/dev/', '').replace('/', '_')}`;

        const payload: any = {
          agent_id: bbAgentId,
          task_type: 'WRITE_TEST',
          business_name: `${model.name}-${diskName.replace('/dev/', '')}`,
          dispatch_count: 1,
          params: {
            device: diskName,
            volume_id: volumeId,
            lba: '0',
            block_size: model.block_size || '4096',
            io_model: model.io_model,
            concurrency: model.concurrency || '8',
            iterations: model.iterations || '1',
            read_verify: 'true',
          },
        };

        if (model.io_model === 'fio') {
          payload.params.fio_engine = model.fio_engine;
          payload.params.workload_profile = model.workload_profile;
          payload.params.iodepth = model.iodepth;
        }

        await startTask(payload);
        successCount++;
      });

      await Promise.allSettled(promises);
      message.success(`矩阵派发完成，已成功拉起 ${successCount} 个独立压测流！`);
    } finally {
      setIsDispatching(false);
    }
  };

  const connectedSessions = sessions.filter(s => s.status === 'connected');

  const columns = [
    {
      title: '节点',
      dataIndex: 'sessionName',
      key: 'sessionName',
      render: (val: string, r: any) => {
        const mapped = agentMappings.find(m => m.sshSessionId === r.sessionId);
        return (
          <Space direction="vertical" size={0}>
            <Tag color="blue">{val}</Tag>
            {mapped
              ? <Text type="secondary" style={{ fontSize: 11 }}>BB Agent: <b>{mapped.bbAgentId}</b></Text>
              : <Tag color="warning" style={{ fontSize: 11 }}>⚠ 未绑定 Agent ID</Tag>}
          </Space>
        );
      },
    },
    {
      title: '目标裸盘',
      dataIndex: 'diskName',
      key: 'diskName',
      render: (val: string, r: any) => (
        <Space>
          <Text strong>{val}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>({r.model})</Text>
        </Space>
      ),
    },
    { title: '容量', dataIndex: 'size', key: 'size', render: (v: number) => formatBytes(v) },
    {
      title: '指派 IO 模型',
      key: 'config',
      render: (_: any, r: any) => {
        const currentId = matrixConfig[r.key];
        return (
          <Select
            allowClear
            placeholder="不压测 (Skip)"
            value={currentId}
            style={{ width: 220 }}
            onChange={val => setMatrixConfig(prev => ({ ...prev, [r.key]: val }))}
            options={savedModels.map(m => ({ label: m.name, value: m.id }))}
          />
        );
      },
    },
  ];

  return (
    <Card size="small" bordered={false}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space direction="vertical" size={2}>
          <Title level={5} style={{ margin: 0 }}>多节点 / 多盘符 压测矩阵</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>全自动过滤系统盘。每块裸盘独立指定 IO 模型，矩阵一键并发压满。</Text>
        </Space>
        <Space>
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              setEditingSessionId(connectedSessions[0]?.id || '');
              setMappingModalOpen(true);
            }}
          >
            配置 Agent ID 映射
          </Button>
          <Button icon={<SyncOutlined spin={isScanning} />} onClick={scanAllNodes} loading={isScanning}>
            重新扫描拓扑
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStartMatrix} loading={isDispatching}>
            启动矩阵任务
          </Button>
        </Space>
      </div>

      <Table size="small" dataSource={flatDisks} columns={columns} pagination={false} />

      {/* FIX-2: Agent ID mapping modal */}
      <Modal
        title="绑定 SSH 会话 → Block Benchmark Agent ID"
        open={mappingModalOpen}
        onOk={handleSaveMapping}
        onCancel={() => setMappingModalOpen(false)}
        okText="保存绑定"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>选择 SSH 会话节点：</Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              value={editingSessionId}
              onChange={setEditingSessionId}
              options={connectedSessions.map(s => ({
                label: s.name,
                value: s.id,
              }))}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              对应的 Block Benchmark Agent ID（启动 agent 时传入的 <code>--id</code> 参数）：
            </Text>
            <Input
              style={{ marginTop: 4 }}
              placeholder="例如: node-a 或 storage-node-01"
              value={editingBBId}
              onChange={e => setEditingBBId(e.target.value)}
            />
          </div>
          {agentMappings.length > 0 && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>当前已有映射：</Text>
              {agentMappings.map(m => (
                <Tag key={m.sshSessionId} color="green" style={{ marginTop: 4 }}>{m.label} → {m.bbAgentId}</Tag>
              ))}
            </div>
          )}
        </Space>
      </Modal>
    </Card>
  );
};

export default TopologyMatrix;
