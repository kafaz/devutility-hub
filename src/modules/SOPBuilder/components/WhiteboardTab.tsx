import { CopyOutlined, SaveOutlined } from '@ant-design/icons';
import { Button, message, Spin, Tooltip } from 'antd';
import type { Editor } from 'tldraw';
import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSOPStore } from '../store/sopStore';

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

  if (!instance) return <Spin />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 16px', borderBottom: '1px solid #e5e7eb' }}>
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
      <div style={{ flex: 1, position: 'relative' }}>
        <Tldraw
          onMount={handleMount}
          persistenceKey={`tldraw-sop-${instanceId}`}
        />
      </div>
    </div>
  );
};

export default WhiteboardTab;
