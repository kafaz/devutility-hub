import { SyncOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Table, Tag, Typography } from 'antd';
import React, { useEffect } from 'react';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Title } = Typography;

const MetricsDashboard: React.FC = () => {
  const { tasks, fetchTasks } = useBenchmarkStore();

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const columns = [
    { title: 'Task ID', dataIndex: 'id', key: 'id' },
    { title: 'Type', dataIndex: 'task_type', key: 'type' },
    { title: 'Agent', dataIndex: 'agent_id', key: 'agent_id' },
    { 
      title: 'Status', 
      dataIndex: 'status', 
      key: 'status',
      render: (val: string) => (
        <Tag color={val === 'SUCCESS' ? 'green' : val === 'RUNNING' ? 'blue' : val === 'FAIL' ? 'red' : 'default'}>
          {val}
        </Tag>
      )
    },
    { 
      title: 'Created At', 
      dataIndex: 'created_at', 
      key: 'created_at',
      render: (val: string) => new Date(val).toLocaleString()
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
         <Title level={5} style={{ margin: 0 }}>Recent Tasks & Arbitration Status</Title>
         <Button icon={<SyncOutlined />} onClick={fetchTasks} type="text">刷新</Button>
      </div>

      <Alert 
        type="info" 
        showIcon 
        message="数据一致性校验 (Arbiter) 状态监控机制" 
        description="由于后端采用 LBA Window 的 GlobalSeq 与 CRC 验证，若发现并发写入后脏读或损坏，相应的验证任务状态将直接变更为 FAIL。你可以在下表中实时跟踪并发 IO 集群的状态。" 
      />

      <Card size="small" bodyStyle={{ padding: 0 }}>
        <Table 
          dataSource={tasks} 
          columns={columns} 
          rowKey="id" 
          pagination={{ pageSize: 15 }} 
          size="small"
        />
      </Card>
      
    </div>
  );
};

export default MetricsDashboard;
