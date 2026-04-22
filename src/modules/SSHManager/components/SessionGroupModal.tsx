import { Form, Input, Modal, Select } from 'antd';
import React, { useEffect } from 'react';
import type { InitCommandTemplate, SessionGroup, SSHSession } from '../store/sshStore';
import InitCommandListEditor from './InitCommandListEditor';

interface Props {
  open: boolean;
  sessions: SSHSession[];
  initialValue?: SessionGroup | null;
  onCancel: () => void;
  onSave: (values: Omit<SessionGroup, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

const SessionGroupModal: React.FC<Props> = ({ open, sessions, initialValue, onCancel, onSave }) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (initialValue) {
        form.setFieldsValue({
          name: initialValue.name,
          tags: initialValue.tags,
          sessionIds: initialValue.sessionIds,
          initCommands: initialValue.initCommands,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          tags: [],
          sessionIds: [],
          initCommands: [],
        });
      }
    });
  }, [open, initialValue, form]);

  return (
    <Modal
      open={open}
      title={initialValue ? '编辑会话组' : '新建会话组'}
      width={760}
      onCancel={onCancel}
      onOk={async () => {
        const values = await form.validateFields();
        const initCommands = ((values.initCommands ?? []) as Array<Partial<InitCommandTemplate> & { id?: string }>).map((item) => ({
          ...item,
          id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          name: String(item.name ?? ''),
          command: String(item.command ?? ''),
          timeout: item.timeout ?? 15000,
          continueOnFailure: item.continueOnFailure !== false,
        }));
        onSave({
          name: values.name,
          tags: values.tags ?? [],
          sessionIds: values.sessionIds ?? [],
          initCommands,
        });
      }}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="name" label="组名" rules={[{ required: true, message: '请输入组名' }]}>
          <Input placeholder="例如：回归测试-夜跑集群" />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select mode="tags" placeholder="输入标签后回车" />
        </Form.Item>
        <Form.Item name="sessionIds" label="成员会话">
          <Select
            mode="multiple"
            placeholder="选择要归入此组的会话"
            options={sessions.map((session) => ({ label: session.name, value: session.id }))}
          />
        </Form.Item>
        <InitCommandListEditor
          fieldName="initCommands"
          title="组级初始化采集命令"
          description="连接成功后会在默认采集命令后执行，可用于追加本组专属变量、节点标签或业务上下文。"
        />
      </Form>
    </Modal>
  );
};

export default SessionGroupModal;
