/**
 * SSH Manager — 多节点版
 *
 * 布局：
 *   左栏(280px): 连接档案 + 命名会话列表
 *   中栏:        Tab 终端（每会话一个 Tab，含独立 XTerm 实例）
 *   右栏(380px): 多节点 SOP 执行配置 + 实时进度
 */
import {
    ApiOutlined,
    BgColorsOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    CopyOutlined,
    DeleteOutlined,
    DisconnectOutlined,
    EditOutlined,
    ExportOutlined,
    FolderOpenOutlined,
    GlobalOutlined,
    KeyOutlined, LockOutlined,
    PlayCircleOutlined,
    PlusOutlined,
    ReloadOutlined,
    SearchOutlined,
    StopOutlined,
    ThunderboltOutlined,
} from '@ant-design/icons';
import { SearchAddon } from '@xterm/addon-search';
import {
    Alert,
    Badge,
    Button,
    Card,
    Divider, Form,
    Input, InputNumber,
    message,
    Modal,
    Popconfirm,
    Progress,
    Segmented,
    Select, Space,
    Spin,
    Switch,
    Tag,
    Tooltip,
    Typography,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import ResizableOutput from '../../components/shared/ResizableOutput';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useGlobalStore } from '../../store/globalStore';
import type { NodeReportData } from '../../utils';
import {
    extractTemplateVariables,
    generateMultiNodeReport, renderTemplate,
} from '../../utils';
import { useSOPStore } from '../SOPBuilder/store/sopStore';
import BackgroundJobMonitor from './components/BackgroundJobMonitor';
import BatchLoginModal from './components/BatchLoginModal';
import CredentialManager from './components/CredentialManager';
import KeywordAnalyzer from './components/KeywordAnalyzer';
import NodeContextPanel from './components/NodeContextPanel';
import SessionJournal from './components/SessionJournal';
import SessionGroupModal from './components/SessionGroupModal';
import { useAnalyzerStore } from './store/analyzerStore';
import { useCronStore } from './store/cronStore';
import { useJournalStore } from './store/journalStore';
import type { NodeExecution, PlanStepResult, SessionGroup, SSHProfile, SSHSession } from './store/sshStore';
import { getTerminalBuffer, recordManualCommandStart, useSSHStore } from './store/sshStore';

const { Title, Text } = Typography;
const { Password } = Input;
const PROXY_HTTP = 'http://127.0.0.1:3001';

// ─── 状态配置 ─────────────────────────────────────────────────────────────

type ConnStatus = SSHSession['status'];
const STATUS: Record<ConnStatus, { badge: 'default' | 'processing' | 'success' | 'error'; color: string; label: string }> = {
  idle:         { badge: 'default',    color: '#6b7280', label: '未连接' },
  connecting:   { badge: 'processing', color: '#3b82f6', label: '连接中' },
  connected:    { badge: 'success',    color: '#22c55e', label: '已连接' },
  error:        { badge: 'error',      color: '#ef4444', label: '失败'   },
  disconnected: { badge: 'default',    color: '#6b7280', label: '已断开' },
};

interface PrepareProfileStep {
  name: string;
  cmd: string;
  cacheScope?: string;
  cacheTtlMs?: number;
  mode?: 'exec' | 'pty';
  parallelGroup?: string;
  phase?: 'ready' | 'context';
  timeoutMs?: number;
  timeout?: number;
}

interface PrepareProfile {
  profileId: string;
  name: string;
  description?: string;
  steps: PrepareProfileStep[];
  createdAt?: number;
  updatedAt?: number;
}

interface PrepareResultStep {
  name: string;
  cmd: string;
  cachedAt?: number;
  cacheTtlMs?: number;
  finishedAt?: number;
  fromCache?: boolean;
  mode?: 'exec' | 'pty';
  parallelGroup?: string;
  phase?: 'ready' | 'context';
  processedOutput?: string;
  resolvedCmd?: string;
  startedAt?: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  status: 'done' | 'failed';
  statusReason?: string;
}

interface PrepareRunResult {
  cachedStepCount?: number;
  contextStepCount?: number;
  finalVarContext?: Record<string, string>;
  profile?: PrepareProfile | null;
  readyDurationMs?: number;
  readyStepCount?: number;
  status: 'done' | 'failed';
  steps: PrepareResultStep[];
  totalDurationMs?: number;
}

interface PrepareSettings {
  profileId: string;
  autoRun: boolean;
  continueOnError: boolean;
}

interface PrepareRunSummary {
  cachedStepCount: number;
  contextStepCount: number;
  profileId: string;
  profileName: string;
  readyDurationMs: number;
  readyStepCount: number;
  status: 'done' | 'failed';
  stepCount: number;
  failedCount: number;
  finishedAt: number;
  totalDurationMs: number;
  connectedAt?: number;
  trigger: 'auto' | 'manual';
}

function formatDurationLabel(value?: number) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms >= 1000) {
    const seconds = ms / 1000;
    return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

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
  registerGetCurrentLine?: (fn: () => string) => void;
}> = ({ sessionId, isDark, visible, onInput, onResize, registerWrite, registerSnapshot, registerGetCurrentLine }) => {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [searchOpen, setSearchOpen]   = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [highlightKeyword, setHighlightKeyword] = useState('');
  const [highlightColor, setHighlightColor] = useState('#ef4444');
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const { highlightRules, addHighlightRule, removeHighlightRule } = useAnalyzerStore();
  const highlightRulesRef = useRef(highlightRules);
  highlightRulesRef.current = highlightRules;

  const applyHighlights = (bin: string, rules: typeof highlightRules) => {
    if (!rules.length) return bin;
    let result = bin;
    rules.forEach(rule => {
      if (!rule.keyword) return;
      try {
        const hex = rule.color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) || 255;
        const g = parseInt(hex.substring(2, 4), 16) || 255;
        const b = parseInt(hex.substring(4, 6), 16) || 255;
        const regex = new RegExp(`(${rule.keyword})`, 'gi');
        result = result.replace(regex, `\x1b[38;2;${r};${g};${b}m$1\x1b[0m`);
      } catch {
        // ignore bad regex
      }
    });
    return result;
  };

  // Re-apply highlights to existing buffer when rules change
  useEffect(() => {
    if (!termRef.current) return;
    const rawBuffer = getTerminalBuffer(sessionId);
    const highlighted = applyHighlights(rawBuffer, highlightRules);
    termRef.current.clear();
    const buf = new Uint8Array(highlighted.length);
    for (let i = 0; i < highlighted.length; i++) buf[i] = highlighted.charCodeAt(i);
    termRef.current.write(buf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRules, sessionId]);

  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      theme: isDark
        ? { background: '#1e1e1e', foreground: '#d4d4d8', cursor: '#3b82f6' }
        : { background: '#fafafa', foreground: '#18181b', cursor: '#3b82f6' },
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      fontSize: 13, lineHeight: 1.4, cursorBlink: true, scrollback: 5000,
      convertEol: true,
    });
    termRef.current = term;
    const fit = new FitAddon();
    const search = new SearchAddon();
    searchAddonRef.current = search;
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(ref.current);

    // 恢复历史缓冲区（带高亮）
    const initBuffer = getTerminalBuffer(sessionId);
    if (initBuffer) {
      const highlighted = applyHighlights(initBuffer, highlightRulesRef.current);
      const buf = new Uint8Array(highlighted.length);
      for (let i = 0; i < highlighted.length; i++) buf[i] = highlighted.charCodeAt(i);
      term.write(buf);
    }

    requestAnimationFrame(() => { fit.fit(); onResize(term.cols, term.rows); });

    const d1 = term.onData(onInput);
    const ro = new ResizeObserver(() => { if (visible) { fit.fit(); onResize(term.cols, term.rows); } });
    ro.observe(ref.current);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      if (e.key === 'Escape') { setSearchOpen(false); setHighlightOpen(false); }
    };
    ref.current?.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);

    registerWrite((b64: string) => {
      const bin = atob(b64);
      const highlighted = applyHighlights(bin, highlightRulesRef.current);
      const bytes = new Uint8Array(highlighted.length);
      for (let i = 0; i < highlighted.length; i++) bytes[i] = highlighted.charCodeAt(i);
      term.write(bytes);
    });

    registerSnapshot(() => {
      const lines: string[] = [];
      for (let i = 0; i < term.buffer.active.length; i++) {
        const line = term.buffer.active.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      return lines.join('\n').trim();
    });

    if (registerGetCurrentLine) {
      registerGetCurrentLine(() => {
        const active = term.buffer.active;
        const line = active.getLine(active.baseY + active.cursorY);
        return line ? line.translateToString(true) : '';
      });
    }

    return () => {
      d1.dispose(); ro.disconnect(); term.dispose(); termRef.current = null;
      document.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isDark]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: visible ? 'flex' : 'none', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ position: 'absolute', top: 4, right: 12, zIndex: 101, display: 'flex', gap: 4 }}>
        <Tooltip title="搜索 (Ctrl+F)">
          <Button size="small" icon={<SearchOutlined />} onClick={() => { setSearchOpen(v => !v); setHighlightOpen(false); }} />
        </Tooltip>
        <Tooltip title="关键字高亮">
          <Button size="small" icon={<BgColorsOutlined />} onClick={() => { setHighlightOpen(v => !v); setSearchOpen(false); }} />
        </Tooltip>
      </div>

      {/* 搜索浮层 */}
      {searchOpen && (
        <div style={{
          position: 'absolute', top: 36, right: 12, zIndex: 100,
          display: 'flex', gap: 4, alignItems: 'center',
          background: isDark ? '#252526' : '#fff',
          border: '1px solid #3b82f6',
          borderRadius: 6, padding: '4px 8px', boxShadow: '0 2px 8px rgba(0,0,0,.25)',
        }}>
          <Input
            autoFocus
            size="small"
            placeholder="搜索..."
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              searchAddonRef.current?.findNext(e.target.value, { incremental: true });
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (e.shiftKey) searchAddonRef.current?.findPrevious(searchQuery);
                else searchAddonRef.current?.findNext(searchQuery);
              }
            }}
            style={{ width: 180, fontFamily: 'monospace', fontSize: 12 }}
          />
          <Button size="small" onClick={() => searchAddonRef.current?.findPrevious(searchQuery)}>↑</Button>
          <Button size="small" onClick={() => searchAddonRef.current?.findNext(searchQuery)}>↓</Button>
          <Button size="small" onClick={() => setSearchOpen(false)}>×</Button>
        </div>
      )}

      {/* 关键字高亮浮层 */}
      {highlightOpen && (
        <div style={{
          position: 'absolute', top: 36, right: 12, zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 6,
          background: isDark ? '#252526' : '#fff',
          border: '1px solid #22c55e',
          borderRadius: 6, padding: '8px 10px', boxShadow: '0 2px 8px rgba(0,0,0,.25)',
          width: 260,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text strong style={{ fontSize: 12 }}>关键字高亮</Text>
            <Button size="small" onClick={() => setHighlightOpen(false)}>×</Button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="color"
              value={highlightColor}
              onChange={e => setHighlightColor(e.target.value)}
              style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', outline: 'none' }}
            />
            <Input
              size="small"
              placeholder="输入关键字"
              value={highlightKeyword}
              onChange={e => setHighlightKeyword(e.target.value)}
              onPressEnter={() => {
                if (highlightKeyword.trim()) {
                  addHighlightRule({ keyword: highlightKeyword.trim(), color: highlightColor });
                  setHighlightKeyword('');
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              size="small"
              type="primary"
              onClick={() => {
                if (highlightKeyword.trim()) {
                  addHighlightRule({ keyword: highlightKeyword.trim(), color: highlightColor });
                  setHighlightKeyword('');
                }
              }}
            >添加</Button>
          </div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {highlightRules.map(rule => (
              <div key={rule.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <Space size={4}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: rule.color }} />
                  <Text code style={{ fontSize: 11 }}>{rule.keyword}</Text>
                </Space>
                <Button type="text" danger size="small" onClick={() => removeHighlightRule(rule.id)} style={{ padding: 0, height: 18 }}>删除</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        ref={ref}
        style={{
          width: '100%', flex: 1,
          background: isDark ? '#1e1e1e' : '#fafafa',
          padding: 4,
        }}
      />
    </div>
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
  profiles: SSHProfile[];
  onOk: (p: Omit<SSHProfile, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
  checkKeyFile: (p: string) => Promise<{ ok: boolean; resolved?: string; msg?: string }>;
}> = ({ open, initial, profiles, onOk, onCancel, checkKeyFile }) => {
  const [form] = Form.useForm();
  const [authType, setAuthType] = useState<'privateKey' | 'password' | 'agent'>('privateKey');
  const [keyMsg,   setKeyMsg]   = useState('');
  const { credentials } = useSSHStore();

  useEffect(() => {
    if (open) {
      // Use queueMicrotask to avoid cascading renders while preserving functionality
      queueMicrotask(() => {
        form.setFieldsValue(initial ?? { port: 22, authType: 'privateKey' });
        setAuthType(initial?.authType ?? 'privateKey');
        setKeyMsg('');
      });
    }
  }, [open, initial, form]);

  const handleCheckKey = async () => {
    const p = form.getFieldValue('keyFilePath');
    if (!p) return;
    const r = await checkKeyFile(p) as { ok: boolean; resolved?: string; msg?: string };
    setKeyMsg(r.ok ? `✅ 可读: ${r.resolved ?? p}` : `❌ ${r.msg ?? '不可读'}`);
  };

  // 当选择凭证时，自动同步认证方式和用户名
  const handleCredentialChange = (credId: string | undefined) => {
    if (!credId) return;
    const cred = credentials.find(c => c.id === credId);
    if (cred) {
      form.setFieldValue('username', cred.username);
      form.setFieldValue('authType', cred.authType);
      setAuthType(cred.authType);
      if (cred.keyFilePath) form.setFieldValue('keyFilePath', cred.keyFilePath);
    }
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
        <Form.Item name="credentialId" label="绑定登录凭证 (可选)"
          extra={<Text style={{ fontSize: 11 }}>绑定凭证后可一键直连，无需每次输入密码</Text>}>
          <Select allowClear placeholder="不绑定 — 每次手动输入" onChange={handleCredentialChange}>
            {credentials.map(c => (
              <Select.Option key={c.id} value={c.id}>
                {c.name} ({c.username}) <Tag color={c.authType === 'privateKey' ? 'blue' : 'green'} style={{ float: 'right', fontSize: 10 }}>{c.authType}</Tag>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
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
        <Form.Item name="jumpHostProfileId" label="跳板机 (可选)" extra={<Text style={{ fontSize: 11 }}>经由该跳板机连接目标机器</Text>}>
          <Select allowClear placeholder="不使用跳板机">
            {profiles.filter(p => !initial || p.id !== initial.id).map(p => (
              <Select.Option key={p.id} value={p.id}>{p.name} ({p.host})</Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────
const CronJobList = React.lazy(() => import('./components/CronJobList'));

const SSHManager: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark    = theme === 'dark';
  const analyzerLogCount = useAnalyzerStore(s => s.logs.length);

  const {
    credentials, profiles, sessions, sessionGroups, activeSessionId, proxyOnline, multiNodeRun, nodeContexts,
    addProfile, updateProfile, deleteProfile,
    addSession, removeSession, renameSession, setActiveSession,
    createSessionGroup, updateSessionGroup, deleteSessionGroup,
    connectGroup, reconnectGroup, disconnectGroup,
    checkProxy, setSessionTermCallback,
    connectSession, disconnectSession, sendInputToSession, resizeSession,
    startMultiNodeRun, cancelMultiNodeRun, clearMultiNodeRun, buildNodeScopedVars,
    checkKeyFile,
  } = useSSHStore();

  const { instances, updateCheckResult, appendSubStepResult, setInstanceStatus } = useSOPStore();

  const [messageApi, ctx]     = message.useMessage();
  const [profileModal, setProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SSHProfile | null>(null);
  const [connectModal, setConnectModal]     = useState(false);
  const [credentialModal, setCredentialModal] = useState(false);
  const [batchLoginModal, setBatchLoginModal] = useState(false);
  const [groupModal, setGroupModal] = useState<SessionGroup | null | 'new'>(null);
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
  const [activeView,  setActiveView]      = useState<'terminal' | 'progress' | 'journal' | 'analyzer' | 'bgjobs'>('terminal');
  const [activeTab, setActiveTab] = useState('connect'); // 'connect' | 'multi_node' | 'cron'
  const [terminalHeight, setTerminalHeight] = useState(720);
  const [prepareProfiles, setPrepareProfiles] = useState<PrepareProfile[]>([]);
  const [loadingPrepareProfiles, setLoadingPrepareProfiles] = useState(false);
  const [prepareRunningIds, setPrepareRunningIds] = useState<string[]>([]);
  const [prepareSummaries, setPrepareSummaries] = useState<Record<string, PrepareRunSummary>>({});
  const [prepareSettings, setPrepareSettings] = useLocalStorage<PrepareSettings>('devutility-ssh-prepare-settings', {
    profileId: 'linux-problem-localization-fast-path',
    autoRun: true,
    continueOnError: true,
  });

  // 从选中实例预填占位符（若实例在 InstanceRunner 中已填写）
  useEffect(() => {
    const instIds = execMode === 'broadcast'
      ? (broadcastInstanceId ? [broadcastInstanceId] : [])
      : selectedNodes.map((sid) => targetedMap[sid]).filter(Boolean);
    const merged: Record<string, string> = {};
    instIds.forEach((instId) => {
      const inst = instances.find((i) => i.id === instId);
      if (inst?.placeholderValues) Object.assign(merged, inst.placeholderValues);
    });
    if (Object.keys(merged).length > 0) setVarValues((prev) => ({ ...prev, ...merged }));
  }, [execMode, broadcastInstanceId, selectedNodes, targetedMap, instances]);

  // ── 终端写入函数 Map（每会话一个） ────────────────────────────────────────
  const writeCallbacks    = useRef<Map<string, (b64: string) => void>>(new Map());
  const snapshotCallbacks = useRef<Map<string, () => string>>(new Map());
  const getLineFns        = useRef<Record<string, () => string>>({});
  const autoPreparedAtRef = useRef<Record<string, number>>({});

  const { addEntry, addSOPNodeResults } = useJournalStore();
  const { evaluateJobs } = useCronStore();

  const resolveLegacyGroupSessionIds = React.useCallback((groupId: string) => {
    if (!groupId.startsWith('group-')) return [];
    const groupName = groupId.replace(/^group-/, '');
    return sessions
      .filter((session) => {
        const profile = profiles.find((item) => item.id === session.profileId);
        if (!profile) return false;
        const parts = profile.name.split('-');
        const derivedGroupName = parts.length > 1 ? parts[0] : '其他';
        return derivedGroupName === groupName;
      })
      .map((session) => session.id);
  }, [profiles, sessions]);

  const resolveCronTargetSessionIds = React.useCallback((targetGroupIds: string[], targetSessions: string[]) => {
    const targetSessionIds = new Set(targetSessions);
    targetGroupIds.forEach((groupId) => {
      const realGroup = sessionGroups.find((group) => group.id === groupId);
      if (realGroup) {
        realGroup.sessionIds.forEach((sessionId) => targetSessionIds.add(sessionId));
        return;
      }
      resolveLegacyGroupSessionIds(groupId).forEach((sessionId) => targetSessionIds.add(sessionId));
    });
    return Array.from(targetSessionIds);
  }, [resolveLegacyGroupSessionIds, sessionGroups]);

  useEffect(() => {
    // 定时任务 (Cron) 每分钟轮询
    const intervalId = setInterval(async () => {
        const jobsToRun = evaluateJobs();
        if (!jobsToRun || jobsToRun.length === 0) return;

        // 对每一个需要执行的 Job 进行自动派发
        for (const job of jobsToRun) {
          console.log(`[Cron] Executing job: ${job.name} (${job.id})`);
          const targetSessionIds = new Set(resolveCronTargetSessionIds(job.targetGroupIds, job.targetSessions));

          // 取当前所有激活的连线
          const activeSessionIds = Array.from(targetSessionIds).filter(sid => {
            const s = useSSHStore.getState().sessions.find(sess => sess.id === sid);
            return s?.status === 'connected';
          });

          if (activeSessionIds.length === 0) {
            console.warn(`[Cron] Job ${job.name} skipped: no connected target sessions.`);
            continue;
          }

          // 构造该 Job 对应的临时 Instance 列表
          interface CronJobConfig {
            sessionId: string;
            instanceId: string;
            instanceTitle: string;
            templateName: string;
            steps: import('./store/sshStore').PlanStep[];
          }
          const configs: CronJobConfig[] = [];
          
          for (const sessionId of activeSessionIds) {
            // （暂只处理广播模式）如果是 targeted 模式也可以按需从 job.targetedConfigs 里去取
            const templateId = job.execMode === 'broadcast' ? job.broadcastTemplateId : undefined;
            if (!templateId) continue;

            const tpl = useSOPStore.getState().templates.find(t => t.id === templateId);
            if (!tpl) continue;

            // 为这次触发在 sopStore 里面新建一个追踪实例
            const instanceId = useSOPStore.getState().startInstance(templateId, `[定时任务] ${job.name} - 自动触发`);
            const inst = useSOPStore.getState().instances.find(i => i.id === instanceId);
            if (!inst) continue;

            // 构建用于到底层分发的执行步骤 (这里复用了 SSHManager 本地的 buildSteps 逻辑框架)
            const templateDefaults: Record<string, string> = {};
            if (inst.variables) {
              inst.variables.forEach(v => {
                if (v.defaultValue !== undefined) {
                  templateDefaults[v.name] = String(v.defaultValue);
                }
              });
            }
            const mergedVars = useSSHStore.getState().buildNodeScopedVars(sessionId, job.broadcastVars, templateDefaults);

            const steps: import('./store/sshStore').PlanStep[] = [];
            const missingVars = new Set<string>();
            [...inst.checkResults, ...inst.extraChecks].forEach((cr) => {
              const subs = cr.subSteps ?? [];
              if (subs.length > 0) {
                subs.forEach((ss) => steps.push({
                  id: ss.id, name: ss.name,
                  cmd: renderTemplate(ss.command, mergedVars),
                  captureVar: ss.captureVar, capturePattern: ss.capturePattern,
                  normalRegex: ss.normalRegex, abnormalRegex: ss.abnormalRegex,
                  scriptPath: ss.scriptPath, timeout: ss.timeoutMs ?? 30000,
                  checkId: cr.checkId, isSubStep: true,
                }));
              } else {
                const cmd = renderTemplate(cr.command, mergedVars);
                extractTemplateVariables(cr.command).forEach((name) => {
                  if (mergedVars[name] === undefined) missingVars.add(name);
                });
                if (cmd.trim()) steps.push({
                  id: cr.checkId, name: cr.checkName, cmd,
                  checkId: cr.checkId, isSubStep: false,
                });
              }
            });

            [...inst.checkResults, ...inst.extraChecks].forEach((cr) => {
              (cr.subSteps ?? []).forEach((ss) => {
                extractTemplateVariables(ss.command).forEach((name) => {
                  if (mergedVars[name] === undefined) missingVars.add(name);
                });
              });
            });

            if (missingVars.size > 0) {
              console.warn(`[Cron] Job ${job.name} skipped for session ${sessionId}: missing vars ${Array.from(missingVars).join(', ')}`);
              continue;
            }

            if (steps.length > 0) {
              configs.push({
                sessionId,
                instanceId,
                instanceTitle: inst.incidentTitle,
                templateName: inst.templateName,
                steps
              });
            }
          }

          if (configs.length > 0) {
            // 背景执行，不阻塞 UI 
            useSSHStore.getState().startMultiNodeRun(configs, job.execMode).then(() => {
              // 执行结束后把结果写回 instances。
              const run = useSSHStore.getState().multiNodeRun;
              run?.nodeExecutions.forEach((ne) => {
                const currentInsts = useSOPStore.getState().instances;
                const inst = currentInsts.find((i) => i.id === ne.instanceId);
                if (!inst) return;
                
                ne.steps.forEach((step) => {
                  const r = ne.results[step.id];
                  if (!r) return;
                  if (step.isSubStep && step.checkId) {
                    useSOPStore.getState().appendSubStepResult(inst.id, step.checkId, {
                      subStepId: step.id, name: step.name,
                      command: r.resolvedCmd ?? step.cmd,
                      stdout: r.stdout, stderr: r.stderr,
                      exitCode: r.exitCode, durationMs: r.durationMs,
                      capturedVar: r.capturedVar,
                    });
                  } else if (step.checkId) {
                    useSOPStore.getState().updateCheckResult(inst.id, step.checkId, {
                      output: r.processedOutput ?? r.stdout,
                      status: r.exitCode === 0 ? 'normal' : 'abnormal',
                      conclusion: r.statusReason ?? `exit ${r.exitCode}`,
                    });
                  }
                });
                useSOPStore.getState().setInstanceStatus(inst.id, 'resolved');
              });
              messageApi.success(`定时任务 [${job.name}] 执行完成。`);
            }).catch(e => {
              console.error(`Jobs execution failed for cron ${job.name}`, e);
            });
          }
        }
    }, 60000);
    
    // 立即执行一次以防页面刚好错过一分钟的跳变
    evaluateJobs();

    return () => clearInterval(intervalId);
  }, [evaluateJobs, messageApi, resolveCronTargetSessionIds]);

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
  const activePrepareProfile = React.useMemo(
    () => prepareProfiles.find((profile) => profile.profileId === prepareSettings.profileId) || null,
    [prepareProfiles, prepareSettings.profileId]
  );
  const connectedSelectedNodes = React.useMemo(
    () => selectedNodes.filter((sessionId) => sessions.find((sess) => sess.id === sessionId)?.status === 'connected'),
    [selectedNodes, sessions]
  );
  const selectedPrepareStats = React.useMemo(() => {
    return connectedSelectedNodes.reduce((summary, sessionId) => {
      if (prepareRunningIds.includes(sessionId)) {
        summary.running += 1;
        return summary;
      }
      const currentSession = sessions.find((item) => item.id === sessionId);
      const runSummary = prepareSummaries[sessionId];
      if (!runSummary || runSummary.connectedAt !== currentSession?.connectedAt) {
        summary.pending += 1;
        return summary;
      }
      if (runSummary.status === 'done') {
        summary.ready += 1;
      } else {
        summary.failed += 1;
      }
      return summary;
    }, { ready: 0, failed: 0, running: 0, pending: 0 });
  }, [connectedSelectedNodes, prepareRunningIds, prepareSummaries, sessions]);

  async function fetchPrepareProfiles(silent = false) {
    setLoadingPrepareProfiles(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/prepare-profiles`);
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || '预处理模板加载失败');
      }
      const nextProfiles = Array.isArray(data.data) ? data.data as PrepareProfile[] : [];
      setPrepareProfiles(nextProfiles);
      if (nextProfiles.length > 0 && !nextProfiles.some((item) => item.profileId === prepareSettings.profileId)) {
        setPrepareSettings((current) => ({
          ...current,
          profileId: nextProfiles.some((item) => item.profileId === 'linux-problem-localization-fast-path')
            ? 'linux-problem-localization-fast-path'
            : nextProfiles.some((item) => item.profileId === 'linux-problem-localization-boost')
              ? 'linux-problem-localization-boost'
            : nextProfiles[0].profileId,
        }));
      }
    } catch (error) {
      if (!silent) {
        messageApi.warning(error instanceof Error ? error.message : '预处理模板加载失败');
      }
    } finally {
      setLoadingPrepareProfiles(false);
    }
  }

  async function requestPrepare(
    sessionId: string,
    profileId: string,
    continueOnError: boolean
  ) {
    let lastError = '预处理失败';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(`${PROXY_HTTP}/api/agent/sessions/${encodeURIComponent(sessionId)}/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profileId,
            continueOnError,
          }),
        });
        const data = await response.json();
        if (response.ok && data.ok) {
          return data.data as PrepareRunResult;
        }
        lastError = data.error || `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : '预处理失败';
      }

      await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
    }

    throw new Error(lastError);
  }

  async function runPrepareOnSession(
    sessionId: string,
    trigger: 'auto' | 'manual',
    silent = false
  ) {
    const profileId = prepareSettings.profileId;
    if (!profileId) {
      if (!silent) messageApi.warning('请先选择预处理模板');
      return false;
    }

    const session = sessions.find((item) => item.id === sessionId);
    const profile = profiles.find((item) => item.id === session?.profileId);
    if (!session || session.status !== 'connected') {
      if (!silent) messageApi.warning('目标会话尚未连接');
      return false;
    }

    setPrepareRunningIds((current) => current.includes(sessionId) ? current : [...current, sessionId]);

    try {
      const result = await requestPrepare(sessionId, profileId, prepareSettings.continueOnError);
      const resolvedProfile = result.profile || prepareProfiles.find((item) => item.profileId === profileId) || activePrepareProfile;
      const profileName = resolvedProfile?.name || profileId;
      const steps = Array.isArray(result.steps) ? result.steps : [];
      const readyStepCount = result.readyStepCount || resolvedProfile?.steps.filter((step) => step.phase === 'ready').length || 0;
      const startedAt = Date.now();

      steps.forEach((step, index) => {
        const stepStatusReason = [
          step.fromCache ? '命中缓存' : '',
          step.statusReason || '',
        ].filter(Boolean).join(' · ');
        addEntry({
          sessionId,
          sessionName: session.name,
          type: 'prepare_step',
          timestamp: startedAt + index,
          command: step.resolvedCmd || step.cmd,
          output: [step.stdout, step.stderr].filter(Boolean).join('\n').trim(),
          exitCode: step.exitCode,
          durationMs: step.durationMs,
          statusReason: stepStatusReason || undefined,
          prepareProfileName: profileName,
          prepareStepName: step.name,
          nodeHost: profile?.host,
          nodePort: profile?.port,
          nodeUser: profile?.username,
        });
      });

      const failedCount = steps.filter((step) => step.status === 'failed' || step.exitCode !== 0).length;
      setPrepareSummaries((current) => ({
        ...current,
        [sessionId]: {
          cachedStepCount: result.cachedStepCount || 0,
          contextStepCount: result.contextStepCount || Math.max(0, steps.length - readyStepCount),
          profileId,
          profileName,
          readyDurationMs: result.readyDurationMs || 0,
          readyStepCount,
          status: result.status,
          stepCount: steps.length,
          failedCount,
          finishedAt: Date.now(),
          totalDurationMs: result.totalDurationMs || 0,
          connectedAt: session.connectedAt,
          trigger,
        },
      }));

      if (!silent) {
        const readyText = result.readyDurationMs
          ? `ready ${formatDurationLabel(result.readyDurationMs)}`
          : null;
        const cacheText = result.cachedStepCount ? `缓存 ${result.cachedStepCount} 步` : null;
        const text = failedCount > 0
          ? `${session.name} 预处理完成，${failedCount} 个步骤需要关注${readyText ? `，${readyText}` : ''}${cacheText ? `，${cacheText}` : ''}`
          : `${session.name} 预处理完成${readyText ? `，${readyText}` : ''}${cacheText ? `，${cacheText}` : ''}`;
        messageApi[failedCount > 0 ? 'warning' : 'success'](text);
      }
      return true;
    } catch (error) {
      const fallbackReadyStepCount = activePrepareProfile?.steps.filter((step) => step.phase === 'ready').length || 0;
      setPrepareSummaries((current) => ({
        ...current,
        [sessionId]: {
          cachedStepCount: 0,
          contextStepCount: Math.max(0, (activePrepareProfile?.steps.length || 0) - fallbackReadyStepCount),
          profileId,
          profileName: activePrepareProfile?.name || profileId,
          readyDurationMs: 0,
          readyStepCount: fallbackReadyStepCount,
          status: 'failed',
          stepCount: activePrepareProfile?.steps.length || 0,
          failedCount: activePrepareProfile?.steps.length || 0,
          finishedAt: Date.now(),
          totalDurationMs: 0,
          connectedAt: session.connectedAt,
          trigger,
        },
      }));
      if (!silent || trigger === 'auto') {
        messageApi.warning(`${session.name} 预处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
      return false;
    } finally {
      setPrepareRunningIds((current) => current.filter((item) => item !== sessionId));
    }
  }

  async function handleRunPrepareOnSelected() {
    if (!activePrepareProfile) {
      messageApi.warning('请先选择可用的预处理模板');
      return;
    }
    if (connectedSelectedNodes.length === 0) {
      messageApi.warning('请先勾选已连接的节点');
      return;
    }

    const results = await Promise.allSettled(
      connectedSelectedNodes.map((sessionId) => runPrepareOnSession(sessionId, 'manual', true))
    );
    const successCount = results.filter((item) => item.status === 'fulfilled' && item.value).length;
    const failedCount = results.length - successCount;
    if (failedCount > 0) {
      messageApi.warning(`预处理完成：${successCount} 个成功，${failedCount} 个失败`);
    } else {
      messageApi.success(`预处理完成：${successCount} 个节点已进入定位就绪状态`);
    }
  }

  useEffect(() => {
    void fetchPrepareProfiles(true);
  }, []);

  useEffect(() => {
    if (!prepareSettings.autoRun || !prepareSettings.profileId) return;

    sessions.forEach((session) => {
      if (session.status !== 'connected' || !session.connectedAt) return;
      if (prepareRunningIds.includes(session.id)) return;
      if (autoPreparedAtRef.current[session.id] === session.connectedAt) return;

      autoPreparedAtRef.current[session.id] = session.connectedAt;
      void runPrepareOnSession(session.id, 'auto', true);
    });
  }, [prepareRunningIds, prepareSettings.autoRun, prepareSettings.profileId, sessions]);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeNodeContext = activeSessionId ? (nodeContexts[activeSessionId] ?? null) : null;
  const sessionGroupsMap = React.useMemo(() => {
    const map = new Map<string, SessionGroup[]>();
    sessionGroups.forEach((group) => {
      group.sessionIds.forEach((sessionId) => {
        const current = map.get(sessionId) ?? [];
        current.push(group);
        map.set(sessionId, current);
      });
    });
    return map;
  }, [sessionGroups]);

  // ── 变量收集（来自选中实例中的占位符和预定义配置） ──────────────────────────
  const definedVars = React.useMemo(() => {
    const map = new Map<string, import('../../types').VariableConfig>();
    [...selectedNodes].forEach((sessionId) => {
      const instId = execMode === 'broadcast' ? broadcastInstanceId : targetedMap[sessionId];
      const inst   = instances.find((i) => i.id === instId);
      if (inst?.variables) {
        inst.variables.forEach(v => map.set(v.name, v));
      }
    });
    return map;
  }, [selectedNodes, execMode, broadcastInstanceId, targetedMap, instances]);

  const extractedVarNames = Array.from(new Set(
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

  const allVarNames = Array.from(new Set([...extractedVarNames, ...Array.from(definedVars.keys())]));

  const nodeVariableDiagnostics = React.useMemo(() => {
    return selectedNodes.map((sessionId) => {
      const instId = execMode === 'broadcast' ? broadcastInstanceId : targetedMap[sessionId];
      const built = instId ? buildSteps(instId, sessionId) : { steps: [], missingVars: [] as string[] };
      return {
        sessionId,
        sessionName: sessions.find((session) => session.id === sessionId)?.name ?? sessionId,
        missingVars: built.missingVars,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodes, execMode, broadcastInstanceId, targetedMap, sessions, varValues, nodeContexts, instances]);

  // ── 构建单会话的执行步骤列表 ──────────────────────────────────────────────
  function buildSteps(instanceId: string, sessionId?: string) {
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return { steps: [], missingVars: [] as string[] };

    const templateDefaults: Record<string, string> = {};
    if (inst.variables) {
      inst.variables.forEach(v => {
        if (v.defaultValue !== undefined) templateDefaults[v.name] = String(v.defaultValue);
      });
    }
    const mergedVars = sessionId
      ? buildNodeScopedVars(sessionId, varValues, templateDefaults)
      : { ...templateDefaults, ...varValues };

    const steps: import('./store/sshStore').PlanStep[] = [];
    const missingVars = new Set<string>();
    [...inst.checkResults, ...inst.extraChecks].forEach((cr) => {
      const subs = cr.subSteps ?? [];
      if (subs.length > 0) {
        subs.forEach((ss) => {
          extractTemplateVariables(ss.command).forEach((name) => {
            if (mergedVars[name] === undefined) missingVars.add(name);
          });
          steps.push({
            id: ss.id, name: ss.name,
            cmd: renderTemplate(ss.command, mergedVars),
            captureVar: ss.captureVar, capturePattern: ss.capturePattern,
            normalRegex: ss.normalRegex, abnormalRegex: ss.abnormalRegex,
            scriptPath: ss.scriptPath, timeout: ss.timeoutMs ?? 30000,
            checkId: cr.checkId, isSubStep: true,
          });
        });
      } else {
        extractTemplateVariables(cr.command).forEach((name) => {
          if (mergedVars[name] === undefined) missingVars.add(name);
        });
        const cmd = renderTemplate(cr.command, mergedVars);
        if (cmd.trim()) steps.push({
          id: cr.checkId, name: cr.checkName, cmd,
          checkId: cr.checkId, isSubStep: false,
        });
      }
    });
    return { steps, missingVars: Array.from(missingVars) };
  }

  // ── 开始多节点执行 ────────────────────────────────────────────────────────
  const handleRunMultiNode = async () => {
    if (selectedNodes.length === 0) { messageApi.warning('请至少选择一个节点'); return; }

    const skippedNodes: Array<{ sessionName: string; missingVars: string[] }> = [];
    const configs = selectedNodes.map((sessionId) => {
      const instId = execMode === 'broadcast' ? broadcastInstanceId : targetedMap[sessionId];
      const inst   = instances.find((i) => i.id === instId);
      const built = buildSteps(instId, sessionId);
      if (built.missingVars.length > 0) {
        skippedNodes.push({
          sessionName: sessions.find((session) => session.id === sessionId)?.name ?? sessionId,
          missingVars: built.missingVars,
        });
      }
      return {
        sessionId,
        instanceId:   instId,
        instanceTitle: inst?.incidentTitle ?? '',
        templateName:  inst?.templateName  ?? '',
        steps:         built.steps,
        missingVars:   built.missingVars,
      };
    }).filter((c) => c.instanceId && c.steps.length > 0 && c.missingVars.length === 0);

    if (skippedNodes.length > 0) {
      messageApi.warning(`已跳过 ${skippedNodes.length} 个节点：缺少变量 ${skippedNodes.map((item) => `${item.sessionName}[${item.missingVars.join(', ')}]`).join('；')}`);
    }

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

      // 自动将执行结果写入每个会话的日志（含节点管理 IP 信息）
      if (run) {
        addSOPNodeResults(
          run.nodeExecutions.map((ne) => {
            // 从会话 → 档案中找到管理 IP
            const sess    = sessions.find((s) => s.id === ne.sessionId);
            const profile = profiles.find((p) => p.id === sess?.profileId);
            return {
              sessionId:   ne.sessionId,
              sessionName: ne.sessionName,
              nodeHost:    profile?.host,
              nodePort:    profile?.port,
              nodeUser:    profile?.username,
              instanceId:  ne.instanceId,
              steps: ne.steps.map((step) => {
                const r = ne.results[step.id];
                return {
                  name:         step.name,
                  command:      r?.resolvedCmd ?? step.cmd,
                  output:       r?.processedOutput ?? r?.stdout ?? '',
                  exitCode:     r?.exitCode ?? -1,
                  durationMs:   r?.durationMs ?? 0,
                  statusReason: r?.statusReason,
                  capturedVar:  r?.capturedVar,
                };
              }),
            };
          })
        );
      }

      const failCount = run?.nodeExecutions.filter((ne) => ne.status === 'failed').length ?? 0;
      if (failCount === 0) {
        messageApi.success(`✅ ${configs.length} 个节点全部执行完成`);
      } else {
        messageApi.warning(`⚠️ ${configs.length} 个节点执行完成，${failCount} 个异常`);
      }
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
    const sess = sessions.find((x) => x.id === sessionId);
    const prf = profiles.find((x) => x.id === sess?.profileId);
    if (!sess || !prf) return;

    // 解析主机凭证
    const cred = prf.credentialId ? credentials.find(c => c.id === prf.credentialId) : null;
    const effectiveAuth = cred?.authType ?? prf.authType ?? 'password';

    // 解析跳板机凭证
    const jumpPrf = profiles.find((x) => x.id === prf.jumpHostProfileId);
    const jumpCred = jumpPrf?.credentialId ? credentials.find(c => c.id === jumpPrf.credentialId) : null;
    const jumpAuth = jumpCred?.authType ?? jumpPrf?.authType;

    // 判断是否需要手动输入
    const hostNeedInput = effectiveAuth === 'password' && !cred?.password;
    const hostNeedPassphrase = effectiveAuth === 'privateKey' && !cred; // 无凭证时可能需要 passphrase
    const jumpNeedInput = jumpPrf && (
      (jumpAuth === 'password' && !jumpCred?.password) ||
      (jumpAuth === 'privateKey' && !jumpCred)
    );

    // 所有凭证已备齐 → 直接连接（跳过弹窗）
    if (!hostNeedInput && !hostNeedPassphrase && !jumpNeedInput) {
      connectSession(sessionId, {
        credentialId: prf.credentialId || undefined,
        password: cred?.password,
        agent: effectiveAuth === 'agent' ? 'true' : undefined,
        jumpPassword: jumpCred?.password,
        jumpAgent: jumpAuth === 'agent' ? 'true' : undefined,
      });
      return;
    }

    // 否则打开弹窗 — 预填已保存的密码
    setConnectingSessionId(sessionId);
    setConnectModal(true);
    connectForm.resetFields();
    if (cred?.password) connectForm.setFieldValue('password', cred.password);
    if (jumpCred?.password) connectForm.setFieldValue('jumpPassword', jumpCred.password);
  };

  const handleConnect = async () => {
    const vals = await connectForm.validateFields().catch(() => null);
    if (!vals) return;
    
    const sess = sessions.find((s) => s.id === connectingSessionId);
    const prf = profiles.find((p) => p.id === sess?.profileId);
    const jumpPrf = prf?.jumpHostProfileId ? profiles.find((p) => p.id === prf.jumpHostProfileId) : null;
    
    connectSession(connectingSessionId, { 
      passphrase: vals.passphrase, 
      password: vals.password,
      agent: prf?.authType === 'agent' ? 'true' : undefined,
      jumpPassphrase: vals.jumpPassphrase,
      jumpPassword: vals.jumpPassword,
      jumpAgent: jumpPrf?.authType === 'agent' ? 'true' : undefined,
    });
    setConnectModal(false);
  };

  const connectingProfile = profiles.find(
    (p) => p.id === sessions.find((s) => s.id === connectingSessionId)?.profileId
  );
  const connectingCred = connectingProfile?.credentialId
    ? credentials.find(c => c.id === connectingProfile.credentialId) : null;
  const connectingEffectiveAuth = connectingCred?.authType ?? connectingProfile?.authType;

  const connectingJumpProfile = connectingProfile?.jumpHostProfileId 
    ? profiles.find(p => p.id === connectingProfile.jumpHostProfileId) 
    : null;
  const connectingJumpCred = connectingJumpProfile?.credentialId
    ? credentials.find(c => c.id === connectingJumpProfile.credentialId) : null;
  const connectingJumpAuth = connectingJumpCred?.authType ?? connectingJumpProfile?.authType;

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
          <Button icon={<KeyOutlined />} size="small" onClick={() => setCredentialModal(true)}>凭证管理</Button>
          <Button icon={<ApiOutlined />} size="small" type="primary" onClick={() => setBatchLoginModal(true)}>批量快捷登录</Button>
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
                    <Tooltip title="⚡ 一键连接（创建会话+自动连接）">
                      <Button size="small" icon={<ThunderboltOutlined />} type="primary"
                        disabled={!proxyOnline}
                        onClick={() => {
                          const sessId = addSession(`${p.host}:${p.port}`, p.id);
                          // 下一帧触发连接，确保 session 已在 store 中
                          queueMicrotask(() => handleOpenConnect(sessId));
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="添加会话（仅创建，不自动连接）">
                      <Button size="small" icon={<PlusOutlined />} type="dashed"
                        onClick={() => addSession(`${p.host}:${p.port}`, p.id)}
                        disabled={!proxyOnline}
                      />
                    </Tooltip>
                    <Tooltip title="复制档案">
                      <CopyOutlined style={{ cursor: 'pointer', color: '#3b82f6', fontSize: 12 }}
                        onClick={() => {
                          setEditingProfile({
                            ...p,
                            id: '',
                            createdAt: p.createdAt || Date.now(),
                            name: `${p.name} (副本)`,
                            host: '',
                          });
                          setProfileModal(true);
                        }} />
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

          <Card
            size="small"
            title="会话组"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
            extra={
              <Button size="small" icon={<PlusOutlined />} type="dashed" onClick={() => setGroupModal('new')}>
                新建
              </Button>
            }
          >
            {sessionGroups.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>批量登录时可直接建组，或在这里单独创建。</Text>
            ) : sessionGroups.map((group) => {
              const groupSessions = sessions.filter((session) => group.sessionIds.includes(session.id));
              const connectedCount = groupSessions.filter((session) => session.status === 'connected').length;
              const autoConnectable = groupSessions.filter((session) => {
                const profile = profiles.find((item) => item.id === session.profileId);
                const credential = profile?.credentialId ? credentials.find((item) => item.id === profile.credentialId) : null;
                return Boolean(
                  profile && (
                    profile.credentialId ||
                    credential?.password ||
                    profile.authType === 'agent' ||
                    (profile.authType === 'privateKey' && profile.keyFilePath)
                  )
                );
              }).length;
              return (
                <div
                  key={group.id}
                  style={{
                    padding: '8px 0',
                    borderBottom: `1px solid ${borderColor}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <Text strong style={{ fontSize: 12 }}>{group.name}</Text>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                        {group.sessionIds.length} 个节点 · {connectedCount} 已连接 · {group.initCommands.length} 条初始化命令
                      </Text>
                    </div>
                    <Space size={4}>
                      <Tooltip title="连接整组（需要已保存凭证）">
                        <Button size="small" type="primary" disabled={!proxyOnline} onClick={() => connectGroup(group.id)}>连接</Button>
                      </Tooltip>
                      <Tooltip title="重连整组（需要已保存凭证）">
                        <Button size="small" onClick={() => reconnectGroup(group.id)}>重连</Button>
                      </Tooltip>
                      <Tooltip title="断开整组">
                        <Button size="small" danger onClick={() => disconnectGroup(group.id)}>断开</Button>
                      </Tooltip>
                      <Button size="small" icon={<EditOutlined />} onClick={() => setGroupModal(group)} />
                      <Popconfirm
                        title="删除此会话组？"
                        onConfirm={() => deleteSessionGroup(group.id)}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  </div>
                  <Space wrap size={[4, 4]}>
                    {group.tags.map((tag) => (
                      <Tag key={tag} color="purple">{tag}</Tag>
                    ))}
                    {autoConnectable < groupSessions.length && (
                      <Tag color="gold">部分成员缺少自动连接凭证</Tag>
                    )}
                  </Space>
                </div>
              );
            })}
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
              ? <Text type="secondary" style={{ fontSize: 12 }}>点击档案的 ⚡ 按钮一键连接</Text>
              : sessions.map((sess) => {
                const sc  = STATUS[sess.status];
                const prf = profiles.find((p) => p.id === sess.profileId);
                const ownerGroups = sessionGroupsMap.get(sess.id) ?? [];
                const isDisconnectedOrError = sess.status === 'disconnected' || sess.status === 'error';
                const uptimeMs = sess.status === 'connected' && sess.connectedAt ? Date.now() - sess.connectedAt : 0;
                const prepareSummary = prepareSummaries[sess.id];
                const prepareStatusMatchesCurrentConnection = prepareSummary?.connectedAt && prepareSummary.connectedAt === sess.connectedAt;
                const prepareRunning = prepareRunningIds.includes(sess.id);
                const uptimeStr = uptimeMs > 0 ? (
                  uptimeMs > 3600000 ? `${Math.floor(uptimeMs / 3600000)}h${Math.floor((uptimeMs % 3600000) / 60000)}m`
                  : uptimeMs > 60000 ? `${Math.floor(uptimeMs / 60000)}m`
                  : `${Math.floor(uptimeMs / 1000)}s`
                ) : '';
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
                          <Tooltip title={sess.status === 'error' ? sess.statusMsg : sc.label}>
                            <Badge status={sc.badge} />
                          </Tooltip>
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
                          {uptimeStr && <Tag color="processing" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>{uptimeStr}</Tag>}
                          {prepareRunning && (
                            <Tag color="gold" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                              预处理中
                            </Tag>
                          )}
                          {!prepareRunning && prepareStatusMatchesCurrentConnection && prepareSummary?.status === 'done' && (
                            <>
                              <Tooltip
                                title={`${prepareSummary.profileName} · ready ${formatDurationLabel(prepareSummary.readyDurationMs)} · 总耗时 ${formatDurationLabel(prepareSummary.totalDurationMs)} · ${prepareSummary.stepCount} 步`}
                              >
                                <Tag color="success" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                                  已预热
                                </Tag>
                              </Tooltip>
                              {prepareSummary.readyDurationMs > 0 && (
                                <Tag color="processing" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                                  ready {formatDurationLabel(prepareSummary.readyDurationMs)}
                                </Tag>
                              )}
                              {prepareSummary.cachedStepCount > 0 && (
                                <Tag color="default" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                                  缓存 {prepareSummary.cachedStepCount}
                                </Tag>
                              )}
                            </>
                          )}
                          {!prepareRunning && prepareStatusMatchesCurrentConnection && prepareSummary?.status === 'failed' && (
                            <Tooltip title={`${prepareSummary.profileName} 需要重新执行${prepareSummary.failedCount > 0 ? ` · ${prepareSummary.failedCount} 步失败` : ''}`}>
                              <Tag color="error" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>
                                预热失败
                              </Tag>
                            </Tooltip>
                          )}
                        </Space>
                      )}
                      <Space size={3} onClick={(e) => e.stopPropagation()}>
                        {sess.status === 'connected' ? (
                          <Button size="small" danger
                            icon={<DisconnectOutlined />}
                            onClick={() => disconnectSession(sess.id)}>
                            断开
                          </Button>
                        ) : isDisconnectedOrError ? (
                          <Button size="small" type="primary"
                            icon={<ReloadOutlined />}
                            disabled={!proxyOnline}
                            onClick={() => handleOpenConnect(sess.id)}>
                            重连
                          </Button>
                        ) : (
                          <Button size="small" type="primary"
                            icon={<ApiOutlined />}
                            disabled={!proxyOnline}
                            onClick={() => handleOpenConnect(sess.id)}>
                            连接
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
                        {sess.status === 'error' && sess.statusMsg ? ` · ⚠ ${sess.statusMsg}` : ''}
                      </Text>
                    )}
                    {ownerGroups.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {ownerGroups.map((group) => (
                          <Tag key={group.id} color="blue" style={{ fontSize: 10, margin: 0 }}>{group.name}</Tag>
                        ))}
                      </div>
                    )}
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
              {
                label: analyzerLogCount > 0 ? `智能监控 (${analyzerLogCount})` : '智能监控',
                value: 'analyzer',
              },
              {
                label: '后台任务',
                value: 'bgjobs',
              },
            ]}
          />

          {activeView === 'terminal' ? (
            <div style={{
              border: `1px solid ${borderColor}`, borderRadius: 6,
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
              height: terminalHeight, minHeight: 300,
              background: isDark ? '#1e1e1e' : '#fafafa',
              position: 'relative',
            }}>
              {/* ----------------- 定时任务列表面板 ----------------- */}
              <div style={{ display: activeTab === 'cron' ? 'block' : 'none', flex: 1, overflowY: 'auto' }}>
                <React.Suspense fallback={<Spin />}>
                  {activeTab === 'cron' && <CronJobList />}
                </React.Suspense>
              </div>

              {/* 终端区域 */}
              <div style={{ flex: 1, display: activeTab === 'cron' ? 'none' : 'flex', flexDirection: 'column', minHeight: 260 }}>
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
                <div style={{ flex: 1, minHeight: 220, position: 'relative' }}>
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
                          if (data === '\r') {
                            const getLine = getLineFns.current[sess.id];
                            if (getLine) {
                              const currentLine = getLine();
                              const cleanCmd = currentLine.replace(/^.*?[#$]\s+/, '').trim();
                              if (cleanCmd) {
                                recordManualCommandStart(sess.id, cleanCmd, currentLine);
                              }
                            }
                          }
                        }}
                        onResize={(cols, rows) => resizeSession(sess.id, cols, rows)}
                        registerGetCurrentLine={(fn) => { getLineFns.current[sess.id] = fn; }}
                        registerWrite={(fn) => { writeCallbacks.current.set(sess.id, fn); }}
                        registerSnapshot={(fn) => { snapshotCallbacks.current.set(sess.id, fn); }}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* 拖拽调整高度 */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startH = terminalHeight;
                  const onMove = (ev: MouseEvent) => {
                    const newH = Math.max(300, startH + ev.clientY - startY);
                    setTerminalHeight(newH);
                  };
                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
                style={{
                  height: 6, cursor: 'row-resize', background: isDark ? '#3e3e42' : '#e4e4e7',
                  position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <div style={{ width: 40, height: 3, borderRadius: 2, background: isDark ? '#555' : '#ccc' }} />
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

          {/* ── 智能监控视图 */}
          {activeView === 'analyzer' && (
            <div style={{
              border: `1px solid ${borderColor}`, borderRadius: 6,
              minHeight: 400, display: 'flex', flexDirection: 'column',
              overflow: 'hidden', height: sessions.length > 0 ? 'calc(100% - 34px)' : '100%'
            }}>
              <KeywordAnalyzer />
            </div>
          )}

          {/* ── 后台任务监控视图 */}
          {activeView === 'bgjobs' && (
            <div style={{
              border: `1px solid ${borderColor}`, borderRadius: 6,
              minHeight: 400, display: 'flex', flexDirection: 'column',
              overflow: 'auto', height: sessions.length > 0 ? 'calc(100% - 34px)' : '100%',
              padding: 8,
            }}>
              <BackgroundJobMonitor />
            </div>
          )}
        </div>

        {/* ══ 右栏：多节点执行配置 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Segmented
            options={[
              { label: '连接及会话', value: 'connect' },
              { label: '多节点执行', value: 'multi_node' },
              { label: '定时任务(Cron)', value: 'cron' },
            ]}
            value={activeTab}
            onChange={(v) => setActiveTab(v as 'connect' | 'multi_node' | 'cron')}
            block
            size="small"
            style={{ marginBottom: 12 }}
          />
          {activeTab === 'connect' && (
            <>
              <Card
                size="small"
                title="连接分组工作台"
                style={{ background: cardBg, border: `1px solid ${borderColor}` }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Alert
                    type="info"
                    showIcon={false}
                    style={{ padding: '8px 10px' }}
                    message={
                      <div>
                        <Text strong style={{ fontSize: 12 }}>当前能力</Text>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                          1. 按会话组批量建连/重连/断开
                        </Text>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                          2. 连接成功后自动发送 `TMOUT=0` 并跑初始化采集命令
                        </Text>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                          3. 当前连接内手动补采集的变量会直接参与多节点命令渲染
                        </Text>
                      </div>
                    }
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    会话组维护在左侧面板，当前右侧重点用于查看活动会话的连接级上下文和手动补采集。
                  </Text>
                </div>
              </Card>
              <NodeContextPanel activeSession={activeSession} context={activeNodeContext} isDark={isDark} />
            </>
          )}

          {activeTab === 'multi_node' && (
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
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>变量配置</Text>
                  {allVarNames.map((v) => {
                    const def = definedVars.get(v);
                    const labelStr = def?.label ? `${def.label} (${v})` : v;
                    return (
                      <div key={v} style={{ marginBottom: 6 }}>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                          {labelStr}{def?.required && <span style={{ color: '#ef4444' }}> *</span>}
                        </Text>
                        {def?.type === 'select' ? (
                          <Select
                            size="small"
                            value={varValues[v] ?? def.defaultValue ?? ''}
                            onChange={(val) => setVarValues((prev) => ({ ...prev, [v]: val }))}
                            style={{ width: '100%', fontSize: 11 }}
                            options={(def.options ?? []).map((o) => ({ label: o, value: o }))}
                          />
                        ) : (
                          <Input
                            size="small"
                            type={def?.type === 'number' ? 'number' : 'text'}
                            value={varValues[v] ?? def?.defaultValue ?? ''}
                            onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                            placeholder={def?.placeholder ?? `输入 ${v}`}
                            style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {nodeVariableDiagnostics.some((item) => item.missingVars.length > 0) && (
                    <Alert
                      type="warning"
                      showIcon={false}
                      style={{ marginTop: 8, padding: '6px 10px' }}
                      message={
                        <div>
                          <Text strong style={{ fontSize: 12 }}>变量缺失检查</Text>
                          {nodeVariableDiagnostics
                            .filter((item) => item.missingVars.length > 0)
                            .map((item) => (
                              <Text key={item.sessionId} type="secondary" style={{ fontSize: 11, display: 'block' }}>
                                {item.sessionName}: 缺少 {item.missingVars.join(', ')}
                              </Text>
                            ))}
                        </div>
                      }
                    />
                  )}
                </div>
              )}

              <Divider style={{ margin: '2px 0' }} />

              <Card size="small" title="登录预处理" extra={
                <Button size="small" icon={<ReloadOutlined />} loading={loadingPrepareProfiles} onClick={() => void fetchPrepareProfiles()}>
                  刷新模板
                </Button>
              }>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    把原来依赖人工完成的 shell/profile/env 预热前置化。这样用户登录节点后能更快进入“可执行、可采集、可定位”的状态。
                  </Text>
                  <Select
                    size="small"
                    value={activePrepareProfile?.profileId}
                    placeholder="选择预处理模板"
                    loading={loadingPrepareProfiles}
                    onChange={(value) => setPrepareSettings((current) => ({ ...current, profileId: value }))}
                    style={{ width: '100%' }}
                    options={prepareProfiles.map((profile) => ({
                      label: `${profile.name} (${profile.steps.length} 步)`,
                      value: profile.profileId,
                    }))}
                  />
                  {activePrepareProfile && (
                    <>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {activePrepareProfile.description || '无描述'}
                      </Text>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {activePrepareProfile.steps.map((step) => (
                          <Tag key={`${activePrepareProfile.profileId}-${step.name}`} color="default" style={{ fontSize: 10 }}>
                            {step.name}
                            {step.phase === 'ready' ? ' · ready' : ''}
                            {step.mode === 'exec' ? ' · exec' : ''}
                            {step.cacheScope ? ' · cache' : ''}
                          </Tag>
                        ))}
                      </div>
                    </>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <Text style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>连接后自动执行</Text>
                      <Switch
                        size="small"
                        checked={prepareSettings.autoRun}
                        onChange={(checked) => setPrepareSettings((current) => ({ ...current, autoRun: checked }))}
                      />
                    </div>
                    <div>
                      <Text style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>失败后继续后续步骤</Text>
                      <Switch
                        size="small"
                        checked={prepareSettings.continueOnError}
                        onChange={(checked) => setPrepareSettings((current) => ({ ...current, continueOnError: checked }))}
                      />
                    </div>
                  </div>
                  <Space wrap>
                    <Tag color={connectedSelectedNodes.length > 0 ? 'blue' : 'default'}>
                      选中已连接 {connectedSelectedNodes.length}
                    </Tag>
                    <Tag color={selectedPrepareStats.ready > 0 ? 'success' : 'default'}>
                      就绪 {selectedPrepareStats.ready}
                    </Tag>
                    {selectedPrepareStats.running > 0 && <Tag color="gold">执行中 {selectedPrepareStats.running}</Tag>}
                    {selectedPrepareStats.failed > 0 && <Tag color="error">失败 {selectedPrepareStats.failed}</Tag>}
                    {selectedPrepareStats.pending > 0 && <Tag color="default">待执行 {selectedPrepareStats.pending}</Tag>}
                  </Space>
                  <Button
                    icon={<ThunderboltOutlined />}
                    block
                    onClick={() => void handleRunPrepareOnSelected()}
                    disabled={connectedSelectedNodes.length === 0 || !activePrepareProfile}
                    loading={connectedSelectedNodes.length > 0 && connectedSelectedNodes.every((sessionId) => prepareRunningIds.includes(sessionId))}
                  >
                    对选中节点执行预处理
                  </Button>
                  <Alert
                    type="info"
                    showIcon={false}
                    style={{ fontSize: 11, padding: '6px 10px' }}
                    message={
                      <div>
                        <Text strong style={{ fontSize: 12 }}>自动预处理负责：</Text>
                        {['优先让节点尽快进入 ready 状态', '并行完成只读上下文探测', '缓存稳定的工具探测结果', '把预热噪声与真正排查信号分开'].map((text, index) => (
                          <Text key={text} type="secondary" style={{ fontSize: 11, display: 'block' }}>{index + 1}. {text}</Text>
                        ))}
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                          如果现场还需要 `sudo su -`、`cd` 到业务目录或额外 source 私有 env，仍可继续在终端手动补充。
                        </Text>
                      </div>
                    }
                  />
                </Space>
              </Card>

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
          )}

          {activeTab === 'cron' && (
            <Card
              size="small"
              title="Cron 说明"
              style={{ background: cardBg, border: `1px solid ${borderColor}` }}
            >
              <Alert
                type="info"
                showIcon={false}
                message={
                  <div>
                    <Text strong style={{ fontSize: 12 }}>真实会话组已接入 Cron</Text>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                      新建/编辑 Cron 时会直接使用真实会话组；旧 `group-*` 任务仍可兼容解析。
                    </Text>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                      中间面板用于维护 Cron 列表，右侧不再重复显示配置表。
                    </Text>
                  </div>
                }
              />
            </Card>
          )}
        </div>
      </div>

      {/* ── 档案编辑弹窗 */}
      <ProfileModal
        open={profileModal}
        initial={editingProfile}
        profiles={profiles}
        onOk={(p) => {
          if (editingProfile && editingProfile.id) updateProfile(editingProfile.id, p);
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
          {connectingEffectiveAuth === 'privateKey' && (
            <Form.Item name="passphrase" label="目标主机私钥 Passphrase">
              <Password prefix={<LockOutlined />} placeholder="私钥加密口令，无加密则留空" autoComplete="off" />
            </Form.Item>
          )}
          {connectingEffectiveAuth === 'password' && (
            <Form.Item name="password" label="目标主机密码" rules={[{ required: true }]}>
              <Password prefix={<LockOutlined />} placeholder="SSH 登录密码" autoComplete="off" />
            </Form.Item>
          )}

          {connectingJumpProfile && (
            <>
              {connectingJumpAuth === 'privateKey' && (
                <Form.Item name="jumpPassphrase" label="跳板机私钥 Passphrase">
                  <Password prefix={<LockOutlined />} placeholder={`[${connectingJumpProfile.name}] 私钥口令，无加密则留空`} autoComplete="off" />
                </Form.Item>
              )}
              {connectingJumpAuth === 'password' && (
                <Form.Item name="jumpPassword" label="跳板机密码" rules={[{ required: true }]}>
                  <Password prefix={<LockOutlined />} placeholder={`[${connectingJumpProfile.name}] SSH 登录密码`} autoComplete="off" />
                </Form.Item>
              )}
            </>
          )}

          <Alert type="info" showIcon={false}
            message={<Text style={{ fontSize: 12 }}>如已在凭证管理中保存密码，可自动连接无需重复输入</Text>} />
        </Form>
      </Modal>

      {/* ── 批量快捷登录弹窗 */}
      <BatchLoginModal
        open={batchLoginModal}
        onCancel={() => setBatchLoginModal(false)}
        onSessionsPrepared={(sessionIds) => setSelectedNodes((current) => Array.from(new Set([...current, ...sessionIds])))}
        onSuccess={() => setBatchLoginModal(false)}
      />

      <SessionGroupModal
        open={!!groupModal}
        sessions={sessions}
        initialValue={groupModal === 'new' ? null : groupModal}
        onCancel={() => setGroupModal(null)}
        onSave={(values) => {
          if (groupModal && groupModal !== 'new') {
            updateSessionGroup(groupModal.id, values);
          } else {
            createSessionGroup(values);
          }
          setGroupModal(null);
        }}
      />

      {/* ── 凭证管理弹窗 */}
      <CredentialManager
        open={credentialModal}
        onCancel={() => setCredentialModal(false)}
      />
    </div>
  );
};

export default SSHManager;
