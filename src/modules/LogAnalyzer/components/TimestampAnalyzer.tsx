import {
    BarChartOutlined,
    BgColorsOutlined,
    ClearOutlined,
    ClockCircleOutlined,
    CloudServerOutlined,
    DownloadOutlined,
    EyeOutlined,
    FieldTimeOutlined,
    FileTextOutlined,
    LineChartOutlined,
    PlayCircleOutlined,
    StepBackwardOutlined,
    StepForwardOutlined,
    ThunderboltOutlined,
} from '@ant-design/icons';
import type { TableProps } from 'antd';
import {
    Alert,
    Badge,
    Button,
    Card,
    Col,
    Collapse,
    Divider,
    Empty,
    Input,
    Radio,
    Row,
    Slider,
    Space,
    Spin,
    Statistic,
    Switch,
    Table,
    Tabs,
    Tag,
    Tooltip,
    Typography,
} from 'antd';
import * as echarts from 'echarts';
import ReactECharts from 'echarts-for-react';
import React, { useMemo, useRef, useState } from 'react';
import { useGlobalStore } from '../../../store/globalStore';
import { useSSHStore } from '../../SSHManager/store/sshStore';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface TimestampLine {
  key: string;
  nodeName: string;
  nodeHost?: string;
  rawLine: string;
  timestamp: string; // preserve exact precision
  timestampDisplay: string;
  prevTimestamp: string | null;
  deltaMs: number;
  cumulativeMs: number;
  isAnomaly: boolean;
}

const DEFAULT_COMMAND = "zgrep -aniE -C 'ts=|ts =' /var/log/spdk/* /var/log/dsware/*";

// ─── Utilities ─────────────────────────────────────────────────────────────

function formatTimestampUs(tsStr: string): string {
  try {
    if (!tsStr.includes('.')) {
      const len = tsStr.length;
      let ms = Number(tsStr);
      if (len === 19) ms = Number(BigInt(tsStr) / 1000000n); // ns -> ms
      else if (len === 16) ms = Number(BigInt(tsStr) / 1000n); // us -> ms
      else if (len === 13) ms = Number(tsStr); // ms -> ms
      else if (len === 10) ms = Number(tsStr) * 1000; // s -> ms
      else return tsStr;

      const date = new Date(ms);
      if (!isNaN(date.getTime())) {
        try {
          return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
          });
        } catch {
          return date.toISOString().replace('T', ' ').replace('Z', '');
        }
      }
    }
  } catch {}
  return tsStr;
}

function exactCompare(aStr: string, bStr: string): number {
  if (!aStr.includes('.') && !bStr.includes('.')) {
    try {
      const a = BigInt(aStr);
      const b = BigInt(bStr);
      return a < b ? -1 : a > b ? 1 : 0;
    } catch {}
  }
  return parseFloat(aStr) - parseFloat(bStr);
}

function computeDeltaMs(aStr: string, bStr: string): number {
  if (!aStr.includes('.') && !bStr.includes('.')) {
    try {
      const a = BigInt(aStr);
      const b = BigInt(bStr);
      const diff = Number(a - b);
      const scaleStr = a > b ? aStr : bStr;
      const len = scaleStr.length;
      if (len === 19) return diff / 1000000; // ns -> ms
      if (len === 16) return diff / 1000;    // us -> ms
      if (len === 13) return diff;           // ms -> ms
      if (len === 10) return diff * 1000;    // s -> ms
      return diff / 1000; // Default fallback original logic for others
    } catch {}
  }
  return (parseFloat(aStr) - parseFloat(bStr)) / 1000;
}

let globalParseId = 0;

function parseText(text: string, nodeName: string, nodeHost?: string) {
  const lines = text.split('\n');
  const regex = /ts\s*=\s*(-?\d+(?:\.\d+)?)/i;
  const matched: TimestampLine[] = [];
  const unmatchedLines: string[] = [];
  const batchId = ++globalParseId;

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '--') return;
    const m = line.match(regex);
    if (m) {
      const tsStr = m[1];
      matched.push({
        key: `${nodeName}-${batchId}-${lineIdx}-${matched.length}-${Date.now()}`,
        nodeName,
        nodeHost,
        rawLine: line,
        timestamp: tsStr,
        timestampDisplay: formatTimestampUs(tsStr),
        prevTimestamp: null,
        deltaMs: 0,
        cumulativeMs: 0,
        isAnomaly: false,
      });
    } else {
      unmatchedLines.push(`[${nodeName}] ${line}`);
    }
  });

  return { matched, unmatchedLines };
}

function computeDeltas(allLines: TimestampLine[], threshold: number): TimestampLine[] {
  const sorted = [...allLines]
    .sort((a, b) => exactCompare(a.timestamp, b.timestamp))
    .map((line) => ({ ...line }));
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      sorted[i].deltaMs = 0;
      sorted[i].cumulativeMs = 0;
      sorted[i].isAnomaly = false;
      sorted[i].prevTimestamp = null;
    } else {
      sorted[i].deltaMs = computeDeltaMs(sorted[i].timestamp, sorted[i - 1].timestamp);
      sorted[i].cumulativeMs = sorted[i - 1].cumulativeMs + sorted[i].deltaMs;
      sorted[i].isAnomaly = sorted[i].deltaMs >= threshold;
      sorted[i].prevTimestamp = sorted[i - 1].timestamp;
    }
  }
  return sorted;
}

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function exportCSV(lines: TimestampLine[], filename: string) {
  const headers = ['节点', '节点IP', '时间戳(原文)', '格式化时间', '上一条时间戳(原文)', '相邻时延(μs)', '相邻时延(ms)', '累计耗时(μs)', '累计耗时(ms)', '是否异常', '原始日志'];
  const rows = lines.map((l) => [
    l.nodeName,
    l.nodeHost || '',
    l.timestamp,
    l.timestampDisplay,
    l.prevTimestamp ?? '',
    (l.deltaMs * 1000).toFixed(1),
    l.deltaMs.toFixed(3),
    (l.cumulativeMs * 1000).toFixed(1),
    l.cumulativeMs.toFixed(3),
    l.isAnomaly ? '是' : '否',
    l.rawLine,
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ─────────────────────────────────────────────────────────────

const TimestampAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const { sessions, execCommandOnSession } = useSSHStore();
  const connectedSessions = useMemo(
    () => sessions.filter((s) => s.status === 'connected'),
    [sessions]
  );

  const [activeInputTab, setActiveInputTab] = useState<'ssh' | 'manual'>('ssh');
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [command, setCommand] = useState(DEFAULT_COMMAND);
  const [manualInput, setManualInput] = useState('');
  const [results, setResults] = useState<TimestampLine[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [thresholdMs, setThresholdMs] = useState<number>(500);
  const [viewMode, setViewMode] = useState<'timeline' | 'per-node'>('timeline');
  const [showOnlyAnomaly, setShowOnlyAnomaly] = useState(false);
  const [highlightAnomalyBorder, setHighlightAnomalyBorder] = useState(true);
  const tableRef = useRef<HTMLDivElement>(null);
  const [anomalyIndex, setAnomalyIndex] = useState(0);

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleRunSSH = async () => {
    if (selectedSessionIds.length === 0) return;
    setLoading(true);
    setResults(null);
    setUnmatched([]);

    try {
      const allMatched: TimestampLine[] = [];
      const allUnmatched: string[] = [];

      await Promise.all(
        selectedSessionIds.map(async (sessionId) => {
          const sess = sessions.find((s) => s.id === sessionId);
          if (!sess) return;
          const profile = useSSHStore.getState().profiles.find((p) => p.id === sess.profileId);

          try {
            const res = await execCommandOnSession(sessionId, command, 120000);
            const text = [res.stdout, res.stderr].filter(Boolean).join('\n');
            const { matched, unmatchedLines } = parseText(text, sess.name, profile?.host);
            allMatched.push(...matched);
            allUnmatched.push(...unmatchedLines);
          } catch (e) {
            allUnmatched.push(`[${sess.name}] 执行失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        })
      );

      const computed = computeDeltas(allMatched, thresholdMs);
      setResults(computed);
      setUnmatched(allUnmatched);
    } finally {
      setLoading(false);
    }
  };

  const handleRunManual = () => {
    const { matched, unmatchedLines } = parseText(manualInput, '手动输入');
    const computed = computeDeltas(matched, thresholdMs);
    setResults(computed);
    setUnmatched(unmatchedLines);
  };

  const handleClear = () => {
    setManualInput('');
    setResults(null);
    setUnmatched([]);
    setSelectedSessionIds([]);
    setAnomalyIndex(0);
  };

  const recalcWithThreshold = (v: number) => {
    setThresholdMs(v);
    if (results) {
      const recalculated = computeDeltas([...results], v);
      setResults(recalculated);
    }
  };

  // ─── Derived data ─────────────────────────────────────────────────────────

  const filteredResults = useMemo(() => {
    if (!results) return [];
    if (!showOnlyAnomaly) return results;
    return results.filter((r) => r.isAnomaly);
  }, [results, showOnlyAnomaly]);

  const perNodeGroups = useMemo(() => {
    if (!results) return [];
    const map = new Map<string, TimestampLine[]>();
    results.forEach((r) => {
      if (!map.has(r.nodeName)) map.set(r.nodeName, []);
      map.get(r.nodeName)!.push(r);
    });
    return Array.from(map.entries()).map(([nodeName, lines]) => {
      const nodeLines = computeDeltas(lines, thresholdMs);
      return {
        nodeName,
        lines: nodeLines,
        anomalyCount: nodeLines.filter((l) => l.isAnomaly).length,
      };
    });
  }, [results, thresholdMs]);

  const stats = useMemo(() => {
    if (!results || results.length === 0) return null;
    const deltas = results.map((r) => r.deltaMs).filter((_, i) => i > 0).sort((a, b) => a - b);
    const totalSpan =
      results.length > 1 ? computeDeltaMs(results[results.length - 1].timestamp, results[0].timestamp) : 0;
    const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;
    const minDelta = deltas.length > 0 ? Math.min(...deltas) : 0;
    const anomalyCount = results.filter((r) => r.isAnomaly).length;
    const nodeSet = new Set(results.map((r) => r.nodeName));
    return {
      totalLines: results.length + unmatched.length,
      matchedLines: results.length,
      nodeCount: nodeSet.size,
      totalSpan,
      avgDelta,
      maxDelta,
      minDelta,
      p50: percentile(deltas, 50),
      p90: percentile(deltas, 90),
      p95: percentile(deltas, 95),
      p99: percentile(deltas, 99),
      anomalyCount,
    };
  }, [results, unmatched.length]);

  const anomalyKeys = useMemo(() => {
    if (!results) return [];
    return results.filter((r) => r.isAnomaly).map((r) => r.key);
  }, [results]);

  // ─── Charts ───────────────────────────────────────────────────────────────

  const latencyTrendOption = useMemo(() => {
    if (!results || results.length < 2) return null;
    const xData = results.map((_, i) => i + 1);
    const sData = results.map((r) => Number(r.deltaMs.toFixed(3)));
    return {
      backgroundColor: 'transparent',
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      tooltip: { trigger: 'axis', formatter: (params: unknown) => { const p = (params as unknown[])[0] as { axisValue: string; value: number }; return `第 ${p.axisValue} 行<br/>时延: ${p.value} ms`; } },
      xAxis: { type: 'category', data: xData, axisLabel: { color: isDark ? '#ccc' : '#333', fontSize: 11 } },
      yAxis: { type: 'value', name: 'ms', axisLabel: { color: isDark ? '#ccc' : '#333', fontSize: 11 }, splitLine: { lineStyle: { color: isDark ? '#333' : '#eee' } } },
      series: [{
        data: sData,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: '#3b82f6' },
        areaStyle: {
          color: new (echarts as unknown as typeof echarts).graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(59,130,246,0.35)' },
            { offset: 1, color: 'rgba(59,130,246,0.05)' },
          ]),
        },
        markLine: {
          silent: true,
          data: [{ yAxis: thresholdMs, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: '阈值 {c} ms', position: 'end', color: '#ef4444', fontSize: 11 } }],
        },
      }],
    };
  }, [results, thresholdMs, isDark]);

  const latencyDistOption = useMemo(() => {
    if (!results || results.length < 2) return null;
    const deltas = results.map((r) => r.deltaMs).filter((_, i) => i > 0);
    const buckets = [
      { name: '< 10ms', count: 0, color: '#22c55e' },
      { name: '10~100ms', count: 0, color: '#3b82f6' },
      { name: '100~500ms', count: 0, color: '#f59e0b' },
      { name: '500~1000ms', count: 0, color: '#f97316' },
      { name: '≥ 1000ms', count: 0, color: '#ef4444' },
    ];
    deltas.forEach((d) => {
      if (d < 10) buckets[0].count++;
      else if (d < 100) buckets[1].count++;
      else if (d < 500) buckets[2].count++;
      else if (d < 1000) buckets[3].count++;
      else buckets[4].count++;
    });
    return {
      backgroundColor: 'transparent',
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: buckets.map((b) => b.name), axisLabel: { color: isDark ? '#ccc' : '#333', fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { color: isDark ? '#ccc' : '#333', fontSize: 11 }, splitLine: { lineStyle: { color: isDark ? '#333' : '#eee' } } },
      series: [{
        data: buckets.map((b) => ({ value: b.count, itemStyle: { color: b.color } })),
        type: 'bar',
        barWidth: '50%',
      }],
    };
  }, [results, isDark]);

  // ─── Table helpers ────────────────────────────────────────────────────────

  const getDeltaTag = (v: number, isAnomaly: boolean) => {
    if (v === 0) return <Tag color="default" style={{ fontSize: 11 }}>—</Tag>;
    let color: string = 'green';
    if (v >= 2000) color = '#7f1d1d';
    else if (v >= 1000) color = 'red';
    else if (v >= 500) color = 'volcano';
    else if (v >= 100) color = 'orange';
    else if (v >= 10) color = 'blue';
    else color = 'cyan';
    if (isAnomaly && (color === 'blue' || color === 'cyan' || color === 'green')) color = 'orange';
    return (
      <Tag color={color} style={{ fontSize: 11, fontWeight: isAnomaly ? 700 : 400 }}>
        {(v * 1000).toFixed(1)} μs
      </Tag>
    );
  };

  const baseColumns: NonNullable<TableProps<TimestampLine>['columns']> = [
    {
      title: '序号',
      key: 'index',
      width: 70,
      render: (_: unknown, __: TimestampLine, idx: number) => <Text style={{ fontSize: 12, color: '#888' }}>{idx + 1}</Text>,
    },
    {
      title: '节点',
      dataIndex: 'nodeName',
      key: 'nodeName',
      width: 120,
      render: (_: string, record: TimestampLine) => (
        <Tooltip title={record.nodeHost || record.nodeName}>
          <Text style={{ fontSize: 12 }}>{record.nodeName}</Text>
        </Tooltip>
      ),
    },
    {
      title: '原始日志',
      dataIndex: 'rawLine',
      key: 'rawLine',
      render: (text: string) => {
        const m = text.match(/ts\s*=\s*(-?\d+(?:\.\d+)?)/i);
        if (!m) {
          return (
            <Text code style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {text.length > 220 ? text.slice(0, 220) + '…' : text}
            </Text>
          );
        }
        const idx = m.index ?? 0;
        const before = text.slice(0, idx);
        const match = m[0];
        const after = text.slice(idx + match.length);
        return (
          <Text code style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {before.length > 110 ? '…' + before.slice(-110) : before}
            <mark style={{ background: '#fde047', color: '#1f2937', padding: '0 2px', borderRadius: 2 }}>{match}</mark>
            {after.length > 110 ? after.slice(0, 110) + '…' : after}
          </Text>
        );
      },
    },
    {
      title: '时间戳',
      key: 'timestamp',
      width: 190,
      render: (_: unknown, record: TimestampLine) => (
        <Tooltip title={`在原始日志中提取到的值: ts = ${record.timestamp}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text code style={{ fontSize: 12 }}>ts = {record.timestamp}</Text>
            {record.timestampDisplay !== record.timestamp && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {record.timestampDisplay}
              </Text>
            )}
          </div>
        </Tooltip>
      ),
    },
    {
      title: (
        <Tooltip title="当前行与上一行按时间戳排序后的时间差">
          <Space size={2}><ThunderboltOutlined />相邻时延</Space>
        </Tooltip>
      ),
      key: 'deltaMs',
      width: 130,
      render: (_: unknown, record: TimestampLine) => (
        <Tooltip
          title={
            record.prevTimestamp != null ? (
              <div style={{ fontSize: 12 }}>
                <div>当前: ts = {record.timestamp}</div>
                <div>上一条: ts = {record.prevTimestamp}</div>
                <div>差值: {(record.deltaMs * 1000).toFixed(1)} μs ({(record.deltaMs).toFixed(3)} ms)</div>
              </div>
            ) : (
              '首条日志，无相邻时延'
            )
          }
        >
          {getDeltaTag(record.deltaMs, record.isAnomaly)}
        </Tooltip>
      ),
    },
    {
      title: (
        <Tooltip title="从第一条日志开始的累计时间">
          <Space size={2}><ClockCircleOutlined />累计耗时</Space>
        </Tooltip>
      ),
      dataIndex: 'cumulativeMs',
      key: 'cumulativeMs',
      width: 130,
      render: (v: number) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text strong style={{ fontSize: 12, color: '#8b5cf6' }}>{v.toFixed(3)} ms</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{(v * 1000).toFixed(0)} μs</Text>
        </div>
      ),
    },
  ];

  const getRowClassName = (record: TimestampLine) => {
    if (!record.isAnomaly) return '';
    return highlightAnomalyBorder ? 'latency-anomaly-row latency-anomaly-bordered' : 'latency-anomaly-row';
  };

  const scrollToAnomaly = (dir: 'next' | 'prev') => {
    if (anomalyKeys.length === 0) return;
    let nextIdx = dir === 'next' ? anomalyIndex + 1 : anomalyIndex - 1;
    if (nextIdx >= anomalyKeys.length) nextIdx = 0;
    if (nextIdx < 0) nextIdx = anomalyKeys.length - 1;
    setAnomalyIndex(nextIdx);
    const key = anomalyKeys[nextIdx];
    const el = tableRef.current?.querySelector(`[data-row-key="${key}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s';
      const original = el.style.backgroundColor;
      el.style.backgroundColor = isDark ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.18)';
      setTimeout(() => { el.style.backgroundColor = original; }, 900);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header card */}
      <Card size="small" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <FieldTimeOutlined style={{ fontSize: 18, color: '#3b82f6' }} />
          <Title level={5} style={{ margin: 0 }}>时间戳提取与时延分析</Title>
        </div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          自动从日志中提取 <code>ts=</code> 或 <code>ts =</code> 后面的微秒时间戳，按时间升序排列，并计算相邻日志之间的时间开销。
          支持<strong>从已连接 SSH 节点自动采集</strong>或<strong>手动粘贴</strong>两种方式。
        </Text>

        <Tabs
          activeKey={activeInputTab}
          onChange={(k) => setActiveInputTab(k as 'ssh' | 'manual')}
          items={[
            {
              key: 'ssh',
              label: <Space size={4}><CloudServerOutlined />从节点采集</Space>,
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>选择目标节点（仅显示已连接会话）</Text>
                    {connectedSessions.length === 0 ? (
                      <Alert type="warning" showIcon message="暂无已连接会话" description="请先在 SSH Manager 中创建并连接会话。" style={{ fontSize: 12 }} />
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                        {connectedSessions.map((sess) => {
                          const selected = selectedSessionIds.includes(sess.id);
                          return (
                            <div
                              key={sess.id}
                              onClick={() => {
                                setSelectedSessionIds((prev) =>
                                  prev.includes(sess.id) ? prev.filter((id) => id !== sess.id) : [...prev, sess.id]
                                );
                              }}
                              style={{
                                padding: '8px 10px',
                                borderRadius: 6,
                                border: `1px solid ${selected ? '#3b82f6' : borderColor}`,
                                background: selected ? (isDark ? '#1e3a5f' : '#eff6ff') : isDark ? '#2d2d30' : '#fafafa',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <Space size={4}><Badge status="success" /><Text style={{ fontSize: 12 }}>{sess.name}</Text></Space>
                              {selected && <Tag color="blue" style={{ fontSize: 10 }}>已选</Tag>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <Divider style={{ margin: '4px 0' }} />

                  <div>
                    <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>执行命令</Text>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="输入要在节点执行的命令"
                      style={{ fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace', fontSize: 12 }}
                    />
                    <Space size={8} style={{ marginTop: 6 }}>
                      <Button size="small" onClick={() => setCommand(DEFAULT_COMMAND)}>恢复默认</Button>
                      <Button size="small" onClick={() => setCommand("grep -aniE 'ts=|ts =' /var/log/spdk/* /var/log/dsware/*")}>无上下文(grep)</Button>
                      <Button size="small" onClick={() => setCommand("zgrep -aniE 'ts=|ts =' /var/log/spdk/* /var/log/dsware/*")}>压缩日志(zgrep)</Button>
                    </Space>
                  </div>

                  <Space style={{ marginTop: 4 }}>
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRunSSH} loading={loading} disabled={selectedSessionIds.length === 0 || !command.trim()}>
                      开始采集并分析 ({selectedSessionIds.length} 节点)
                    </Button>
                    <Button icon={<ClearOutlined />} onClick={handleClear} disabled={loading}>清空</Button>
                  </Space>
                </div>
              ),
            },
            {
              key: 'manual',
              label: <Space size={4}><FileTextOutlined />手动粘贴</Space>,
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <TextArea
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    rows={10}
                    placeholder={`例如：\nevent start, ts=1000000\nevent middle, ts = 1500500\nevent end, ts=2000000`}
                    style={{ fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace', fontSize: 12, background: isDark ? '#1e1e1e' : '#f8f8f8', border: 'none', resize: 'vertical' }}
                  />
                  <Space>
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRunManual} disabled={!manualInput.trim()}>开始分析</Button>
                    <Button icon={<ClearOutlined />} onClick={handleClear} disabled={!manualInput && !results}>清空</Button>
                  </Space>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Results area */}
      {results && (
        <>
          {/* Threshold + controls */}
          <Card size="small" style={{ background: cardBg, border: `1px solid ${borderColor}` }} title={<Text strong>分析控制与阈值</Text>}>
            <Row gutter={[24, 16]} align="middle">
              <Col xs={24} md={12}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>异常时延阈值：</Text>
                  <Slider min={10} max={5000} step={10} value={thresholdMs} onChange={recalcWithThreshold} style={{ flex: 1 }} />
                  <Tag color={thresholdMs >= 1000 ? 'red' : thresholdMs >= 500 ? 'volcano' : 'orange'} style={{ fontSize: 12 }}>{thresholdMs} ms</Tag>
                </div>
              </Col>
              <Col xs={24} md={12}>
                <Space size={16} wrap>
                  <Tooltip title="高亮异常行的左边框"><Space size={6}><BgColorsOutlined /><Switch size="small" checked={highlightAnomalyBorder} onChange={setHighlightAnomalyBorder} /><Text style={{ fontSize: 12 }}>异常边框</Text></Space></Tooltip>
                  <Tooltip title="只显示超过阈值的记录"><Space size={6}><EyeOutlined /><Switch size="small" checked={showOnlyAnomaly} onChange={setShowOnlyAnomaly} /><Text style={{ fontSize: 12 }}>仅异常</Text></Space></Tooltip>
                  <Radio.Group size="small" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
                    <Radio.Button value="timeline"><LineChartOutlined /> 全局时间线</Radio.Button>
                    <Radio.Button value="per-node"><BarChartOutlined /> 按节点分组</Radio.Button>
                  </Radio.Group>
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => results && exportCSV(results, `latency-analysis-${Date.now()}.csv`)}>导出 CSV</Button>
                </Space>
              </Col>
            </Row>
          </Card>

          {/* Statistics */}
          {stats && (
            <Card size="small" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
              <Row gutter={[16, 16]}>
                <Col xs={12} sm={8} md={4}><Statistic title="节点数" value={stats.nodeCount} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="匹配行数" value={stats.matchedLines} /></Col>
                <Col xs={12} sm={8} md={5}><Statistic title="总跨度 (ms)" value={stats.totalSpan.toFixed(3)} /></Col>
                <Col xs={12} sm={8} md={5}><Statistic title="平均耗时 (ms)" value={stats.avgDelta.toFixed(3)} /></Col>
                <Col xs={12} sm={8} md={5}><Statistic title="最大耗时 (ms)" value={stats.maxDelta.toFixed(3)} valueStyle={{ color: '#ef4444' }} /></Col>
                <Col xs={12} sm={8} md={5}><Statistic title="异常时延数" value={stats.anomalyCount} valueStyle={{ color: stats.anomalyCount > 0 ? '#ef4444' : '#22c55e' }} /></Col>
              </Row>
              <Divider style={{ margin: '12px 0' }} />
              <Row gutter={[16, 16]}>
                <Col xs={12} sm={8} md={4}><Statistic title="最小时延 (ms)" value={stats.minDelta.toFixed(3)} valueStyle={{ color: '#22c55e' }} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="P50 (ms)" value={stats.p50.toFixed(3)} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="P90 (ms)" value={stats.p90.toFixed(3)} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="P95 (ms)" value={stats.p95.toFixed(3)} /></Col>
                <Col xs={12} sm={8} md={4}><Statistic title="P99 (ms)" value={stats.p99.toFixed(3)} /></Col>
              </Row>
            </Card>
          )}

          {/* Charts */}
          {latencyTrendOption && latencyDistOption && (
            <Card size="small" style={{ background: cardBg, border: `1px solid ${borderColor}` }} title={<Text strong>时延可视化</Text>}>
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                  <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>时延趋势（按全局时间线）</Text>
                  <ReactECharts option={latencyTrendOption} style={{ height: 240 }} />
                </Col>
                <Col xs={24} lg={10}>
                  <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>时延分布</Text>
                  <ReactECharts option={latencyDistOption} style={{ height: 240 }} />
                </Col>
              </Row>
            </Card>
          )}

          {/* Table */}
          <Card
            size="small"
            title={
              <Space>
                <Text strong>{viewMode === 'timeline' ? '全局时间线' : '按节点分组'}（按时间戳升序）</Text>
                {loading && <Spin size="small" />}
                {anomalyKeys.length > 0 && (
                  <>
                    <Divider type="vertical" />
                    <Space size={4}>
                      <Button size="small" icon={<StepBackwardOutlined />} onClick={() => scrollToAnomaly('prev')}>上一个异常</Button>
                      <Text style={{ fontSize: 12 }}>{anomalyIndex + 1} / {anomalyKeys.length}</Text>
                      <Button size="small" icon={<StepForwardOutlined />} onClick={() => scrollToAnomaly('next')}>下一个异常</Button>
                    </Space>
                  </>
                )}
              </Space>
            }
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            {viewMode === 'timeline' ? (
              <div ref={tableRef}>
                {filteredResults.length > 0 ? (
                  <Table
                    dataSource={filteredResults}
                    columns={baseColumns}
                    rowKey={(r) => r.key}
                    size="small"
                    pagination={{ pageSize: 50 }}
                    scroll={{ x: 'max-content' }}
                    rowClassName={getRowClassName}
                  />
                ) : (
                  <Empty description={showOnlyAnomaly ? '无异常记录' : '未提取到任何时间戳'} />
                )}
              </div>
            ) : (
              <div ref={tableRef}>
                {perNodeGroups.length > 0 ? (
                  <Collapse accordion defaultActiveKey={perNodeGroups[0]?.nodeName}>
                    {perNodeGroups.map((g) => (
                      <Collapse.Panel
                        key={g.nodeName}
                        header={
                          <Space>
                            <Text strong style={{ fontSize: 13 }}>{g.nodeName}</Text>
                            <Tag color="blue" style={{ fontSize: 11 }}>{g.lines.length} 行</Tag>
                            {g.anomalyCount > 0 && <Tag color="red" style={{ fontSize: 11 }}>{g.anomalyCount} 异常</Tag>}
                          </Space>
                        }
                      >
                        <Table
                          dataSource={showOnlyAnomaly ? g.lines.filter((l) => l.isAnomaly) : g.lines}
                          columns={baseColumns.filter((c) => (c as { dataIndex?: string }).dataIndex !== 'nodeName')}
                          rowKey={(r) => r.key}
                          size="small"
                          pagination={{ pageSize: 30 }}
                          scroll={{ x: 'max-content' }}
                          rowClassName={getRowClassName}
                        />
                      </Collapse.Panel>
                    ))}
                  </Collapse>
                ) : (
                  <Empty description="无数据" />
                )}
              </div>
            )}
          </Card>

          {/* Unmatched lines */}
          {unmatched.length > 0 && (
            <Card size="small" title={<Text strong>未匹配行（不含有效 ts 时间戳）<Tag style={{ marginLeft: 8 }}>{unmatched.length}</Tag></Text>} style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
              <div style={{ maxHeight: 240, overflow: 'auto', background: isDark ? '#1e1e1e' : '#f8f8f8', padding: 8, borderRadius: 4, fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}>
                {unmatched.map((line, idx) => (
                  <div key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Styles */}
      <style>{`
        .latency-anomaly-row {
          background-color: ${isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)'} !important;
        }
        .latency-anomaly-row:hover > td {
          background-color: ${isDark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.08)'} !important;
        }
        .latency-anomaly-bordered > td:first-child {
          border-left: 3px solid #ef4444 !important;
        }
      `}</style>
    </div>
  );
};

export default TimestampAnalyzer;
