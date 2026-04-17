import { Card } from 'antd';
import React, { useState } from 'react';
import TracingTaskList from './TracingTaskList';
import TracingLogViewer from './TracingLogViewer';
import { useBenchmarkStore } from '../store/benchmarkStore';

const TracingPanel: React.FC = () => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const task = useBenchmarkStore((s) => s.tracedTasks.find((t) => t.id === selectedTaskId) ?? null);

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <Card size="small" title="任务列表" style={{ flex: '0 0 280px' }}>
        <TracingTaskList selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} />
      </Card>
      <div style={{ flex: 1 }}>
        <TracingLogViewer task={task} />
      </div>
    </div>
  );
};

export default TracingPanel;
