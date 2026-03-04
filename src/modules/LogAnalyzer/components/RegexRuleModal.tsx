import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Table,
  Select,
  Typography,
  Space,
  Tag,
  Alert,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ParseRule, FieldMapping, FieldType } from '../../../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  initial?: ParseRule | null;
  onOk: (data: Partial<ParseRule>) => void;
  onCancel: () => void;
}

const FIELD_TYPE_OPTIONS: { label: string; value: FieldType }[] = [
  { label: '字符串', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '浮点', value: 'float' },
  { label: '日期', value: 'date' },
  { label: 'IP', value: 'ip' },
  { label: '十六进制', value: 'hex' },
];

// 预置正则模板
const REGEX_TEMPLATES = [
  {
    label: 'Nginx 访问日志',
    pattern:
      '^(\\S+)\\s+\\S+\\s+\\S+\\s+\\[([^\\]]+)\\]\\s+"(\\S+)\\s+(\\S+)\\s+\\S+"\\s+(\\d+)\\s+(\\d+)',
    fields: [
      { groupIndex: 1, fieldName: 'remote_ip', fieldType: 'ip' as FieldType },
      { groupIndex: 2, fieldName: 'time', fieldType: 'date' as FieldType },
      { groupIndex: 3, fieldName: 'method', fieldType: 'string' as FieldType },
      { groupIndex: 4, fieldName: 'path', fieldType: 'string' as FieldType },
      { groupIndex: 5, fieldName: 'status', fieldType: 'number' as FieldType },
      { groupIndex: 6, fieldName: 'bytes', fieldType: 'number' as FieldType },
    ],
  },
  {
    label: 'Java 应用日志',
    pattern:
      '^(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(ERROR|INFO|WARN|DEBUG)\\s+\\[([^\\]]+)\\]\\s+(.+)$',
    fields: [
      { groupIndex: 1, fieldName: 'timestamp', fieldType: 'date' as FieldType },
      { groupIndex: 2, fieldName: 'level', fieldType: 'string' as FieldType },
      { groupIndex: 3, fieldName: 'thread', fieldType: 'string' as FieldType },
      { groupIndex: 4, fieldName: 'message', fieldType: 'string' as FieldType },
    ],
  },
  {
    label: 'Apache 访问日志',
    pattern:
      '^(\\S+)\\s+\\S+\\s+\\S+\\s+\\[([^\\]]+)\\]\\s+"(\\w+)\\s+(\\S+)\\s+\\S+"\\s+(\\d+)\\s+(\\d+|-)',
    fields: [
      { groupIndex: 1, fieldName: 'ip', fieldType: 'ip' as FieldType },
      { groupIndex: 2, fieldName: 'time', fieldType: 'date' as FieldType },
      { groupIndex: 3, fieldName: 'method', fieldType: 'string' as FieldType },
      { groupIndex: 4, fieldName: 'url', fieldType: 'string' as FieldType },
      { groupIndex: 5, fieldName: 'status', fieldType: 'number' as FieldType },
      { groupIndex: 6, fieldName: 'size', fieldType: 'number' as FieldType },
    ],
  },
];

const RegexRuleModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();
  const [pattern, setPattern] = useState('');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<string[] | null>(null);

  useEffect(() => {
    if (open) {
      if (initial && initial.mode === 'REGEX') {
        form.setFieldsValue({ name: initial.name, pattern: initial.pattern });
        setPattern(initial.pattern || '');
        setFieldMappings(initial.fieldMappings || []);
      } else {
        form.resetFields();
        setPattern('');
        setFieldMappings([]);
      }
      setRegexError(null);
      setTestInput('');
      setTestResult(null);
    }
  }, [open, initial, form]);

  const validateRegex = (p: string): boolean => {
    try {
      new RegExp(p);
      setRegexError(null);
      return true;
    } catch (e) {
      setRegexError(String(e));
      return false;
    }
  };

  const handlePatternChange = (val: string) => {
    setPattern(val);
    validateRegex(val);
  };

  const handleTest = () => {
    if (!pattern || !testInput) return;
    try {
      const re = new RegExp(pattern);
      const m = re.exec(testInput);
      if (m) {
        setTestResult([...m].slice(1));
      } else {
        setTestResult([]);
      }
    } catch {
      setTestResult(null);
    }
  };

  const applyTemplate = (tpl: (typeof REGEX_TEMPLATES)[0]) => {
    form.setFieldValue('pattern', tpl.pattern);
    setPattern(tpl.pattern);
    setFieldMappings(tpl.fields);
    validateRegex(tpl.pattern);
  };

  const addMapping = () => {
    setFieldMappings((prev) => [
      ...prev,
      {
        groupIndex: prev.length + 1,
        fieldName: `field${prev.length + 1}`,
        fieldType: 'string',
      },
    ]);
  };

  const updateMapping = (
    index: number,
    field: keyof FieldMapping,
    value: string | number
  ) => {
    setFieldMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  };

  const removeMapping = (index: number) => {
    setFieldMappings((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    if (!validateRegex(values.pattern)) return;
    onOk({
      name: values.name,
      mode: 'REGEX',
      pattern: values.pattern,
      fieldMappings,
    });
  };

  const columns = [
    {
      title: '捕获组序号',
      dataIndex: 'groupIndex',
      width: 90,
      render: (v: number, _: FieldMapping, index: number) => (
        <Input
          size="small"
          type="number"
          value={v}
          min={1}
          onChange={(e) =>
            updateMapping(index, 'groupIndex', parseInt(e.target.value) || 1)
          }
        />
      ),
    },
    {
      title: '字段名',
      dataIndex: 'fieldName',
      render: (v: string, _: FieldMapping, index: number) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateMapping(index, 'fieldName', e.target.value)}
        />
      ),
    },
    {
      title: '字段类型',
      dataIndex: 'fieldType',
      width: 110,
      render: (v: string, _: FieldMapping, index: number) => (
        <Select
          size="small"
          value={v}
          options={FIELD_TYPE_OPTIONS}
          style={{ width: '100%' }}
          onChange={(val) => updateMapping(index, 'fieldType', val)}
        />
      ),
    },
    {
      title: '',
      width: 40,
      render: (_: unknown, __: FieldMapping, index: number) => (
        <DeleteOutlined
          style={{ color: '#ef4444', cursor: 'pointer' }}
          onClick={() => removeMapping(index)}
        />
      ),
    },
  ];

  return (
    <Modal
      title={initial ? '编辑正则规则' : '新建正则规则'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={700}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="name"
          label="规则名称"
          rules={[{ required: true, message: '请输入规则名称' }]}
        >
          <Input placeholder="例：Nginx 访问日志" />
        </Form.Item>

        {/* 模板快速选择 */}
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            快速套用模板：
          </Text>
          <Space size={6} style={{ marginLeft: 8 }}>
            {REGEX_TEMPLATES.map((tpl) => (
              <Tag
                key={tpl.label}
                style={{ cursor: 'pointer' }}
                color="blue"
                onClick={() => applyTemplate(tpl)}
              >
                {tpl.label}
              </Tag>
            ))}
          </Space>
        </div>

        <Form.Item
          name="pattern"
          label="正则表达式"
          rules={[{ required: true, message: '请输入正则表达式' }]}
          validateStatus={regexError ? 'error' : ''}
          help={regexError || undefined}
        >
          <Input
            style={{
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              fontSize: 13,
            }}
            placeholder="例：^(\d{4}-\d{2}-\d{2}) (ERROR|INFO) (.+)$"
            onChange={(e) => handlePatternChange(e.target.value)}
          />
        </Form.Item>

        {/* 测试区 */}
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            测试日志行（可选）：
          </Text>
          <Space.Compact style={{ width: '100%', marginTop: 4 }}>
            <Input
              size="small"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="粘贴一行日志进行匹配测试"
              style={{
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                fontSize: 12,
              }}
            />
            <Button size="small" onClick={handleTest}>
              测试
            </Button>
          </Space.Compact>
          {testResult !== null && (
            <div style={{ marginTop: 6 }}>
              {testResult.length === 0 ? (
                <Alert message="未匹配" type="error" showIcon banner />
              ) : (
                <Alert
                  message={
                    <div>
                      <Text type="success">匹配成功，捕获组：</Text>
                      {testResult.map((v, i) => (
                        <Tag key={i} color="green" style={{ marginLeft: 4 }}>
                          [{i + 1}] {v}
                        </Tag>
                      ))}
                    </div>
                  }
                  type="success"
                  showIcon={false}
                  banner
                />
              )}
            </div>
          )}
        </div>
      </Form>

      {/* 字段映射 */}
      <Space style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 14 }}>
          捕获组 → 字段映射
        </Text>
        <Button size="small" icon={<PlusOutlined />} onClick={addMapping}>
          添加映射
        </Button>
      </Space>
      <Table
        dataSource={fieldMappings}
        columns={columns}
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        locale={{ emptyText: '暂无映射，捕获组将使用 field1, field2... 命名' }}
      />
    </Modal>
  );
};

export default RegexRuleModal;
