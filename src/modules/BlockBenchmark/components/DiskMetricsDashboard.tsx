import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { Badge, Button, Card, Col, Empty, Row, Select, Space, Typography, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import { useDiskDiscovery } from '../hooks/useDiskDiscovery';
import { useBenchmarkStore } from '../store/benchmarkStore';

const { Title, Text } = Typography;

interface IostatMetrics {
  timestamp: string;
  r_await: number;
  w_await: number;
  util: number;
  bw_mbps: number;
}

// Parse a single line of `iostat -xd` output for a given device basename (e.g. "sdb")
// Column order (iostat -xd): Device r/s rkB/s rrqm/s %rrqm r_await rareq-sz w/s wkB/s wrqm/s %wrqm w_await wareq-sz ... %util
function parseIostatLine(line: string, deviceBase: string): IostatMetrics | null {
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
  const { tasks } = useBenchmarkStore();
  const { subscribeToSessionLines, sendInputToSession, sessions } = useSSHStore();

  const [selectedDiskKey, setSelectedDiskKey] = useState<string>('');
  const [history, setHistory] = useState<Record<string, IostatMetrics[]>>({});
  const [isMonitoring, setIsMonitoring] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // FIX-1: Now reads from shared store — same data as TopologyMatrix
  const flatDisks = useMemo(() => {
    return Object.values(discoveredNodes).flatMap(node =>
      node.disks.map(d => ({
        sessionId: node.sessionId,
        // FIX-5: sessionName instead of UUID
        sessionName: sessions.find(s => s.id === node.sessionId)?.name || node.sessionId,
        diskName: d.name,
        key: `${node.sessionId}::${d.name}`,
      }))
    );
  }, [discoveredNodes, sessions]);

  useEffect(() => {
    if (flatDisks.length > 0 && !selectedDiskKey) {
      setSelectedDiskKey(flatDisks[0].key);
    }
  }, [flatDisks, selectedDiskKey]);

  // FIX-3: Start/stop real iostat monitoring over SSH
  const startMonitoring = useCallback(() => {
    if (!selectedDiskKey) return;
    const [sessionId, diskName] = selectedDiskKey.split('::');
    const deviceBase = diskName.replace('/dev/', '');

    // Inject the iostat command into the live terminal session
    // The output will stream back through the WebSocket and get intercepted by subscribeToSessionLines
    sendInputToSession(sessionId, `iostat -xd 1 ${deviceBase}\n`);
    setIsMonitoring(true);

    // Subscribe to line stream and parse each line
    const unsub = subscribeToSessionLines(sessionId, (line: string) => {
      const parsed = parseIostatLine(line, deviceBase);
      if (!parsed) return;
      setHistory(prev => {
        const cur = prev[selectedDiskKey] || [];
        const next = [...cur, parsed];
        if (next.length > 120) next.shift(); // keep 2 min of history
        return { ...prev, [selectedDiskKey]: next };
      });
    });

    unsubRef.current = unsub;
  }, [selectedDiskKey, subscribeToSessionLines, sendInputToSession]);

  const stopMonitoring = useCallback(() => {
    if (!selectedDiskKey) return;
    const [sessionId] = selectedDiskKey.split('::');
    // Send Ctrl+C to kill iostat on the remote
    sendInputToSession(sessionId, '\x03');
    unsubRef.current?.();
    unsubRef.current = null;
    setIsMonitoring(false);
    message.info('已停止 iostat 监控。');
  }, [selectedDiskKey, sendInputToSession]);

  // Cleanup on disk change
  useEffect(() => {
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
      setIsMonitoring(false);
    };
  }, [selectedDiskKey]);

  if (flatDisks.length === 0) {
    return <Empty description="暂无扫描到的数据盘，请先在「矩阵调度」页面扫描拓扑" />;
  }

  const currentHistory = history[selectedDiskKey] || [];
  const xAxisData = currentHistory.map(h => h.timestamp);

  const [sessionId] = selectedDiskKey.split('::');
  const relatedTask = tasks.find(t => t.agent_id === sessionId);
  const isDataInconsistent = relatedTask?.status === 'FAIL';

  const optionUtil = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['%Util (跑满)', 'R_Await (读延迟 ms)', 'W_Await (写延迟 ms)'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: xAxisData },
    yAxis: [
      { type: 'value', name: '%', position: 'left', max: 100 },
      { type: 'value', name: 'ms', position: 'right', splitLine: { show: false } },
    ],
    series: [
      {
        name: '%Util (跑满)',
        type: 'line',
        itemStyle: { color: '#ef4444' },
        areaStyle: { color: 'rgba(239, 68, 68, 0.2)' },
        data: currentHistory.map(h => h.util.toFixed(1)),
        smooth: true,
      },
      {
        name: 'R_Await (读延迟 ms)',
        type: 'line',
        yAxisIndex: 1,
        itemStyle: { color: '#f97316' },
        data: currentHistory.map(h => h.r_await.toFixed(2)),
        smooth: true,
      },
      {
        name: 'W_Await (写延迟 ms)',
        type: 'line',
        yAxisIndex: 1,
        itemStyle: { color: '#eab308' },
        data: currentHistory.map(h => h.w_await.toFixed(2)),
        smooth: true,
      },
    ],
  };

  const optionBw = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Bandwidth (MB/s)'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: xAxisData },
    yAxis: { type: 'value', name: 'MB/s' },
    series: [
      {
        name: 'Bandwidth (MB/s)',
        type: 'line',
        itemStyle: { color: '#3b82f6' },
        areaStyle: { color: 'rgba(59, 130, 246, 0.2)' },
        data: currentHistory.map(h => h.bw_mbps.toFixed(2)),
        smooth: true,
      },
    ],
  };

  return (
    <Card size="small" bordered={false}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space direction="vertical" size={2}>
          <Title level={5} style={{ margin: 0 }}>单盘精准 IO 可观测大盘 (iostat 实时解析)</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            点击「开始监控」后，系统将向目标节点注入 <code>iostat -xd 1 {'{device}'}</code>，实时解析 r/w await 与 %util。
          </Text>
        </Space>
        <Space>
          {isDataInconsistent && (
            <Badge status="error" text={<Text type="danger" strong>触发脏读！(数据不一致)</Text>} />
          )}
          {/* FIX-5: Label shows sessionName */}
          <Select
            value={selectedDiskKey}
            onChange={val => { setSelectedDiskKey(val); stopMonitoring(); }}
            style={{ width: 260 }}
            options={flatDisks.map(d => ({ label: `${d.sessionName} — ${d.diskName}`, value: d.key }))}
          />
          {!isMonitoring ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={startMonitoring}>
              开始监控
            </Button>
          ) : (
            <Button danger icon={<StopOutlined />} onClick={stopMonitoring}>
              停止监控
            </Button>
          )}
        </Space>
      </div>

      {currentHistory.length === 0 ? (
        <Empty
          description={isMonitoring ? '等待 iostat 数据流...' : '点击「开始监控」以启动 iostat 数据流'}
          style={{ margin: '40px 0' }}
        />
      ) : (
        <Row gutter={16}>
          <Col span={12}>
            <Card size="small" title="IO 卡顿与跑满检测 (%util & r/w await)">
              <ReactECharts option={optionUtil} notMerge={true} lazyUpdate={true} style={{ height: 280 }} />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" title="磁盘聚合吞吐量 (Bandwidth MB/s)">
              <ReactECharts option={optionBw} notMerge={true} lazyUpdate={true} style={{ height: 280 }} />
            </Card>
          </Col>
        </Row>
      )}
    </Card>
  );
};

export default DiskMetricsDashboard;
