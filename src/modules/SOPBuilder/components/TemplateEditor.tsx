import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Button,
  Space,
  Typography,
  Table,
  Popconfirm,
} from 'antd';
import { PlusOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import type { SOPTemplate, SOPCheck } from '../../../types';
import { generateId } from '../../../utils';

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  open: boolean;
  initial?: SOPTemplate | null;
  onOk: (data: Omit<SOPTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

const CATEGORY_OPTIONS = [
  '服务异常', '性能劣化', '网络问题', '数据库问题',
  '部署问题', '安全事件', '其他',
];

const TemplateEditor: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();
  const [checks, setChecks] = useState<SOPCheck[]>([]);

  useEffect(() => {
    if (open) {
      if (initial) {
        form.setFieldsValue({
          name: initial.name,
          category: initial.category,
          description: initial.description,
          diagnosisHints: initial.diagnosisHints,
        });
        setChecks(initial.checks);
      } else {
        form.resetFields();
        setChecks([]);
      }
    }
  }, [open, initial, form]);

  const addCheck = () => {
    setChecks((prev) => [
      ...prev,
      {
        id: generateId(),
        order: prev.length + 1,
        name: `步骤 ${prev.length + 1}`,
        description: '',
        command: '',
        expectedNormal: '',
        abnormalSigns: '',
      },
    ]);
  };

  const updateCheck = (id: string, field: keyof SOPCheck, value: string | number) => {
    setChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const removeCheck = (id: string) => {
    setChecks((prev) => prev.filter((c) => c.id !== id));
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    onOk({
      name: values.name,
      category: values.category || '其他',
      description: values.description || '',
      diagnosisHints: values.diagnosisHints || '',
      checks: checks.map((c, i) => ({ ...c, order: i + 1 })),
    });
  };

  const columns = [
    {
      title: '',
      width: 28,
      render: () => (
        <HolderOutlined style={{ color: '#6b7280', cursor: 'grab' }} />
      ),
    },
    {
      title: '步骤名称',
      dataIndex: 'name',
      width: 160,
      render: (v: string, rec: SOPCheck) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateCheck(rec.id, 'name', e.target.value)}
          placeholder="步骤名称"
        />
      ),
    },
    {
      title: '执行命令（支持 ${var} 占位符）',
      dataIndex: 'command',
      render: (v: string, rec: SOPCheck) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateCheck(rec.id, 'command', e.target.value)}
          placeholder="ps aux | grep ${service_name}"
          style={{ fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace', fontSize: 12 }}
        />
      ),
    },
    {
      title: '正常特征',
      dataIndex: 'expectedNormal',
      width: 160,
      render: (v: string, rec: SOPCheck) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateCheck(rec.id, 'expectedNormal', e.target.value)}
          placeholder="输出包含..."
        />
      ),
    },
    {
      title: '异常特征',
      dataIndex: 'abnormalSigns',
      width: 160,
      render: (v: string, rec: SOPCheck) => (
        <Input
          size="small"
          value={v}
          onChange={(e) => updateCheck(rec.id, 'abnormalSigns', e.target.value)}
          placeholder="无输出/Connection refused"
        />
      ),
    },
    {
      title: '',
      width: 36,
      render: (_: unknown, rec: SOPCheck) => (
        <Popconfirm
          title="删除此步骤？"
          onConfirm={() => removeCheck(rec.id)}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <DeleteOutlined style={{ color: '#ef4444', cursor: 'pointer' }} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <Modal
      title={initial ? '编辑 SOP 模板' : '新建 SOP 模板'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={900}
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
            <Input placeholder="例：服务不可用排查" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select
              options={CATEGORY_OPTIONS.map((c) => ({ label: c, value: c }))}
              placeholder="选择故障分类"
            />
          </Form.Item>
        </div>
        <Form.Item name="description" label="场景描述">
          <Input placeholder="适用于哪些故障场景" />
        </Form.Item>
        <Form.Item name="diagnosisHints" label="常见根因提示（Markdown 格式）">
          <TextArea
            rows={3}
            placeholder="**常见根因**&#10;- 进程 OOM 被 kill&#10;- 依赖服务连接耗尽"
          />
        </Form.Item>
      </Form>

      <Space style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
        <Text strong>排查步骤（{checks.length} 步）</Text>
        <Button size="small" icon={<PlusOutlined />} onClick={addCheck} type="dashed">
          添加步骤
        </Button>
      </Space>
      <Table
        dataSource={checks}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
        locale={{ emptyText: '暂无步骤，点击「添加步骤」开始构建排查流程' }}
        scroll={{ x: 800 }}
      />
    </Modal>
  );
};

export default TemplateEditor;
