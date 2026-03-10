import { AreaChartOutlined } from '@ant-design/icons';
import { App, Card, Col, Empty, Input, Layout, Row, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import React, { useMemo, useState } from 'react';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Content } = Layout;

interface IoStat { iops: number; bw: number; latAvg: number; p99: number; p999: number; }
interface FioJob { name: string; read: IoStat; write: IoStat; }

const getEmptyIo = (): IoStat => ({ iops: 0, bw: 0, latAvg: 0, p99: 0, p999: 0 });

const parseValueWithUnit = (valStr: string): number => {
  const match = valStr.match(/^([\d.]+)([kKMGT]?)$/i);
  if (!match) return parseFloat(valStr) || 0;
  const num = parseFloat(match[1]);
  let mult = 1;
  const unit = match[2].toUpperCase();
  if (unit === 'K') mult = 1000;
  if (unit === 'M') mult = 1000000;
  if (unit === 'G') mult = 1000000000;
  if (unit === 'T') mult = 1000000000000;
  return num * mult;
};

const parseFioLog = (log: string): FioJob[] => {
  const lines = log.split('\n');
  const jobs: FioJob[] = [];
  let currentJob: FioJob | null = null;
  let currentMode: 'read' | 'write' | null = null;
  let latMultiplier = 1;

  for (let line of lines) {
    line = line.trim();
    if (line.match(/^[\w-]+:\s*\(groupid=/)) {
      if (currentJob) jobs.push(currentJob);
      const name = line.split(':')[0].trim();
      currentJob = { name, read: getEmptyIo(), write: getEmptyIo() };
      continue;
    }
    // Also catch "Job N:" style
    if (line.match(/^Job \d+( \(.+\))?:/)) {
      if (currentJob) jobs.push(currentJob);
      const name = line.split(':')[0].trim();
      currentJob = { name, read: getEmptyIo(), write: getEmptyIo() };
      continue;
    }

    if (!currentJob) continue;

    if (line.startsWith('read: IOPS=')) {
      currentMode = 'read';
      const m1 = line.match(/IOPS=([\d.]+[kK]?[M]?)/);
      const m2 = line.match(/BW=([\d.]+[KMGT]?iB\/s|[\d.]+[KMGT]?B\/s)/);
      if (m1) currentJob.read.iops = parseValueWithUnit(m1[1]);
      if (m2) {
          const bwMatch = m2[1].match(/^([\d.]+)([KMGT]?i?B\/s)/);
          if (bwMatch) currentJob.read.bw = parseValueWithUnit(bwMatch[1] + (bwMatch[2].charAt(0).toUpperCase().replace('I', '')));
      }
    } else if (line.startsWith('write: IOPS=')) {
      currentMode = 'write';
      const m1 = line.match(/IOPS=([\d.]+[kK]?[M]?)/);
      const m2 = line.match(/BW=([\d.]+[KMGT]?iB\/s|[\d.]+[KMGT]?B\/s)/);
      if (m1) currentJob.write.iops = parseValueWithUnit(m1[1]);
      if (m2) {
          const bwMatch = m2[1].match(/^([\d.]+)([KMGT]?i?B\/s)/);
          if (bwMatch) currentJob.write.bw = parseValueWithUnit(bwMatch[1] + (bwMatch[2].charAt(0).toUpperCase().replace('I', '')));
      }
    } else if (line.match(/(c?lat) \((usec|msec|nsec)\):/)) {
      const match = line.match(/(c?lat) \((usec|msec|nsec)\):/);
      if (match) {
        if (match[2] === 'msec') latMultiplier = 1000;
        else if (match[2] === 'nsec') latMultiplier = 0.001;
        else latMultiplier = 1; // usec (default baseline for our chart)
      }
      const avgMatch = line.match(/avg=\s*([\d.]+)/);
      if (avgMatch && currentMode) {
        currentJob[currentMode].latAvg = parseFloat(avgMatch[1]) * latMultiplier;
      }
    } else if (line.match(/99\.00th=\[\s*(\d+)\]/)) {
      if (currentMode) {
         const p99 = line.match(/99\.00th=\[\s*(\d+)\]/);
         if (p99) currentJob[currentMode].p99 = parseInt(p99[1], 10) * latMultiplier;
         const p999 = line.match(/99\.90th=\[\s*(\d+)\]/);
         if (p999) currentJob[currentMode].p999 = parseInt(p999[1], 10) * latMultiplier;
         const p999_2 = line.match(/99\.90th=\[\s*(\d+)\]/);
         if (!p999 && p999_2) currentJob[currentMode].p999 = parseInt(p999_2[1], 10) * latMultiplier;
      }
    } else if (line.match(/99\.90th=\[\s*(\d+)\]/) && currentMode && !currentJob[currentMode].p999) {
         const p999 = line.match(/99\.90th=\[\s*(\d+)\]/);
         if (p999) currentJob[currentMode].p999 = parseInt(p999[1], 10) * latMultiplier;
    }
  }
  if (currentJob) jobs.push(currentJob);

  // Normalize BW to MB/s
  jobs.forEach(j => {
      j.read.bw = Math.round(j.read.bw / 1000 / 1000 * 100) / 100;
      j.write.bw = Math.round(j.write.bw / 1000 / 1000 * 100) / 100;
  });

  return jobs;
};

const commonChartOptions = (isDark: boolean) => ({
  backgroundColor: 'transparent',
  textStyle: { color: isDark ? '#d4d4d8' : '#333' },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: { textStyle: { color: isDark ? '#a1a1aa' : '#666' }, bottom: 0 },
  grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
  xAxis: {
    type: 'category',
    axisLabel: { color: isDark ? '#a1a1aa' : '#666', interval: 0, rotate: 15 },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: isDark ? '#a1a1aa' : '#666' },
    splitLine: { lineStyle: { color: isDark ? '#3e3e42' : '#eee', type: 'dashed' } }
  }
});

const FIOVisualizer: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const jobs = useMemo(() => parseFioLog(inputText), [inputText]);

  const iopsOption = useMemo(() => {
    const opt = commonChartOptions(isDark);
    return {
      ...opt,
      title: { text: 'IOPS 对比 (次/秒)', textStyle: { color: isDark ? '#e4e4e7' : '#333', fontSize: 14 } },
      xAxis: { ...opt.xAxis, data: jobs.map(j => j.name) },
      series: [
        { name: 'Read IOPS', type: 'bar', data: jobs.map(j => j.read.iops), itemStyle: { color: '#3b82f6', borderRadius: [2, 2, 0, 0] } },
        { name: 'Write IOPS', type: 'bar', data: jobs.map(j => j.write.iops), itemStyle: { color: '#10b981', borderRadius: [2, 2, 0, 0] } }
      ]
    };
  }, [jobs, isDark]);

  const bwOption = useMemo(() => {
    const opt = commonChartOptions(isDark);
    return {
      ...opt,
      title: { text: '吞吐量 Bandwidth (MB/s)', textStyle: { color: isDark ? '#e4e4e7' : '#333', fontSize: 14 } },
      xAxis: { ...opt.xAxis, data: jobs.map(j => j.name) },
      series: [
        { name: 'Read BW', type: 'bar', data: jobs.map(j => j.read.bw), itemStyle: { color: '#8b5cf6', borderRadius: [2, 2, 0, 0] } },
        { name: 'Write BW', type: 'bar', data: jobs.map(j => j.write.bw), itemStyle: { color: '#f59e0b', borderRadius: [2, 2, 0, 0] } }
      ]
    };
  }, [jobs, isDark]);

  const latOption = useMemo(() => {
    const opt = commonChartOptions(isDark);
    return {
      ...opt,
      title: { text: '延迟 Latency 对比 (微秒 μs)', textStyle: { color: isDark ? '#e4e4e7' : '#333', fontSize: 14 } },
      xAxis: { ...opt.xAxis, data: jobs.map(j => j.name) },
      yAxis: { ...opt.yAxis, type: 'log', name: 'Log Scale (μs)' }, // Use log scale for tail latency visualization
      series: [
        { name: 'R.Avg', type: 'line', data: jobs.map(j => j.read.latAvg), itemStyle: { color: '#3b82f6' } },
        { name: 'R.P99', type: 'line', data: jobs.map(j => j.read.p99), itemStyle: { color: '#60a5fa' }, lineStyle: { type: 'dashed' } },
        { name: 'R.P99.9', type: 'line', data: jobs.map(j => j.read.p999), itemStyle: { color: '#93c5fd' }, lineStyle: { type: 'dotted' } },
        { name: 'W.Avg', type: 'line', data: jobs.map(j => j.write.latAvg), itemStyle: { color: '#10b981' } },
        { name: 'W.P99', type: 'line', data: jobs.map(j => j.write.p99), itemStyle: { color: '#34d399' }, lineStyle: { type: 'dashed' } },
        { name: 'W.P99.9', type: 'line', data: jobs.map(j => j.write.p999), itemStyle: { color: '#6ee7b7' }, lineStyle: { type: 'dotted' } }
      ]
    };
  }, [jobs, isDark]);

  return (
    <App>
      <Content style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <AreaChartOutlined style={{ fontSize: 24, color: '#3b82f6' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>FIO 性能解析器 (FIO Visualizer)</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>将复杂的 FIO 压测日志粘入下方，即时生成 IOPS、吞吐与长尾延迟柱状图。</Text>
          </div>
        </div>

        <Row gutter={[16, 16]} style={{ flex: 1, minHeight: 0 }}>
          <Col span={8} style={{ display: 'flex', flexDirection: 'column' }}>
            <Card 
              size="small" 
              title="原始 FIO 输出" 
              style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#252526' : '#fff' }}
              bodyStyle={{ flex: 1, padding: 0 }}
            >
              <TextArea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="粘贴你的 FIO CLI 输出信息...\n支持多 Job 聚合分析。"
                style={{ 
                  height: '100%', 
                  resize: 'none', 
                  border: 'none', 
                  borderRadius: '0 0 8px 8px',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  background: isDark ? '#1e1e1e' : '#fafafa',
                  color: isDark ? '#d4d4d8' : '#333'
                }}
              />
            </Card>
          </Col>

          <Col span={16} style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
            {jobs.length === 0 ? (
              <Card style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? '#252526' : '#fff' }}>
                <Empty description="等待输入 FIO 日志" />
              </Card>
            ) : (
              <>
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Card size="small" style={{ background: isDark ? '#252526' : '#fff' }}>
                      <ReactECharts option={iopsOption} style={{ height: 260 }} />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small" style={{ background: isDark ? '#252526' : '#fff' }}>
                      <ReactECharts option={bwOption} style={{ height: 260 }} />
                    </Card>
                  </Col>
                </Row>
                <Card size="small" style={{ background: isDark ? '#252526' : '#fff' }}>
                  <ReactECharts option={latOption} style={{ height: 320 }} />
                </Card>
              </>
            )}
          </Col>
        </Row>
      </Content>
    </App>
  );
};

export default FIOVisualizer;
