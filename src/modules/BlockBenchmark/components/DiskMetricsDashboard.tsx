import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Space, Typography, message } from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useDiskDiscovery } from '../hooks/useDiskDiscovery';
import { useBenchmarkStore } from '../store/benchmarkStore';
import IOMonitorGrid from './IOMonitorGrid';
import IOMonitorDetail from './IOMonitorDetail';

const { Title, Text } = Typography;

export interface IostatMetrics {
  timestamp: string;
  r_await: number;
  w_await: number;
  util: number;
  bw_mbps: number;
}

// Parse a single line of `iostat -xd` output for a given device basename (e.g. "sdb")
// Column order (iostat -xd): Device r/s rkB/s rrqm/s %rrqm r_await rareq-sz w/s wkB/s wrqm/s %wrqm w_await wareq-sz ... %util
export function parseIostatLine(line: string, deviceBase: string): IostatMetrics | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(deviceBase)) return null;
  const parts = trimmed.split(/\s+/);
  // Minimum columns check
  if (parts.length < 22) return null;
  try {
    // iostat -xd extended columns (Linux):
    // 0:Device 1:r/s 2:rkB/s 3:rrqm/s 4:%rrqm 5:r_await 6:rareq-sz
    // 7:w/s  8:wkB/s 9:wrqm/s 10:%wrqm 11:w_await 12:wareq-sz
    // 13:d/s 14:dkB/s 15:drqm/s 16:%drqm 17:d_await 18:dareq-sz
    // 19:f/s 20:f_await 21:aqu-sz 22:%util (may vary by kernel version)
    const r_await = parseFloat(parts[5]) || 0;
    const w_await = parseFloat(parts[11]) || 0;
    const util = parseFloat(parts[parts.length - 1]) || 0; // %util is always last
    const bw_mbps = (parseFloat(parts[2]) + parseFloat(parts[8])) / 1024; // rkB/s + wkB/s → MB/s
    return {
      timestamp: new Date().toLocaleTimeString(),
      r_await,
      w_await,
      util,
      bw_mbps,
    };
  } catch {
    return null;
  }
}

export const DiskMetricsDashboard: React.FC = () => {
  const { discoveredNodes } = useDiskDiscovery();
  const { ioSnapshots, updateIOSnapshot, clearIOSnapshots, tasks } = useBenchmarkStore();
  const { subscribeToSessionLines, sendInputToSession, sessions } = useSSHStore();

  const [selectedDiskKey, setSelectedDiskKey] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const unsubRef = useRef<(() => void)[]>([]);

  // Flat list of all discovered disks across all sessions
  const flatDisks = useMemo(() => {
    return Object.values(discoveredNodes).flatMap((node) =>
      node.disks.map((d) => {
        const session = sessions.find((s) => s.id === node.sessionId);
        return {
          sessionId: node.sessionId,
          sessionName: session?.name || node.sessionId,
          diskName: d.name,
          key: `${node.sessionId}::${d.name}`,
        };
      })
    );
  }, [discoveredNodes, sessions]);

  // Build a map of active IO models from running tasks
  const activeIOModelMap = useMemo(() => {
    const map: Record<string, { model: string; taskId: string }> = {};
    for (const task of tasks) {
      if (task.status === 'running' || task.status === 'RUNNING') {
        // Try to infer disk from task params if available; fallback to agent_id mapping
        // The key format is sessionId::device
        const sessionId = task.agent_id;
        // Best-effort: we mark all disks on that session with the active model
        // A more precise mapping would require device in task payload
        const disksForSession = flatDisks.filter((d) => d.sessionId === sessionId);
        for (const d of disksForSession) {
          map[d.key] = { model: task.task_type, taskId: task.id };
        }
      }
    }
    return map;
  }, [tasks, flatDisks]);

  // Enrich snapshots with session names and active IO models
  const enrichedSnapshots = useMemo(() => {
    return ioSnapshots.map((snap) => {
      const diskInfo = flatDisks.find((d) => d.key === snap.key);
      const active = activeIOModelMap[snap.key];
      return {
        ...snap,
        sessionName: diskInfo?.sessionName || snap.sessionName || snap.sessionId,
        diskName: diskInfo?.diskName || snap.diskName,
        activeIOModel: active?.model,
        activeTaskId: active?.taskId,
      };
    });
  }, [ioSnapshots, flatDisks, activeIOModelMap]);

  // Auto-select first disk if none selected
  useEffect(() => {
    if (flatDisks.length > 0 && !selectedDiskKey) {
      setSelectedDiskKey(flatDisks[0].key);
    }
  }, [flatDisks, selectedDiskKey]);

  // Start monitoring all discovered disks across all sessions
  const startMonitoring = useCallback(() => {
    if (flatDisks.length === 0) {
      message.warning('未发现可用磁盘，请先扫描拓扑。');
      return;
    }

    // Clear previous unsubs
    unsubRef.current.forEach((unsub) => unsub());
    unsubRef.current = [];

    const sessionDiskMap = new Map<string, string[]>();
    for (const d of flatDisks) {
      const list = sessionDiskMap.get(d.sessionId) || [];
      list.push(d.diskName);
      sessionDiskMap.set(d.sessionId, list);
    }

    for (const [sessionId, diskNames] of sessionDiskMap.entries()) {
      const deviceBases = diskNames.map((n) => n.replace('/dev/', ''));
      // Start a single iostat for all devices on this session
      const cmd = `iostat -xd 1 ${deviceBases.join(' ')}\n`;
      sendInputToSession(sessionId, cmd);

      for (const diskName of diskNames) {
        const deviceBase = diskName.replace('/dev/', '');
        const key = `${sessionId}::${diskName}`;

        const unsub = subscribeToSessionLines(sessionId, (line: string) => {
          const parsed = parseIostatLine(line, deviceBase);
          if (!parsed) return;
          updateIOSnapshot(key, parsed);
        });

        unsubRef.current.push(unsub);
      }
    }

    setIsMonitoring(true);
    message.success(`已启动 ${flatDisks.length} 个磁盘的 iostat 监控`);
  }, [flatDisks, subscribeToSessionLines, sendInputToSession, updateIOSnapshot]);

  // Stop all iostat processes
  const stopMonitoring = useCallback(() => {
    const sessionIds = new Set(flatDisks.map((d) => d.sessionId));
    for (const sessionId of sessionIds) {
      sendInputToSession(sessionId, '\x03');
    }

    unsubRef.current.forEach((unsub) => unsub());
    unsubRef.current = [];
    setIsMonitoring(false);
    message.info('已停止所有 iostat 监控。');
  }, [flatDisks, sendInputToSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubRef.current.forEach((unsub) => unsub());
      unsubRef.current = [];
    };
  }, []);

  if (flatDisks.length === 0) {
    return <Empty description="暂无扫描到的数据盘，请先在「矩阵调度」页面扫描拓扑" />;
  }

  const selectedSnapshot = enrichedSnapshots.find((s) => s.key === selectedDiskKey) || null;

  return (
    <Card size="small" bordered={false}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Space direction="vertical" size={2}>
          <Title level={5} style={{ margin: 0 }}>
            集群 IO 实时监控大盘 (iostat 聚合)
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            点击「开始监控」后，系统将向所有节点注入 <code>iostat -xd 1</code>，实时解析所有磁盘的 r/w await 与 %util。
          </Text>
        </Space>
        <Space>
          {!isMonitoring ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={startMonitoring}>
              开始监控
            </Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={stopMonitoring}>
              停止监控
            </Button>
          )}
          {ioSnapshots.length > 0 && (
            <Button onClick={clearIOSnapshots}>清空数据</Button>
          )}
        </Space>
      </div>

      <IOMonitorGrid
        snapshots={enrichedSnapshots}
        selectedKey={selectedDiskKey}
        onSelect={(key) => setSelectedDiskKey(key)}
      />

      <div style={{ marginTop: 16 }}>
        <IOMonitorDetail snapshot={selectedSnapshot} />
      </div>
    </Card>
  );
};

export default DiskMetricsDashboard;
