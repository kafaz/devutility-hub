/**
 * SSH Manager — 私钥认证 + SOP 全自动执行
 *
 * 布局：左栏（档案管理）| 中栏（终端/进度）| 右栏（SOP执行面板）
 * 认证等同 paramiko: key_filename + passphrase
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Typography, Button, Input, InputNumber, Select, Space, Card,
  Tag, Alert, Tooltip, Divider, Form, Modal, Progress, Badge,
  Spin, message, Segmented, Popconfirm,
} from 'antd';
import {
  ApiOutlined, DisconnectOutlined, KeyOutlined, LockOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined, PlayCircleOutlined,
  StopOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, ReloadOutlined, FolderOpenOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import { useSSHStore } from './store/sshStore';
import type { SSHProfile, PlanStepResult } from './store/sshStore';
import { useSOPStore } from '../SOPBuilder/store/sopStore';
import { generateInstanceReport } from '../../utils';
import { useGlobalStore } from '../../store/globalStore';
import { useClipboard } from '../../hooks/useClipboard';
import { renderTemplate } from '../../utils';

const { Title, Text } = Typography;
const { Password } = Input;

// ─── 常量 ──────────────────────────────────────────────────────────────────


type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
const STATUS_CFG: Record<ConnStatus, { badge: 'default' | 'processing' | 'success' | 'error'; label: string; color: string }> = {
  idle:         { badge: 'default',    label: '未连接',  color: '#6b7280' },
  connecting:   { badge: 'processing', label: '连接中…', color: '#3b82f6' },
  connected:    { badge: 'success',    label: '已连接',  color: '#22c55e' },
  error:        { badge: 'error',      label: '连接失败', color: '#ef4444' },
  disconnected: { badge: 'default',    label: '已断开',  color: '#6b7280' },
};

// ─── 终端组件 ──────────────────────────────────────────────────────────────

const TerminalPanel: React.FC<{
  isDark: boolean;
  onInput: (d: string) => void;
  onResize: (cols: number, rows: number) => void;
  registerWrite: (fn: (b64: string) => void) => void;
}> = ({ isDark, onInput, onResize, registerWrite }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      theme: isDark
        ? { background: '#1e1e1e', foreground: '#d4d4d8', cursor: '#3b82f6' }
        : { background: '#fafafa', foreground: '#18181b', cursor: '#3b82f6' },
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      fontSize: 13, lineHeight: 1.4, cursorBlink: true, scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    requestAnimationFrame(() => { fit.fit(); onResize(term.cols, term.rows); });

    const d1 = term.onData(onInput);
    const ro = new ResizeObserver(() => { fit.fit(); onResize(term.cols, term.rows); });
    ro.observe(ref.current);

    registerWrite((b64: string) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      term.write(buf);
    });

    return () => { d1.dispose(); ro.disconnect(); term.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  return (
    <div
      ref={ref}
      style={{
        width: '100%', height: '100%', minHeight: 320,
        background: isDark ? '#1e1e1e' : '#fafafa',
        borderRadius: 4, padding: 4,
      }}
    />
  );
};

// ─── 档案编辑弹窗 ──────────────────────────────────────────────────────────

const ProfileModal: React.FC<{
  open: boolean;
  initial?: SSHProfile | null;
  onOk: (p: Omit<SSHProfile, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
  checkKeyFile: (p: string) => Promise<{ ok: boolean; msg?: string }>;
}> = ({ open, initial, onOk, onCancel, checkKeyFile }) => {
  const [form] = Form.useForm();
  const [authType, setAuthType] = useState<'privateKey' | 'password' | 'agent'>('privateKey');
  const [keyOk, setKeyOk] = useState<boolean | null>(null);
  const [keyMsg, setKeyMsg] = useState('');

  useEffect(() => {
    if (open) {
      if (initial) {
        form.setFieldsValue(initial);
        setAuthType(initial.authType);
      } else {
        form.resetFields();
        form.setFieldsValue({ port: 22, authType: 'privateKey' });
        setAuthType('privateKey');
      }
      setKeyOk(null); setKeyMsg('');
    }
  }, [open, initial, form]);

  const handleCheckKey = async () => {
    const p = form.getFieldValue('keyFilePath');
    if (!p) return;
    const r = await checkKeyFile(p);
    setKeyOk(r.ok);
            const resp = r as { ok: boolean; resolved?: string; msg?: string };
            setKeyMsg(resp.ok ? `文件可读: ${resp.resolved ?? p}` : resp.msg ?? '不可读');
  };

  const handleOk = async () => {
    const v = await form.validateFields();
    onOk({ name: v.name, host: v.host, port: v.port, username: v.username,
           authType: v.authType, keyFilePath: v.keyFilePath });
  };

  return (
    <Modal title={initial ? '编辑连接档案' : '新建连接档案'}
      open={open} onOk={handleOk} onCancel={onCancel} okText="保存" cancelText="取消" width={520}>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="name" label="档案名称" rules={[{ required: true }]}>
          <Input placeholder="例：生产-用户服务-01" />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
          <Form.Item name="host" label="主机地址" rules={[{ required: true }]}>
            <Input placeholder="192.168.1.100" />
          </Form.Item>
          <Form.Item name="port" label="端口" rules={[{ required: true }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
          <Input placeholder="root" />
        </Form.Item>
        <Form.Item name="authType" label="认证方式">
          <Segmented
            value={authType}
            onChange={(v) => { setAuthType(v as typeof authType); form.setFieldValue('authType', v); }}
            options={[
              { label: '私钥 + Passphrase', value: 'privateKey' },
              { label: '密码', value: 'password' },
              { label: 'SSH Agent', value: 'agent' },
            ]}
          />
        </Form.Item>
        {authType === 'privateKey' && (
          <Form.Item
            name="keyFilePath"
            label="私钥文件路径"
            extra={
              keyOk !== null && (
                <Text type={keyOk ? 'success' : 'danger'} style={{ fontSize: 12 }}>
                  {keyMsg}
                </Text>
              )
            }
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="~/.ssh/id_rsa  或  C:\Users\you\.ssh\id_rsa"
                prefix={<KeyOutlined style={{ color: '#a1a1aa' }} />}
              />
              <Button icon={<FolderOpenOutlined />} onClick={handleCheckKey}>验证</Button>
            </Space.Compact>
          </Form.Item>
        )}
        <Alert
          type="info"
          showIcon={false}
          style={{ fontSize: 12 }}
          message={
            authType === 'privateKey'
              ? 'Passphrase（私钥口令）连接时填写，不保存到本地'
              : authType === 'password'
              ? '密码连接时填写，不保存到本地'
              : 'SSH Agent 需提前在本机启动并加载密钥'
          }
        />
      </Form>
    </Modal>
  );
};

// ─── 执行步骤行 ────────────────────────────────────────────────────────────

const StepRow: React.FC<{
  step: { id: string; name: string; cmd: string };
  result?: PlanStepResult;
  isCurrent: boolean;
  isDark: boolean;
}> = ({ step, result, isCurrent, isDark }) => {
  const { copy } = useClipboard();
  const [expanded, setExpanded] = useState(false);

  const icon =
    !result           ? (isCurrent ? <Spin size="small" /> : <ClockCircleOutlined style={{ color: '#6b7280' }} />)
    : result.status === 'done'   ? <CheckCircleOutlined style={{ color: '#22c55e' }} />
    : result.status === 'failed' ? <CloseCircleOutlined style={{ color: '#ef4444' }} />
    : result.status === 'running'? <Spin size="small" />
    : <ClockCircleOutlined style={{ color: '#6b7280' }} />;

  const outputText = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trimEnd();

  return (
    <div
      style={{
        borderLeft: `3px solid ${
          !result           ? (isCurrent ? '#3b82f6' : '#3e3e42')
          : result.status === 'done'   ? '#22c55e'
          : result.status === 'failed' ? '#ef4444' : '#3e3e42'
        }`,
        paddingLeft: 10,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space size={6}>
          {icon}
          <Text strong style={{ fontSize: 13 }}>{step.name}</Text>
          {result?.durationMs != null && (
            <Text type="secondary" style={{ fontSize: 11 }}>{result.durationMs}ms</Text>
          )}
          {result && (
            <Tag color={result.exitCode === 0 ? 'success' : 'error'} style={{ fontSize: 10 }}>
              exit {result.exitCode}
            </Tag>
          )}
        </Space>
        {outputText && (
          <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }}
            onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开输出'}
          </Button>
        )}
      </div>

      {/* 命令预览 */}
      <div style={{
        fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11,
        color: '#6b7280', marginTop: 2,
      }}>
        $ {step.cmd}
      </div>

      {/* 输出展开区 */}
      {expanded && outputText && (
        <div style={{ marginTop: 6, position: 'relative' }}>
          <pre style={{
            margin: 0, padding: '6px 10px',
            background: isDark ? '#1e1e1e' : '#f4f4f5',
            borderRadius: 4, fontSize: 11,
            fontFamily: 'JetBrains Mono, Consolas, monospace',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 200, overflowY: 'auto',
            color: result?.stderr && !result.stdout ? '#ef4444' : undefined,
          }}>
            {outputText}
          </pre>
          <Tooltip title="复制输出">
            <CopyOutlined
              style={{ position: 'absolute', top: 6, right: 8, color: '#a1a1aa', cursor: 'pointer' }}
              onClick={() => copy(outputText)}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

const SSHManager: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const {
    profiles, activeProfileId, proxyOnline,
    status, statusMsg, currentPlan,
    addProfile, updateProfile, deleteProfile, setActiveProfile,
    checkProxy, setOnTermData, connect, disconnect,
    sendInput, resize, runPlan, cancelPlan,
    checkKeyFile,
  } = useSSHStore();

  // SOP 数据
  const { templates, instances, updateCheckResult, setInstanceStatus } = useSOPStore();

  const [messageApi, ctx] = message.useMessage();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SSHProfile | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectForm] = Form.useForm();
  const [activeView, setActiveView] = useState<'terminal' | 'progress'>('terminal');

  // SOP 执行配置
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);

  const writeTermRef = useRef<((b64: string) => void) | null>(null);
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  // 定期检查代理
  useEffect(() => {
    checkProxy();
    const t = setInterval(checkProxy, 5000);
    return () => clearInterval(t);
  }, [checkProxy]);

  // 注入终端写入函数到 store
  useEffect(() => {
    setOnTermData((b64) => writeTermRef.current?.(b64));
    return () => setOnTermData(null);
  }, [setOnTermData]);

  // 连接时切换到终端视图
  useEffect(() => {
    if (status === 'connected') setActiveView('terminal');
  }, [status]);

  const sc      = STATUS_CFG[status as ConnStatus];
  const isConn  = status === 'connected';
  const isRunning = currentPlan?.status === 'running';

  // 获取 SOP 实例对应的所有步骤（含变量替换）
  const selectedInstance = instances.find((i) => i.id === selectedInstanceId);
  const selectedTemplate = templates.find((t) => t.id === selectedInstance?.templateId);

  // 收集所有步骤中的变量名
  const allStepVars = Array.from(new Set(
    (selectedInstance?.checkResults ?? [])
      .flatMap((r) => [...(r.command.matchAll(/\$\{([^}]+)\}/g))].map((m) => m[1]))
  ));

  // ── 打开连接弹窗 ────────────────────────────────────────────────────────

  const handleOpenConnect = () => {
    if (!activeProfile) { messageApi.warning('请先选择或创建连接档案'); return; }
    connectForm.resetFields();
    setConnectModalOpen(true);
  };

  // ── 建立连接 ────────────────────────────────────────────────────────────

  const handleConnect = async () => {
    if (!activeProfile) return;
    const vals = await connectForm.validateFields().catch(() => null);
    if (!vals) return;
    connect({
      profile:    activeProfile,
      passphrase: vals.passphrase,
      password:   vals.password,
      agent:      vals.agent,
    });
    setConnectModalOpen(false);
  };

  // ── 执行 SOP 计划 ────────────────────────────────────────────────────────

  const handleRunPlan = async () => {
    if (!selectedInstance) { messageApi.warning('请选择要执行的 SOP 实例'); return; }

    const steps = [
      ...selectedInstance.checkResults,
      ...selectedInstance.extraChecks,
    ].map((r) => ({
      id:   r.checkId,
      name: r.checkName,
      cmd:  renderTemplate(r.command, varValues),
    }));

    if (steps.some((s) => !s.cmd.trim())) {
      messageApi.warning('部分步骤命令为空，请检查');
      return;
    }

    setExecuting(true);
    setActiveView('progress');

    try {
      const plan = await runPlan(steps);

      // 将执行结果写回 SOP 实例
      plan.steps.forEach((step) => {
        const r = plan.results[step.id];
        if (!r) return;
        updateCheckResult(selectedInstance.id, step.id, {
          command:    step.cmd,
          output:     [r.stdout, r.stderr].filter(Boolean).join('\n').trimEnd(),
          status:     r.exitCode === 0 ? 'normal' : 'abnormal',
          conclusion: r.exitCode === 0
            ? `exit 0，耗时 ${r.durationMs}ms`
            : `exit ${r.exitCode}，${r.stderr.split('\n')[0].slice(0, 80)}`,
        });
      });

      setInstanceStatus(selectedInstance.id, 'resolved');

      const abnormal = Object.values(plan.results).filter((r) => r.exitCode !== 0).length;
      if (abnormal === 0) {
        messageApi.success(`✅ 全部 ${steps.length} 步执行完成，无异常`);
      } else {
        messageApi.warning(`⚠️ 完成 ${steps.length} 步，${abnormal} 步异常（exit ≠ 0）`);
      }
    } catch (e) {
      messageApi.error(`执行出错: ${String(e)}`);
    } finally {
      setExecuting(false);
    }
  };

  // ── 导出报告 ────────────────────────────────────────────────────────────

  const handleExport = () => {
    if (!selectedInstance) return;
    const md = generateInstanceReport({
      instance:     selectedInstance,
      templateName: selectedTemplate?.name ?? selectedInstance.templateName,
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `报告-${selectedInstance.incidentTitle.replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    messageApi.success('报告已导出');
  };

  const cardBg     = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  // 计算执行进度
  const planSteps   = currentPlan?.steps ?? [];
  const planResults = currentPlan?.results ?? {};
  const doneCount   = Object.values(planResults).filter((r) => r.status !== 'running').length;
  const failCount   = Object.values(planResults).filter((r) => r.status === 'failed').length;
  const currentIdx  = planSteps.findIndex((s) => !planResults[s.id]);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {ctx}

      {/* ── 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>SSH Manager</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            私钥认证（等同 paramiko key_filename + passphrase）· SOP 全自动执行
          </Text>
        </div>
        <Space>
          <Badge status={sc.badge} />
          <Tag color={sc.color}>{sc.label}</Tag>
          {statusMsg && <Text type="secondary" style={{ fontSize: 12 }}>{statusMsg}</Text>}
        </Space>
      </div>

      {/* ── 代理未启动提示 */}
      {!proxyOnline && (
        <Alert type="warning" showIcon
          message="SSH Proxy 代理服务未运行"
          description={
            <div style={{ fontSize: 12 }}>
              <pre style={{
                marginTop: 6, padding: '6px 10px',
                background: isDark ? '#1e1e1e' : '#f4f4f5',
                borderRadius: 4, fontSize: 12,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
              }}>
                cd devutility-hub/server{'\n'}
                npm install  # 首次运行{'\n'}
                node index.js
              </pre>
              <Button size="small" icon={<ReloadOutlined />} onClick={checkProxy}>重新检测</Button>
            </div>
          }
        />
      )}

      {/* ── 主体：三栏 */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 320px', gap: 16, alignItems: 'start' }}>

        {/* ══ 左栏：档案管理 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card
            size="small"
            title="连接档案"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
            extra={
              <Button size="small" icon={<PlusOutlined />} type="dashed"
                onClick={() => { setEditingProfile(null); setProfileModalOpen(true); }}>
                新建
              </Button>
            }
          >
            {profiles.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>暂无档案，点击「新建」创建</Text>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setActiveProfile(p.id)}
                    style={{
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      border: `1px solid ${activeProfileId === p.id ? '#3b82f6' : borderColor}`,
                      background: activeProfileId === p.id
                        ? isDark ? '#1e3a5f' : '#eff6ff' : isDark ? '#2d2d30' : '#fafafa',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong style={{ fontSize: 13, color: activeProfileId === p.id ? '#3b82f6' : undefined }}>
                        {p.name}
                      </Text>
                      <Space size={4} onClick={(e) => e.stopPropagation()}>
                        <EditOutlined
                          style={{ fontSize: 12, color: '#a1a1aa', cursor: 'pointer' }}
                          onClick={() => { setEditingProfile(p); setProfileModalOpen(true); }}
                        />
                        <Popconfirm title="删除此档案？"
                          onConfirm={() => deleteProfile(p.id)}
                          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                          <DeleteOutlined style={{ fontSize: 12, color: '#ef4444', cursor: 'pointer' }} />
                        </Popconfirm>
                      </Space>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      {p.username}@{p.host}:{p.port}
                    </Text>
                    <Tag style={{ fontSize: 10, marginTop: 2 }}>
                      {p.authType === 'privateKey' ? '🔑 私钥' : p.authType === 'password' ? '🔒 密码' : '🤝 Agent'}
                    </Tag>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 连接/断开按钮 */}
          {!isConn ? (
            <Button type="primary" icon={<ApiOutlined />}
              onClick={handleOpenConnect}
              disabled={!proxyOnline || !activeProfile}
              block>
              连接 {activeProfile ? `(${activeProfile.name})` : ''}
            </Button>
          ) : (
            <Button danger icon={<DisconnectOutlined />} onClick={disconnect} block>
              断开连接
            </Button>
          )}
        </div>

        {/* ══ 中栏：终端 / 执行进度 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Segmented
            value={activeView}
            onChange={(v) => setActiveView(v as typeof activeView)}
            options={[
              { label: '终端', value: 'terminal' },
              {
                label: currentPlan
                  ? `执行进度 (${doneCount}/${planSteps.length})`
                  : '执行进度',
                value: 'progress',
              },
            ]}
          />

          {activeView === 'terminal' ? (
            <div style={{
              border: `1px solid ${isConn ? '#22c55e44' : borderColor}`,
              borderRadius: 6, overflow: 'hidden',
              background: isDark ? '#1e1e1e' : '#fafafa',
              minHeight: 420, position: 'relative',
            }}>
              {!isConn && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  zIndex: 5, pointerEvents: 'none',
                }}>
                  <Text type="secondary">
                    {status === 'error' ? statusMsg : '选择档案后点击「连接」'}
                  </Text>
                </div>
              )}
              <TerminalPanel
                isDark={isDark}
                onInput={sendInput}
                onResize={resize}
                registerWrite={(fn) => { writeTermRef.current = fn; }}
              />
            </div>
          ) : (
            <Card
              size="small"
              title={
                <Space>
                  <Text strong>SOP 执行进度</Text>
                  {currentPlan?.status === 'running' && <Spin size="small" />}
                  {currentPlan?.status === 'done' && (
                    failCount === 0
                      ? <Tag color="success">全部成功</Tag>
                      : <Tag color="error">{failCount} 项失败</Tag>
                  )}
                </Space>
              }
              style={{ background: cardBg, border: `1px solid ${borderColor}`, minHeight: 420 }}
            >
              {!currentPlan ? (
                <Text type="secondary" style={{ fontSize: 13 }}>在右侧选择 SOP 实例后点击「开始执行」</Text>
              ) : (
                <>
                  {planSteps.length > 0 && (
                    <Progress
                      percent={Math.round((doneCount / planSteps.length) * 100)}
                      strokeColor={failCount > 0 ? '#ef4444' : '#22c55e'}
                      size="small"
                      style={{ marginBottom: 12 }}
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {planSteps.map((step, i) => (
                      <StepRow
                        key={step.id}
                        step={step}
                        result={planResults[step.id]}
                        isCurrent={i === currentIdx}
                        isDark={isDark}
                      />
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}
        </div>

        {/* ══ 右栏：SOP 执行配置 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card
            size="small"
            title="SOP 自动执行"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* 选择 SOP 实例 */}
              <div>
                <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>排查实例</Text>
                <Select
                  value={selectedInstanceId || undefined}
                  onChange={(v) => { setSelectedInstanceId(v); setVarValues({}); }}
                  placeholder="选择一个 SOP 排查实例"
                  style={{ width: '100%' }}
                  options={instances.map((inst) => ({
                    label: (
                      <Space size={4}>
                        <span style={{ fontSize: 12 }}>{inst.incidentTitle}</span>
                        <Tag style={{ fontSize: 10 }}>{inst.templateName}</Tag>
                      </Space>
                    ),
                    value: inst.id,
                  }))}
                />
              </div>

              {/* 变量填写 */}
              {allStepVars.length > 0 && (
                <div>
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                    命令变量（{allStepVars.length} 个）
                  </Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {allStepVars.map((v) => (
                      <Input
                        key={v}
                        size="small"
                        prefix={<Text type="secondary" style={{ fontSize: 11 }}>{v}:</Text>}
                        value={varValues[v] ?? ''}
                        onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                        placeholder={`填写 ${v}`}
                        style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 步骤预览 */}
              {selectedInstance && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    步骤预览（{selectedInstance.checkResults.length} 步）
                  </Text>
                  <div style={{
                    maxHeight: 160, overflowY: 'auto',
                    background: isDark ? '#1e1e1e' : '#f4f4f5',
                    borderRadius: 4, padding: '6px 8px',
                  }}>
                    {selectedInstance.checkResults.map((r, i) => (
                      <div key={r.checkId} style={{ fontSize: 11, marginBottom: 2 }}>
                        <Text type="secondary">{i + 1}. {r.checkName}</Text>
                        <div style={{
                          fontFamily: 'JetBrains Mono, Consolas, monospace',
                          fontSize: 10, color: '#6b7280',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          $ {renderTemplate(r.command, varValues)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Divider style={{ margin: '4px 0' }} />

              {/* 执行/取消按钮 */}
              {!isRunning ? (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleRunPlan}
                  disabled={!isConn || !selectedInstanceId || executing}
                  loading={executing}
                  block
                >
                  开始自动执行
                </Button>
              ) : (
                <Button danger icon={<StopOutlined />} onClick={cancelPlan} block>
                  取消执行
                </Button>
              )}

              {/* 导出报告 */}
              {currentPlan?.status === 'done' && selectedInstance && (
                <Button icon={<CheckCircleOutlined />} onClick={handleExport} block>
                  导出执行报告
                </Button>
              )}

              {!isConn && (
                <Alert
                  type="info"
                  showIcon={false}
                  message={<Text type="secondary" style={{ fontSize: 12 }}>请先在左侧建立 SSH 连接</Text>}
                />
              )}
            </div>
          </Card>
        </div>

      </div>

      {/* ── 档案编辑弹窗 */}
      <ProfileModal
        open={profileModalOpen}
        initial={editingProfile}
        onOk={(p) => {
          if (editingProfile) updateProfile(editingProfile.id, p);
          else addProfile(p);
          setProfileModalOpen(false);
          messageApi.success(editingProfile ? '档案已更新' : '档案已创建');
        }}
        onCancel={() => setProfileModalOpen(false)}
        checkKeyFile={checkKeyFile}
      />

      {/* ── 连接凭证弹窗（每次连接时填写，不保存） */}
      <Modal
        title={`连接 ${activeProfile?.name ?? ''}`}
        open={connectModalOpen}
        onOk={handleConnect}
        onCancel={() => setConnectModalOpen(false)}
        okText="连接"
        cancelText="取消"
      >
        <Form form={connectForm} layout="vertical" style={{ marginTop: 12 }}>
          {activeProfile?.authType === 'privateKey' && (
            <Form.Item name="passphrase" label="私钥 Passphrase（口令）">
              <Password
                prefix={<LockOutlined />}
                placeholder="私钥加密口令，无加密则留空"
                autoComplete="off"
              />
            </Form.Item>
          )}
          {activeProfile?.authType === 'password' && (
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Password prefix={<LockOutlined />} placeholder="SSH 登录密码" autoComplete="off" />
            </Form.Item>
          )}
          <Alert
            type="info"
            showIcon={false}
            message={<Text style={{ fontSize: 12 }}>凭证仅在本次连接会话中使用，不会保存到本地存储</Text>}
          />
        </Form>
      </Modal>
    </div>
  );
};

export default SSHManager;
