import { Card, Empty, Space, Tag, Typography } from 'antd';
import React, { useEffect } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { TracedTask } from '../types';

const { Text } = Typography;

interface Props {
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}

const statusColorMap: Record<TracedTask['status'], string> = {
  running: 'processing',
  completed: 'success',
  failed: 'error',
  unknown: 'default',
};

const statusLabelMap: Record<TracedTask['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  unknown: '未知',
};

const TracingTaskList: React.FC<Props> = ({ selectedTaskId, onSelect }) => {
  const { execCommandOnSession } = useSSHStore();
  const { tracedTasks, updateTracedTask } = useBenchmarkStore();

  useEffect(() => {
    const interval = setInterval(() => {
      const runningTasks = tracedTasks.filter(
        (t): t is TracedTask & { pid: string } =>
          t.status === 'running' && typeof t.pid === 'string' && t.pid.length > 0
      );

      for (const task of runningTasks) {
        execCommandOnSession(task.nodeId, `ps -p ${task.pid} > /dev/null; echo $?`, 10000)
          .then((res) => {
            const exitCode = parseInt(res.stdout.trim(), 10);
            if (exitCode !== 0) {
              updateTracedTask(task.id, { status: 'completed', lastStatusCheckAt: Date.now() });
            } else {
              updateTracedTask(task.id, { lastStatusCheckAt: Date.now() });
            }
          })
          .catch(() => {
            updateTracedTask(task.id, { status: 'unknown', lastStatusCheckAt: Date.now() });
          });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [tracedTasks, execCommandOnSession, updateTracedTask]);

  if (tracedTasks.length === 0) {
    return <Empty description="暂无追踪任务" />;
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {tracedTasks.map((task) => (
        <Card
          key={task.id}
          size="small"
          style={{
            cursor: 'pointer',
            borderColor: selectedTaskId === task.id ? '#1890ff' : undefined,
          }}
          onClick={() => onSelect(task.id)}
        >
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Space>
              <Text strong>{task.name}</Text>
              <Tag color={statusColorMap[task.status]}>{statusLabelMap[task.status]}</Tag>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              节点: {task.nodeName} | PID: {task.pid ?? '-'} | 来源: {task.source.type}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              启动: {new Date(task.startedAt).toLocaleString('zh-CN')}
            </Text>
          </Space>
        </Card>
      ))}
    </Space>
  );
};

export default TracingTaskList;
