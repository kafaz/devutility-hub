import React from 'react';
import { Button, List, Popconfirm, Space, Tag, Typography } from 'antd';
import type { ConsistencyCheck } from '../types';

const { Text } = Typography;

const STATUS_COLORS: Record<ConsistencyCheck['status'], string> = {
  pending: 'default',
  running: 'processing',
  pass: 'success',
  fail: 'error',
  error: 'warning',
};

const STATUS_LABELS: Record<ConsistencyCheck['status'], string> = {
  pending: '待执行',
  running: '执行中',
  pass: '通过',
  fail: '失败',
  error: '异常',
};

const TYPE_LABELS: Record<string, string> = {
  crc: 'CRC 校验',
  lba_range: 'LBA 范围比对',
  metadata: '元数据一致性',
  custom: '自定义',
};

interface Props {
  checks: ConsistencyCheck[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRun: (check: ConsistencyCheck) => void;
  onDelete: (id: string) => void;
  onEdit: (check: ConsistencyCheck) => void;
}

const BUILTIN_IDS = new Set(['crc_check', 'lba_cmp', 'meta_cmp']);

const AnalysisCheckList: React.FC<Props> = ({ checks, selectedId, onSelect, onRun, onDelete, onEdit }) => {
  return (
    <List
      dataSource={checks}
      rowKey="id"
      renderItem={(check) => {
        const isBuiltin = BUILTIN_IDS.has(check.id);
        const isSelected = selectedId === check.id;
        return (
          <List.Item
            onClick={() => onSelect(check.id)}
            style={{
              cursor: 'pointer',
              padding: 0,
              borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
            }}
          >
            <div
              style={{
                width: '100%',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.16)' : 'transparent',
                borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
                transition: 'background-color 120ms ease, border-color 120ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <Text
                  strong
                  style={{
                    fontSize: 14,
                    lineHeight: 1.4,
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                  }}
                >
                  {check.name}
                </Text>
                <Tag color={STATUS_COLORS[check.status]}>{STATUS_LABELS[check.status]}</Tag>
                {isBuiltin && <Tag>内置</Tag>}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(148, 163, 184, 0.08)',
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                    类型
                  </Text>
                  <Text style={{ fontSize: 12 }}>{TYPE_LABELS[check.checkType] ?? check.checkType}</Text>
                </div>
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(148, 163, 184, 0.08)',
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                    目标节点
                  </Text>
                  <Text style={{ fontSize: 12, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    {check.nodeIds.length > 0 ? check.nodeIds.join(', ') : '未指定'}
                  </Text>
                </div>
              </div>

              <Space size={[8, 8]} wrap onClick={(event) => event.stopPropagation()}>
                <Button key="run" size="small" type="primary" onClick={() => onRun(check)}>
                  执行
                </Button>
                <Button key="edit" size="small" onClick={() => onEdit(check)}>
                  编辑
                </Button>
                {isBuiltin ? null : (
                  <Popconfirm
                    key="delete"
                    title="确认删除？"
                    onConfirm={() => onDelete(check.id)}
                    onCancel={(event) => event?.stopPropagation()}
                  >
                    <Button key="delete" size="small" danger onClick={(event) => event.stopPropagation()}>
                      删除
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </div>
          </List.Item>
        );
      }}
    />
  );
};

export default AnalysisCheckList;
