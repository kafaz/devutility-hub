/**
 * ResizableOutput — 可拖拽调整高度的只读输出区域
 *
 * 底部有 6px 的拖拽柄（ns-resize 光标），向下拖动展开更多行，
 * 向上拖动收缩。使用 pointer events 兼容触控设备。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Tooltip } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useClipboard } from '../../hooks/useClipboard';

interface ResizableOutputProps {
  content:     string;
  minHeight?:  number;   // 最小高度（px）
  maxHeight?:  number;   // 最大高度（px）
  isDark?:     boolean;
  showCopy?:   boolean;
  style?:      React.CSSProperties;
  /** 高亮规则：匹配行的背景色 */
  highlights?: Array<{ pattern: string; color: string; label: string }>;
}

const ResizableOutput: React.FC<ResizableOutputProps> = ({
  content,
  minHeight = 80,
  maxHeight = 800,
  isDark    = true,
  showCopy  = true,
  style,
  highlights = [],
}) => {
  const [height, setHeight]     = useState(minHeight);
  const dragRef                 = useRef<{ startY: number; startH: number } | null>(null);
  const containerRef            = useRef<HTMLDivElement>(null);
  const { copy, copied }        = useClipboard();

  // ── 拖拽逻辑（全局 pointermove / pointerup，防止快速移动时脱离元素）
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [height]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const delta  = e.clientY - dragRef.current.startY;
    const newH   = Math.min(maxHeight, Math.max(minHeight, dragRef.current.startH + delta));
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

  // ── 行级高亮渲染
  const renderContent = () => {
    if (highlights.length === 0) return content;

    const compiledRules = highlights
      .map((h) => {
        try   { return { re: new RegExp(h.pattern), color: h.color, label: h.label }; }
        catch { return null; }
      })
      .filter(Boolean) as Array<{ re: RegExp; color: string; label: string }>;

    if (compiledRules.length === 0) return content;

    return content
      .split('\n')
      .map((line, i) => {
        const match = compiledRules.find((r) => r.re.test(line));
        return (
          <span
            key={i}
            style={{
              display: 'block',
              background: match ? match.color : 'transparent',
              borderLeft: match ? `3px solid ${match.color}` : '3px solid transparent',
              paddingLeft: 4,
            }}
          >
            {line || '\u200b'}
          </span>
        );
      });
  };

  const bg     = isDark ? '#1e1e1e' : '#f4f4f5';
  const handle = isDark ? '#3e3e42' : '#d1d5db';
  const pip    = isDark ? '#6b7280' : '#9ca3af';

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      {/* 主内容区 */}
      <pre
        style={{
          height,
          overflowY:   'auto',
          overflowX:   'auto',
          margin:       0,
          padding:     '6px 36px 6px 10px',
          background:   bg,
          borderRadius: '4px 4px 0 0',
          fontSize:     11,
          fontFamily:  'JetBrains Mono, Fira Code, Consolas, monospace',
          lineHeight:   1.6,
          whiteSpace:  'pre-wrap',
          wordBreak:   'break-all',
          color:        isDark ? '#d4d4d8' : '#18181b',
          userSelect:  'text',
        }}
      >
        {renderContent()}
      </pre>

      {/* 复制按钮 */}
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
            }}
          />
        </Tooltip>
      )}

      {/* 拖拽柄 */}
      <div
        onPointerDown={onPointerDown}
        title="拖拽调整输出区域高度"
        style={{
          height:       6,
          background:   handle,
          borderRadius: '0 0 4px 4px',
          cursor:      'ns-resize',
          display:     'flex',
          alignItems:  'center',
          justifyContent: 'center',
          userSelect:  'none',
          touchAction: 'none',
        }}
      >
        {/* 中央凸点提示 */}
        <div style={{ width: 40, height: 2, background: pip, borderRadius: 1 }} />
      </div>
    </div>
  );
};

export default ResizableOutput;
