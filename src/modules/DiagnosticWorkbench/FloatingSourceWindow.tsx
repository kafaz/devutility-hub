import { CloseOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import React, {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

const { Text } = Typography;

interface FloatingWindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragState {
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

export interface FloatingSourceWindowProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  isDark?: boolean;
  children: ReactNode;
  onClose(): void;
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

function getInitialRect(): FloatingWindowRect {
  const viewport = getViewportSize();
  const width = Math.min(940, Math.max(620, viewport.width - 96));
  const height = Math.min(720, Math.max(420, viewport.height - 128));
  return {
    left: Math.max(24, viewport.width - width - 32),
    top: 84,
    width,
    height,
  };
}

function clampRect(rect: FloatingWindowRect): FloatingWindowRect {
  const viewport = getViewportSize();
  const width = Math.min(rect.width, Math.max(520, viewport.width - 32));
  const height = Math.min(rect.height, Math.max(360, viewport.height - 32));
  const maxLeft = Math.max(16, viewport.width - width - 16);
  const maxTop = Math.max(16, viewport.height - 72);
  return {
    left: Math.min(Math.max(16, rect.left), maxLeft),
    top: Math.min(Math.max(16, rect.top), maxTop),
    width,
    height,
  };
}

export default function FloatingSourceWindow(props: FloatingSourceWindowProps) {
  const [rect, setRect] = useState(getInitialRect);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!props.open) return;

    function handleMouseMove(event: MouseEvent) {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      setRect((current) =>
        clampRect({
          ...current,
          left: dragState.startLeft + event.clientX - dragState.startX,
          top: dragState.startTop + event.clientY - dragState.startY,
        })
      );
    }

    function handleMouseUp() {
      dragStateRef.current = null;
      if (typeof document !== 'undefined') {
        document.body.style.userSelect = '';
      }
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      handleMouseUp();
    };
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;

    function handleWindowResize() {
      setRect((current) => clampRect(current));
    }

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [props.open]);

  if (!props.open) return null;

  function handleDragStart(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button,a,input,textarea,select,[data-no-drag="true"]')) return;
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    if (typeof document !== 'undefined') {
      document.body.style.userSelect = 'none';
    }
  }

  const surfaceStyle: CSSProperties = {
    position: 'fixed',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    minWidth: 520,
    minHeight: 360,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    zIndex: 1080,
    display: 'flex',
    flexDirection: 'column',
    resize: 'both',
    overflow: 'hidden',
    borderRadius: 8,
    border: `1px solid ${props.isDark ? 'rgba(71, 85, 105, 0.9)' : 'rgba(148, 163, 184, 0.45)'}`,
    background: props.isDark ? '#0f172a' : '#ffffff',
    boxShadow: props.isDark
      ? '0 24px 70px rgba(0, 0, 0, 0.55)'
      : '0 24px 70px rgba(15, 23, 42, 0.24)',
  };

  return (
    <div role="dialog" aria-label="FloatingSourceWindow" style={surfaceStyle}>
      <div
        onMouseDown={handleDragStart}
        style={{
          cursor: 'move',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          borderBottom: `1px solid ${props.isDark ? 'rgba(71, 85, 105, 0.72)' : 'rgba(226, 232, 240, 0.95)'}`,
          background: props.isDark ? '#111827' : '#f8fafc',
        }}
      >
        <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
          <Text strong>{props.title}</Text>
          {props.subtitle ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {props.subtitle}
            </Text>
          ) : null}
        </Space>
        <Space size={8} wrap data-no-drag="true" style={{ justifyContent: 'flex-end' }}>
          {props.extra}
          <Button size="small" icon={<CloseOutlined />} onClick={props.onClose} />
        </Space>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 12,
          background: props.isDark ? '#020617' : '#ffffff',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
