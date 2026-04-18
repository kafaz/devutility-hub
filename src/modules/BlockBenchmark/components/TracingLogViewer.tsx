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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { LogPathConfig, TracedTask } from '../types';
import { generateId } from '../../../utils';

const { Text, Title } = Typography;
const LOG_POLL_INTERVAL_MS = 2000;
const LOG_TAIL_LINE_COUNT = 200;

function quoteShellArg(value: string): string {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function splitLogLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r/g, '').split('\n').slice(-500);
}

interface Props {
  task: TracedTask | null;
}

const TracingLogViewer: React.FC<Props> = ({ task }) => {
  const { execCommandOnSession } = useSSHStore();
  const { replaceLogBuffer, updateTracedTask } = useBenchmarkStore();

  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMode, setNewMode] = useState<'snapshot' | 'stream'>('stream');
  const [paused, setPaused] = useState(false);

  const bufferEndRef = useRef<HTMLDivElement | null>(null);
  const pollTimersRef = useRef<Record<string, ReturnType<typeof window.setInterval>>>({});
  const pollInFlightRef = useRef<Record<string, boolean>>({});

  // Auto-scroll to bottom when buffer changes (unless paused)
  useEffect(() => {
    if (!paused && bufferEndRef.current) {
      bufferEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [task?.logPaths, paused]);

  const stopPolling = useCallback((pathId: string) => {
    const timer = pollTimersRef.current[pathId];
    if (timer !== undefined) {
      window.clearInterval(timer);
      delete pollTimersRef.current[pathId];
    }
    delete pollInFlightRef.current[pathId];
  }, []);

  const stopAllPolling = useCallback(() => {
    Object.keys(pollTimersRef.current).forEach((pathId) => stopPolling(pathId));
  }, [stopPolling]);

  const refreshLogPath = useCallback(async (taskId: string, pathId: string, nodeId: string, path: string) => {
    if (pollInFlightRef.current[pathId]) return;
    pollInFlightRef.current[pathId] = true;
    try {
      const res = await execCommandOnSession(
        nodeId,
        `tail -n ${LOG_TAIL_LINE_COUNT} -- ${quoteShellArg(path)}`,
        15000,
        { journal: false }
      );

      if (res.exitCode !== 0) {
        replaceLogBuffer(taskId, pathId, [`[ERROR] ${res.stderr || `无法读取日志，exit=${res.exitCode}`}`]);
        return;
      }

      replaceLogBuffer(taskId, pathId, splitLogLines(res.stdout));
    } finally {
      pollInFlightRef.current[pathId] = false;
    }
  }, [execCommandOnSession, replaceLogBuffer]);

  const startPolling = useCallback((taskId: string, pathId: string, nodeId: string, path: string) => {
    if (pollTimersRef.current[pathId] !== undefined) return;

    void refreshLogPath(taskId, pathId, nodeId, path);
    pollTimersRef.current[pathId] = window.setInterval(() => {
      void refreshLogPath(taskId, pathId, nodeId, path);
    }, LOG_POLL_INTERVAL_MS);
  }, [refreshLogPath]);

  useEffect(() => {
    if (!task) return undefined;

    task.logPaths
      .filter((lp) => lp.mode === 'stream')
      .forEach((lp) => startPolling(task.id, lp.id, task.nodeId, lp.path));

    return () => {
      stopAllPolling();
    };
  }, [task?.id, startPolling, stopAllPolling]);

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
      await refreshLogPath(task.id, pathId, task.nodeId, newPath.trim());
    } else {
      startPolling(task.id, pathId, task.nodeId, newPath.trim());
    }

    setNewPath('');
    setNewLabel('');
    setNewMode('stream');
  };

  const handleRemoveLogPath = (pathId: string) => {
    if (!task) return;
    stopPolling(pathId);
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
