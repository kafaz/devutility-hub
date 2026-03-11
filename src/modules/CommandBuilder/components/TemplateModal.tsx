import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Space,
  Select,
  Table,
  Tag,
  Typography,
  Popconfirm,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { CommandTemplate, VariableConfig } from '../../../types';
import {
  extractTemplateVariables,
  inferVariableType,
} from '../../../utils';

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  open: boolean;
  initial?: CommandTemplate | null;
  onOk: (data: Omit<CommandTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

const TYPE_OPTIONS = [
  { label: '文本', value: 'text' },
  { label: '数字', value: 'number' },
  { label: '路径', value: 'path' },
  { label: '下拉选择', value: 'select' },
];

const CATEGORY_OPTIONS = [
  '网络连接',
  '文件操作',
  '日志分析',
  'Docker',
  '进程管理',
  '其他',
];

const TemplateModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();
  const [templateStr, setTemplateStr] = useState('');
  const [variables, setVariables] = useState<VariableConfig[]>([]);

  useEffect(() => {
    if (open) {
      // Use queueMicrotask to avoid cascading renders while preserving functionality
      queueMicrotask(() => {
        if (initial) {
          form.setFieldsValue({
            name: initial.name,
            category: initial.category,
            description: initial.description,
            template: initial.template,
          });
          setTemplateStr(initial.template);
          setVariables(initial.variables);
        } else {
          form.resetFields();
          setTemplateStr('');
          setVariables([]);
        }
      });
    }
  }, [open, initial, form]);

  // 当模板字符串变化时，自动检测新变量
  const handleTemplateChange = (val: string) => {
    setTemplateStr(val);
    const detected = extractTemplateVariables(val);
    setVariables((prev) => {
      const existingNames = new Set(prev.map((v) => v.name));
      const newVars: VariableConfig[] = detected
        .filter((n) => !existingNames.has(n))
        .map((n) => ({
          name: n,
          label: n,
          type: inferVariableType(n),
          required: true,
          defaultValue: '',
          placeholder: '',
        }));
      // 移除模板中已不存在的变量
      const detectedSet = new Set(detected);
      const filtered = prev.filter((v) => detectedSet.has(v.name));
      return [...filtered, ...newVars];
    });
  };

  const updateVariable = (
    index: number,
    field: keyof VariableConfig,
    value: string | boolean
  ) => {
    setVariables((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  };

  const removeVariable = (index: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  };

  const addVariable = () => {
    setVariables((prev) => [
      ...prev,
      {
        name: `var${prev.length + 1}`,
        label: `变量${prev.length + 1}`,
        type: 'text',
        required: false,
      },
    ]);
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    onOk({
      name: values.name,
      category: values.category || '其他',
      description: values.description || '',
      template: values.template,
      variables,
    });
  };

  const columns = [
    {
      title: '变量名',
      dataIndex: 'name',
      width: 120,
      render: (v: string, _: VariableConfig, index: number) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateVariable(index, 'name', e.target.value)}
        />
      ),
    },
    {
      title: '显示标签',
      dataIndex: 'label',
      width: 120,
      render: (v: string, _: VariableConfig, index: number) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateVariable(index, 'label', e.target.value)}
        />
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (v: string, _: VariableConfig, index: number) => (
        <Select
          size="small"
          value={v}
          options={TYPE_OPTIONS}
          style={{ width: '100%' }}
          onChange={(val) => updateVariable(index, 'type', val)}
        />
      ),
    },
    {
      title: '默认值',
      dataIndex: 'defaultValue',
      width: 100,
      render: (v: string, _: VariableConfig, index: number) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateVariable(index, 'defaultValue', e.target.value)}
        />
      ),
    },
    {
      title: '必填',
      dataIndex: 'required',
      width: 60,
      render: (v: boolean, _: VariableConfig, index: number) => (
        <Tag
          style={{ cursor: 'pointer' }}
          color={v ? 'blue' : 'default'}
          onClick={() => updateVariable(index, 'required', !v)}
        >
          {v ? '是' : '否'}
        </Tag>
      ),
    },
    {
      title: '',
      width: 40,
      render: (_: unknown, __: VariableConfig, index: number) => (
        <Popconfirm
          title="删除此变量？"
          onConfirm={() => removeVariable(index)}
          okText="确认"
          cancelText="取消"
        >
          <DeleteOutlined style={{ color: '#ef4444', cursor: 'pointer' }} />
        </Popconfirm>
      ),
    },
  ];

  // 高亮显示模板中的变量
  const highlightedTemplate = templateStr.replace(
    /\$\{([^}]+)\}/g,
    (_, name) => `‹${name}›`
  );

  return (
    <Modal
      title={initial ? '编辑模板' : '新建命令模板'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={760}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input placeholder="例：SSH 远程登录" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select
              options={CATEGORY_OPTIONS.map((c) => ({ label: c, value: c }))}
              placeholder="选择或输入分类"
              allowClear
              showSearch
            />
          </Form.Item>
        </div>
        <Form.Item name="description" label="描述（可选）">
          <Input placeholder="简短描述此命令的用途" />
        </Form.Item>
        <Form.Item
          name="template"
          label="命令模板"
          rules={[{ required: true, message: '请输入命令模板' }]}
          extra={
            templateStr && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                预览：{highlightedTemplate}
              </Text>
            )
          }
        >
          <TextArea
            rows={3}
            placeholder="使用 ${变量名} 语法，例：ssh ${user}@${host} -p ${port}"
            onChange={(e) => handleTemplateChange(e.target.value)}
            style={{ fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace' }}
          />
        </Form.Item>
      </Form>

      <div style={{ marginTop: 8 }}>
        <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
          <Text strong style={{ fontSize: 14 }}>变量配置</Text>
          <Button size="small" icon={<PlusOutlined />} onClick={addVariable}>
            添加变量
          </Button>
        </Space>
        <Table
          dataSource={variables}
          columns={columns}
          rowKey="name"
          size="small"
          pagination={false}
          locale={{ emptyText: '模板中暂无变量，使用 ${变量名} 语法添加' }}
          scroll={{ x: 550 }}
        />
      </div>
    </Modal>
  );
};

export default TemplateModal;
