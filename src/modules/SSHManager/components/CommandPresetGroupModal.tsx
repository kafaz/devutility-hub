import { Form, Input, Modal, Select } from 'antd';
import React, { useEffect } from 'react';
import type { CommandPresetGroup, InitCommandTemplate } from '../store/sshStore';
import InitCommandListEditor from './InitCommandListEditor';

interface Props {
  open: boolean;
  initialValue?: CommandPresetGroup | null;
  onCancel: () => void;
  onSave: (values: Omit<CommandPresetGroup, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

const CommandPresetGroupModal: React.FC<Props> = ({ open, initialValue, onCancel, onSave }) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (initialValue) {
        form.setFieldsValue({
          name: initialValue.name,
          description: initialValue.description,
          tags: initialValue.tags,
          commands: initialValue.commands,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          tags: [],
          commands: [],
        });
      }
    });
  }, [form, initialValue, open]);

  return (
    <Modal
      open={open}
      title={initialValue ? '编辑预设命令组' : '新建预设命令组'}
      width={820}
      onCancel={onCancel}
      onOk={async () => {
        const values = await form.validateFields();
        const commands = ((values.commands ?? []) as Array<Partial<InitCommandTemplate> & { id?: string }>).map((item) => ({
          ...item,
          id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          name: String(item.name ?? ''),
          command: String(item.command ?? ''),
          timeout: item.timeout ?? 15000,
          continueOnFailure: item.continueOnFailure !== false,
        }));
        onSave({
          name: values.name,
          description: values.description,
          tags: values.tags ?? [],
          commands,
        });
      }}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="name" label="命令组名称" rules={[{ required: true, message: '请输入命令组名称' }]}>
          <Input placeholder="例如：K8s 节点登录预热" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="说明这组命令在连接后会补齐哪些上下文或环境变量" />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select mode="tags" placeholder="输入标签后回车，例如 k8s / build / database" />
        </Form.Item>

        <InitCommandListEditor
          fieldName="commands"
          title="预设命令列表"
          description="连接建立后会按绑定顺序执行，适合做环境探测、路径解析、版本读取、快捷变量注入。"
          addLabel="添加预设命令"
        />
      </Form>
    </Modal>
  );
};

export default CommandPresetGroupModal;
