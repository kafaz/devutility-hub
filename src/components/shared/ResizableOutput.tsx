/**
 * ResizableOutput — 可拖拽调整高度的输出区域
 *
 * 两种模式：
 *   只读模式（默认）：<pre> 展示内容，支持行高亮
 *   可编辑模式（传入 onChange）：<textarea> 允许粘贴/编辑，外观与只读一致
 *
 * 底部拖拽柄（ns-resize）向下拖动展开更多行，向上收缩。
 * 使用 PointerEvent（含 setPointerCapture）确保快速移动不丢失焦点。
 */
import { CopyOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useClipboard } from '../../hooks/useClipboard';
import { highlightDBSText } from '../../utils/dbsHighlighter';

interface CompiledHighlightRule {
  color: string;
  re: RegExp;
}

interface ThreadLogLine {
  func: string;
  raw: string;
  threadAddr: string;
  threadId: string;
}

interface ThreadLogPlainBlock {
  key: string;
  kind: 'plain';
  lines: string[];
}

interface ThreadLogGroupBlock {
  key: string;
  kind: 'thread-group';
  lines: ThreadLogLine[];
  threadAddr: string;
  threadId: string;
}

type ThreadLogBlock = ThreadLogPlainBlock | ThreadLogGroupBlock;

interface ThreadGroupedOutputProps {
  blocks: ThreadLogBlock[];
  foldableBlocks: ThreadLogGroupBlock[];
  isDark: boolean;
  renderOutputLine: (line: string, key: string) => React.ReactNode;
}

interface ResizableOutputProps {
  content:      string;
  minHeight?:   number;
  maxHeight?:   number;
  isDark?:      boolean;
  showCopy?:    boolean;
  style?:       React.CSSProperties;
  /** 只读模式：逐行正则高亮 */
  highlights?:  Array<{ pattern: string; color: string; label: string }>;
  /** 可编辑模式：提供此回调则切换为 textarea */
  onChange?:    (value: string) => void;
  placeholder?: string;
  onTextSelect?: (text: string) => void;
  threadFolding?: 'off' | 'auto';
}

const THREAD_LOG_LINE_RE = /^\s*\*?\[([^\]]+)\]\[([^\]]+)\]\[([^\]]+)\](.*)$/;

function compileHighlightRules(highlights: ResizableOutputProps['highlights']): CompiledHighlightRule[] {
  return (highlights || [])
    .map((highlight) => {
      try {
        return { re: new RegExp(highlight.pattern), color: highlight.color };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CompiledHighlightRule[];
}

function getLineHighlightColor(line: string, rules: CompiledHighlightRule[]): string | null {
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    if (rule.re.test(line)) {
      return rule.color;
    }
  }
  return null;
}

function parseThreadLogLine(line: string): ThreadLogLine | null {
  const match = line.match(THREAD_LOG_LINE_RE);
  if (!match) return null;
  return {
    threadId: match[1],
    threadAddr: match[2],
    func: match[3],
    raw: line,
  };
}

function buildThreadLogBlocks(content: string): ThreadLogBlock[] {
  const rawLines = content.split('\n');
  const blocks: ThreadLogBlock[] = [];
  let plainLines: string[] = [];
  let threadLines: ThreadLogLine[] = [];

  const flushPlain = () => {
    if (plainLines.length === 0) return;
    blocks.push({
      key: `plain-${blocks.length}`,
      kind: 'plain',
      lines: plainLines,
    });
    plainLines = [];
  };

  const flushThreadGroup = () => {
    if (threadLines.length === 0) return;
    if (threadLines.length === 1) {
      plainLines.push(threadLines[0].raw);
      threadLines = [];
      return;
    }
    blocks.push({
      key: `thread-${blocks.length}-${threadLines[0].threadId}`,
      kind: 'thread-group',
      threadId: threadLines[0].threadId,
      threadAddr: threadLines[0].threadAddr,
      lines: threadLines,
    });
    threadLines = [];
  };

  rawLines.forEach((line) => {
    const parsed = parseThreadLogLine(line);
    if (!parsed) {
      flushThreadGroup();
      plainLines.push(line);
      return;
    }

    if (threadLines.length === 0) {
      flushPlain();
      threadLines = [parsed];
      return;
    }

    if (threadLines[0].threadId === parsed.threadId) {
      threadLines.push(parsed);
      return;
    }

    flushThreadGroup();
    flushPlain();
    threadLines = [parsed];
  });

  flushThreadGroup();
  flushPlain();

  return blocks;
}

function buildContentSignature(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
  }
  return `${content.length}:${hash >>> 0}`;
}

const ThreadGroupedOutput: React.FC<ThreadGroupedOutputProps> = ({ blocks, foldableBlocks, isDark, renderOutputLine }) => {
  const [threadFoldingEnabled, setThreadFoldingEnabled] = useState(foldableBlocks.length > 0);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(foldableBlocks.map((block) => [block.key, true])),
  );

  if (foldableBlocks.length === 0) {
    return (
      <>
        {blocks.flatMap((block) => (
          block.kind === 'plain'
            ? block.lines.map((line, index) => renderOutputLine(line, `${block.key}-${index}`))
            : block.lines.map((line, index) => renderOutputLine(line.raw, `${block.key}-${index}`))
        ))}
      </>
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: `1px solid ${isDark ? '#3e3e42' : '#d4d4d8'}`,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={threadFoldingEnabled}
            onChange={(event) => setThreadFoldingEnabled(event.target.checked)}
          />
          <span>按 thread_id 折叠连续日志</span>
        </label>
        <button
          type="button"
          onClick={() => setCollapsedGroups(Object.fromEntries(foldableBlocks.map((block) => [block.key, false])))}
          style={{ border: 'none', background: 'transparent', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 11 }}
        >
          全部展开
        </button>
        <button
          type="button"
          onClick={() => setCollapsedGroups(Object.fromEntries(foldableBlocks.map((block) => [block.key, true])))}
          style={{ border: 'none', background: 'transparent', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 11 }}
        >
          全部折叠
        </button>
        <span style={{ color: isDark ? '#94a3b8' : '#475569', fontSize: 11 }}>
          {foldableBlocks.length} 个线程簇
        </span>
      </div>

      {threadFoldingEnabled
        ? blocks.map((block) => {
            if (block.kind === 'plain') {
              return (
                <div key={block.key}>
                  {block.lines.map((line, index) => renderOutputLine(line, `${block.key}-${index}`))}
                </div>
              );
            }

            const collapsed = collapsedGroups[block.key] ?? true;
            const functions = Array.from(new Set(block.lines.map((line) => line.func))).slice(0, 2);
            return (
              <div
                key={block.key}
                style={{
                  marginBottom: 8,
                  border: `1px solid ${isDark ? '#3e3e42' : '#d4d4d8'}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: isDark ? '#18181b' : '#ffffff',
                }}
              >
                <button
                  type="button"
                  onClick={() => setCollapsedGroups((current) => ({ ...current, [block.key]: !collapsed }))}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    border: 'none',
                    background: isDark ? '#202024' : '#f8fafc',
                    color: isDark ? '#e4e4e7' : '#111827',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    [{block.threadId}] {block.lines.length} 行
                    {block.threadAddr ? ` · ${block.threadAddr}` : ''}
                    {functions.length > 0 ? ` · ${functions.join(' / ')}` : ''}
                  </span>
                  <span>{collapsed ? '展开' : '收起'}</span>
                </button>
                {!collapsed && (
                  <div style={{ padding: '6px 8px 8px 10px' }}>
                    {block.lines.map((line, index) => renderOutputLine(line.raw, `${block.key}-${index}`))}
                  </div>
                )}
              </div>
            );
          })
        : blocks.map((block) => (
            block.kind === 'plain'
              ? <div key={block.key}>{block.lines.map((line, index) => renderOutputLine(line, `${block.key}-${index}`))}</div>
              : <div key={block.key}>{block.lines.map((line, index) => renderOutputLine(line.raw, `${block.key}-${index}`))}</div>
          ))}
    </>
  );
};

const ResizableOutput: React.FC<ResizableOutputProps> = ({
  content,
  minHeight   = 80,
  maxHeight   = 800,
  isDark      = true,
  showCopy    = true,
  style,
  highlights  = [],
  onChange,
  placeholder = '粘贴输出结果...',
  onTextSelect,
  threadFolding = 'off',
}) => {
  const [height, setHeight] = useState(minHeight);
  const dragRef             = useRef<{ startY: number; startH: number } | null>(null);
  const containerRef        = useRef<HTMLDivElement>(null);
  const { copy, copied }    = useClipboard();
  const isEditable = typeof onChange === 'function';
  const compiledHighlightRules = React.useMemo(() => compileHighlightRules(highlights), [highlights]);
  const threadBlocks = React.useMemo(
    () => (!isEditable && threadFolding === 'auto' ? buildThreadLogBlocks(content) : []),
    [content, isEditable, threadFolding],
  );
  const contentSignature = React.useMemo(() => buildContentSignature(content), [content]);
  const foldableThreadBlocks = React.useMemo(
    () => threadBlocks.filter((block): block is ThreadLogGroupBlock => block.kind === 'thread-group'),
    [threadBlocks],
  );

  // ── 拖拽逻辑 ────────────────────────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [height]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientY - dragRef.current.startY;
    const newH  = Math.min(maxHeight, Math.max(minHeight, dragRef.current.startH + delta));
    setHeight(newH);
  }, [minHeight, maxHeight]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup',   onPointerUp);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup',   onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // ── 行级高亮（只读模式） ──────────────────────────────────────────────────

  const handleTextSelection = () => {
    if (!onTextSelect) return;
    const selection = window.getSelection();
    if (selection) {
      const text = selection.toString().trim();
      if (text && /^[A-Za-z_][A-Za-z0-9_:]*$/.test(text)) {
        onTextSelect(text);
      }
    }
  };

  const renderOutputLine = (line: string, key: string) => {
    const matchColor = getLineHighlightColor(line, compiledHighlightRules);
    return (
      <div
        key={key}
        style={{
          background: matchColor || 'transparent',
          borderLeft: matchColor ? `3px solid ${matchColor}` : '3px solid transparent',
          paddingLeft: 4,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {line ? highlightDBSText(line) : '\u200b'}
      </div>
    );
  };

  // ── 样式常量 ──────────────────────────────────────────────────────────────

  const bg     = isDark ? '#1e1e1e' : '#f4f4f5';
  const handle = isDark ? '#3e3e42' : '#d1d5db';
  const pip    = isDark ? '#6b7280' : '#9ca3af';
  const clr    = isDark ? '#d4d4d8' : '#18181b';

  const sharedStyle: React.CSSProperties = {
    height,
    overflowY:    'auto',
    overflowX:    'auto',
    margin:        0,
    padding:      '6px 36px 6px 10px',
    background:    bg,
    borderRadius: '4px 4px 0 0',
    fontSize:      11,
    fontFamily:   'JetBrains Mono, Fira Code, Consolas, monospace',
    lineHeight:    1.6,
    color:         clr,
    display:      'block',
    width:        '100%',
    boxSizing:    'border-box',
  };
  const readonlyBodyStyle: React.CSSProperties = {
    ...sharedStyle,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    userSelect: 'text',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>

      {/* ── 内容区：只读 <pre> 或 可编辑 <textarea> ── */}
      {isEditable ? (
        <textarea
          value={content}
          onChange={(e) => onChange!(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            ...sharedStyle,
            resize:    'none',       // 禁用浏览器原生 resize，统一使用底部拖拽柄
            border:    'none',
            outline:   'none',
            whiteSpace: 'pre',
            wordBreak: 'break-all',
          }}
        />
      ) : (
        <div onMouseUp={handleTextSelection} style={readonlyBodyStyle}>
          {foldableThreadBlocks.length > 0 ? (
            <ThreadGroupedOutput
              key={`${contentSignature}:${foldableThreadBlocks.map((block) => block.key).join('|')}`}
              blocks={threadBlocks}
              foldableBlocks={foldableThreadBlocks}
              isDark={isDark}
              renderOutputLine={renderOutputLine}
            />
          ) : (
            content.split('\n').map((line, index) => renderOutputLine(line, `plain-${index}`))
          )}
        </div>
      )}

      {/* ── 复制按钮 ── */}
      {showCopy && content && (
        <Tooltip title={copied ? '已复制' : '复制全部'}>
          <CopyOutlined
            onClick={() => copy(content)}
            style={{
              position:   'absolute',
              top:         8,
              right:       8,
              color:       copied ? '#22c55e' : '#6b7280',
              cursor:     'pointer',
              fontSize:    13,
              transition: 'color 0.2s',
              zIndex:      1,
            }}
          />
        </Tooltip>
      )}

      {/* ── 拖拽柄 ── */}
      <div
        onPointerDown={onPointerDown}
        title="向下拖拽查看更多日志行"
        style={{
          height:         6,
          background:     handle,
          borderRadius:  '0 0 4px 4px',
          cursor:        'ns-resize',
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'center',
          userSelect:    'none',
          touchAction:   'none',
          flexShrink:     0,
        }}
      >
        <div style={{ width: 40, height: 2, background: pip, borderRadius: 1 }} />
      </div>
    </div>
  );
};

export default ResizableOutput;
