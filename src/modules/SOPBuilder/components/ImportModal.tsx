import React, { useState, useCallback } from 'react';
import {
  Modal,
  Tabs,
  Input,
  Button,
  Typography,
  Space,
  Tag,
  Alert,
  Table,
  Upload,
  Divider,
} from 'antd';
import {
  UploadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { parseSOPTemplatesFromMarkdown } from '../../../utils';
import type { SOPTemplate } from '../../../types';
import { useGlobalStore } from '../../../store/globalStore';

const { TextArea } = Input;
const { Text } = Typography;

interface ParsedPreview {
  name: string;
  category: string;
  checksCount: number;
  hasHints: boolean;
}

interface Props {
  open: boolean;
  onOk: (md: string) => void;
  onOkJSON: (templates: SOPTemplate[]) => void;
  onCancel: () => void;
}

const ImportModal: React.FC<Props> = ({ open, onOk, onOkJSON, onCancel }) => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const [mdText, setMdText] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [mdPreviews, setMdPreviews] = useState<ParsedPreview[]>([]);
  const [jsonPreviews, setJsonPreviews] = useState<ParsedPreview[]>([]);
  const [mdError, setMdError] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [activeTab, setActiveTab] = useState<'markdown' | 'json'>('markdown');

  const codeBg = isDark ? '#1e1e1e' : '#f4f4f5';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const handleMdChange = useCallback((val: string) => {
    setMdText(val);
    setMdError('');
    if (!val.trim()) { setMdPreviews([]); return; }
    try {
      const parsed = parseSOPTemplatesFromMarkdown(val);
      if (parsed.length === 0) {
        setMdError('未能识别出有效模板，请确认格式以 `# SOP: 模板名称` 开头');
      }
      setMdPreviews(
        parsed.map((t) => ({
          name: t.name,
          category: t.category,
          checksCount: t.checks.length,
          hasHints: !!t.diagnosisHints,
        }))
      );
    } catch (e) {
      setMdError(String(e));
      setMdPreviews([]);
    }
  }, []);

  const handleJsonChange = useCallback((val: string) => {
    setJsonText(val);
    setJsonError('');
    if (!val.trim()) { setJsonPreviews([]); return; }
    try {
      const data = JSON.parse(val);
      const arr: SOPTemplate[] = Array.isArray(data) ? data : [data];
      setJsonPreviews(
        arr.map((t) => ({
          name: t.name || '（无名称）',
          category: t.category || '其他',
          checksCount: (t.checks || []).length,
          hasHints: !!t.diagnosisHints,
        }))
      );
    } catch {
      setJsonError('JSON 解析失败，请检查格式');
      setJsonPreviews([]);
    }
  }, []);

  const handleFileUpload = (file: File, type: 'md' | 'json') => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (type === 'md') handleMdChange(text);
      else handleJsonChange(text);
    };
    reader.readAsText(file);
    return false;
  };

  const handleOk = () => {
    if (activeTab === 'markdown') {
      if (mdPreviews.length === 0) return;
      onOk(mdText);
    } else {
      if (jsonPreviews.length === 0) return;
      try {
        const data = JSON.parse(jsonText);
        const arr: SOPTemplate[] = Array.isArray(data) ? data : [data];
        onOkJSON(arr);
      } catch {
        setJsonError('JSON 解析失败');
      }
    }
    resetState();
  };

  const resetState = () => {
    setMdText('');
    setJsonText('');
    setMdPreviews([]);
    setJsonPreviews([]);
    setMdError('');
    setJsonError('');
  };

  const handleCancel = () => {
    resetState();
    onCancel();
  };

  const previewColumns = [
    { title: '模板名称', dataIndex: 'name', render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '步骤数',
      dataIndex: 'checksCount',
      width: 70,
      render: (v: number) => <Tag>{v} 步</Tag>,
    },
    {
      title: '根因提示',
      dataIndex: 'hasHints',
      width: 80,
      render: (v: boolean) =>
        v ? (
          <CheckCircleOutlined style={{ color: '#22c55e' }} />
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  const currentPreviews = activeTab === 'markdown' ? mdPreviews : jsonPreviews;
  const canSubmit = currentPreviews.length > 0;

  // Markdown 格式说明示例
  const mdExample = `# SOP: 服务不可用排查

**分类**: 服务异常
**描述**: 适用于服务突发不可用场景

## 常见根因提示

- 进程 OOM 被 kill
- 依赖服务连接耗尽

## 排查步骤

### 步骤 1: 检查进程状态

> 确认服务进程是否存在

\`\`\`bash
ps aux | grep \${service_name}
\`\`\`

- ✅ **正常**: 能看到进程 PID
- ❌ **异常**: 无输出 = 进程不存在

---

### 步骤 2: 检查端口监听

\`\`\`bash
ss -tlnp | grep \${port}
\`\`\`

- ✅ **正常**: 能看到 LISTEN 状态
- ❌ **异常**: 无输出说明端口未监听`;

  return (
    <Modal
      title="导入 SOP 模板"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={`导入 ${currentPreviews.length > 0 ? `(${currentPreviews.length} 个)` : ''}`}
      cancelText="取消"
      okButtonProps={{ disabled: !canSubmit }}
      width={760}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'markdown' | 'json')}
        size="small"
        items={[
          {
            key: 'markdown',
            label: 'Markdown 格式',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    粘贴 Markdown 文本，或上传 <code>.md</code> 文件
                  </Text>
                  <Upload
                    accept=".md,.txt"
                    showUploadList={false}
                    beforeUpload={(f) => handleFileUpload(f, 'md')}
                  >
                    <Button size="small" icon={<UploadOutlined />}>
                      上传文件
                    </Button>
                  </Upload>
                </Space>

                <TextArea
                  rows={10}
                  value={mdText}
                  onChange={(e) => handleMdChange(e.target.value)}
                  placeholder="粘贴 Markdown 格式的 SOP 模板..."
                  style={{
                    fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                    fontSize: 12,
                    background: codeBg,
                    resize: 'vertical',
                  }}
                />

                {mdError && (
                  <Alert
                    message={mdError}
                    type="error"
                    showIcon
                    icon={<ExclamationCircleOutlined />}
                  />
                )}

                {mdPreviews.length > 0 && (
                  <>
                    <Text strong style={{ fontSize: 13 }}>
                      解析预览（识别到 {mdPreviews.length} 个模板）
                    </Text>
                    <Table
                      dataSource={mdPreviews}
                      columns={previewColumns}
                      rowKey="name"
                      size="small"
                      pagination={false}
                    />
                  </>
                )}

                {/* Markdown 格式说明 */}
                <Divider style={{ margin: '8px 0 4px' }} />
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#a1a1aa' }}>
                    查看 Markdown 格式规范示例
                  </summary>
                  <pre
                    style={{
                      marginTop: 8,
                      padding: '10px 12px',
                      background: isDark ? '#1e1e1e' : '#f4f4f5',
                      border: `1px solid ${borderColor}`,
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 240,
                      overflowY: 'auto',
                    }}
                  >
                    {mdExample}
                  </pre>
                </details>
              </div>
            ),
          },
          {
            key: 'json',
            label: 'JSON 格式',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    粘贴 JSON 数据，或上传 <code>.json</code> 文件（由本工具导出的格式）
                  </Text>
                  <Upload
                    accept=".json"
                    showUploadList={false}
                    beforeUpload={(f) => handleFileUpload(f, 'json')}
                  >
                    <Button size="small" icon={<UploadOutlined />}>
                      上传文件
                    </Button>
                  </Upload>
                </Space>

                <TextArea
                  rows={10}
                  value={jsonText}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  placeholder="粘贴 JSON 格式的模板数据..."
                  style={{
                    fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                    fontSize: 12,
                    background: codeBg,
                    resize: 'vertical',
                  }}
                />

                {jsonError && (
                  <Alert message={jsonError} type="error" showIcon />
                )}

                {jsonPreviews.length > 0 && (
                  <>
                    <Text strong style={{ fontSize: 13 }}>
                      解析预览（识别到 {jsonPreviews.length} 个模板）
                    </Text>
                    <Table
                      dataSource={jsonPreviews}
                      columns={previewColumns}
                      rowKey="name"
                      size="small"
                      pagination={false}
                    />
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};

export default ImportModal;
