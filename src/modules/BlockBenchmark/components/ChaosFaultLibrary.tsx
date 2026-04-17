import { Card, Tag, Space, Typography } from 'antd';
import React, { useMemo } from 'react';
import type { ChaosFault } from '../types';

const { Text } = Typography;

interface Props {
  faults: ChaosFault[];
  selectedId: string | null;
  onSelect: (fault: ChaosFault) => void;
}

const CATEGORY_COLORS: Record<ChaosFault['category'], string> = {
  network: 'blue',
  disk: 'orange',
  cpu: 'red',
  memory: 'purple',
  process: 'cyan',
  custom: 'default',
};

const CATEGORY_LABELS: Record<ChaosFault['category'], string> = {
  network: '网络',
  disk: '磁盘',
  cpu: 'CPU',
  memory: '内存',
  process: '进程',
  custom: '自定义',
};

const ChaosFaultLibrary: React.FC<Props> = ({ faults, selectedId, onSelect }) => {
  const grouped = useMemo(() => {
    const map = new Map<ChaosFault['category'], ChaosFault[]>();
    for (const f of faults) {
      const arr = map.get(f.category) || [];
      arr.push(f);
      map.set(f.category, arr);
    }
    return map;
  }, [faults]);

  const categories = useMemo(
    () => Array.from(grouped.keys()),
    [grouped]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {categories.map((cat) => (
        <div key={cat}>
          <Tag color={CATEGORY_COLORS[cat]} style={{ marginBottom: 8 }}>
            {CATEGORY_LABELS[cat]}
          </Tag>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {grouped.get(cat)?.map((fault) => {
              const isSelected = fault.id === selectedId;
              return (
                <Card
                  key={fault.id}
                  size="small"
                  hoverable
                  onClick={() => onSelect(fault)}
                  style={{
                    cursor: 'pointer',
                    borderColor: isSelected ? '#1890ff' : undefined,
                    background: isSelected ? '#e6f7ff' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong>{fault.name}</Text>
                    <Space size="small">
                      {fault.isBuiltin && <Tag size="small">内置</Tag>}
                      {fault.recoveryCmdTemplate && <Tag color="success" size="small">可恢复</Tag>}
                    </Space>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {fault.description}
                  </Text>
                  {fault.params.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        参数: {fault.params.map((p) => `${p.label}`).join(', ')}
                      </Text>
                    </div>
                  )}
                </Card>
              );
            })}
          </Space>
        </div>
      ))}
      {faults.length === 0 && (
        <Text type="secondary">暂无故障库，请先添加故障定义</Text>
      )}
    </div>
  );
};

export default ChaosFaultLibrary;
