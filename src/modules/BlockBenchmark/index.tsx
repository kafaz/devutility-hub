import { AppstoreOutlined, CloudServerOutlined, CodeOutlined, DashboardOutlined, FileSearchOutlined, ThunderboltOutlined } from '@ant-design/icons';
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
const ChaosInjectionPanel = React.lazy(() => import('./components/ChaosInjectionPanel'));
const TracingPanel = React.lazy(() => import('./components/TracingPanel'));

const { Title, Text } = Typography;

const BlockBenchmark: React.FC = () => {
  const isDark = useGlobalStore(s => s.theme === 'dark');
  const { fetchAgents, fetchTasks, agents } = useBenchmarkStore();
  
  useEffect(() => {
    void fetchAgents();
    void fetchTasks();
    const timer = setInterval(() => {
      void fetchAgents();
      void fetchTasks();
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchAgents, fetchTasks]);

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
      label: <><AppstoreOutlined /> 业务编排与下发</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TaskDispatcher />
        </React.Suspense>
      )
    },
    {
      key: 'chaos',
      label: <><ThunderboltOutlined /> 故障混沌注入</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <ChaosInjectionPanel />
        </React.Suspense>
      )
    },
    {
      key: 'io_monitor',
      label: <><DashboardOutlined /> IO 实时监控</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <DiskMetricsDashboard />
        </React.Suspense>
      )
    },
    {
      key: 'tracing',
      label: <><FileSearchOutlined /> 任务追踪与日志</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <TracingPanel />
        </React.Suspense>
      )
    },
    {
      key: 'analysis',
      label: <><CodeOutlined /> 一致性检测与仲裁</>,
      children: (
        <React.Suspense fallback={<div>Loading...</div>}>
          <MetricsDashboard />
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
