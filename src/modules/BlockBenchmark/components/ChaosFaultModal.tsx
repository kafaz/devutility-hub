import { Input, Modal, Form, InputNumber, Select } from 'antd';
import React from 'react';
import type { ChaosFault } from '../types';

const { TextArea } = Input;

interface Props {
  open: boolean;
  initial?: ChaosFault;
  onOk: (fault: Omit<ChaosFault, 'id'>) => void;
  onCancel: () => void;
}

const CATEGORIES = [
  { label: '网络', value: 'network' },
  { label: '磁盘', value: 'disk' },
  { label: 'CPU', value: 'cpu' },
  { label: '内存', value: 'memory' },
  { label: '进程', value: 'process' },
  { label: '自定义', value: 'custom' },
];

const ChaosFaultModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue(initial ?? { category: 'custom', defaultDurationSec: 60 });
    }
  }, [open, initial, form]);

  const handleOk = () => {
    form.validateFields().then((vals) => {
      onOk({
        name: vals.name,
        category: vals.category,
        description: vals.description,
        cmdTemplate: vals.cmdTemplate,
        params: vals.params ?? [],
        recoveryCmdTemplate: vals.recoveryCmdTemplate || undefined,
        defaultDurationSec: vals.defaultDurationSec,
        isBuiltin: false,
      });
      form.resetFields();
    });
  };

  return (
    <Modal title={initial ? '编辑故障' : '自定义故障'} open={open} onOk={handleOk} onCancel={onCancel} width={640}>
      <Form form={form} layout="vertical">
        <Form.Item label="名称" name="name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="类别" name="category" rules={[{ required: true }]}>
          <Select options={CATEGORIES} />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <TextArea rows={2} />
        </Form.Item>
        <Form.Item label="注入命令模板" name="cmdTemplate" rules={[{ required: true }]}>
          <TextArea rows={2} placeholder="支持 {{param}} 变量替换" />
        </Form.Item>
        <Form.Item label="恢复命令模板" name="recoveryCmdTemplate">
          <TextArea rows={2} placeholder="可选，支持 {{param}} 变量替换" />
        </Form.Item>
        <Form.Item label="默认持续时间(秒)" name="defaultDurationSec" initialValue={60}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ChaosFaultModal;
