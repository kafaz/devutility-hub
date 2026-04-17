import { Input, Modal, Form, Select, InputNumber, Switch } from 'antd';
import React from 'react';
import { generateId } from '../../../utils';
import type { BusinessStep } from '../types';

const { TextArea } = Input;

interface Props {
  open: boolean;
  initial?: BusinessStep;
  onOk: (step: BusinessStep) => void;
  onCancel: () => void;
}

const BusinessStepModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue(initial ?? {
        name: '', cmd: '', target: 'all', timeout: 30000, blocking: true,
      });
    }
  }, [open, initial, form]);

  const handleOk = () => {
    form.validateFields().then((vals) => {
      onOk({
        id: initial?.id ?? generateId(),
        name: vals.name,
        cmd: vals.cmd,
        target: vals.target,
        timeout: vals.timeout,
        captureVar: vals.captureName ? { name: vals.captureName, pattern: vals.capturePattern } : undefined,
        blocking: vals.blocking,
      });
      form.resetFields();
    });
  };

  return (
    <Modal
      title={initial ? '编辑步骤' : '添加步骤'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={640}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="步骤名称" name="name" rules={[{ required: true }]}>
          <Input placeholder="如：创建 RBD 卷" />
        </Form.Item>
        <Form.Item label="命令模板" name="cmd" rules={[{ required: true }]}>
          <TextArea rows={3} placeholder="支持 {{var}}、$capture.x、$node.name / $node.ip" />
        </Form.Item>
        <Form.Item label="目标节点" name="target" rules={[{ required: true }]}>
          <Select
            mode="tags"
            placeholder="输入节点ID，或选择 all"
            options={[{ label: '所有选中节点 (all)', value: 'all' }]}
          />
        </Form.Item>
        <Form.Item label="超时 (ms)" name="timeout" initialValue={30000}>
          <InputNumber style={{ width: '100%' }} min={1000} step={1000} />
        </Form.Item>
        <Form.Item label="阻塞执行" name="blocking" valuePropName="checked" initialValue={true}>
          <Switch checkedChildren="是" unCheckedChildren="否" />
        </Form.Item>
        <Form.Item label="捕获变量名 (可选)" name="captureName">
          <Input placeholder="如 volume_id" />
        </Form.Item>
        <Form.Item label="捕获正则 (可选)" name="capturePattern">
          <Input placeholder="如 volume_id: (.+)" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default BusinessStepModal;
