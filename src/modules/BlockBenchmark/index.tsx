import { AppstoreOutlined, CloudServerOutlined, DashboardOutlined } from '@ant-design/icons';
import { Card, Tabs, Typography } from 'antd';
import React, { useEffect } from 'react';
import { useGlobalStore } from '../../store/globalStore';
import { useBenchmarkStore } from './store/benchmarkStore';

const DeploymentManager = React.lazy(() => import('./components/DeploymentManager'));
const TaskDispatcher = React.lazy(() => import('./components/TaskDispatcher'));
const TopologyMatrix = React.lazy(() => import('./components/TopologyMatrix'));
const MetricsDashboard = React.lazy(() => import('./components/MetricsDashboard'));
const DiskMetricsDashboard = React.lazy(() => import('./components/DiskMetricsDashboard'));
const ArtifactDistributor = React.lazy(() => import('./components/ArtifactDistributor'));

const { Title, Text } = Typography;

const BlockBenchmark: React.FC = () => {
  const isDark = useGlobalStore(s => s.theme === 'dark');
  const { fetchAgents, agents } = useBenchmarkStore();
  
  useEffect(() => {
    fetchAgents();
    const timer = setInterval(() => {
      fetchAgents();
    }, 5000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlineAgentsCount = agents.filter(a => a.status === 'online').length;

  const items = [
    {
      key: 'deploy',
      label: <><CloudServerOutlined /> 部署与管控 ({onlineAgentsCount} 在线)</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DeploymentManager />
        </React.Suspense>
      )
    },
    {
      key: 'topology',
      label: <><AppstoreOutlined /> 多节点磁盘矩阵调度</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TopologyMatrix />
        </React.Suspense>
      )
    },
    {
      key: 'task',
      label: <><AppstoreOutlined /> 自定义参数分发 (Tasks)</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TaskDispatcher />
        </React.Suspense>
      )
    },
    {
      key: 'dash',
      label: <><DashboardOutlined /> 性能指标与仲裁大盘</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <MetricsDashboard />
        </React.Suspense>
      )
    },
    {
      key: 'disk_metrics',
      label: <><DashboardOutlined /> 单挂载点 IO 监控 (iostat)</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DiskMetricsDashboard />
        </React.Suspense>
      )
    },
    {
      key: 'distribution',
      label: <><CloudServerOutlined /> CI/CD 构件极速分发与部署</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ArtifactDistributor />
        </React.Suspense>
      )
    }
  ];

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>分布式块存储测试工作台</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          集成 BlockBenchmark 控制面引擎，支持多节点并发模型、时序数据一致性仲裁与混沌隔离验证
        </Text>
      </div>

      <Card 
        styles={{ body: { padding: '16px 24px', height: '100%', flex: 1, display: 'flex', flexDirection: 'column'} }}
        style={{ background: isDark ? '#1e1e1e' : '#fff', flex: 1, display: 'flex', flexDirection: 'column', border: 'none' }}
      >
        <Tabs items={items} />
      </Card>
    </div>
  );
};

export default BlockBenchmark;
