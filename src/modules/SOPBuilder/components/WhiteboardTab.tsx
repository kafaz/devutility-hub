import { CopyOutlined, SaveOutlined } from '@ant-design/icons';
import { Button, message, Spin, Tooltip } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from 'tldraw';
import { AssetRecordType, createShapeId, Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';
import { useSOPStore } from '../store/sopStore';

const MIN_HEIGHT = 320;
const MAX_HEIGHT = 1600;
const DEFAULT_HEIGHT = 680;
const HANDLE_HEIGHT = 8;

interface WhiteboardTabProps {
  instanceId: string;
  /** When parent Tab becomes hidden, trigger silent auto-save (14-A) */
  isVisible?: boolean;
}

const WhiteboardTab: React.FC<WhiteboardTabProps> = ({ instanceId, isVisible = true }) => {
  const { instances, updateWhiteboard } = useSOPStore();
  const instance = instances.find(i => i.id === instanceId);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  // Persistent height
  const storageKey = `whiteboard-height-${instanceId}`;
  const [containerHeight, setContainerHeight] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed >= MIN_HEIGHT && parsed <= MAX_HEIGHT) return parsed;
      }
    } catch { /* ignore */ }
    return DEFAULT_HEIGHT;
  });

  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(Math.round(containerHeight))); } catch { /* ignore */ }
  }, [containerHeight, storageKey]);

  // Drag-to-resize handlers
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientY - dragRef.current.startY;
      setContainerHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startH + delta)));
    };
    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: containerHeight };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    (e.target as Element).setPointerCapture(e.pointerId);
  }, [containerHeight]);

  // Initialize with snapshot if it exists
  const initialSnapshot = instance?.whiteboardSnapshot
    ? JSON.parse(instance.whiteboardSnapshot)
    : undefined;

  const handleMount = useCallback((editorInst: Editor) => {
    editorRef.current = editorInst;
    if (initialSnapshot) {
      try {
        (editorInst.store as unknown as { loadSnapshot: (s: unknown) => void }).loadSnapshot(initialSnapshot);
      } catch (e) {
        console.error('Failed to load tldraw snapshot:', e);
      }
    }
  }, [initialSnapshot]);

  /** Core save logic — returns true on success, can run silently */
  const doSave = async (silent = false): Promise<boolean> => {
    const ed = editorRef.current;
    if (!ed || !instanceId) return false;
    try {
      const snapshot = (ed.store as unknown as { getSnapshot: () => unknown }).getSnapshot();
      const snapshotJson = JSON.stringify(snapshot);
      const shapeIds = Array.from(ed.getCurrentPageShapeIds().values());

      if (shapeIds.length === 0) {
        updateWhiteboard(instanceId, snapshotJson, '');
        if (!silent) message.success('已清空并保存');
        return true;
      }

      const result = await ed.getSvgString(shapeIds, { background: true, padding: 32 });
      if (result?.svg) {
        const base64data = `data:image/svg+xml;base64,${btoa(
          encodeURIComponent(result.svg).replace(/%([0-9A-F]{2})/g, (_, p1) =>
            String.fromCharCode(Number('0x' + p1))
          )
        )}`;
        updateWhiteboard(instanceId, snapshotJson, base64data);
        if (!silent) message.success('白板数据与截图已持久化暂存');
        return true;
      }
    } catch (e) {
      console.error(e);
      if (!silent) message.error('保存白板快照失败');
    }
    return false;
  };

  const handleSave = async () => {
    setIsSaving(true);
    await doSave(false);
    setIsSaving(false);
  };

  // 14-A: Auto-save when tab becomes invisible
  const prevVisibleRef = useRef(isVisible);
  useEffect(() => {
    if (prevVisibleRef.current && !isVisible && editorRef.current) {
      doSave(true); // silent auto-save
    }
    prevVisibleRef.current = isVisible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  // 14-I: Copy PNG to clipboard
  const handleCopyPng = async () => {
    const ed = editorRef.current;
    if (!ed) return;
    setIsCopying(true);
    try {
      const shapeIds = Array.from(ed.getCurrentPageShapeIds().values());
      if (shapeIds.length === 0) { message.warning('白板为空，无法复制'); setIsCopying(false); return; }
      const result = await ed.toImage(shapeIds, { format: 'png', background: true, padding: 32 });
      if (result?.blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': result.blob })
        ]);
        message.success('PNG 已复制到剪贴板，可直接粘贴进飞书/钉钉');
      }
    } catch (e) {
      console.error(e);
      message.error('复制失败（浏览器可能不支持 ClipboardItem）');
    }
    setIsCopying(false);
  };

  // Clipboard image paste handler
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const ed = editorRef.current;
    if (!ed) return;

    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return; // let tldraw handle non-image pastes

    e.preventDefault();
    e.stopPropagation();

    const blob = imageItem.getAsFile();
    if (!blob) return;

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Get image dimensions
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 400, h: 300 });
        img.src = dataUrl;
      });

      // Limit max dimension to 800px while keeping aspect ratio
      const maxDim = 800;
      let w = dims.w;
      let h = dims.h;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const assetId = AssetRecordType.createId();
      const shapeId = createShapeId();

      ed.createAssets([{
        id: assetId,
        typeName: 'asset',
        type: 'image',
        props: {
          name: `pasted-${Date.now()}.png`,
          src: dataUrl,
          w: dims.w,
          h: dims.h,
          mimeType: blob.type || 'image/png',
          isAnimated: false,
        },
        meta: {},
      }]);

      const viewportCenter = ed.getViewportScreenCenter();
      const pagePoint = ed.screenToPage(viewportCenter);

      ed.createShape({
        id: shapeId,
        type: 'image',
        x: pagePoint.x - w / 2,
        y: pagePoint.y - h / 2,
        props: {
          assetId,
          w,
          h,
        },
      });

      ed.select(shapeId);
      message.success('图片已粘贴到白板');
    } catch (err) {
      console.error('Paste image failed:', err);
      message.error('粘贴图片失败');
    }
  }, []);

  if (!instance) return <Spin />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }} onPaste={handlePaste}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          拖拽底部边缘调整高度 · Ctrl+V 粘贴图片
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Tooltip title="复制为 PNG，可直接粘贴进 IM 工具">
            <Button
              icon={<CopyOutlined />}
              loading={isCopying}
              onClick={handleCopyPng}
              size="small"
            >
              复制图片
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={isSaving}
            onClick={handleSave}
            size="small"
          >
            保存快照 (用于报告导出)
          </Button>
        </div>
      </div>
      <div style={{ height: containerHeight, position: 'relative' }}>
        <Tldraw
          onMount={handleMount}
          persistenceKey={`tldraw-sop-${instanceId}`}
        />
      </div>
      {/* Drag handle */}
      <div
        onPointerDown={handleDragStart}
        title="向下拖拽扩展白板高度"
        style={{
          height: HANDLE_HEIGHT,
          background: '#d1d5db',
          borderRadius: '0 0 6px 6px',
          cursor: 'ns-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          userSelect: 'none',
          touchAction: 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 48, height: 2, background: '#9ca3af', borderRadius: 1 }} />
      </div>
    </div>
  );
};

export default WhiteboardTab;

