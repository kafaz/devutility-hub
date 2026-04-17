import React, { useMemo } from 'react';
import { Card, Progress, Space, Typography, Badge } from 'antd';
import type { IOMetricsSnapshot } from '../types';

const { Text } = Typography;

interface IOMonitorGridProps {
  snapshots: IOMetricsSnapshot[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function getUtilColor(util: number): string {
  if (util > 80) return '#ef4444';
  if (util >= 60) return '#f59e0b';
  return '#22c55e';
}

function estimateIOPS(metrics: { r_await: number; w_await: number; bw_mbps: number }): number {
  // Approximate IOPS from bandwidth assuming 4KB average IO size
  if (metrics.bw_mbps <= 0) return 0;
  return Math.round((metrics.bw_mbps * 1024) / 4);
}

export const IOMonitorGrid: React.FC<IOMonitorGridProps> = ({
  snapshots,
  selectedKey,
  onSelect,
}) => {
  const sorted = useMemo(() => {
    return [...snapshots].sort((a, b) => a.key.localeCompare(b.key));
  }, [snapshots]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {sorted.map((snap) => {
        const { latest } = snap;
        const utilColor = getUtilColor(latest.util);
        const iops = estimateIOPS(latest);
        const isSelected = selectedKey === snap.key;

        return (
          <Card
            key={snap.key}
            size="small"
            hoverable
            onClick={() => onSelect(snap.key)}
            style={{
              width: 280,
              cursor: 'pointer',
              border: isSelected ? `2px solid ${utilColor}` : '1px solid #f0f0f0',
              boxShadow: isSelected ? `0 0 8px ${utilColor}33` : undefined,
            }}
          >
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong ellipsis style={{ maxWidth: 160 }} title={snap.sessionName}>
                  {snap.sessionName}
                </Text>
                {snap.activeIOModel && (
                  <Badge
                    count={snap.activeIOModel}
                    style={{ backgroundColor: '#1677ff' }}
                  />
                )}
              </div>

              <Text type="secondary" style={{ fontSize: 12 }}>
                {snap.diskName}
              </Text>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ fontSize: 12 }}>
                  BW: <strong>{latest.bw_mbps.toFixed(2)}</strong> MB/s
                </Text>
                <Text style={{ fontSize: 12 }}>
                  IOPS: <strong>{iops.toLocaleString()}</strong>
                </Text>
              </div>

              <div style={{ marginTop: 4 }}>
                <Progress
                  percent={Math.min(Math.round(latest.util), 100)}
                  size="small"
                  strokeColor={utilColor}
                  showInfo
                  format={(percent) => `${percent}% util`}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ fontSize: 11, color: '#f97316' }}>
                  r_await: {latest.r_await.toFixed(2)} ms
                </Text>
                <Text style={{ fontSize: 11, color: '#eab308' }}>
                  w_await: {latest.w_await.toFixed(2)} ms
                </Text>
              </div>
            </Space>
          </Card>
        );
      })}
    </div>
  );
};

export default IOMonitorGrid;
