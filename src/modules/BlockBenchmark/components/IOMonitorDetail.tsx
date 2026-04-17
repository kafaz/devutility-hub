import React, { useMemo } from 'react';
import { Card, Empty, Space, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { IOMetricsSnapshot } from '../types';

const { Text } = Typography;

interface IOMonitorDetailProps {
  snapshot: IOMetricsSnapshot | null;
}

export const IOMonitorDetail: React.FC<IOMonitorDetailProps> = ({ snapshot }) => {
  const hasData = snapshot && snapshot.history.length > 0;

  const utilOption = useMemo(() => {
    if (!hasData) return {};
    const history = snapshot!.history;
    const xAxisData = history.map((h) => h.timestamp);

    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['%Util', 'R_Await (ms)', 'W_Await (ms)'],
        bottom: 0,
      },
      grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: xAxisData },
      yAxis: [
        { type: 'value', name: '%', position: 'left', max: 100 },
        { type: 'value', name: 'ms', position: 'right', splitLine: { show: false } },
      ],
      series: [
        {
          name: '%Util',
          type: 'line',
          itemStyle: { color: '#ef4444' },
          areaStyle: { color: 'rgba(239, 68, 68, 0.2)' },
          data: history.map((h) => h.util.toFixed(1)),
          smooth: true,
        },
        {
          name: 'R_Await (ms)',
          type: 'line',
          yAxisIndex: 1,
          itemStyle: { color: '#f97316' },
          data: history.map((h) => h.r_await.toFixed(2)),
          smooth: true,
        },
        {
          name: 'W_Await (ms)',
          type: 'line',
          yAxisIndex: 1,
          itemStyle: { color: '#eab308' },
          data: history.map((h) => h.w_await.toFixed(2)),
          smooth: true,
        },
      ],
    };
  }, [snapshot, hasData]);

  const bwOption = useMemo(() => {
    if (!hasData) return {};
    const history = snapshot!.history;
    const xAxisData = history.map((h) => h.timestamp);

    return {
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
          data: history.map((h) => h.bw_mbps.toFixed(2)),
          smooth: true,
        },
      ],
    };
  }, [snapshot, hasData]);

  if (!hasData) {
    return (
      <Card size="small" bordered={false}>
        <Empty
          description={
            snapshot
              ? '暂无历史数据，等待 IO 监控数据流入...'
              : '请在左侧选择一个 IO 监控卡片查看详情'
          }
          style={{ margin: '40px 0' }}
        />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong style={{ fontSize: 16 }}>
          {snapshot.sessionName} — {snapshot.diskName}
        </Text>
        {snapshot.activeIOModel && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前模型: <strong>{snapshot.activeIOModel}</strong>
          </Text>
        )}
      </div>

      <Card size="small" title="IO Utilization + R/W Await">
        <ReactECharts
          option={utilOption}
          notMerge={true}
          lazyUpdate={true}
          style={{ height: 300 }}
        />
      </Card>

      <Card size="small" title="Bandwidth (MB/s)">
        <ReactECharts
          option={bwOption}
          notMerge={true}
          lazyUpdate={true}
          style={{ height: 300 }}
        />
      </Card>
    </Space>
  );
};

export default IOMonitorDetail;
