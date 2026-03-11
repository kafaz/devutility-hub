/**
 * SessionJournal — 会话执行日志面板
 *
 * 以时间线方式展示当前会话发生的所有操作：
 *   - SOP 步骤执行记录（命令 + 输出 + 正则判断依据 + 变量）
 *   - 手动命令记录（从终端键盘截收）
 *   - 快速执行命令记录
 *   - 用户备注
 *   - 终端快照
 *
 * 支持：
 *   - 按类型筛选
 *   - 导出为 Markdown
 *   - 添加备注
 *   - 触发终端快照
 */
import {
    CameraOutlined,
    CheckCircleOutlined,
    ClearOutlined,
    CloseCircleOutlined,
    CodeOutlined,
    DeleteOutlined, DownloadOutlined,
    EditOutlined,
    FileTextOutlined,
    InfoCircleOutlined,
    PlusOutlined,
} from '@ant-design/icons';
import {
    Badge,
    Button,
    Empty,
    Input,
    message,
    Modal,
    Popconfirm,
    Select,
    Space,
    Tag,
    Tooltip,
    Typography,
} from 'antd';
import React, { useState } from 'react';
import ResizableOutput from '../../../components/shared/ResizableOutput';
import { useGlobalStore } from '../../../store/globalStore';
import type { JournalEntry, JournalEntryType } from '../store/journalStore';
import { useJournalStore } from '../store/journalStore';

const { Text } = Typography;
const { TextArea } = Input;

// ─── 类型配置 ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<JournalEntryType, {
  color: string; label: string; dot: React.ReactNode;
}> = {
  sop_step:    { color: '#3b82f6', label: 'SOP',    dot: <FileTextOutlined style={{ color: '#3b82f6' }} /> },
  quick_exec:  { color: '#22c55e', label: '快速执行', dot: <CodeOutlined style={{ color: '#22c55e' }} /> },
  manual_cmd:  { color: '#8b5cf6', label: '手动命令', dot: <CodeOutlined style={{ color: '#8b5cf6' }} /> },
  note:        { color: '#f59e0b', label: '备注',   dot: <EditOutlined style={{ color: '#f59e0b' }} /> },
  snapshot:    { color: '#06b6d4', label: '快照',   dot: <CameraOutlined style={{ color: '#06b6d4' }} /> },
  session_evt: { color: '#6b7280', label: '事件',   dot: <InfoCircleOutlined style={{ color: '#6b7280' }} /> },
};

// ─── 单条日志条目 ──────────────────────────────────────────────────────────

const EntryCard: React.FC<{
  entry:    JournalEntry;
  isDark:   boolean;
  onDelete: () => void;
}> = ({ entry, isDark, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const tc  = TYPE_CONFIG[entry.type];
  const bg  = isDark ? '#2d2d30' : '#fafafa';
  const bdr = isDark ? '#3e3e42' : '#e4e4e7';
  const ts  = new Date(entry.timestamp).toLocaleTimeString('zh-CN');

  const outputText = entry.output?.trimEnd() ?? '';
  const hasOutput  = outputText.length > 0;

  return (
    <div
      style={{
        padding:       '8px 10px',
        background:    bg,
        border:        `1px solid ${bdr}`,
        borderRadius:  6,
        borderLeft:    `3px solid ${tc.color}`,
        marginBottom:  4,
        position:      'relative',
      }}
    >
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>

          {/* 第一行：类型 + 节点 IP + 时间 */}
          <Space size={6} wrap>
            <Tag color={tc.color} style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
              {tc.label}
            </Tag>

            {/* 节点信息：管理 IP（始终显示，优先级最高） */}
            {(entry.nodeHost || entry.sessionName) && (
              <Tooltip
                title={
                  entry.nodeHost
                    ? `${entry.nodeUser ?? ''}${entry.nodeUser ? '@' : ''}${entry.nodeHost}:${entry.nodePort ?? 22}`
                    : entry.sessionName
                }
              >
                <Tag
                  color="default"
                  style={{
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                    background: isDark ? '#1e3a5f' : '#eff6ff',
                    border:     `1px solid ${isDark ? '#3b82f644' : '#bfdbfe'}`,
                    color:      isDark ? '#93c5fd' : '#1d4ed8',
                    padding:    '0 6px',
                    lineHeight: '18px',
                  }}
                >
                  {/* 优先显示 IP，没有则显示会话名 */}
                  {entry.nodeHost
                    ? `📡 ${entry.nodeHost}`
                    : `📡 ${entry.sessionName}`}
                </Tag>
              </Tooltip>
            )}

            <Text type="secondary" style={{ fontSize: 11 }}>{ts}</Text>
            {entry.durationMs != null && (
              <Text type="secondary" style={{ fontSize: 11 }}>{entry.durationMs}ms</Text>
            )}
            {entry.exitCode != null && (
              <Tag
                color={entry.exitCode === 0 ? 'success' : 'error'}
                icon={entry.exitCode === 0
                  ? <CheckCircleOutlined />
                  : <CloseCircleOutlined />}
                style={{ fontSize: 10 }}
              >
                exit {entry.exitCode}
              </Tag>
            )}
            {entry.statusReason && (
              <Tooltip title={entry.statusReason}>
                <Tag
                  color={entry.exitCode === 0 ? 'green' : 'red'}
                  style={{ fontSize: 10, cursor: 'help' }}
                >
                  {entry.statusReason.startsWith('正常正则') ? '✅正则' :
                   entry.statusReason.startsWith('异常正则') ? '❌正则' : ''}
                </Tag>
              </Tooltip>
            )}
          </Space>

          {/* 第二行：SOP 步骤名（仅 sop_step 类型显示） */}
          {entry.sopStepName && (
            <Text type="secondary" style={{ fontSize: 11, paddingLeft: 2 }}>
              └ {entry.sopStepName}
            </Text>
          )}
        </div>
        <Space size={4}>
          {hasOutput && (
            <Button
              type="link" size="small" style={{ padding: 0, fontSize: 11 }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? '收起' : '展开输出'}
            </Button>
          )}
          <Popconfirm
            title="删除此记录？" okText="删除" cancelText="取消"
            okButtonProps={{ danger: true }} onConfirm={onDelete}
          >
            <DeleteOutlined style={{ fontSize: 11, color: '#6b7280', cursor: 'pointer' }} />
          </Popconfirm>
        </Space>
      </div>

      {/* 命令 */}
      {entry.command && (
        <div
          style={{
            fontFamily: 'JetBrains Mono, Consolas, monospace',
            fontSize:    11,
            color:       isDark ? '#e4e4e7' : '#18181b',
            padding:     '2px 6px',
            background:  isDark ? '#1e1e1e' : '#f4f4f5',
            borderRadius: 4,
            marginBottom: 4,
          }}
        >
          $ {entry.command}
        </div>
      )}

      {/* 备注/快照/事件内容 */}
      {entry.content && (
        <Text style={{ fontSize: 12, display: 'block', whiteSpace: 'pre-wrap' }}>
          {entry.content}
        </Text>
      )}

      {/* 变量捕获 */}
      {entry.capturedVar && (
        <Tag color="blue" style={{ fontSize: 10, marginTop: 2 }}>
          🔵 ${'{'}{ entry.capturedVar.name }{'}'} = {entry.capturedVar.value.slice(0, 40)}
          {entry.capturedVar.value.length > 40 ? '…' : ''}
        </Tag>
      )}

      {/* 输出（可展开，可拖拽） */}
      {expanded && hasOutput && (
        <div style={{ marginTop: 6 }}>
          <ResizableOutput
            content={outputText}
            isDark={isDark}
            minHeight={60}
            maxHeight={400}
            showCopy
          />
        </div>
      )}
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

interface Props {
  sessionId:   string;
  sessionName: string;
  /** 触发终端内容读取（由父组件注入） */
  onSnapshotRequest: () => string;
}

const SessionJournal: React.FC<Props> = ({ sessionId, sessionName, onSnapshotRequest }) => {
  const { theme }              = useGlobalStore();
  const isDark                 = theme === 'dark';
  const { journals, addEntry, deleteEntry, clearSession } = useJournalStore();
  const [messageApi, ctx]      = message.useMessage();
  const [filterType, setFilterType] = useState<JournalEntryType | 'all'>('all');
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  const entries = journals[sessionId] ?? [];

  const filtered = filterType === 'all'
    ? entries
    : entries.filter((e) => e.type === filterType);

  // ── 添加终端快照 ────────────────────────────────────────────────────────
  const handleSnapshot = () => {
    const content = onSnapshotRequest();
    if (!content.trim()) { messageApi.info('终端暂无内容'); return; }
    addEntry({
      sessionId, sessionName,
      type:      'snapshot',
      timestamp: Date.now(),
      content,
      eventTitle: '终端快照',
    });
    messageApi.success('终端快照已保存到日志');
  };

  // ── 添加备注 ─────────────────────────────────────────────────────────────
  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addEntry({
      sessionId, sessionName,
      type:      'note',
      timestamp: Date.now(),
      content:   noteText.trim(),
    });
    setNoteText('');
    setNoteModalOpen(false);
    messageApi.success('备注已添加');
  };

  // ── 导出为 Markdown ───────────────────────────────────────────────────────
  const handleExport = () => {
    const lines: string[] = [
      `# 会话日志：${sessionName}`,
      '',
      `> 导出时间：${new Date().toLocaleString('zh-CN')}  `,
      `> 共 ${entries.length} 条记录`,
      '',
      '---',
      '',
    ];

    entries.forEach((e) => {
      const tc   = TYPE_CONFIG[e.type];
      const ts   = new Date(e.timestamp).toLocaleString('zh-CN');
      // 节点信息字符串
      const nodeInfo = e.nodeHost
        ? `${e.nodeUser ? e.nodeUser + '@' : ''}${e.nodeHost}:${e.nodePort ?? 22}`
        : e.sessionName;
      lines.push(`## [${ts}] ${tc.label}${e.sopStepName ? ` · ${e.sopStepName}` : ''}`);
      lines.push('');
      lines.push(`> **节点**: \`${nodeInfo}\``);
      lines.push('');

      if (e.command) {
        lines.push('**命令**');
        lines.push('```bash');
        lines.push(e.command);
        lines.push('```');
        lines.push('');
      }

      if (e.exitCode != null) {
        const statusLine = `**状态**: exit ${e.exitCode}${e.durationMs != null ? ` (${e.durationMs}ms)` : ''}${e.statusReason ? ` · ${e.statusReason}` : ''}`;
        lines.push(statusLine);
        lines.push('');
      }

      if (e.output) {
        lines.push('**输出**');
        lines.push('```');
        lines.push(e.output);
        lines.push('```');
        lines.push('');
      }

      if (e.capturedVar) {
        lines.push(`**捕获变量**: \`\${${e.capturedVar.name}}\` = \`${e.capturedVar.value}\``);
        lines.push('');
      }

      if (e.content) {
        lines.push(e.content);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    });

    const md   = lines.join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `会话日志-${sessionName}-${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    messageApi.success('日志已导出');
  };

  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  // 统计各类型数量
  const typeCounts = entries.reduce(
    (acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {ctx}

      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        background: isDark ? '#252526' : '#fafafa',
        border: `1px solid ${borderColor}`, borderRadius: 6,
        flexShrink: 0,
      }}>
        <Space size={8} wrap>
          <Text strong style={{ fontSize: 13 }}>{sessionName}</Text>
          <Badge
            count={entries.length}
            color="#3b82f6"
            size="small"
            overflowCount={999}
          />
          {/* 类型统计小标签 */}
          {Object.entries(typeCounts).map(([type, count]) => (
            <Tag
              key={type}
              color={TYPE_CONFIG[type as JournalEntryType]?.color ?? 'default'}
              style={{ fontSize: 10, cursor: 'pointer' }}
              onClick={() => setFilterType(type === filterType ? 'all' : type as JournalEntryType)}
            >
              {TYPE_CONFIG[type as JournalEntryType]?.label ?? type} {count}
            </Tag>
          ))}
        </Space>

        <Space size={4}>
          <Tooltip title="记录终端快照（当前屏幕内容）">
            <Button size="small" icon={<CameraOutlined />} onClick={handleSnapshot} />
          </Tooltip>
          <Tooltip title="添加文字备注">
            <Button size="small" icon={<PlusOutlined />} onClick={() => setNoteModalOpen(true)} />
          </Tooltip>
          <Tooltip title="导出为 Markdown">
            <Button size="small" icon={<DownloadOutlined />} onClick={handleExport} disabled={entries.length === 0} />
          </Tooltip>
          <Popconfirm
            title="清空此会话的全部日志？"
            okText="清空" cancelText="取消" okButtonProps={{ danger: true }}
            onConfirm={() => { clearSession(sessionId); messageApi.success('日志已清空'); }}
          >
            <Tooltip title="清空日志">
              <Button size="small" icon={<ClearOutlined />} danger disabled={entries.length === 0} />
            </Tooltip>
          </Popconfirm>
        </Space>
      </div>

      {/* 筛选器 */}
      {entries.length > 0 && (
        <Select
          size="small"
          value={filterType}
          onChange={(v) => setFilterType(v)}
          style={{ width: '100%', flexShrink: 0 }}
          options={[
            { label: `全部 (${entries.length})`, value: 'all' },
            ...Object.entries(TYPE_CONFIG).map(([k, v]) => ({
              label: `${v.label} (${typeCounts[k] ?? 0})`,
              value: k,
            })),
          ]}
        />
      )}

      {/* 日志列表 */}
      <div
        style={{
          flex: 1, overflowY: 'auto',
          padding: '4px 2px',
        }}
      >
        {filtered.length === 0 ? (
          <Empty
            description={
              entries.length === 0
                ? '暂无记录\n执行 SOP 或在终端输入命令后自动记录'
                : '当前筛选条件无结果'
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ paddingTop: 40 }}
          />
        ) : (
          [...filtered].reverse().map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              isDark={isDark}
              onDelete={() => deleteEntry(sessionId, entry.id)}
            />
          ))
        )}
      </div>

      {/* 添加备注弹窗 */}
      <Modal
        title="添加备注"
        open={noteModalOpen}
        onOk={handleAddNote}
        onCancel={() => { setNoteModalOpen(false); setNoteText(''); }}
        okText="添加" cancelText="取消"
        okButtonProps={{ disabled: !noteText.trim() }}
      >
        <TextArea
          rows={5}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="记录分析思路、异常现象、临时结论等..."
          autoFocus
          style={{ marginTop: 12, resize: 'vertical' }}
        />
      </Modal>
    </div>
  );
};

export default SessionJournal;
