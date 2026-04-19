import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import React, { useEffect } from 'react';
import type { SessionGroup, SSHSession } from '../store/sshStore';

const { Text } = Typography;

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
        onSave({
          name: values.name,
          tags: values.tags ?? [],
          sessionIds: values.sessionIds ?? [],
          initCommands: (values.initCommands ?? []).map((item: any) => ({
            ...item,
            id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            timeout: item.timeout ?? 15000,
            continueOnFailure: item.continueOnFailure !== false,
          })),
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

        <div style={{ marginBottom: 8 }}>
          <Text strong>组级初始化采集命令</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            连接成功后会在默认采集命令后执行，可用于提取本组专属变量。
          </Text>
        </div>

        <Form.List name="initCommands">
          {(fields, { add, remove }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fields.map((field) => (
                <div
                  key={field.key}
                  style={{
                    border: '1px solid #d9d9d9',
                    borderRadius: 8,
                    padding: 12,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px auto', gap: 8 }}>
                    <Form.Item {...field} name={[field.name, 'name']} label="名称" rules={[{ required: true, message: '请输入名称' }]} style={{ marginBottom: 0 }}>
                      <Input placeholder="例如：获取构建版本" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'timeout']} label="超时(ms)" style={{ marginBottom: 0 }}>
                      <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
                    </Form.Item>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                      <Button danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </div>
                  </div>
                  <Form.Item {...field} name={[field.name, 'command']} label="命令" rules={[{ required: true, message: '请输入命令' }]} style={{ marginBottom: 0 }}>
                    <Input.TextArea rows={2} placeholder="例如：cat /etc/os-release | grep ^VERSION_ID=" />
                  </Form.Item>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Form.Item {...field} name={[field.name, 'captureVar']} label="捕获变量名" style={{ marginBottom: 0 }}>
                      <Input placeholder="例如：os_version" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'capturePattern']} label="提取正则" style={{ marginBottom: 0 }}>
                      <Input placeholder={'例如：VERSION_ID="?([^"]+)"?'} />
                    </Form.Item>
                  </div>
                </div>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({ timeout: 15000, continueOnFailure: true })}
              >
                添加初始化命令
              </Button>
            </div>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
};

export default SessionGroupModal;
