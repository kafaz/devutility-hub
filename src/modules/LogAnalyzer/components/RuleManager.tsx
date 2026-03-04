import React from 'react';
import {
  Select,
  Button,
  Space,
  Tooltip,
  Popconfirm,
  Tag,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { ParseRule } from '../../../types';

const { Text } = Typography;

interface Props {
  rules: ParseRule[];
  activeRuleId: string | null;
  onSelectRule: (id: string) => void;
  onAddRule: () => void;
  onEditRule: (rule: ParseRule) => void;
  onDeleteRule: (id: string) => void;
}

const RuleManager: React.FC<Props> = ({
  rules,
  activeRuleId,
  onSelectRule,
  onAddRule,
  onEditRule,
  onDeleteRule,
}) => {
  const activeRule = rules.find((r) => r.id === activeRuleId);

  return (
    <Space style={{ width: '100%' }}>
      <Text style={{ whiteSpace: 'nowrap', fontSize: 13 }}>解析规则：</Text>
      <Select
        value={activeRuleId}
        onChange={onSelectRule}
        placeholder="选择解析规则"
        style={{ minWidth: 220 }}
        options={rules.map((r) => ({
          label: (
            <Space size={6}>
              <span>{r.name}</span>
              <Tag
                color={r.mode === 'C_FORMAT' ? 'orange' : 'blue'}
                style={{ fontSize: 10, lineHeight: '14px', padding: '0 4px' }}
              >
                {r.mode === 'C_FORMAT' ? 'C格式' : '正则'}
              </Tag>
            </Space>
          ),
          value: r.id,
        }))}
      />

      {activeRule && (
        <>
          <Tooltip title="编辑规则">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEditRule(activeRule)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除此规则？"
            onConfirm={() => onDeleteRule(activeRule.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="删除规则">
              <Button
                size="small"
                icon={<DeleteOutlined />}
                danger
              />
            </Tooltip>
          </Popconfirm>
        </>
      )}

      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={onAddRule}
        type="dashed"
      >
        新建规则
      </Button>
    </Space>
  );
};

export default RuleManager;
