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
} from '@ant-design/icons';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import { useSSHStore } from './store/sshStore';
import type { SSHProfile, PlanStepResult } from './store/sshStore';
import { useSOPStore } from '../SOPBuilder/store/sopStore';
import ResizableOutput from '../../components/shared/ResizableOutput';
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
  const { copy: _copy } = useClipboard(); void _copy;
  const [expanded, setExpanded] = useState(false);

  const icon =
    !result           ? (isCurrent ? <Spin size="small" /> : <ClockCircleOutlined style={{ color: '#6b7280' }} />)
    : result.status === 'done'   ? <CheckCircleOutlined style={{ color: '#22c55e' }} />
    : result.status === 'failed' ? <CloseCircleOutlined style={{ color: '#ef4444' }} />
    : result.status === 'running'? <Spin size="small" />
    : <ClockCircleOutlined style={{ color: '#6b7280' }} />;

  // 优先展示脚本处理后的输出，其次原始输出
  const displayOutput = result?.processedOutput ?? result?.stdout ?? '';
  const outputText = [displayOutput, result?.stderr].filter(Boolean).join('\n').trimEnd();

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
            <>
              <Tag color={result.exitCode === 0 ? 'success' : 'error'} style={{ fontSize: 10 }}>
                exit {result.exitCode}
              </Tag>
              {result.statusReason && (
                <Tooltip title={result.statusReason}>
                  <Tag
                    color={result.status === 'done' ? 'green' : 'red'}
                    style={{ fontSize: 10, cursor: 'help' }}
                  >
                    {result.statusReason.startsWith('正常正则') ? '✅正则' :
                     result.statusReason.startsWith('异常正则') ? '❌正则' :
                     result.processedOutput !== undefined ? '🐍脚本' : ''}
                  </Tag>
                </Tooltip>
              )}
            </>
          )}
        </Space>
        {outputText && (
          <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }}
            onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开输出'}
          </Button>
        )}
      </div>

      {/* 命令预览（优先显示渲染后的实际命令） */}
      <div style={{
        fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11,
        color: '#6b7280', marginTop: 2,
      }}>
        $ {result?.resolvedCmd ?? step.cmd}
      </div>

      {/* 变量捕获标记 */}
      {result?.capturedVar && (
        <div style={{ marginTop: 3 }}>
          <Tag color="blue" style={{ fontSize: 10 }}>
            🔵 已捕获 ${'{'}
            {result.capturedVar.name}
            {'}'} = <code style={{ fontSize: 10 }}>{result.capturedVar.value.slice(0, 40)}{result.capturedVar.value.length > 40 ? '…' : ''}</code>
          </Tag>
        </div>
      )}

      {/* 输出展开区（ResizableOutput：可拖拽调整高度） */}
      {expanded && outputText && (
        <div style={{ marginTop: 6 }}>
          {result?.processedOutput !== undefined && result.processedOutput !== result.stdout && (
            <Tag color="purple" style={{ fontSize: 10, marginBottom: 4 }}>
              🐍 已经 Python 脚本处理（原始 {result.stdout?.split('\n').length ?? 0} 行 →
              处理后 {result.processedOutput?.split('\n').length ?? 0} 行）
            </Tag>
          )}
          {result?.scriptError && (
            <Tag color="red" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
              ⚠️ 脚本错误：{result.scriptError}
            </Tag>
          )}
          <ResizableOutput
            content={outputText}
            isDark={isDark}
            minHeight={80}
            maxHeight={500}
            showCopy={true}
          />
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
  const {
    templates, instances,
    updateCheckResult, appendSubStepResult, setInstanceStatus,
  } = useSOPStore();

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

    // ── 展平子步骤：每个 SOPCheckResult 展开为若干 PlanStep ──────────────
    const allCheckResults = [
      ...selectedInstance.checkResults,
      ...selectedInstance.extraChecks,
    ];

    const planSteps: import('./store/sshStore').PlanStep[] = [];

    for (const cr of allCheckResults) {
      const subs = cr.subSteps ?? [];
      if (subs.length > 0) {
        subs.forEach((ss) => {
          planSteps.push({
            id:             ss.id,
            name:           ss.name,
            cmd:            renderTemplate(ss.command, varValues),
            captureVar:     ss.captureVar,
            capturePattern: ss.capturePattern,
            normalRegex:    ss.normalRegex,    // 正常判断正则
            abnormalRegex:  ss.abnormalRegex,  // 异常判断正则（最高优先级）
            scriptPath:     ss.scriptPath,     // Python 后处理脚本
            timeout:        ss.timeoutMs ?? 30000,
            checkId:        cr.checkId,
            isSubStep:      true,
          });
        });
      } else {
        // 无子步骤：使用检查步骤的兜底命令
        const cmd = renderTemplate(cr.command, varValues);
        if (cmd.trim()) {
          planSteps.push({
            id:        cr.checkId,
            name:      cr.checkName,
            cmd,
            timeout:   30000,
            checkId:   cr.checkId,
            isSubStep: false,
          });
        }
      }
    }

    if (planSteps.length === 0) {
      messageApi.warning('所有步骤命令均为空，请先完善 SOP 模板');
      return;
    }

    setExecuting(true);
    setActiveView('progress');

    try {
      const plan = await runPlan(planSteps);

        // ── 将执行结果聚合写回 SOPInstance ──────────────────────────────────
      // 按 checkId 分组
      const resultsByCheck = new Map<string, typeof plan.results[string][]>();
      plan.steps.forEach((step) => {
        const r = plan.results[step.id];
        if (!r || !step.checkId) return;
        const list = resultsByCheck.get(step.checkId) ?? [];
        list.push(r);
        resultsByCheck.set(step.checkId, list);
      });

      resultsByCheck.forEach((stepResults, checkId) => {
        const aggregatedOutput = stepResults
          .map((r) => {
            const step = plan.steps.find((s) => s.id === r.stepId);
            return `[${step?.name ?? r.stepId}]${r.resolvedCmd ? ` $ ${r.resolvedCmd}` : ''}\n${r.stdout || r.stderr}`;
          })
          .join('\n\n');

        // 如果是子步骤：通过 appendSubStepResult 逐条写入，聚合逻辑在 store 处理
        if (plan.steps.find((s) => s.checkId === checkId && s.isSubStep)) {
          stepResults.forEach((r) => {
            const step = plan.steps.find((s) => s.id === r.stepId);
            if (!step) return;
            appendSubStepResult(selectedInstance.id, checkId, {
              subStepId:   step.id,
              name:        step.name,
              command:     r.resolvedCmd ?? step.cmd,
              stdout:      r.stdout,
              stderr:      r.stderr,
              exitCode:    r.exitCode,
              durationMs:  r.durationMs,
              capturedVar: r.capturedVar,
            });
          });
        } else {
          // 兜底命令：直接更新 checkResult
          const r = stepResults[0];
          if (r) {
            updateCheckResult(selectedInstance.id, checkId, {
              command:    r.resolvedCmd ?? plan.steps.find((s) => s.checkId === checkId)?.cmd ?? '',
              output:     aggregatedOutput,
              status:     r.exitCode === 0 ? 'normal' : 'abnormal',
              conclusion: r.exitCode === 0
                ? `exit 0，耗时 ${r.durationMs}ms`
                : `exit ${r.exitCode}，${r.stderr.split('\n')[0].slice(0, 80)}`,
            });
          }
        }
      });

      setInstanceStatus(selectedInstance.id, 'resolved');

      const abnormal = Object.values(plan.results).filter((r) => r.exitCode !== 0).length;
      const capturedVarCount = Object.values(plan.results).filter((r) => r.capturedVar).length;
      const msg = abnormal === 0
        ? `✅ 全部 ${planSteps.length} 步执行完成，无异常${capturedVarCount > 0 ? `，捕获 ${capturedVarCount} 个变量` : ''}`
        : `⚠️ 完成 ${planSteps.length} 步，${abnormal} 步异常`;
      abnormal === 0 ? messageApi.success(msg) : messageApi.warning(msg);

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

                  {/* 变量上下文快照（plan 完成后显示） */}
                  {currentPlan?.status === 'done' &&
                    currentPlan.finalVarContext &&
                    Object.keys(currentPlan.finalVarContext).length > 0 && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: '8px 12px',
                        background: isDark ? 'rgba(59,130,246,0.08)' : '#eff6ff',
                        border: '1px solid rgba(59,130,246,0.25)',
                        borderRadius: 6,
                      }}
                    >
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                        🔵 捕获变量（可在后续命令中引用）
                      </Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.entries(currentPlan.finalVarContext).map(([k, v]) => (
                          <Tag key={k} color="blue" style={{ fontSize: 11, fontFamily: 'JetBrains Mono, Consolas, monospace' }}>
                            ${'{'}
                            {k}
                            {'}'} = {v.slice(0, 40)}{v.length > 40 ? '…' : ''}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>
          )}
        </div>

        {/* ══ 右栏：SOP 执行配置 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card
            size="small"
            title={
              <Space>
                <Text strong>SOP 自动执行</Text>
                <Tag color="blue" style={{ fontSize: 10 }}>复用当前终端 Shell</Tag>
              </Space>
            }
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

              {/* 预处理提示 */}
              {isConn && (
                <Alert
                  type="info"
                  showIcon={false}
                  style={{ fontSize: 11, padding: '6px 10px' }}
                  message={
                    <div>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                        ✅ 执行前请在左侧终端完成：
                      </Text>
                      {[
                        '堡垒机跳转 / 切换到目标主机',
                        'sudo su - root（如需 root 权限）',
                        'cd 到目标工作目录',
                        'source 环境变量文件（如需）',
                      ].map((step, i) => (
                        <Text key={i} type="secondary" style={{ fontSize: 11, display: 'block' }}>
                          {i + 1}. {step}
                        </Text>
                      ))}
                      <Text style={{ fontSize: 11, color: '#3b82f6', display: 'block', marginTop: 4 }}>
                        SOP 命令将在同一 Shell 中顺序执行，完全继承以上状态。
                      </Text>
                    </div>
                  }
                />
              )}

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
                  开始自动执行（复用当前 Shell）
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
