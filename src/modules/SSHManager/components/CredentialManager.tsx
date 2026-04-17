import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Popconfirm, Segmented, Space, Table, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import type { SSHCredential } from '../store/sshStore';
import { useSSHStore } from '../store/sshStore';

const { Text } = Typography;

const CredentialManager: React.FC<{ open: boolean; onCancel: () => void }> = ({ open, onCancel }) => {
  const { credentials, addCredential, updateCredential, deleteCredential } = useSSHStore();
  
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [authType, setAuthType] = useState<'password' | 'privateKey' | 'agent'>('password');

  useEffect(() => {
    if (!open) {
      setShowEditor(false);
    }
  }, [open]);

  const handleEdit = (cred?: SSHCredential) => {
    setEditingId(cred?.id ?? null);
    setShowEditor(true);
    if (cred) {
      form.setFieldsValue(cred);
      setAuthType(cred.authType);
    } else {
      form.resetFields();
      setAuthType('password');
      form.setFieldValue('authType', 'password');
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        name: values.name,
        username: values.username,
        authType: values.authType,
        password: values.password,
        keyFilePath: values.keyFilePath,
      };
      
      if (editingId) {
        updateCredential(editingId, payload);
      } else {
        addCredential(payload);
      }
      setShowEditor(false);
    } catch {}
  };

  return (
    <Modal
      title="登录凭证管理"
      open={open}
      onCancel={onCancel}
      footer={showEditor ? [
        <Button key="cancel" onClick={() => setShowEditor(false)}>取消</Button>,
        <Button key="save" type="primary" onClick={handleSave}>保存选项</Button>
      ] : null}
      width={700}
    >
      {showEditor ? (
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="凭证名称 (便于识别)" rules={[{ required: true }]}>
             <Input placeholder="例如: 生产环境统一密钥" />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
             <Input placeholder="root" />
          </Form.Item>
          <Form.Item name="authType" label="认证方式">
            <Segmented
              value={authType}
              onChange={(v) => { setAuthType(v as typeof authType); form.setFieldValue('authType', v); }}
              options={[
                { label: '密码', value: 'password' },
                { label: '私钥', value: 'privateKey' },
                { label: 'SSH Agent', value: 'agent' },
              ]}
            />
          </Form.Item>
          {authType === 'password' && (
            <Form.Item name="password" label="密码">
              <Input.Password placeholder="输入连接密码" />
            </Form.Item>
          )}
          {authType === 'privateKey' && (
            <>
              <Form.Item name="keyFilePath" label="私钥路径" rules={[{ required: true }]}>
                <Input prefix={<KeyOutlined />} placeholder="~/.ssh/id_rsa" />
              </Form.Item>
              <Form.Item name="password" label="Passphrase (如果有)">
                <Input.Password placeholder="私钥的解锁密码" />
              </Form.Item>
            </>
          )}
        </Form>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
             <Button type="primary" icon={<PlusOutlined />} onClick={() => handleEdit()}>新建凭证</Button>
          </div>
          <Table
            dataSource={credentials}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 5 }}
            columns={[
              { title: '名称', dataIndex: 'name', key: 'name', render: (t) => <Text strong>{t}</Text> },
              { title: '用户名', dataIndex: 'username', key: 'username' },
              { title: '类型', dataIndex: 'authType', key: 'authType', render: (t) => <Tag color={t === 'privateKey' ? 'blue' : 'green'}>{t}</Tag> },
              {
                title: '操作',
                key: 'action',
                width: 100,
                render: (_, record) => (
                  <Space>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
                    <Popconfirm title="确定删除？" onConfirm={() => deleteCredential(record.id)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )
              }
            ]}
          />
        </div>
      )}
    </Modal>
  );
};

export default CredentialManager;
