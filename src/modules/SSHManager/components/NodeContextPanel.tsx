import { DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, List, message, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import React from 'react';
import type { NodeConnectionContext, SSHSession } from '../store/sshStore';
import { useSSHStore } from '../store/sshStore';
import { SHELL_VAR_NAME_PATTERN } from '../shellVars';

const { Text } = Typography;

interface Props {
  activeSession: SSHSession | null;
  context: NodeConnectionContext | null;
  isDark: boolean;
}

const statusColorMap: Record<NonNullable<NodeConnectionContext['bootstrapStatus']>, string> = {
  idle: 'default',
  running: 'processing',
  success: 'success',
  partial: 'warning',
  failed: 'error',
};

const NodeContextPanel: React.FC<Props> = ({ activeSession, context, isDark }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);
  const { captureContextCommand, clearNodeContext, removeContextEntry } = useSSHStore();
  const [messageApi, contextHolder] = message.useMessage();

  const handleCapture = async () => {
    if (!activeSession) return;
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setLoading(true);
    try {
      const result = await captureContextCommand(activeSession.id, {
        source: 'manual',
        name: values.name || values.command,
        command: values.command,
        captureVar: values.captureVar || undefined,
        capturePattern: values.capturePattern || undefined,
        timeout: 20000,
        continueOnFailure: true,
      });
      if (result.exitCode === 0) {
        messageApi.success('上下文采集完成');
      } else {
        messageApi.warning('命令已采集，但执行返回非零退出码');
      }
      form.resetFields();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      size="small"
      title="节点连接上下文"
      extra={
        activeSession && context ? (
          <Popconfirm
            title="清空当前连接上下文？"
            onConfirm={() => clearNodeContext(activeSession.id)}
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger>清空</Button>
          </Popconfirm>
        ) : null
      }
      style={{
        background: isDark ? '#252526' : '#ffffff',
        border: `1px solid ${isDark ? '#3e3e42' : '#e4e4e7'}`,
      }}
    >
      {contextHolder}
      {!activeSession ? (
        <Text type="secondary" style={{ fontSize: 12 }}>请先选择一个会话。</Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Space wrap size={6}>
              <Text strong style={{ fontSize: 12 }}>{activeSession.name}</Text>
              <Tag color={statusColorMap[context?.bootstrapStatus ?? 'idle']}>
                Bootstrap: {context?.bootstrapStatus ?? 'idle'}
              </Tag>
              {context?.bootstrapError && (
                <Tooltip title={context.bootstrapError}>
                  <Tag color="error">初始化异常</Tag>
                </Tooltip>
              )}
            </Space>
          </div>

          <Alert
            type="info"
            showIcon={false}
            style={{ padding: '8px 10px' }}
            title={
              <div>
                <Text strong style={{ fontSize: 12 }}>手动采集到上下文</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                  可只保存输出，也可填写变量名 + 正则，把结果提取为当前连接可复用变量，并自动 export 到当前 SSH shell。
                </Text>
              </div>
            }
          />

          <Form form={form} layout="vertical">
            <Form.Item name="command" label="命令" rules={[{ required: true, message: '请输入命令' }]} style={{ marginBottom: 8 }}>
              <Input.TextArea rows={2} placeholder="例如：cat /etc/os-release" />
            </Form.Item>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Form.Item name="name" label="记录名称" style={{ marginBottom: 8 }}>
                <Input placeholder="例如：读取 OS 版本" />
              </Form.Item>
              <Form.Item
                name="captureVar"
                label="变量名 / Shell 变量"
                rules={[{
                  validator: (_: unknown, value?: string) => {
                    if (!value || SHELL_VAR_NAME_PATTERN.test(value)) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('变量名需符合 Shell 变量命名规范：字母或下划线开头，只能包含字母、数字、下划线'));
                  },
                }]}
                style={{ marginBottom: 8 }}
              >
                <Input placeholder="例如：os_version" />
              </Form.Item>
            </div>
            <Form.Item name="capturePattern" label="提取正则 (可选)" style={{ marginBottom: 8 }}>
              <Input placeholder={'例如：VERSION_ID="?([^"]+)"?'} />
            </Form.Item>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={loading}
              disabled={activeSession.status !== 'connected'}
              onClick={handleCapture}
            >
              执行并采集
            </Button>
          </Form>

          <div>
            <Text strong style={{ fontSize: 12 }}>当前变量</Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
              这些变量已经同步到当前 SSH 会话，可直接在终端中用 `$变量名` 继续排查。
            </Text>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {context && Object.keys(context.vars).length > 0 ? (
                Object.entries(context.vars).map(([key, value]) => (
                  <Tooltip key={key} title={value}>
                    <Tag color="blue" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {key}={value}
                    </Tag>
                  </Tooltip>
                ))
              ) : (
                <Text type="secondary" style={{ fontSize: 11 }}>当前连接还没有采集到变量。</Text>
              )}
            </div>
          </div>

          <div>
            <Text strong style={{ fontSize: 12 }}>最近采集记录</Text>
            <List
              size="small"
              dataSource={[...(context?.entries ?? [])].sort((a, b) => b.timestamp - a.timestamp)}
              locale={{ emptyText: '暂无上下文采集记录' }}
              renderItem={(entry) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="delete"
                      title="删除这条采集记录？"
                      onConfirm={() => activeSession && removeContextEntry(activeSession.id, entry.id)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space wrap size={6}>
                        <Text strong style={{ fontSize: 12 }}>{entry.name}</Text>
                        <Tag color={entry.source === 'init' ? 'purple' : 'cyan'}>{entry.source}</Tag>
                        <Tag color={entry.exitCode === 0 ? 'success' : 'error'}>exit {entry.exitCode}</Tag>
                      </Space>
                    }
                    description={
                      <div style={{ fontSize: 11 }}>
                        <div style={{ fontFamily: 'monospace', marginBottom: 2 }}>{entry.command}</div>
                        {Object.keys(entry.extractedVars).length > 0 && (
                          <div style={{ marginBottom: 2 }}>
                            {Object.entries(entry.extractedVars).map(([key, value]) => (
                              <Tag key={key} color="blue">{key}={value}</Tag>
                            ))}
                          </div>
                        )}
                        {(entry.stdout || entry.stderr) && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {(entry.stdout || entry.stderr).slice(0, 140)}
                            {(entry.stdout || entry.stderr).length > 140 ? '…' : ''}
                          </Text>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        </div>
      )}
    </Card>
  );
};

export default NodeContextPanel;
