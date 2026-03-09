/**
 * TaskEditor — 定时任务新增/编辑弹窗
 *
 * 表单结构：
 *   1. 基础信息：名称、描述、Cron 表达式（含实时预览 + 常用预设）
 *   2. 执行模式：broadcast（同一模板）/ targeted（每节点独立模板）
 *   3. Broadcast 模式：选择模板 + 会话（多选）+ 模板变量填写
 *   4. Targeted 模式：每个会话行独立选择模板 + 填写变量
 *
 * 与外部交互：
 *   - useSOPStore.templates    ← 模板列表
 *   - useSSHStore.sessions     ← 会话列表
 *   - validateCronExpr         ← cron 合法性校验
 *   - getCronDescription       ← cron 人类可读描述
 *   - getNextCronRun           ← 下次执行时间预览
 *   - extractTemplateVars      ← 从模板提取变量占位符
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, Form, Input, Select, Switch, Divider, Button, Tag,
  Table, Space, Tooltip, Radio, Typography, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import type { SOPScheduledTask, SOPScheduleNodeAssignment } from '../../../types';
import { useSOPStore }  from '../../SOPBuilder/store/sopStore';
import { useSSHStore }  from '../../SSHManager/store/sshStore';
import {
  validateCronExpr, getCronDescription, getNextCronRun, extractTemplateVars,
} from '../../../utils';

const { Text } = Typography;

// ─── 常用 Cron 预设 ──────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: '每分钟',    value: '* * * * *' },
  { label: '每5分钟',   value: '*/5 * * * *' },
  { label: '每10分钟',  value: '*/10 * * * *' },
  { label: '每30分钟',  value: '*/30 * * * *' },
  { label: '每小时',    value: '0 * * * *' },
  { label: '每天00:00', value: '0 0 * * *' },
  { label: '每天08:00', value: '0 8 * * *' },
  { label: '每周一00:00', value: '0 0 * * 1' },
  { label: '每月1日',   value: '0 0 1 * *' },
];

// ─── 变量编辑器（key-value 行） ───────────────────────────────────────────────

interface VarEditorProps {
  vars:     Record<string, string>;
  hints?:   string[];  // 从模板中提取的变量名提示
  onChange: (v: Record<string, string>) => void;
}

const VarEditor: React.FC<VarEditorProps> = ({ vars, hints = [], onChange }) => {
  const entries = Object.entries(vars);
  const unusedHints = hints.filter((h) => !(h in vars));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 6 }}>
          <Input
            size="small"
            value={k}
            placeholder="变量名"
            style={{ width: 130 }}
            onChange={(e) => {
              const next: Record<string, string> = {};
              entries.forEach(([ek, ev]) => { next[ek === k ? e.target.value : ek] = ev; });
              onChange(next);
            }}
          />
          <Input
            size="small"
            value={v}
            placeholder="值"
            style={{ flex: 1 }}
            onChange={(e) => onChange({ ...vars, [k]: e.target.value })}
          />
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              const next = { ...vars };
              delete next[k];
              onChange(next);
            }}
          />
        </div>
      ))}
      <Space wrap size={4}>
        {unusedHints.map((h) => (
          <Tag
            key={h}
            style={{ cursor: 'pointer', fontSize: 11 }}
            color="blue"
            onClick={() => onChange({ ...vars, [h]: '' })}
          >
            + {h}
          </Tag>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => onChange({ ...vars, ['']: '' })}
        >
          添加变量
        </Button>
      </Space>
    </div>
  );
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open:     boolean;
  initial?: SOPScheduledTask | null;
  onOk:     (data: Omit<SOPScheduledTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const TaskEditor: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const { templates } = useSOPStore();
  const { sessions }  = useSSHStore();

  const [form] = Form.useForm();
  const [mode,           setMode]           = useState<'broadcast' | 'targeted'>('broadcast');
  const [cronExpr,       setCronExpr]       = useState('*/5 * * * *');
  const [broadcastTmpl,  setBroadcastTmpl]  = useState<string>('');
  const [broadcastSess,  setBroadcastSess]  = useState<string[]>([]);
  const [broadcastVars,  setBroadcastVars]  = useState<Record<string, string>>({});
  const [nodeAssign,     setNodeAssign]     = useState<SOPScheduleNodeAssignment[]>([]);

  // 重置表单
  useEffect(() => {
    if (!open) return;
    if (initial) {
      form.setFieldsValue({ name: initial.name, description: initial.description, enabled: initial.enabled });
      setMode(initial.mode);
      setCronExpr(initial.cronExpr);
      setBroadcastTmpl(initial.broadcastTemplateId ?? '');
      setBroadcastSess(initial.broadcastSessionIds ?? []);
      setBroadcastVars(initial.broadcastVarValues ?? {});
      setNodeAssign(initial.nodeAssignments ?? []);
    } else {
      form.resetFields();
      form.setFieldsValue({ enabled: true });
      setMode('broadcast');
      setCronExpr('*/5 * * * *');
      setBroadcastTmpl('');
      setBroadcastSess([]);
      setBroadcastVars({});
      setNodeAssign([]);
    }
  }, [open, initial, form]);

  // 当前广播模板的变量提示
  const broadcastVarHints = useMemo(() => {
    const tmpl = templates.find((t) => t.id === broadcastTmpl);
    return tmpl ? extractTemplateVars(tmpl) : [];
  }, [broadcastTmpl, templates]);

  // cron 相关计算
  const cronError = validateCronExpr(cronExpr);
  const cronDesc  = cronError ? '' : getCronDescription(cronExpr);
  const nextRun   = cronError ? null : getNextCronRun(cronExpr);

  // 向 nodeAssign 中添加一行（当前所有 sessions）
  const addAllSessions = () => {
    const existing = new Set(nodeAssign.map((a) => a.sessionId));
    const newRows  = sessions
      .filter((s) => !existing.has(s.id))
      .map((s) => ({ sessionId: s.id, templateId: '', varValues: {} }));
    setNodeAssign((prev) => [...prev, ...newRows]);
  };

  const updateNodeRow = (idx: number, patch: Partial<SOPScheduleNodeAssignment>) =>
    setNodeAssign((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const removeNodeRow = (idx: number) =>
    setNodeAssign((prev) => prev.filter((_, i) => i !== idx));

  // 提交
  const handleOk = async () => {
    const values = await form.validateFields();
    if (cronError) return;

    if (mode === 'broadcast') {
      if (!broadcastTmpl) { form.setFields([{ name: 'broadcastTmpl', errors: ['请选择模板'] }]); return; }
      if (broadcastSess.length === 0) { form.setFields([{ name: 'broadcastSess', errors: ['请选择至少一个会话'] }]); return; }
    } else {
      if (nodeAssign.length === 0) { return; }
      if (nodeAssign.some((a) => !a.templateId)) { return; }
    }

    onOk({
      name:               values.name,
      description:        values.description ?? '',
      enabled:            values.enabled ?? true,
      cronExpr,
      mode,
      broadcastTemplateId: mode === 'broadcast' ? broadcastTmpl : undefined,
      broadcastSessionIds: mode === 'broadcast' ? broadcastSess : undefined,
      broadcastVarValues:  mode === 'broadcast' ? broadcastVars : undefined,
      nodeAssignments:    mode === 'targeted'  ? nodeAssign    : undefined,
      lastRunAt:          initial?.lastRunAt,
      lastRunStatus:      initial?.lastRunStatus,
      nextRunAt:          nextRun?.getTime(),
    });
  };

  // targeted 模式表格列
  const targetedColumns = [
    {
      title: '会话',
      key: 'session',
      render: (_: unknown, rec: SOPScheduleNodeAssignment, idx: number) => {
        const sess = sessions.find((s) => s.id === rec.sessionId);
        return (
          <Select
            size="small"
            style={{ width: '100%' }}
            value={rec.sessionId}
            options={sessions.map((s) => ({ label: s.name, value: s.id }))}
            onChange={(v) => updateNodeRow(idx, { sessionId: v })}
            placeholder="选择会话"
          />
        );
        void sess;
      },
    },
    {
      title: '执行模板',
      key: 'template',
      render: (_: unknown, rec: SOPScheduleNodeAssignment, idx: number) => (
        <Select
          size="small"
          style={{ width: '100%' }}
          value={rec.templateId || undefined}
          options={templates.map((t) => ({ label: t.name, value: t.id }))}
          onChange={(v) => updateNodeRow(idx, { templateId: v, varValues: {} })}
          placeholder="选择模板"
        />
      ),
    },
    {
      title: (
        <Tooltip title="点击行内的「变量」展开填写">
          变量
        </Tooltip>
      ),
      key: 'vars',
      width: 60,
      render: (_: unknown, rec: SOPScheduleNodeAssignment, idx: number) => {
        const varCount = Object.keys(rec.varValues ?? {}).length;
        const tmpl = templates.find((t) => t.id === rec.templateId);
        const hints = tmpl ? extractTemplateVars(tmpl) : [];
        return (
          <Tooltip
            title={
              <VarEditor
                vars={rec.varValues ?? {}}
                hints={hints}
                onChange={(v) => updateNodeRow(idx, { varValues: v })}
              />
            }
            trigger="click"
            overlayStyle={{ maxWidth: 380 }}
          >
            <Tag style={{ cursor: 'pointer' }} color={varCount > 0 ? 'blue' : 'default'}>
              {varCount > 0 ? `${varCount}个变量` : '配置'}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '',
      key: 'del',
      width: 40,
      render: (_: unknown, __: unknown, idx: number) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeNodeRow(idx)}
        />
      ),
    },
  ];

  return (
    <Modal
      title={initial ? '编辑定时任务' : '新建定时任务'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={initial ? '保存' : '创建'}
      cancelText="取消"
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>

        {/* 基础信息 */}
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请填写任务名称' }]}>
          <Input placeholder="例：生产环境服务健康检查" />
        </Form.Item>

        <Form.Item name="description" label="描述（可选）">
          <Input.TextArea rows={2} placeholder="任务说明，方便团队识别" />
        </Form.Item>

        <Form.Item name="enabled" label="启用状态" valuePropName="checked">
          <Switch checkedChildren="已启用" unCheckedChildren="已禁用" />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }}>Cron 调度配置</Divider>

        {/* Cron 预设 */}
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>常用预设：</Text>
          <Space wrap size={4} style={{ marginTop: 4 }}>
            {CRON_PRESETS.map((p) => (
              <Tag
                key={p.value}
                style={{ cursor: 'pointer', fontSize: 11 }}
                color={cronExpr === p.value ? 'blue' : 'default'}
                onClick={() => setCronExpr(p.value)}
              >
                {p.label}
              </Tag>
            ))}
          </Space>
        </div>

        {/* Cron 输入 */}
        <Form.Item
          label={
            <Space size={4}>
              Cron 表达式
              <Tooltip title="格式：分 时 日 月 周（0-59 0-23 1-31 1-12 0-6）">
                <InfoCircleOutlined style={{ color: '#a1a1aa' }} />
              </Tooltip>
            </Space>
          }
          validateStatus={cronError ? 'error' : cronExpr ? 'success' : ''}
          help={cronError || (
            <Space size={8} style={{ fontSize: 12 }}>
              {cronDesc && <Text type="secondary">{cronDesc}</Text>}
              {nextRun && (
                <Text type="secondary">
                  下次执行：{nextRun.toLocaleString('zh-CN', { hour12: false })}
                </Text>
              )}
            </Space>
          )}
        >
          <Input
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="*/5 * * * *"
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }}>执行模式</Divider>

        <Form.Item label="模式">
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio value="broadcast">
              <Space size={4}>
                广播模式
                <Text type="secondary" style={{ fontSize: 12 }}>（所有节点执行同一 SOP）</Text>
              </Space>
            </Radio>
            <Radio value="targeted">
              <Space size={4}>
                独立模式
                <Text type="secondary" style={{ fontSize: 12 }}>（每个节点执行自己的 SOP）</Text>
              </Space>
            </Radio>
          </Radio.Group>
        </Form.Item>

        {/* 广播模式配置 */}
        {mode === 'broadcast' && (
          <>
            <Form.Item name="broadcastTmpl" label="执行模板">
              <Select
                placeholder="选择要执行的 SOP 模板"
                options={templates.map((t) => ({
                  label: (
                    <Space>
                      <span>{t.name}</span>
                      <Tag color="blue" style={{ fontSize: 10 }}>{t.category}</Tag>
                    </Space>
                  ),
                  value: t.id,
                }))}
                value={broadcastTmpl || undefined}
                onChange={(v) => { setBroadcastTmpl(v); setBroadcastVars({}); }}
              />
            </Form.Item>

            <Form.Item name="broadcastSess" label="目标会话（多选）">
              <Select
                mode="multiple"
                placeholder="选择执行此 SOP 的节点"
                options={sessions.map((s) => ({
                  label: (
                    <Space>
                      <span>{s.name}</span>
                      <Tag
                        color={s.status === 'connected' ? 'green' : 'default'}
                        style={{ fontSize: 10 }}
                      >
                        {s.status === 'connected' ? '已连接' : s.status}
                      </Tag>
                    </Space>
                  ),
                  value: s.id,
                }))}
                value={broadcastSess}
                onChange={setBroadcastSess}
              />
            </Form.Item>

            {broadcastVarHints.length > 0 || Object.keys(broadcastVars).length > 0 ? (
              <Form.Item label="模板变量">
                <VarEditor
                  vars={broadcastVars}
                  hints={broadcastVarHints}
                  onChange={setBroadcastVars}
                />
              </Form.Item>
            ) : null}
          </>
        )}

        {/* 独立模式配置 */}
        {mode === 'targeted' && (
          <Form.Item label="节点与模板映射">
            {nodeAssign.length === 0 && (
              <Alert
                type="info"
                showIcon
                message="点击「添加全部会话」快速填充，或逐行添加"
                style={{ marginBottom: 8 }}
              />
            )}
            <Table
              dataSource={nodeAssign}
              columns={targetedColumns}
              rowKey={(_, idx) => String(idx)}
              size="small"
              pagination={false}
              style={{ marginBottom: 8 }}
            />
            <Space>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setNodeAssign((prev) => [...prev, { sessionId: '', templateId: '' }])}
              >
                添加行
              </Button>
              <Button
                size="small"
                onClick={addAllSessions}
                disabled={sessions.length === 0}
              >
                添加全部会话
              </Button>
            </Space>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default TaskEditor;
