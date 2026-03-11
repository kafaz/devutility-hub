import { Divider, Form, Input, Modal, Select, Space, Switch, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import type { CronJob } from '../../../types';
import { useSOPStore } from '../../SOPBuilder/store/sopStore';
import { useCronStore } from '../store/cronStore';
import { useSSHStore } from '../store/sshStore';

const { Text } = Typography;

interface Props {
  open: boolean;
  initialValue: CronJob | null | undefined;
  onCancel: () => void;
  onSave: () => void;
}

const CRON_PRESETS = [
  { label: '每分钟 (* * * * *)', value: '* * * * *' },
  { label: '每小时初 (0 * * * *)', value: '0 * * * *' },
  { label: '每天凌晨 2 点 (0 2 * * *)', value: '0 2 * * *' },
];

const CronJobEditor: React.FC<Props> = ({ open, initialValue, onCancel, onSave }) => {
  const [form] = Form.useForm();
  const { addJob, updateJob } = useCronStore();
  const { profiles, sessions } = useSSHStore();
  const { templates } = useSOPStore();
  const [execMode, setExecMode] = useState<'broadcast' | 'targeted'>('broadcast');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      // Use queueMicrotask to avoid cascading renders while preserving functionality
      queueMicrotask(() => {
        if (initialValue) {
          form.setFieldsValue(initialValue);
          setExecMode(initialValue.execMode);
          setSelectedTemplateId(initialValue.broadcastTemplateId);
        } else {
          form.resetFields();
          form.setFieldsValue({
            enabled: true,
            cronExpr: '* * * * *',
            targetGroupIds: [],
            targetSessions: [],
            execMode: 'broadcast',
          });
          setExecMode('broadcast');
          setSelectedTemplateId(undefined);
        }
      });
    }
  }, [open, initialValue, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (initialValue && initialValue.id) {
        updateJob(initialValue.id, values);
      } else {
        addJob(values);
      }
      onSave();
    } catch {
      // Validating failed
    }
  };
  // 计算组信息 (前端动态计算)
  const localGroupsMap = new Map<string, { id: string; name: string; children: string[] }>();
  profiles.forEach(p => {
    const parts = p.name.split('-');
    const groupName = parts.length > 1 ? parts[0] : '其他';
    const groupId = `group-${groupName}`;
    if (!localGroupsMap.has(groupId)) {
      localGroupsMap.set(groupId, { id: groupId, name: groupName, children: [] });
    }
  });
  sessions.forEach(sess => {
    const p = profiles.find(x => x.id === sess.profileId);
    if (p) {
      const parts = p.name.split('-');
      const groupName = parts.length > 1 ? parts[0] : '其他';
      const groupId = `group-${groupName}`;
      localGroupsMap.get(groupId)?.children.push(sess.id);
    }
  });
  const localGroups = Array.from(localGroupsMap.values());

  // 构造目标选择器选项
  const groupOptions = localGroups.map((g) => ({ label: g.name, value: g.id }));
  const sessionOptions = localGroups.flatMap((g) =>
    g.children.map((sid: string) => {
      const s = sessions.find((x) => x.id === sid);
      return { label: `[${g.name}] ${s?.name || sid}`, value: sid };
    })
  );

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const templateVars = selectedTemplate?.variables || [];

  return (
    <Modal
      open={open}
      title={initialValue ? '编辑定时任务' : '新建定时任务'}
      onCancel={onCancel}
      onOk={handleOk}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="例：每日巡检" />
          </Form.Item>
          <Form.Item name="enabled" label="是否启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>

        <Form.Item
          name="cronExpr"
          label={
            <Space>
              <span>Cron 表达式</span>
              <Text type="secondary" style={{ fontSize: 12 }}>分 时 日 月 周</Text>
            </Space>
          }
          rules={[{ required: true, message: '请输入 Cron 表达式' }]}
        >
          <Select
            mode="tags"
            maxCount={1}
            style={{ width: '100%' }}
            placeholder="输入如 * * * * * 或选择预设"
            options={CRON_PRESETS}
          />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }} />

        <Text strong style={{ display: 'block', marginBottom: 12 }}>执行目标</Text>
        <Form.Item name="targetGroupIds" label="目标会话组">
          <Select mode="multiple" placeholder="选择会话组此组内的所有会话都将执行" options={groupOptions} />
        </Form.Item>
        <Form.Item name="targetSessions" label="特定会话（独立选择）">
          <Select mode="multiple" placeholder="独立选择具体的会话" options={sessionOptions} />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text strong>执行策略</Text>
        </div>
        <Form.Item name="execMode" label="模式">
          <Select
            options={[
              { label: '广播模式（所有选中目标运行同一 SOP）', value: 'broadcast' },
              { label: '定向模式（为每个目标单独指定 SOP，尚未在UI完全实现配置）', value: 'targeted', disabled: true }, // Temporarily disabled complex config
            ]}
            onChange={(val) => setExecMode(val)}
          />
        </Form.Item>

        {execMode === 'broadcast' && (
          <div style={{ marginTop: 12 }}>
            <Form.Item name="broadcastTemplateId" label="选择要执行的 SOP">
              <Select
                placeholder="请选择 SOP 模板"
                onChange={(val) => {
                  setSelectedTemplateId(val);
                  form.setFieldValue('broadcastVars', {});
                }}
                options={templates.map((t) => ({ label: t.name, value: t.id }))}
              />
            </Form.Item>

            {templateVars.length > 0 && (
              <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, marginBottom: 16 }}>
                <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>SOP 变量配置</Text>
                {templateVars.map((v) => (
                  <Form.Item
                    key={v.name}
                    name={['broadcastVars', v.name]}
                    label={`${v.label} (${v.name})`}
                    rules={v.required ? [{ required: true, message: `请输入 ${v.label}` }] : []}
                    style={{ marginBottom: 12 }}
                  >
                    {v.type === 'select' ? (
                      <Select options={(v.options || []).map(o => ({ label: o, value: o }))} />
                    ) : (
                      <Input type={v.type === 'number' ? 'number' : 'text'} placeholder={v.placeholder || `输入 ${v.label}`} />
                    )}
                  </Form.Item>
                ))}
              </div>
            )}
          </div>
        )}

      </Form>
    </Modal>
  );
};

export default CronJobEditor;
