import { Button, Form, Input, message, Space, Table, Tag, Typography } from 'antd';
import React, { useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Text } = Typography;

type AgentStatusLabel = 'online' | 'offline' | 'unmapped';

function quoteShellArg(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

const DeploymentManager: React.FC = () => {
  const { sessions, execCommandOnSession } = useSSHStore();
  const { agents, agentMappings } = useBenchmarkStore();
  
  const [controllerIp, setControllerIp] = useState('127.0.0.1:9090');
  const [agentPath, setAgentPath] = useState('/usr/local/bin/agent.bin');

  const handleStartAgent = async (sessionId: string, nodeName: string, agentId: string) => {
    try {
      const cmd = `nohup ${quoteShellArg(agentPath)} --id ${quoteShellArg(agentId)} --controller ${quoteShellArg(controllerIp)} > /tmp/agent.log 2>&1 &`;
      await execCommandOnSession(sessionId, cmd);
      message.success(`Start command sent to ${nodeName} (${agentId})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`Failed to start agent on ${nodeName}: ${msg}`);
    }
  };

  const tableData = sessions.map(sess => {
    const mapping = agentMappings.find((item) => item.sshSessionId === sess.id);
    const agentId = mapping?.bbAgentId ?? sess.name;
    const agent = agents.find((item) => item.id === agentId);
    const agentStatus: AgentStatusLabel = mapping ? (agent?.status ?? 'offline') : 'unmapped';
    return {
      key: sess.id,
      sessionId: sess.id,
      name: sess.name,
      agentId,
      status: sess.status, // SSH status
      agentStatus,
      agentIp: agent?.ip || '-',
    };
  });

  interface TableRow {
    key: string;
    sessionId: string;
    name: string;
    agentId: string;
    status: string;
    agentStatus: AgentStatusLabel;
    agentIp: string;
  }

  const columns = [
    { title: '节点名称', dataIndex: 'name', key: 'name' },
    { title: 'Agent ID', dataIndex: 'agentId', key: 'agentId' },
    {
      title: 'SSH 连接状态',
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => (
        <Tag color={val === 'connected' ? 'green' : 'red'}>{val}</Tag>
      )
    },
    {
      title: 'Agent 注册状态',
      dataIndex: 'agentStatus',
      key: 'agentStatus',
      render: (val: AgentStatusLabel) => (
        <Tag
          color={val === 'online' ? 'blue' : val === 'offline' ? 'default' : 'warning'}
          style={{ fontWeight: 'bold' }}
        >
          {val === 'unmapped' ? '未绑定' : val.toUpperCase()}
        </Tag>
      )
    },
    { title: 'Agent 上报 IP', dataIndex: 'agentIp', key: 'agentIp' },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: TableRow) => (
        <Space>
          <Button
            size="small"
            type="primary"
            disabled={record.status !== 'connected'}
            onClick={() => handleStartAgent(record.sessionId, record.name, record.agentId)}
          >
            启动 Agent
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Form layout="inline" style={{ marginBottom: 8 }}>
        <Form.Item label="Controller 目标地址 (Agent上报用)">
          <Input 
            value={controllerIp} 
            onChange={e => setControllerIp(e.target.value)} 
            placeholder="e.g. 192.168.1.100:9090"
            style={{ width: 220 }}
          />
        </Form.Item>
        <Form.Item label="Agent 二进制文件绝对路径">
          <Input 
            value={agentPath} 
            onChange={e => setAgentPath(e.target.value)} 
            placeholder="/usr/local/bin/agent.bin"
            style={{ width: 300 }}
          />
        </Form.Item>
      </Form>

      <Table 
        size="small"
        dataSource={tableData}
        columns={columns}
        pagination={false}
      />
      
      <div style={{ marginTop: 12 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          提示：启动 Agent 依赖 SSH 会话中能够访问到指定的 二进制路经。请提前将 `agent.bin` 上传至目标服务器，或者挂载共享存储。
        </Text>
      </div>
    </div>
  );
};

export default DeploymentManager;
