import {
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Typography,
  message,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { LogPathConfig, TracedTask } from '../types';
import { generateId } from '../../../utils';

const { Text, Title } = Typography;

interface Props {
  task: TracedTask | null;
}

const TracingLogViewer: React.FC<Props> = ({ task }) => {
  const { execCommandOnSession, subscribeToSessionLines, sendInputToSession } = useSSHStore();
  const { appendLogBuffer, updateTracedTask } = useBenchmarkStore();

  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMode, setNewMode] = useState<'snapshot' | 'stream'>('stream');
  const [paused, setPaused] = useState(false);

  const bufferEndRef = useRef<HTMLDivElement | null>(null);
  const streamUnsubsRef = useRef<Record<string, () => void>>({});

  // Auto-scroll to bottom when buffer changes (unless paused)
  useEffect(() => {
    if (!paused && bufferEndRef.current) {
      bufferEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [task?.logPaths, paused]);

  // Cleanup stream subscriptions when task changes or unmounts
  useEffect(() => {
    return () => {
      Object.values(streamUnsubsRef.current).forEach((unsub) => unsub());
      streamUnsubsRef.current = {};
    };
  }, [task?.id]);

  const handleAddLogPath = async () => {
    if (!task) {
      message.warning('请先选择一个任务');
      return;
    }
    if (!newPath.trim()) {
      message.warning('请输入绝对路径');
      return;
    }
    if (!newLabel.trim()) {
      message.warning('请输入标签');
      return;
    }

    const pathId = generateId();
    const logPath: LogPathConfig = {
      id: pathId,
      path: newPath.trim(),
      label: newLabel.trim(),
      mode: newMode,
      buffer: [],
    };

    updateTracedTask(task.id, {
      logPaths: [...task.logPaths, logPath],
    });

    if (newMode === 'snapshot') {
      try {
        const res = await execCommandOnSession(task.nodeId, `tail -n 200 "${newPath.trim()}"`, 15000);
        const lines = res.stdout.split('\n');
        appendLogBuffer(task.id, pathId, lines);
      } catch {
        appendLogBuffer(task.id, pathId, ['[ERROR] 无法读取快照日志']);
      }
    } else {
      // Stream mode: send tail -F via shell PTY
      sendInputToSession(task.nodeId, `tail -n 100 -F "${newPath.trim()}"\n`);
      const unsub = subscribeToSessionLines(task.nodeId, (line: string) => {
        appendLogBuffer(task.id, pathId, [line]);
      });
      streamUnsubsRef.current[pathId] = unsub;
    }

    setNewPath('');
    setNewLabel('');
    setNewMode('stream');
  };

  const handleRemoveLogPath = (pathId: string) => {
    if (!task) return;
    const unsub = streamUnsubsRef.current[pathId];
    if (unsub) {
      unsub();
      delete streamUnsubsRef.current[pathId];
    }
    updateTracedTask(task.id, {
      logPaths: task.logPaths.filter((lp) => lp.id !== pathId),
    });
  };

  const handleClearBuffer = () => {
    if (!task) return;
    updateTracedTask(
      task.id,
      {
        logPaths: task.logPaths.map((lp) => ({ ...lp, buffer: [] })),
      }
    );
  };

  const handleExport = () => {
    if (!task || task.logPaths.length === 0) return;
    const payload = task.logPaths.map((lp) => ({
      label: lp.label,
      path: lp.path,
      mode: lp.mode,
      lines: lp.buffer ?? [],
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trace-${task.name}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allLines = task?.logPaths.flatMap((lp) =>
    (lp.buffer ?? []).map((line) => ({ label: lp.label, line }))
  ) ?? [];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Title level={5} style={{ margin: 0 }}>
        日志追踪
      </Title>

      {task && (
        <>
          <Space wrap>
            <Input
              placeholder="绝对路径"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              style={{ width: 240 }}
            />
            <Input
              placeholder="标签"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ width: 140 }}
            />
            <Select
              value={newMode}
              onChange={(v) => setNewMode(v)}
              options={[
                { label: '快照', value: 'snapshot' },
                { label: '实时流', value: 'stream' },
              ]}
              style={{ width: 100 }}
            />
            <Button type="primary" onClick={handleAddLogPath}>
              添加日志路径
            </Button>
          </Space>

          <Space wrap>
            <Button onClick={() => setPaused((p) => !p)}>
              {paused ? '恢复自动滚动' : '暂停自动滚动'}
            </Button>
            <Button onClick={handleClearBuffer}>清空缓冲区</Button>
            <Button onClick={handleExport} disabled={allLines.length === 0}>
              导出日志
            </Button>
          </Space>

          {task.logPaths.length === 0 && (
            <Empty description="尚未添加日志路径" />
          )}

          {task.logPaths.map((lp) => (
            <Card
              key={lp.id}
              size="small"
              title={
                <Space>
                  <Text strong>{lp.label}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {lp.path} ({lp.mode === 'snapshot' ? '快照' : '实时流'})
                  </Text>
                </Space>
              }
              extra={
                <Button size="small" danger onClick={() => handleRemoveLogPath(lp.id)}>
                  移除
                </Button>
              }
            >
              <div
                style={{
                  maxHeight: 320,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  background: '#f6f8fa',
                  padding: 8,
                  borderRadius: 4,
                }}
              >
                {(lp.buffer ?? []).length === 0 ? (
                  <Text type="secondary">暂无日志数据</Text>
                ) : (
                  (lp.buffer ?? []).map((line, idx) => (
                    <div key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {line}
                    </div>
                  ))
                )}
                <div ref={bufferEndRef} />
              </div>
            </Card>
          ))}
        </>
      )}

      {!task && <Empty description="请从左侧选择一个任务" />}
    </Space>
  );
};

export default TracingLogViewer;
