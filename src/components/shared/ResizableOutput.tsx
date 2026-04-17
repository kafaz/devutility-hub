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
}

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
}) => {
  const [height, setHeight] = useState(minHeight);
  const dragRef             = useRef<{ startY: number; startH: number } | null>(null);
  const containerRef        = useRef<HTMLDivElement>(null);
  const { copy, copied }    = useClipboard();

  const isEditable = typeof onChange === 'function';

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

  const renderHighlighted = () => {
    const rules = highlights
      .map((h) => {
        try   { return { re: new RegExp(h.pattern), color: h.color }; }
        catch { return null; }
      })
      .filter(Boolean) as Array<{ re: RegExp; color: string }>;

    if (rules.length === 0) return content;

    return content.split('\n').map((line, i) => {
      const match = rules.find((r) => r.re.test(line));
      return (
        <span
          key={i}
          style={{
            display:    'block',
            background: match ? match.color : 'transparent',
            borderLeft: match ? `3px solid ${match.color}` : '3px solid transparent',
            paddingLeft: 4,
          }}
        >
          {line ? highlightDBSText(line) : '\u200b'}
        </span>
      );
    });
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
        <pre
          onMouseUp={() => {
            if (!onTextSelect) return;
            const selection = window.getSelection();
            if (selection) {
              const text = selection.toString().trim();
              if (text && /^[A-Za-z_][A-Za-z0-9_:]*$/.test(text)) {
                onTextSelect(text);
              }
            }
          }}
          style={{
            ...sharedStyle,
            whiteSpace: 'pre-wrap',
            wordBreak:  'break-all',
            userSelect: 'text',
          }}
        >
          {renderHighlighted()}
        </pre>
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
