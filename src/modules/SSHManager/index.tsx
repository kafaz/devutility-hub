import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  Typography,
  Button,
  Input,
  InputNumber,
  Select,
  Space,
  Card,
  Tag,
  Alert,
  Tooltip,
  Divider,
  Table,
  Badge,
  Spin,
  message,
} from 'antd';
import {
  ApiOutlined,
  DisconnectOutlined,
  PlayCircleOutlined,
  ClearOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { useSSHStore } from './store/sshStore';
import type { ConnStatus, ExecResult } from './store/sshStore';
import { useGlobalStore } from '../../store/globalStore';
import { useClipboard } from '../../hooks/useClipboard';

const { Title, Text } = Typography;

// ─── 状态徽章 ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ConnStatus, { badge: 'processing' | 'success' | 'error' | 'default'; label: string; color: string }> = {
  idle:         { badge: 'default',    label: '未连接',   color: '#6b7280' },
  connecting:   { badge: 'processing', label: '连接中…',  color: '#3b82f6' },
  connected:    { badge: 'success',    label: '已连接',   color: '#22c55e' },
  error:        { badge: 'error',      label: '连接失败', color: '#ef4444' },
  disconnected: { badge: 'default',    label: '已断开',   color: '#6b7280' },
};

// ─── 终端组件 ──────────────────────────────────────────────────────────────

const TerminalPanel: React.FC<{
  isDark: boolean;
  onReady: (write: (b64: string) => void) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}> = ({ isDark, onReady, onInput, onResize }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: isDark
        ? { background: '#1e1e1e', foreground: '#d4d4d8', cursor: '#3b82f6',
            selectionBackground: '#3b82f633', black: '#1e1e1e' }
        : { background: '#fafafa', foreground: '#18181b', cursor: '#3b82f6',
            selectionBackground: '#3b82f622' },
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      fontSize:   13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback:  5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    // 延迟 fit 等 DOM 渲染完成
    requestAnimationFrame(() => {
      fit.fit();
      onResize(term.cols, term.rows);
    });

    termRef.current = term;
    fitRef.current  = fit;

    // 键盘输入 → store
    const dispInput = term.onData(onInput);

    // 窗口 resize → fit
    const ro = new ResizeObserver(() => {
      fit.fit();
      onResize(term.cols, term.rows);
    });
    ro.observe(containerRef.current);

    // 暴露写入函数给父组件（用 atob 替代 Node Buffer，兼容浏览器环境）
    onReady((b64: string) => {
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      term.write(bytes);
    });

    return () => {
      dispInput.dispose();
      ro.disconnect();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  return (
    <div
      ref={containerRef}
      style={{
        width:  '100%',
        height: '100%',
        padding: 4,
        background: isDark ? '#1e1e1e' : '#fafafa',
        borderRadius: 4,
      }}
    />
  );
};

// ─── 快速测试命令组 ────────────────────────────────────────────────────────

const QUICK_CMDS = [
  { label: 'whoami',   cmd: 'whoami' },
  { label: 'hostname', cmd: 'hostname' },
  { label: 'uptime',   cmd: 'uptime' },
  { label: 'df -h',    cmd: 'df -h' },
  { label: 'free -h',  cmd: 'free -h' },
  { label: 'ps top5',  cmd: "ps aux --sort=-%cpu | head -6" },
];

// ─── 执行历史表格 ──────────────────────────────────────────────────────────

const HistoryTable: React.FC<{ history: ExecResult[]; isDark: boolean }> = ({ history, isDark }) => {
  const { copy } = useClipboard();
  const cardBg = isDark ? '#2d2d30' : '#fafafa';
  const border  = isDark ? '#3e3e42' : '#e4e4e7';

  const columns = [
    {
      title: '状态',
      dataIndex: 'exitCode',
      width: 56,
      render: (c: number) =>
        c === 0
          ? <CheckCircleOutlined style={{ color: '#22c55e' }} />
          : <CloseCircleOutlined style={{ color: '#ef4444' }} />,
    },
    {
      title: '命令',
      dataIndex: 'cmd',
      ellipsis: { showTitle: false },
      render: (v: string) => (
        <Tooltip title={v}>
          <Text
            style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
          >
            {v}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 72,
      render: (v: number) => (
        <Text type="secondary" style={{ fontSize: 11 }}>{v}ms</Text>
      ),
    },
    {
      title: 'Exit',
      dataIndex: 'exitCode',
      width: 50,
      render: (v: number) => (
        <Tag color={v === 0 ? 'success' : 'error'} style={{ fontSize: 10 }}>
          {v}
        </Tag>
      ),
    },
    {
      title: '输出',
      dataIndex: 'stdout',
      ellipsis: { showTitle: false },
      render: (v: string, rec: ExecResult) => {
        const text = v || rec.stderr || '（无输出）';
        return (
          <Space size={4}>
            <Tooltip title={<pre style={{ maxWidth: 400, whiteSpace: 'pre-wrap', fontSize: 11 }}>{text}</pre>}>
              <Text
                type="secondary"
                style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }}
              >
                {text.split('\n')[0].slice(0, 60)}
              </Text>
            </Tooltip>
            <CopyOutlined
              style={{ cursor: 'pointer', color: '#a1a1aa' }}
              onClick={() => copy(v || rec.stderr)}
            />
          </Space>
        );
      },
    },
  ];

  return (
    <Table
      dataSource={history}
      columns={columns}
      rowKey="id"
      size="small"
      pagination={{ pageSize: 10, size: 'small', showTotal: (t) => `共 ${t} 条` }}
      locale={{ emptyText: '暂无执行记录' }}
      style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 6 }}
    />
  );
};

// ─── 主页面 ────────────────────────────────────────────────────────────────

const SSHManager: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const {
    params, setParams,
    proxyOnline, agents, checkProxy,
    status, statusMsg,
    execHistory,
    connect, disconnect, sendInput, resize,
    execCommand, clearHistory,
  } = useSSHStore();

  const [messageApi, contextHolder] = message.useMessage();
  const [executing,  setExecuting]  = useState(false);
  const [customCmd,  setCustomCmd]  = useState('');
  const [activeTab,  setActiveTab]  = useState<'terminal' | 'history'>('terminal');

  // 持有 terminal write 函数的 ref（由 TerminalPanel 在 onReady 时注入）
  const writeTermRef = useRef<((b64: string) => void) | null>(null);

  // ─ 检查代理服务器
  useEffect(() => {
    checkProxy();
    const timer = setInterval(checkProxy, 5000);
    return () => clearInterval(timer);
  }, [checkProxy]);

  // ─ 连接
  const handleConnect = useCallback(() => {
    if (!params.host || !params.username) {
      messageApi.warning('请填写主机地址和用户名');
      return;
    }
    if (!params.agent) {
      messageApi.warning('请选择 SSH Agent');
      return;
    }
    connect((b64) => writeTermRef.current?.(b64));
  }, [params, connect, messageApi]);

  // ─ 执行命令（exec 通道，有独立环境）
  const handleExec = useCallback(async (cmd: string) => {
    if (status !== 'connected') {
      messageApi.warning('请先建立 SSH 连接');
      return;
    }
    if (!cmd.trim()) return;

    setExecuting(true);
    try {
      const result = await execCommand(cmd.trim());
      if (result.exitCode === 0) {
        messageApi.success(`✅ 命令执行成功（${result.durationMs}ms）`);
      } else {
        messageApi.warning(`❌ exit ${result.exitCode}`);
      }
      setActiveTab('history');
    } finally {
      setExecuting(false);
    }
  }, [status, execCommand, messageApi]);

  const cardBg     = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';
  const sc          = STATUS_CONFIG[status];
  const isConn      = status === 'connected';

  return (
    <div style={{ padding: 24, height: '100vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      {/* ── 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>SSH Manager</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            SSH Agent 复用 · 无需重复输入密码
          </Text>
        </div>
        <Space>
          <Badge status={sc.badge} />
          <Tag color={sc.color} style={{ marginRight: 0 }}>{sc.label}</Tag>
          {statusMsg && <Text type="secondary" style={{ fontSize: 12 }}>{statusMsg}</Text>}
        </Space>
      </div>

      {/* ── 代理状态提示 */}
      {!proxyOnline && (
        <Alert
          type="warning"
          showIcon
          message="SSH Proxy 代理服务未运行"
          description={
            <div style={{ fontSize: 12 }}>
              <Text>请在项目目录执行以下命令启动代理服务：</Text>
              <pre
                style={{
                  marginTop: 6,
                  padding: '6px 10px',
                  background: isDark ? '#1e1e1e' : '#f4f4f5',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                }}
              >
                cd devutility-hub/server{'\n'}
                npm install{'\n'}
                node index.js
              </pre>
              <Button size="small" icon={<ReloadOutlined />} onClick={checkProxy}>
                重新检测
              </Button>
            </div>
          }
        />
      )}

      {/* ── 主体：两栏 */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, flex: 1, minHeight: 0 }}>

        {/* ── 左栏：连接配置 + 命令面板 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>

          {/* 连接配置卡 */}
          <Card
            size="small"
            title="连接配置"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <Text style={{ fontSize: 12 }}>主机地址</Text>
                <Input
                  size="small"
                  value={params.host}
                  onChange={(e) => setParams({ host: e.target.value })}
                  placeholder="192.168.1.100"
                  disabled={isConn}
                  style={{ marginTop: 2 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
                <div>
                  <Text style={{ fontSize: 12 }}>用户名</Text>
                  <Input
                    size="small"
                    value={params.username}
                    onChange={(e) => setParams({ username: e.target.value })}
                    placeholder="root"
                    disabled={isConn}
                    style={{ marginTop: 2 }}
                  />
                </div>
                <div>
                  <Text style={{ fontSize: 12 }}>端口</Text>
                  <InputNumber
                    size="small"
                    min={1}
                    max={65535}
                    value={params.port}
                    onChange={(v) => setParams({ port: v ?? 22 })}
                    disabled={isConn}
                    style={{ width: '100%', marginTop: 2 }}
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 12 }}>SSH Agent</Text>
                  <Tooltip title="刷新可用 Agent 列表">
                    <ReloadOutlined
                      style={{ fontSize: 11, color: '#a1a1aa', cursor: 'pointer' }}
                      onClick={checkProxy}
                    />
                  </Tooltip>
                </div>
                <Select
                  size="small"
                  value={params.agent || undefined}
                  onChange={(v) => setParams({ agent: v })}
                  disabled={isConn || !proxyOnline}
                  placeholder={proxyOnline ? '选择 Agent' : '代理服务未启动'}
                  style={{ width: '100%', marginTop: 2 }}
                  options={agents.map((a) => ({
                    label: (
                      <Tooltip title={a.hint}>
                        <span>{a.name}</span>
                      </Tooltip>
                    ),
                    value: a.value,
                  }))}
                />
                {/* 所选 Agent 的提示信息 */}
                {params.agent && agents.find((a) => a.value === params.agent)?.hint && (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 3 }}>
                    💡 {agents.find((a) => a.value === params.agent)?.hint}
                  </Text>
                )}
              </div>

              <Divider style={{ margin: '4px 0' }} />

              {/* 连接 / 断开按钮 */}
              {!isConn ? (
                <Button
                  type="primary"
                  icon={<ApiOutlined />}
                  onClick={handleConnect}
                  disabled={!proxyOnline}
                  block
                >
                  连接
                </Button>
              ) : (
                <Button
                  danger
                  icon={<DisconnectOutlined />}
                  onClick={disconnect}
                  block
                >
                  断开连接
                </Button>
              )}
            </div>
          </Card>

          {/* 快速命令面板 */}
          <Card
            size="small"
            title="快速执行（exec 通道）"
            extra={
              <Tooltip title="exec 通道与终端 Shell 隔离，命令在独立环境中运行，cd/export 等不影响终端">
                <Text type="secondary" style={{ fontSize: 11, cursor: 'help' }}>
                  ⓘ 独立通道
                </Text>
              </Tooltip>
            }
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            {/* 预设快速命令 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {QUICK_CMDS.map((q) => (
                <Button
                  key={q.cmd}
                  size="small"
                  disabled={!isConn || executing}
                  onClick={() => handleExec(q.cmd)}
                  style={{ fontSize: 11 }}
                >
                  {q.label}
                </Button>
              ))}
            </div>

            {/* 自定义命令输入 */}
            <Space.Compact style={{ width: '100%' }}>
              <Input
                size="small"
                value={customCmd}
                onChange={(e) => setCustomCmd(e.target.value)}
                onPressEnter={() => handleExec(customCmd)}
                placeholder="输入命令后按 Enter 执行"
                disabled={!isConn || executing}
                style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
              />
              <Button
                size="small"
                type="primary"
                icon={executing ? <Spin size="small" /> : <PlayCircleOutlined />}
                onClick={() => handleExec(customCmd)}
                disabled={!isConn || executing || !customCmd.trim()}
              />
            </Space.Compact>
          </Card>

          {/* Tab 切换按钮 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="small"
              type={activeTab === 'terminal' ? 'primary' : 'default'}
              onClick={() => setActiveTab('terminal')}
              style={{ flex: 1 }}
            >
              终端
            </Button>
            <Button
              size="small"
              type={activeTab === 'history' ? 'primary' : 'default'}
              onClick={() => setActiveTab('history')}
              style={{ flex: 1 }}
            >
              执行历史 {execHistory.length > 0 && `(${execHistory.length})`}
            </Button>
          </div>

          {/* 清除历史 */}
          {activeTab === 'history' && execHistory.length > 0 && (
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={clearHistory}
              block
            >
              清除历史
            </Button>
          )}
        </div>

        {/* ── 右栏：终端 / 执行历史 */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {activeTab === 'terminal' ? (
            <div
              style={{
                flex: 1,
                border: `1px solid ${isConn ? '#22c55e44' : borderColor}`,
                borderRadius: 6,
                overflow: 'hidden',
                background: isDark ? '#1e1e1e' : '#fafafa',
                minHeight: 400,
              }}
            >
              {!isConn && status !== 'connecting' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                    pointerEvents: 'none',
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {status === 'error'
                      ? statusMsg
                      : '填写左侧配置后点击「连接」'}
                  </Text>
                </div>
              )}
              <TerminalPanel
                isDark={isDark}
        onReady={(write) => { writeTermRef.current = write; }}
        onInput={sendInput}
        onResize={resize}
      />

            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <HistoryTable history={execHistory} isDark={isDark} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SSHManager;
