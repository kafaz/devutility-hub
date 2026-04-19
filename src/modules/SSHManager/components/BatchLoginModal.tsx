import { Form, Input, message, Modal, Select, Switch, Tag, Typography } from 'antd';
import React, { useState } from 'react';
import { renderTemplate } from '../../../utils';
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
  const {
    credentials,
    addProfile,
    addSession,
    connectSession,
    profiles,
    sessions,
    sessionGroups,
    createSessionGroup,
    assignSessionsToGroup,
  } = useSSHStore();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [joinCurrentTargets, setJoinCurrentTargets] = useState(true);
  const groupMode = Form.useWatch('groupMode', form) as 'none' | 'existing' | 'new' | undefined;

  const handleBatchLogin = async () => {
    try {
      const values = await form.validateFields();
      const ipListRaw = values.ipList as string;
      const credId = values.credentialId as string;
      const groupMode = values.groupMode as 'none' | 'existing' | 'new';
      const groupIdValue = values.groupId as string | undefined;
      const groupName = values.groupName as string | undefined;
      const groupTags = (values.groupTags as string[] | undefined) ?? [];
      const sessionNamePattern = (values.sessionNamePattern as string | undefined)?.trim() || '${host}:${port}';

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
      let targetGroupId: string | null = null;
      if (groupMode === 'existing' && groupIdValue) {
        targetGroupId = groupIdValue;
      } else if (groupMode === 'new' && groupName) {
        targetGroupId = createSessionGroup({
          name: groupName,
          tags: groupTags,
          sessionIds: [],
          initCommands: [],
        });
      }

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

        const sessionName = renderTemplate(sessionNamePattern, {
          host,
          port: String(port),
          index: String(preparedSessionIds.length + 1),
        });
        const sessionId = addSession(sessionName || `${host}:${port}`, profileId);
        connectSession(sessionId, { credentialId: credId });
        preparedSessionIds.push(sessionId);
        launchedCount += 1;
      }

      const uniquePreparedSessionIds = Array.from(new Set(preparedSessionIds));
      if (targetGroupId && uniquePreparedSessionIds.length > 0) {
        const existing = sessionGroups.find((group) => group.id === targetGroupId)?.sessionIds ?? [];
        assignSessionsToGroup(targetGroupId, Array.from(new Set([...existing, ...uniquePreparedSessionIds])));
      }
      if (joinCurrentTargets && uniquePreparedSessionIds.length > 0) {
        onSessionsPrepared?.(uniquePreparedSessionIds);
      }

      const messageParts = [`发起 ${launchedCount} 个节点连接`];
      if (reconnectedCount > 0) messageParts.push(`复用断开会话 ${reconnectedCount} 个`);
      if (reusedCount > 0) messageParts.push(`沿用活跃会话 ${reusedCount} 个`);
      if (duplicateCount > 0) messageParts.push(`去重 ${duplicateCount} 行`);
      if (targetGroupId) messageParts.push('已加入会话组');
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
        <Form.Item
          name="sessionNamePattern"
          label="会话命名模板"
          initialValue="${host}:${port}"
          extra={<Text type="secondary" style={{ fontSize: 12 }}>支持变量：`${'{host}'}`、`${'{port}'}`、`${'{index}'}`</Text>}
        >
          <Input placeholder="${host}:${port}" />
        </Form.Item>
        <Form.Item name="groupMode" label="加入会话组" initialValue="new">
          <Select
            options={[
              { label: '创建新组', value: 'new' },
              { label: '加入已有组', value: 'existing' },
              { label: '不分组', value: 'none' },
            ]}
          />
        </Form.Item>
        {groupMode === 'existing' && (
          <Form.Item name="groupId" label="目标会话组" rules={[{ required: true, message: '请选择会话组' }]}>
            <Select placeholder="选择已有会话组" options={sessionGroups.map((group) => ({ label: group.name, value: group.id }))} />
          </Form.Item>
        )}
        {groupMode === 'new' && (
          <>
            <Form.Item name="groupName" label="新组名称" rules={[{ required: true, message: '请输入组名' }]}>
              <Input placeholder="例如：回归测试-第一批" />
            </Form.Item>
            <Form.Item name="groupTags" label="组标签">
              <Select mode="tags" placeholder="输入标签后回车，例如 smoke / perf / nightly" />
            </Form.Item>
          </>
        )}
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
