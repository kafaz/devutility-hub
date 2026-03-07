/**
 * SSH Manager — 多节点版
 *
 * 布局：
 *   左栏(280px): 连接档案 + 命名会话列表
 *   中栏:        Tab 终端（每会话一个 Tab，含独立 XTerm 实例）
 *   右栏(380px): 多节点 SOP 执行配置 + 实时进度
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
  ExportOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import { useSSHStore } from './store/sshStore';
import type { SSHSession, SSHProfile, PlanStepResult, NodeExecution } from './store/sshStore';
import { useJournalStore } from './store/journalStore';
import { useSOPStore } from '../SOPBuilder/store/sopStore';
import {
  generateMultiNodeReport, renderTemplate,
} from '../../utils';
import type { NodeReportData } from '../../utils';
import { useGlobalStore } from '../../store/globalStore';
import ResizableOutput from '../../components/shared/ResizableOutput';
import SessionJournal from './components/SessionJournal';

const { Title, Text } = Typography;
const { Password } = Input;

// ─── 状态配置 ─────────────────────────────────────────────────────────────

type ConnStatus = SSHSession['status'];
const STATUS: Record<ConnStatus, { badge: 'default' | 'processing' | 'success' | 'error'; color: string; label: string }> = {
  idle:         { badge: 'default',    color: '#6b7280', label: '未连接' },
  connecting:   { badge: 'processing', color: '#3b82f6', label: '连接中' },
  connected:    { badge: 'success',    color: '#22c55e', label: '已连接' },
  error:        { badge: 'error',      color: '#ef4444', label: '失败'   },
  disconnected: { badge: 'default',    color: '#6b7280', label: '已断开' },
};

// ─── 单个 XTerm 终端实例（每会话挂载一次，CSS 控制显隐） ─────────────────

const TerminalInstance: React.FC<{
  sessionId:     string;
  isDark:        boolean;
  visible:       boolean;
  onInput:       (data: string) => void;
  onResize:      (cols: number, rows: number) => void;
  registerWrite: (fn: (b64: string) => void) => void;
  /** 注册"读取终端缓冲区文本"的函数，供快照使用 */
  registerSnapshot: (fn: () => string) => void;
}> = ({ sessionId, isDark, visible, onInput, onResize, registerWrite, registerSnapshot }) => {
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
    const ro = new ResizeObserver(() => { if (visible) { fit.fit(); onResize(term.cols, term.rows); } });
    ro.observe(ref.current);

    registerWrite((b64: string) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      term.write(buf);
    });

    // 注册快照函数：读取 XTerm 当前可见缓冲区的所有文本行
    registerSnapshot(() => {
      const lines: string[] = [];
      for (let i = 0; i < term.buffer.active.length; i++) {
        const line = term.buffer.active.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      return lines.join('\n').trim();
    });

    return () => { d1.dispose(); ro.disconnect(); term.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isDark]);

  return (
    <div
      ref={ref}
      style={{
        width:      '100%', height:     '100%',
        background: isDark ? '#1e1e1e' : '#fafafa',
        padding:    4,
        display:    visible ? 'block' : 'none',
      }}
    />
  );
};

// ─── 步骤执行行（多节点进度用） ────────────────────────────────────────────

const PlanStepRow: React.FC<{
  step:      { id: string; name: string; cmd: string };
  result?:   PlanStepResult;
  isCurrent: boolean;
  isDark:    boolean;
}> = ({ step, result, isCurrent, isDark }) => {
  const [expanded, setExpanded] = useState(false);
  const displayOutput = result?.processedOutput ?? result?.stdout ?? '';
  const outputText    = [displayOutput, result?.stderr].filter(Boolean).join('\n').trimEnd();

  const icon =
    !result          ? (isCurrent ? <Spin size="small" /> : <ClockCircleOutlined style={{ color: '#6b7280' }} />)
    : result.status === 'done'    ? <CheckCircleOutlined style={{ color: '#22c55e' }} />
    : result.status === 'failed'  ? <CloseCircleOutlined style={{ color: '#ef4444' }} />
    : result.status === 'running' ? <Spin size="small" />
    : <ClockCircleOutlined style={{ color: '#6b7280' }} />;

  return (
    <div style={{
      borderLeft: `3px solid ${
        !result ? (isCurrent ? '#3b82f6' : '#3e3e42')
        : result.status === 'done'   ? '#22c55e'
        : result.status === 'failed' ? '#ef4444' : '#3e3e42'
      }`,
      paddingLeft: 8, marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space size={5}>
          {icon}
          <Text style={{ fontSize: 12 }}>{step.name}</Text>
          {result?.durationMs != null && (
            <Text type="secondary" style={{ fontSize: 10 }}>{result.durationMs}ms</Text>
          )}
          {result && (
            <Tag color={result.exitCode === 0 ? 'success' : 'error'} style={{ fontSize: 10 }}>
              exit {result.exitCode}
            </Tag>
          )}
          {result?.statusReason && (
            <Tooltip title={result.statusReason}>
              <Tag color={result.status === 'done' ? 'green' : 'red'} style={{ fontSize: 10, cursor: 'help' }}>
                {result.statusReason.startsWith('正常正则') ? '✅正则' : result.statusReason.startsWith('异常正则') ? '❌正则' : ''}
              </Tag>
            </Tooltip>
          )}
          {result?.capturedVar && (
            <Tag color="blue" style={{ fontSize: 10 }}>
              🔵 ${'{'}{ result.capturedVar.name }{'}'} ={' '}
              {result.capturedVar.value.slice(0, 20)}{result.capturedVar.value.length > 20 ? '…' : ''}
            </Tag>
          )}
        </Space>
        {outputText && (
          <Button type="link" size="small" style={{ padding: 0, fontSize: 10 }}
            onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '输出'}
          </Button>
        )}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 10, color: '#6b7280', marginTop: 1 }}>
        $ {result?.resolvedCmd ?? step.cmd}
      </div>
      {expanded && outputText && (
        <div style={{ marginTop: 4 }}>
          <ResizableOutput content={outputText} isDark={isDark} minHeight={60} maxHeight={300} showCopy />
        </div>
      )}
    </div>
  );
};

// ─── 单节点执行卡片 ────────────────────────────────────────────────────────

const NodeCard: React.FC<{
  ne:    NodeExecution;
  isDark: boolean;
}> = ({ ne, isDark }) => {
  const cardBg     = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const failCount   = Object.values(ne.results).filter((r) => r.status === 'failed').length;
  const doneCount   = Object.values(ne.results).filter((r) => r.status !== 'running').length;
  const currentIdx  = ne.steps.findIndex((s) => !ne.results[s.id]);

  const statusColor  = ne.status === 'done'    ? '#22c55e'
                      : ne.status === 'failed' ? '#ef4444'
                      : ne.status === 'running'? '#3b82f6' : '#6b7280';

  return (
    <Card
      size="small"
      style={{
        background:    cardBg,
        border:        `1px solid ${ne.status === 'failed' ? '#ef444444' : ne.status === 'done' ? '#22c55e44' : borderColor}`,
        marginBottom:  8,
      }}
      title={
        <Space>
          <Badge color={statusColor} />
          <Text strong style={{ fontSize: 13 }}>{ne.sessionName}</Text>
          {ne.status === 'running' && <Spin size="small" />}
          {ne.status === 'done' && failCount === 0 && <Tag color="success">全部正常</Tag>}
          {ne.status === 'done' && failCount > 0  && <Tag color="error">{failCount} 项异常</Tag>}
          {ne.status === 'failed' && <Tag color="error">执行失败</Tag>}
        </Space>
      }
      extra={
        ne.steps.length > 0 && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {doneCount}/{ne.steps.length}
          </Text>
        )
      }
    >
      {ne.steps.length > 0 && (
        <Progress
          percent={Math.round((doneCount / ne.steps.length) * 100)}
          strokeColor={failCount > 0 ? '#ef4444' : '#22c55e'}
          size="small"
          style={{ marginBottom: 8 }}
        />
      )}
      {ne.steps.map((step, i) => (
        <PlanStepRow
          key={step.id}
          step={step}
          result={ne.results[step.id]}
          isCurrent={i === currentIdx}
          isDark={isDark}
        />
      ))}
      {ne.finalVarContext && Object.keys(ne.finalVarContext).length > 0 && (
        <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(59,130,246,0.06)', borderRadius: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>变量：</Text>
          {Object.entries(ne.finalVarContext).map(([k, v]) => (
            <Tag key={k} color="blue" style={{ fontSize: 10, margin: 1 }}>
              ${'{'}{ k }{'}'} = {v.slice(0, 30)}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  );
};

// ─── 档案编辑弹窗 ──────────────────────────────────────────────────────────

const ProfileModal: React.FC<{
  open: boolean;
  initial?: SSHProfile | null;
  onOk: (p: Omit<SSHProfile, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
  checkKeyFile: (p: string) => Promise<{ ok: boolean; resolved?: string; msg?: string }>;
}> = ({ open, initial, onOk, onCancel, checkKeyFile }) => {
  const [form] = Form.useForm();
  const [authType, setAuthType] = useState<'privateKey' | 'password' | 'agent'>('privateKey');
  const [keyMsg,   setKeyMsg]   = useState('');

  useEffect(() => {
    if (open) {
      form.setFieldsValue(initial ?? { port: 22, authType: 'privateKey' });
      setAuthType(initial?.authType ?? 'privateKey');
      setKeyMsg('');
    }
  }, [open, initial, form]);

  const handleCheckKey = async () => {
    const p = form.getFieldValue('keyFilePath');
    if (!p) return;
    const r = await checkKeyFile(p) as { ok: boolean; resolved?: string; msg?: string };
    setKeyMsg(r.ok ? `✅ 可读: ${r.resolved ?? p}` : `❌ ${r.msg ?? '不可读'}`);
  };

  return (
    <Modal title={initial ? '编辑档案' : '新建连接档案'} open={open}
      onOk={async () => { const v = await form.validateFields(); onOk(v); }}
      onCancel={onCancel} okText="保存" cancelText="取消" width={500}>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="name" label="档案名称" rules={[{ required: true }]}>
          <Input placeholder="例：生产环境-主集群" />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
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
          <Form.Item name="keyFilePath" label="私钥文件路径"
            extra={keyMsg && <Text style={{ fontSize: 11 }}>{keyMsg}</Text>}>
            <Space.Compact style={{ width: '100%' }}>
              <Input prefix={<KeyOutlined style={{ color: '#a1a1aa' }} />}
                placeholder="~/.ssh/id_rsa" />
              <Button icon={<FolderOpenOutlined />} onClick={handleCheckKey}>验证</Button>
            </Space.Compact>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

const SSHManager: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark    = theme === 'dark';

  const {
    profiles, sessions, activeSessionId, proxyOnline, multiNodeRun,
    addProfile, updateProfile, deleteProfile,
    addSession, removeSession, renameSession, setActiveSession,
    checkProxy, setSessionTermCallback,
    connectSession, disconnectSession, sendInputToSession, resizeSession,
    startMultiNodeRun, cancelMultiNodeRun, clearMultiNodeRun,
    checkKeyFile,
  } = useSSHStore();

  const { instances, updateCheckResult, appendSubStepResult, setInstanceStatus } = useSOPStore();

  const [messageApi, ctx]     = message.useMessage();
  const [profileModal, setProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SSHProfile | null>(null);
  const [connectModal, setConnectModal]     = useState(false);
  const [connectingSessionId, setConnectingSessionId] = useState('');
  const [renamingSessionId, setRenamingSessionId]     = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [connectForm] = Form.useForm();

  // ── 多节点执行配置 ────────────────────────────────────────────────────────
  const [execMode,      setExecMode]      = useState<'broadcast' | 'targeted'>('broadcast');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [broadcastInstanceId, setBroadcastInstanceId] = useState('');
  const [targetedMap, setTargetedMap]     = useState<Record<string, string>>({});
  const [varValues,   setVarValues]       = useState<Record<string, string>>({});
  const [executing,   setExecuting]       = useState(false);
  const [activeView,  setActiveView]      = useState<'terminal' | 'progress' | 'journal'>('terminal');

  // ── 终端写入函数 Map（每会话一个） ────────────────────────────────────────
  const writeCallbacks    = useRef<Map<string, (b64: string) => void>>(new Map());
  const snapshotCallbacks = useRef<Map<string, () => string>>(new Map());
  // 每会话的键盘输入缓冲（检测手动命令行）
  const cmdBuffers        = useRef<Map<string, string>>(new Map());

  const { addEntry, addSOPNodeResults } = useJournalStore();

  // 定期检查代理
  useEffect(() => {
    checkProxy();
    const t = setInterval(checkProxy, 5000);
    return () => clearInterval(t);
  }, [checkProxy]);

  // 为每个会话注册终端数据回调
  useEffect(() => {
    sessions.forEach((sess) => {
      setSessionTermCallback(sess.id, (b64) => {
        writeCallbacks.current.get(sess.id)?.(b64);
      });
    });
  }, [sessions, setSessionTermCallback]);

  // 执行完成后切到进度视图
  useEffect(() => {
    if (multiNodeRun && !multiNodeRun.doneAt) setActiveView('progress');
  }, [multiNodeRun]);

  const cardBg      = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const connectedSessions = sessions.filter((s) => s.status === 'connected');

  // ── 变量收集（来自选中实例中的占位符） ────────────────────────────────────
  const allVarNames = Array.from(new Set(
    [...selectedNodes].flatMap((sessionId) => {
      const instId = execMode === 'broadcast' ? broadcastInstanceId : targetedMap[sessionId];
      const inst   = instances.find((i) => i.id === instId);
      if (!inst) return [];
      return [...inst.checkResults, ...inst.extraChecks]
        .flatMap((r) => {
          const subs = r.subSteps ?? [];
          if (subs.length > 0) return subs.flatMap((ss) => [...(ss.command.matchAll(/\$\{([^}]+)\}/g))].map((m) => m[1]));
          return [...(r.command.matchAll(/\$\{([^}]+)\}/g))].map((m) => m[1]);
        });
    })
  ));

  // ── 构建单会话的执行步骤列表 ──────────────────────────────────────────────
  function buildSteps(instanceId: string) {
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return [];
    const steps: import('./store/sshStore').PlanStep[] = [];
    [...inst.checkResults, ...inst.extraChecks].forEach((cr) => {
      const subs = cr.subSteps ?? [];
      if (subs.length > 0) {
        subs.forEach((ss) => steps.push({
          id: ss.id, name: ss.name,
          cmd: renderTemplate(ss.command, varValues),
          captureVar: ss.captureVar, capturePattern: ss.capturePattern,
          normalRegex: ss.normalRegex, abnormalRegex: ss.abnormalRegex,
          scriptPath: ss.scriptPath, timeout: ss.timeoutMs ?? 30000,
          checkId: cr.checkId, isSubStep: true,
        }));
      } else {
        const cmd = renderTemplate(cr.command, varValues);
        if (cmd.trim()) steps.push({
          id: cr.checkId, name: cr.checkName, cmd,
          checkId: cr.checkId, isSubStep: false,
        });
      }
    });
    return steps;
  }

  // ── 开始多节点执行 ────────────────────────────────────────────────────────
  const handleRunMultiNode = async () => {
    if (selectedNodes.length === 0) { messageApi.warning('请至少选择一个节点'); return; }

    const configs = selectedNodes.map((sessionId) => {
      const instId = execMode === 'broadcast' ? broadcastInstanceId : targetedMap[sessionId];
      const inst   = instances.find((i) => i.id === instId);
      return {
        sessionId,
        instanceId:   instId,
        instanceTitle: inst?.incidentTitle ?? '',
        templateName:  inst?.templateName  ?? '',
        steps:         buildSteps(instId),
      };
    }).filter((c) => c.instanceId && c.steps.length > 0);

    if (configs.length === 0) { messageApi.warning('所选节点无可执行步骤'); return; }

    setExecuting(true);
    try {
      await startMultiNodeRun(configs, execMode);

      // 写回 SOPInstance
      const run = useSSHStore.getState().multiNodeRun;
      run?.nodeExecutions.forEach((ne) => {
        const inst = instances.find((i) => i.id === ne.instanceId);
        if (!inst) return;
        ne.steps.forEach((step) => {
          const r = ne.results[step.id];
          if (!r) return;
          if (step.isSubStep && step.checkId) {
            appendSubStepResult(inst.id, step.checkId, {
              subStepId: step.id, name: step.name,
              command: r.resolvedCmd ?? step.cmd,
              stdout: r.stdout, stderr: r.stderr,
              exitCode: r.exitCode, durationMs: r.durationMs,
              capturedVar: r.capturedVar,
            });
          } else if (step.checkId) {
            updateCheckResult(inst.id, step.checkId, {
              output:     r.processedOutput ?? r.stdout,
              status:     r.exitCode === 0 ? 'normal' : 'abnormal',
              conclusion: r.statusReason ?? `exit ${r.exitCode}`,
            });
          }
        });
        setInstanceStatus(inst.id, 'resolved');
      });

      // 自动将执行结果写入每个会话的日志
      if (run) {
        addSOPNodeResults(
          run.nodeExecutions.map((ne) => ({
            sessionId:   ne.sessionId,
            sessionName: ne.sessionName,
            instanceId:  ne.instanceId,
            steps: ne.steps.map((step) => {
              const r = ne.results[step.id];
              return {
                name:        step.name,
                command:     r?.resolvedCmd ?? step.cmd,
                output:      r?.processedOutput ?? r?.stdout ?? '',
                exitCode:    r?.exitCode ?? -1,
                durationMs:  r?.durationMs ?? 0,
                statusReason: r?.statusReason,
                capturedVar:  r?.capturedVar,
              };
            }),
          }))
        );
      }

      const failCount = run?.nodeExecutions.filter((ne) => ne.status === 'failed').length ?? 0;
      failCount === 0
        ? messageApi.success(`✅ ${configs.length} 个节点全部执行完成`)
        : messageApi.warning(`⚠️ ${configs.length} 个节点执行完成，${failCount} 个异常`);
    } finally {
      setExecuting(false);
    }
  };

  // ── 导出多节点报告 ────────────────────────────────────────────────────────
  const handleExportReport = () => {
    if (!multiNodeRun) return;
    const profile = (sessionId: string) =>
      profiles.find((p) => p.id === sessions.find((s) => s.id === sessionId)?.profileId);

    const nodes: NodeReportData[] = multiNodeRun.nodeExecutions.map((ne) => ({
      sessionName:   ne.sessionName,
      host:          profile(ne.sessionId)?.host,
      instanceTitle: ne.instanceTitle ?? '',
      templateName:  ne.templateName  ?? '',
      status:        ne.status,
      steps: ne.steps.map((step) => {
        const r = ne.results[step.id];
        return {
          name: step.name, command: r?.resolvedCmd ?? step.cmd,
          stdout: r?.processedOutput ?? r?.stdout ?? '',
          stderr: r?.stderr ?? '', exitCode: r?.exitCode ?? -1,
          durationMs: r?.durationMs ?? 0,
          statusReason: r?.statusReason,
          capturedVar:  r?.capturedVar,
        };
      }),
      finalVarContext: ne.finalVarContext,
    }));

    const md   = generateMultiNodeReport({ runId: multiNodeRun.id, mode: multiNodeRun.mode, startedAt: multiNodeRun.startedAt, nodes });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `多节点排查报告-${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    messageApi.success('多节点报告已导出');
  };

  // ── 连接会话 ──────────────────────────────────────────────────────────────
  const handleOpenConnect = (sessionId: string) => {
    setConnectingSessionId(sessionId);
    connectForm.resetFields();
    setConnectModal(true);
  };

  const handleConnect = async () => {
    const vals = await connectForm.validateFields().catch(() => null);
    if (!vals) return;
    connectSession(connectingSessionId, { passphrase: vals.passphrase, password: vals.password });
    setConnectModal(false);
  };

  const connectingProfile = profiles.find(
    (p) => p.id === sessions.find((s) => s.id === connectingSessionId)?.profileId
  );

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ctx}

      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>SSH Manager</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            多节点会话管理 · 复用预处理终端 · 分布式 SOP 执行
          </Text>
        </div>
        <Space>
          <Badge status={proxyOnline ? 'success' : 'default'} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {proxyOnline ? '代理运行中' : '代理未启动'}
          </Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={checkProxy} />
        </Space>
      </div>

      {/* 代理未启动提示 */}
      {!proxyOnline && (
        <Alert type="warning" showIcon
          message="SSH Proxy 代理服务未运行"
          description={
            <pre style={{ margin: '6px 0 0', fontSize: 11, fontFamily: 'JetBrains Mono, Consolas, monospace' }}>
              cd devutility-hub/server{'\n'}node index.js
            </pre>
          }
        />
      )}

      {/* 主体三栏 */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 370px', gap: 14, alignItems: 'start' }}>

        {/* ══ 左栏：档案 + 会话 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* 连接档案 */}
          <Card size="small" title="连接档案"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
            extra={
              <Button size="small" icon={<PlusOutlined />} type="dashed"
                onClick={() => { setEditingProfile(null); setProfileModal(true); }}>
                新建
              </Button>
            }>
            {profiles.length === 0
              ? <Text type="secondary" style={{ fontSize: 12 }}>暂无档案</Text>
              : profiles.map((p) => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 0', borderBottom: `1px solid ${borderColor}`,
                }}>
                  <div>
                    <Text style={{ fontSize: 12 }}>{p.name}</Text>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      {p.username}@{p.host}:{p.port}
                    </Text>
                  </div>
                  <Space size={4}>
                    <Tooltip title="添加会话">
                      <Button size="small" icon={<PlusOutlined />} type="dashed"
                        onClick={() => addSession(`${p.name}-${Date.now().toString(36).slice(-4)}`, p.id)}
                        disabled={!proxyOnline}
                      />
                    </Tooltip>
                    <EditOutlined style={{ cursor: 'pointer', color: '#a1a1aa', fontSize: 12 }}
                      onClick={() => { setEditingProfile(p); setProfileModal(true); }} />
                    <Popconfirm title="删除此档案？"
                      onConfirm={() => deleteProfile(p.id)}
                      okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                      <DeleteOutlined style={{ cursor: 'pointer', color: '#ef4444', fontSize: 12 }} />
                    </Popconfirm>
                  </Space>
                </div>
              ))}
          </Card>

          {/* 活跃会话列表 */}
          <Card size="small"
            title={
              <Space>
                <GlobalOutlined />
                <Text strong>会话</Text>
                <Badge count={sessions.length} color="#3b82f6" size="small" />
              </Space>
            }
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
            {sessions.length === 0
              ? <Text type="secondary" style={{ fontSize: 12 }}>点击档案的 + 按钮创建会话</Text>
              : sessions.map((sess) => {
                const sc  = STATUS[sess.status];
                const prf = profiles.find((p) => p.id === sess.profileId);
                return (
                  <div key={sess.id} style={{
                    padding: '6px 8px', borderRadius: 6, marginBottom: 6,
                    border: `1px solid ${activeSessionId === sess.id ? '#3b82f6' : borderColor}`,
                    background: activeSessionId === sess.id
                      ? isDark ? '#1e3a5f' : '#eff6ff'
                      : isDark ? '#2d2d30' : '#fafafa',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActiveSession(sess.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {/* 会话名称（可内联编辑） */}
                      {renamingSessionId === sess.id ? (
                        <Input
                          size="small"
                          value={renameValue}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => { renameSession(sess.id, renameValue || sess.name); setRenamingSessionId(''); }}
                          onPressEnter={() => { renameSession(sess.id, renameValue || sess.name); setRenamingSessionId(''); }}
                          style={{ width: 140 }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <Space size={5}>
                          <Badge status={sc.badge} />
                          <Text
                            strong
                            style={{ fontSize: 12, cursor: 'text', color: activeSessionId === sess.id ? '#3b82f6' : undefined }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setRenamingSessionId(sess.id);
                              setRenameValue(sess.name);
                            }}
                          >
                            {sess.name}
                          </Text>
                        </Space>
                      )}
                      <Space size={3} onClick={(e) => e.stopPropagation()}>
                        {sess.status !== 'connected' ? (
                          <Button size="small" type="primary"
                            icon={<ApiOutlined />}
                            disabled={!proxyOnline}
                            onClick={() => handleOpenConnect(sess.id)}>
                            连接
                          </Button>
                        ) : (
                          <Button size="small" danger
                            icon={<DisconnectOutlined />}
                            onClick={() => disconnectSession(sess.id)}>
                            断开
                          </Button>
                        )}
                        <Popconfirm title="删除此会话？"
                          onConfirm={() => removeSession(sess.id)}
                          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                          <DeleteOutlined style={{ color: '#ef4444', cursor: 'pointer', fontSize: 12 }} />
                        </Popconfirm>
                      </Space>
                    </div>
                    {prf && (
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 1 }}>
                        {prf.username}@{prf.host}:{prf.port}
                        {sess.status === 'error' && ` · ${sess.statusMsg}`}
                      </Text>
                    )}
                    <Text type="secondary" style={{ fontSize: 10 }}>双击名称重命名</Text>
                  </div>
                );
              })}
          </Card>
        </div>

        {/* ══ 中栏：Tab 终端 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Segmented
            value={activeView}
            onChange={(v) => setActiveView(v as typeof activeView)}
            options={[
              { label: '终端', value: 'terminal' },
              {
                label: multiNodeRun
                  ? `多节点进度 (${multiNodeRun.nodeExecutions.filter((ne) => ne.status !== 'pending').length}/${multiNodeRun.nodeExecutions.length})`
                  : '多节点进度',
                value: 'progress',
              },
              {
                label: activeSessionId
                  ? `会话日志 (${(useJournalStore.getState().journals[activeSessionId] ?? []).length})`
                  : '会话日志',
                value: 'journal',
              },
            ]}
          />

          {activeView === 'terminal' ? (
            <div style={{
              border: `1px solid ${borderColor}`, borderRadius: 6,
              overflow: 'hidden', minHeight: 400, background: isDark ? '#1e1e1e' : '#fafafa',
            }}>
              {/* Tab 切换 */}
              {sessions.length > 0 && (
                <div style={{
                  display: 'flex', overflowX: 'auto',
                  borderBottom: `1px solid ${borderColor}`,
                  background: isDark ? '#252526' : '#fafafa',
                }}>
                  {sessions.map((sess) => {
                    const sc = STATUS[sess.status];
                    return (
                      <div
                        key={sess.id}
                        onClick={() => setActiveSession(sess.id)}
                        style={{
                          padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
                          borderBottom: activeSessionId === sess.id ? '2px solid #3b82f6' : '2px solid transparent',
                          background: activeSessionId === sess.id
                            ? isDark ? '#1e1e1e' : '#ffffff'
                            : 'transparent',
                          fontSize: 12,
                        }}
                      >
                        <Badge status={sc.badge} />
                        <span style={{ marginLeft: 4, color: activeSessionId === sess.id ? '#3b82f6' : undefined }}>
                          {sess.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 每个会话的终端（CSS display 控制显隐，保留历史） */}
              <div style={{ height: sessions.length > 0 ? 'calc(100% - 34px)' : '100%', minHeight: 360 }}>
                {sessions.length === 0 ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', color: '#6b7280', fontSize: 13,
                  }}>
                    从左侧档案点击 + 创建会话后连接
                  </div>
                ) : (
                  sessions.map((sess) => (
                    <TerminalInstance
                      key={sess.id}
                      sessionId={sess.id}
                      isDark={isDark}
                      visible={sess.id === activeSessionId && activeView === 'terminal'}
                      onInput={(data) => {
                        sendInputToSession(sess.id, data);
                        // 键盘截收：缓冲字符，Enter 时保存为 manual_cmd
                        const buf = cmdBuffers.current.get(sess.id) ?? '';
                        if (data === '\r') {
                          const cmd = buf.trim();
                          if (cmd) {
                            addEntry({
                              sessionId:   sess.id,
                              sessionName: sess.name,
                              type:        'manual_cmd',
                              timestamp:   Date.now(),
                              command:     cmd,
                            });
                          }
                          cmdBuffers.current.set(sess.id, '');
                        } else if (data === '\x7f' || data === '\b') {
                          cmdBuffers.current.set(sess.id, buf.slice(0, -1));
                        } else if (data.charCodeAt(0) >= 32 && !data.startsWith('\x1b')) {
                          cmdBuffers.current.set(sess.id, buf + data);
                        }
                      }}
                      onResize={(cols, rows) => resizeSession(sess.id, cols, rows)}
                      registerWrite={(fn) => { writeCallbacks.current.set(sess.id, fn); }}
                      registerSnapshot={(fn) => { snapshotCallbacks.current.set(sess.id, fn); }}
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            /* 多节点进度视图 */
            <Card size="small"
              title={
                <Space>
                  <Text strong>多节点执行进度</Text>
                  {multiNodeRun && !multiNodeRun.doneAt && <Spin size="small" />}
                  {multiNodeRun?.doneAt && (
                    multiNodeRun.nodeExecutions.every((ne) => ne.status === 'done')
                      ? <Tag color="success">全部成功</Tag>
                      : <Tag color="error">{multiNodeRun.nodeExecutions.filter((ne) => ne.status === 'failed').length} 个节点异常</Tag>
                  )}
                </Space>
              }
              extra={
                multiNodeRun?.doneAt && (
                  <Space>
                    <Button size="small" icon={<ExportOutlined />} onClick={handleExportReport}>
                      导出多节点报告
                    </Button>
                    <Button size="small" onClick={clearMultiNodeRun}>清除</Button>
                  </Space>
                )
              }
              style={{ background: cardBg, border: `1px solid ${borderColor}`, minHeight: 400 }}
            >
              {!multiNodeRun ? (
                <Text type="secondary">在右侧配置节点和 SOP 后开始执行</Text>
              ) : (
                <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                  {multiNodeRun.nodeExecutions.map((ne) => (
                    <NodeCard key={ne.sessionId} ne={ne} isDark={isDark} />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* ── 会话日志视图 */}
          {activeView === 'journal' && (
            <div
              style={{
                border: `1px solid ${borderColor}`, borderRadius: 6,
                minHeight: 400, display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {activeSessionId ? (
                <SessionJournal
                  sessionId={activeSessionId}
                  sessionName={sessions.find((s) => s.id === activeSessionId)?.name ?? ''}
                  onSnapshotRequest={() =>
                    snapshotCallbacks.current.get(activeSessionId)?.() ?? ''
                  }
                />
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flex: 1, color: '#6b7280', fontSize: 13, padding: 40,
                }}>
                  请先从左侧选择一个会话
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══ 右栏：多节点执行配置 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card size="small"
            title={
              <Space>
                <Text strong>多节点 SOP 执行</Text>
                <Tag color={connectedSessions.length > 0 ? 'blue' : 'default'} style={{ fontSize: 10 }}>
                  {connectedSessions.length} 个已连接
                </Tag>
              </Space>
            }
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* 执行模式 */}
              <div>
                <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>执行模式</Text>
                <Segmented
                  value={execMode}
                  onChange={(v) => setExecMode(v as typeof execMode)}
                  style={{ width: '100%' }}
                  options={[
                    { label: '广播（同一 SOP）', value: 'broadcast' },
                    { label: '定向（独立 SOP）', value: 'targeted' },
                  ]}
                />
              </div>

              <Divider style={{ margin: '2px 0' }} />

              {/* 节点选择 */}
              <div>
                <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>选择执行节点</Text>
                {sessions.length === 0 ? (
                  <Alert type="info" showIcon={false} message={<Text type="secondary" style={{ fontSize: 11 }}>暂无会话，请先创建并连接</Text>} />
                ) : (
                  sessions.map((sess) => {
                    const sc       = STATUS[sess.status];
                    const isConn   = sess.status === 'connected';
                    const selected = selectedNodes.includes(sess.id);
                    return (
                      <div
                        key={sess.id}
                        onClick={() => {
                          if (!isConn) return;
                          setSelectedNodes((prev) =>
                            prev.includes(sess.id) ? prev.filter((id) => id !== sess.id) : [...prev, sess.id]
                          );
                        }}
                        style={{
                          padding: '6px 8px', borderRadius: 6, marginBottom: 4,
                          border: `1px solid ${selected ? '#3b82f6' : borderColor}`,
                          background: selected
                            ? isDark ? '#1e3a5f' : '#eff6ff'
                            : isDark ? '#2d2d30' : '#fafafa',
                          cursor: isConn ? 'pointer' : 'not-allowed',
                          opacity: isConn ? 1 : 0.5,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}
                      >
                        <Space size={4}>
                          <Badge status={sc.badge} />
                          <Text style={{ fontSize: 12 }}>{sess.name}</Text>
                        </Space>
                        <Tag style={{ fontSize: 10 }} color={isConn ? 'green' : 'default'}>
                          {sc.label}
                        </Tag>
                      </div>
                    );
                  })
                )}
              </div>

              <Divider style={{ margin: '2px 0' }} />

              {/* 广播模式：统一 SOP 实例 */}
              {execMode === 'broadcast' ? (
                <div>
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>SOP 排查实例（全部节点执行）</Text>
                  <Select
                    size="small"
                    value={broadcastInstanceId || undefined}
                    onChange={setBroadcastInstanceId}
                    placeholder="选择 SOP 实例"
                    style={{ width: '100%' }}
                    options={instances.map((i) => ({
                      label: <Space size={4}><span style={{ fontSize: 12 }}>{i.incidentTitle}</span><Tag style={{ fontSize: 10 }}>{i.templateName}</Tag></Space>,
                      value: i.id,
                    }))}
                  />
                </div>
              ) : (
                /* 定向模式：每个节点选不同 SOP */
                <div>
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>各节点 SOP 实例</Text>
                  {selectedNodes.length === 0
                    ? <Text type="secondary" style={{ fontSize: 11 }}>请先选择节点</Text>
                    : selectedNodes.map((sessionId) => {
                      const sess = sessions.find((s) => s.id === sessionId);
                      return (
                        <div key={sessionId} style={{ marginBottom: 6 }}>
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                            {sess?.name}
                          </Text>
                          <Select
                            size="small"
                            value={targetedMap[sessionId] || undefined}
                            onChange={(v) => setTargetedMap((prev) => ({ ...prev, [sessionId]: v }))}
                            placeholder="选择此节点的 SOP"
                            style={{ width: '100%' }}
                            options={instances.map((i) => ({ label: i.incidentTitle, value: i.id }))}
                          />
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 变量填写 */}
              {allVarNames.length > 0 && (
                <div>
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>命令变量</Text>
                  {allVarNames.map((v) => (
                    <Input key={v} size="small"
                      prefix={<Text type="secondary" style={{ fontSize: 11 }}>{v}:</Text>}
                      value={varValues[v] ?? ''}
                      onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                      style={{ marginBottom: 4, fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }}
                    />
                  ))}
                </div>
              )}

              <Divider style={{ margin: '2px 0' }} />

              {/* 预处理提示 */}
              {selectedNodes.length > 0 && (
                <Alert type="info" showIcon={false} style={{ fontSize: 11, padding: '6px 10px' }}
                  message={
                    <div>
                      <Text strong style={{ fontSize: 12 }}>执行前请在对应终端完成：</Text>
                      {['堡垒机跳转 / 切换目标主机', 'sudo su - root（如需）', 'cd 目标目录', 'source 环境变量'].map((s, i) => (
                        <Text key={i} type="secondary" style={{ fontSize: 11, display: 'block' }}>{i + 1}. {s}</Text>
                      ))}
                    </div>
                  }
                />
              )}

              {/* 执行按钮 */}
              {!executing ? (
                <Button type="primary" icon={<PlayCircleOutlined />} block
                  onClick={handleRunMultiNode}
                  disabled={selectedNodes.length === 0 || (execMode === 'broadcast' && !broadcastInstanceId)}>
                  开始多节点执行 ({selectedNodes.length} 节点)
                </Button>
              ) : (
                <Button danger icon={<StopOutlined />} block onClick={cancelMultiNodeRun}>
                  取消执行
                </Button>
              )}

              {/* 执行完成后导出按钮 */}
              {multiNodeRun?.doneAt && (
                <Button icon={<ExportOutlined />} block onClick={handleExportReport}>
                  导出多节点报告 (.md)
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── 档案编辑弹窗 */}
      <ProfileModal
        open={profileModal}
        initial={editingProfile}
        onOk={(p) => {
          if (editingProfile) updateProfile(editingProfile.id, p);
          else addProfile(p);
          setProfileModal(false);
        }}
        onCancel={() => setProfileModal(false)}
        checkKeyFile={checkKeyFile}
      />

      {/* ── 连接凭证弹窗 */}
      <Modal title={`连接 ${sessions.find((s) => s.id === connectingSessionId)?.name ?? ''}`}
        open={connectModal}
        onOk={handleConnect} onCancel={() => setConnectModal(false)}
        okText="连接" cancelText="取消">
        <Form form={connectForm} layout="vertical" style={{ marginTop: 12 }}>
          {connectingProfile?.authType === 'privateKey' && (
            <Form.Item name="passphrase" label="私钥 Passphrase">
              <Password prefix={<LockOutlined />} placeholder="私钥加密口令，无加密则留空" autoComplete="off" />
            </Form.Item>
          )}
          {connectingProfile?.authType === 'password' && (
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Password prefix={<LockOutlined />} placeholder="SSH 登录密码" autoComplete="off" />
            </Form.Item>
          )}
          <Alert type="info" showIcon={false}
            message={<Text style={{ fontSize: 12 }}>凭证仅本次会话使用，不保存</Text>} />
        </Form>
      </Modal>
    </div>
  );
};

export default SSHManager;
