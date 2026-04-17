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
              backgroundColor: isSelected ? '#f0f5ff' : undefined,
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
            }}
            actions={[
              <Button key="run" size="small" type="primary" onClick={(e) => { e.stopPropagation(); onRun(check); }}>
                执行
              </Button>,
              <Button key="edit" size="small" onClick={(e) => { e.stopPropagation(); onEdit(check); }}>
                编辑
              </Button>,
              isBuiltin ? null : (
                <Popconfirm
                  key="delete"
                  title="确认删除？"
                  onConfirm={(e) => { e?.stopPropagation(); onDelete(check.id); }}
                  onCancel={(e) => e?.stopPropagation()}
                >
                  <Button key="delete" size="small" danger onClick={(e) => e.stopPropagation()}>
                    删除
                  </Button>
                </Popconfirm>
              ),
            ].filter(Boolean)}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Text strong>{check.name}</Text>
                  <Tag color={STATUS_COLORS[check.status]}>{STATUS_LABELS[check.status]}</Tag>
                  {isBuiltin && <Tag>内置</Tag>}
                </Space>
              }
              description={
                <Space size="middle">
                  <Text type="secondary">类型: {TYPE_LABELS[check.checkType] ?? check.checkType}</Text>
                  <Text type="secondary">节点: {check.nodeIds.length > 0 ? check.nodeIds.join(', ') : '未指定'}</Text>
                </Space>
              }
            />
          </List.Item>
        );
      }}
    />
  );
};

export default AnalysisCheckList;
