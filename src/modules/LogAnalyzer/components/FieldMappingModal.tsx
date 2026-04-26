/**
 * FieldMappingModal — 字段值映射编辑器
 *
 * 针对 C 日志函数分析器的每个标签页，允许用户为每个参数预设值映射表
 * （如 0 → STATUS_OK, 1 → STATUS_FAIL），解析结果展示时自动翻译。
 */
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
    Button,
    Col,
    Divider,
    Input,
    Modal,
    Row,
    Space,
    Table,
    Tabs,
    Tag,
    Tooltip,
    Typography,
} from 'antd';
import React, { useEffect, useState } from 'react';
import type { FieldValueMapping } from '../store/logStore';

const { Text } = Typography;
const { TextArea } = Input;

interface Props {
  open: boolean;
  tabName: string;
  paramNames: string[];
  /** 当前 tab 的完整映射配置 */
  mappings: Record<string, FieldValueMapping[]>;
  onSave: (paramName: string, mappings: FieldValueMapping[]) => void;
  onCancel: () => void;
}

// ── 单个参数的映射编辑器 ────────────────────────────────────────────────────────

const ParamMappingEditor: React.FC<{
  paramName: string;
  initialMappings: FieldValueMapping[];
  onSave: (mappings: FieldValueMapping[]) => void;
}> = ({ paramName, initialMappings, onSave }) => {
  const [rows, setRows] = useState<FieldValueMapping[]>(initialMappings);
  const [bulkText, setBulkText] = useState('');

  // 每次 paramName 变化时重置
  useEffect(() => {
    setRows(initialMappings);
    setBulkText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramName]);

  const addRow = () => setRows((prev) => [...prev, { value: '', label: '' }]);

  const updateRow = (index: number, field: keyof FieldValueMapping, val: string) =>
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });

  const removeRow = (index: number) =>
    setRows((prev) => prev.filter((_, i) => i !== index));

  // 批量粘贴: 每行 "value=label" 或 "value label"
  const handleBulkImport = () => {
    const parsed: FieldValueMapping[] = [];
    bulkText.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // 支持 = 或空白分隔
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        parsed.push({ value: trimmed.slice(0, eqIdx).trim(), label: trimmed.slice(eqIdx + 1).trim() });
      } else {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          parsed.push({ value: parts[0], label: parts.slice(1).join(' ') });
        }
      }
    });
    if (parsed.length > 0) {
      setRows((prev) => {
        // 去重：若 value 已存在则覆盖
        const map = new Map<string, FieldValueMapping>();
        [...prev, ...parsed].forEach((r) => { if (r.value) map.set(r.value, r); });
        return Array.from(map.values());
      });
      setBulkText('');
    }
  };

  // 每次 rows 变化自动通知父组件
  useEffect(() => {
    onSave(rows.filter((r) => r.value.trim() && r.label.trim()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const columns = [
    {
      title: '原始值',
      dataIndex: 'value',
      width: 140,
      render: (_: string, _row: FieldValueMapping, index: number) => (
        <Input
          size="small"
          value={rows[index].value}
          onChange={(e) => updateRow(index, 'value', e.target.value)}
          placeholder="如 0, 0x1, error"
          style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
        />
      ),
    },
    {
      title: '友好名称',
      dataIndex: 'label',
      render: (_: string, _row: FieldValueMapping, index: number) => (
        <Input
          size="small"
          value={rows[index].label}
          onChange={(e) => updateRow(index, 'label', e.target.value)}
          placeholder="如 STATUS_OK, WRITE_OP"
          style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
        />
      ),
    },
    {
      title: '',
      width: 36,
      render: (_: unknown, _row: FieldValueMapping, index: number) => (
        <Tooltip title="删除">
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => removeRow(index)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      {/* 行编辑 */}
      <Table
        size="small"
        dataSource={rows.map((r, i) => ({ ...r, _key: i }))}
        columns={columns}
        rowKey="_key"
        pagination={false}
        style={{ marginBottom: 8 }}
      />
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={addRow}
        style={{ marginBottom: 12 }}
      >
        添加映射
      </Button>

      {/* 批量导入 */}
      <Divider style={{ margin: '8px 0' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>批量粘贴（每行 value=label 或 value label）</Text>
      </Divider>
      <Row gutter={8}>
        <Col flex="1">
          <TextArea
            rows={3}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'0=STATUS_OK\n1=STATUS_WARN\n2=STATUS_ERROR'}
            style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
          />
        </Col>
        <Col>
          <Button type="primary" ghost size="small" onClick={handleBulkImport} style={{ marginTop: 4 }}>
            导入
          </Button>
        </Col>
      </Row>
    </div>
  );
};

// ── 主 Modal ───────────────────────────────────────────────────────────────────

const FieldMappingModal: React.FC<Props> = ({
  open,
  tabName,
  paramNames,
  mappings,
  onSave,
  onCancel,
}) => {
  // 实时维护草稿，关闭时丢弃未保存的细粒度改动已由 onSave 实时推送到 store
  if (!open || paramNames.length === 0) return null;

  return (
    <Modal
      title={
        <Space>
          <span>字段值映射</span>
          <Tag color="blue" style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }}>
            {tabName}
          </Tag>
        </Space>
      }
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="close" type="primary" onClick={onCancel}>
          完成
        </Button>,
      ]}
      width={600}
      destroyOnClose
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        为每个参数配置值→名称映射。分析时将自动把日志中的魔鬼数字替换为友好名称；无匹配时显示原始值。
      </Text>

      {paramNames.length === 1 ? (
        <ParamMappingEditor
          paramName={paramNames[0]}
          initialMappings={mappings[paramNames[0]] ?? []}
          onSave={(m) => onSave(paramNames[0], m)}
        />
      ) : (
        <Tabs
          size="small"
          type="card"
          items={paramNames.map((name) => ({
            key: name,
            label: (
              <Tooltip title={name}>
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                    fontSize: 12,
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'inline-block',
                    verticalAlign: 'bottom',
                  }}
                >
                  {name}
                </span>
              </Tooltip>
            ),
            children: (
              <ParamMappingEditor
                paramName={name}
                initialMappings={mappings[name] ?? []}
                onSave={(m) => onSave(name, m)}
              />
            ),
          }))}
        />
      )}
    </Modal>
  );
};

export default FieldMappingModal;
