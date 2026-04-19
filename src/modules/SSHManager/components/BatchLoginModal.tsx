import { Form, Input, message, Modal, Select, Switch, Tag, Typography } from 'antd';
import React, { useState } from 'react';
import { useSSHStore } from '../store/sshStore';

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  onSessionsPrepared?: (sessionIds: string[]) => void;
}

function parseHostLine(hostLine: string) {
  const raw = String(hostLine || '').trim();
  if (!raw) return null;

  let host = raw;
  let port = 22;
  const parts = raw.split(':');
  if (parts.length === 2) {
    host = parts[0].trim();
    port = parseInt(parts[1], 10) || 22;
  }

  if (!host) return null;
  return {
    host,
    port,
    dedupeKey: `${host.toLowerCase()}:${port}`,
  };
}

const BatchLoginModal: React.FC<Props> = ({ open, onCancel, onSuccess, onSessionsPrepared }) => {
  const { credentials, addProfile, addSession, connectSession, profiles, sessions } = useSSHStore();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [joinCurrentTargets, setJoinCurrentTargets] = useState(true);

  const handleBatchLogin = async () => {
    try {
      const values = await form.validateFields();
      const ipListRaw = values.ipList as string;
      const credId = values.credentialId as string;

      const seenTargets = new Set<string>();
      let duplicateCount = 0;
      const targets = ipListRaw
        .split('\n')
        .map((line) => parseHostLine(line))
        .filter((item): item is NonNullable<ReturnType<typeof parseHostLine>> => Boolean(item))
        .filter((item) => {
          if (seenTargets.has(item.dedupeKey)) {
            duplicateCount += 1;
            return false;
          }
          seenTargets.add(item.dedupeKey);
          return true;
        });

      if (targets.length === 0) {
        message.warning('请提供有效的 IP 列表');
        return;
      }

      setLoading(true);

      let launchedCount = 0;
      let reusedCount = 0;
      let reconnectedCount = 0;
      const preparedSessionIds: string[] = [];

      for (const target of targets) {
        const { host, port } = target;
        let profileId = profiles.find((item) => item.host === host && item.port === port)?.id;

        if (!profileId) {
          profileId = addProfile({
            name: `批量节点 ${host}`,
            host,
            port,
            credentialId: credId,
          });
        }

        const activeSession = sessions.find((item) =>
          item.profileId === profileId && (item.status === 'connected' || item.status === 'connecting')
        );
        if (activeSession) {
          preparedSessionIds.push(activeSession.id);
          reusedCount += 1;
          continue;
        }

        const reconnectableSession = sessions.find((item) =>
          item.profileId === profileId && (item.status === 'idle' || item.status === 'disconnected' || item.status === 'error')
        );
        if (reconnectableSession) {
          connectSession(reconnectableSession.id, { credentialId: credId });
          preparedSessionIds.push(reconnectableSession.id);
          launchedCount += 1;
          reconnectedCount += 1;
          continue;
        }

        const sessionId = addSession(`${host}:${port}`, profileId);
        connectSession(sessionId, { credentialId: credId });
        preparedSessionIds.push(sessionId);
        launchedCount += 1;
      }

      const uniquePreparedSessionIds = Array.from(new Set(preparedSessionIds));
      if (joinCurrentTargets && uniquePreparedSessionIds.length > 0) {
        onSessionsPrepared?.(uniquePreparedSessionIds);
      }

      const messageParts = [`发起 ${launchedCount} 个节点连接`];
      if (reconnectedCount > 0) messageParts.push(`复用断开会话 ${reconnectedCount} 个`);
      if (reusedCount > 0) messageParts.push(`沿用活跃会话 ${reusedCount} 个`);
      if (duplicateCount > 0) messageParts.push(`去重 ${duplicateCount} 行`);
      if (joinCurrentTargets && uniquePreparedSessionIds.length > 0) messageParts.push('已加入当前排查目标');
      message.success(messageParts.join('，'));
      form.resetFields();
      onSuccess();
    } catch {
      // validation errors are surfaced by the form itself
    } finally {
      setLoading(false);
    }
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
          请粘贴一行一个的主机地址（支持IP、域名，可带端口号比如 `192.168.1.1:2222`）。重复节点会自动去重，已在线会话会优先复用。
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <Text style={{ fontSize: 12, display: 'block' }}>登录后加入当前排查目标</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              让新建或复用的会话直接进入当前多节点排查选择集。
            </Text>
          </div>
          <Switch checked={joinCurrentTargets} onChange={setJoinCurrentTargets} />
        </div>
      </Form>
    </Modal>
  );
};

export default BatchLoginModal;
