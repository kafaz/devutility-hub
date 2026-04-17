import { Form, Input, message, Modal, Select, Tag, Typography } from 'antd';
import React, { useState } from 'react';
import { useSSHStore } from '../store/sshStore';

const { TextArea } = Input;
const { Text } = Typography;

const BatchLoginModal: React.FC<{ open: boolean; onCancel: () => void; onSuccess: () => void }> = ({ open, onCancel, onSuccess }) => {
  const { credentials, addProfile, addSession, connectSession, profiles } = useSSHStore();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleBatchLogin = async () => {
    try {
      const values = await form.validateFields();
      const ipListRaw = values.ipList as string;
      const credId = values.credentialId as string;
      
      const ips = ipListRaw.split('\n').map(l => l.trim()).filter(l => l);
      if (ips.length === 0) {
        message.warning('请提供有效的 IP 列表');
        return;
      }

      setLoading(true);

      // Create profiles & sessions for all target IPs
      let successCount = 0;
      for (const hostStr of ips) {
        let host = hostStr;
        let port = 22;
        if (hostStr.includes(':')) {
           const parts = hostStr.split(':');
           host = parts[0];
           port = parseInt(parts[1], 10) || 22;
        }

        // Try to reuse an existing profile if it exactly matches host and port
        let profileId = profiles.find(p => p.host === host && p.port === port)?.id;

        // If no matching profile exists, create a quick profile
        if (!profileId) {
           profileId = addProfile({
             name: `批量节点 ${host}`,
             host,
             port,
             credentialId: credId,
           });
        }
        
        // Spawn a new session for this run
        const sessId = addSession(`${host}:${port}`, profileId);
        
        // Connect! (Passing the specified credential to override defaults if any)
        connectSession(sessId, { credentialId: credId });
        successCount++;
      }

      setLoading(false);
      message.success(`成功发起 ${successCount} 个节点的连接`);
      form.resetFields();
      onSuccess();
    } catch {}
  };

  return (
    <Modal
      title="批量快捷登录"
      open={open}
      onCancel={onCancel}
      confirmLoading={loading}
      onOk={handleBatchLogin}
      okText="批量连接"
      cancelText="取消"
    >
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          请粘贴一行一个的主机地址（支持IP、域名，可带端口号比如 `192.168.1.1:2222`）。
        </Text>
      </div>
      <Form form={form} layout="vertical">
        <Form.Item name="ipList" label="节点列表" rules={[{ required: true, message: '请粘贴 IP 列表' }]}>
          <TextArea rows={6} placeholder={`192.168.1.101\n192.168.1.102:2222\nnode3.internal`} style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Form.Item name="credentialId" label="绑定登录凭证" rules={[{ required: true, message: '请选择或创建登录凭证' }]}>
          <Select placeholder="选择使用的统一登录方式">
            {credentials.map(c => (
              <Select.Option key={c.id} value={c.id}>
                {c.name} ({c.username}) <Tag color={c.authType === 'privateKey' ? 'blue' : 'green'} style={{ float: 'right', fontSize: 10 }}>{c.authType}</Tag>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default BatchLoginModal;
