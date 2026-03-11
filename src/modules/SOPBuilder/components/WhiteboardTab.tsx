import { SaveOutlined } from '@ant-design/icons';
import { Button, message, Spin } from 'antd';
import React, { useCallback, useState } from 'react';
import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';
import { useSOPStore } from '../store/sopStore';

interface WhiteboardTabProps {
  instanceId: string;
}

const WhiteboardTab: React.FC<WhiteboardTabProps> = ({ instanceId }) => {
  const { instances, updateWhiteboard } = useSOPStore();
  const instance = instances.find(i => i.id === instanceId);
  const [editor, setEditor] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize with snapshot if it exists
  const initialSnapshot = instance?.whiteboardSnapshot 
    ? JSON.parse(instance.whiteboardSnapshot) 
    : undefined;

  const handleMount = useCallback((editorInst: any) => {
    setEditor(editorInst);
    if (initialSnapshot) {
      try {
        editorInst.store.loadSnapshot(initialSnapshot);
      } catch (e) {
        console.error('Failed to load tldraw snapshot:', e);
      }
    }
  }, [initialSnapshot]);

  const handleSave = async () => {
    if (!editor || !instanceId) return;
    setIsSaving(true);
    try {
      // 1. Get raw document snapshot
      const snapshot = editor.store.getSnapshot();
      const snapshotJson = JSON.stringify(snapshot);

      // 2. Generate SVG for offline markdown report
      const shapeIds = Array.from(editor.getCurrentPageShapeIds().values());
      if (shapeIds.length === 0) {
        updateWhiteboard(instanceId, snapshotJson, '');
        message.success('已清空并保存');
        setIsSaving(false);
        return;
      }

      // Export as SVG string directly from editor
      const result = await editor.getSvgString(shapeIds, {
        background: true,
        padding: 32,
      });
      
      if (result && result.svg) {
        // Base64 encode the SVG string for embedding in MD
        const base64data = `data:image/svg+xml;base64,${btoa(encodeURIComponent(result.svg).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(Number('0x' + p1))))}`;
        updateWhiteboard(instanceId, snapshotJson, base64data);
        message.success('白板数据与截图已持久化暂存');
      }
      setIsSaving(false);
    } catch (e) {
      console.error(e);
      message.error('保存白板快照失败');
      setIsSaving(false);
    }
  };

  if (!instance) return <Spin />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <Button 
          type="primary" 
          icon={<SaveOutlined />} 
          loading={isSaving} 
          onClick={handleSave}
          size="small"
        >
          保存白板快照 (用于报告导出)
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
