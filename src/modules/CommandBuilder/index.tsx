import React, { useState, useMemo } from 'react';
import {
  Typography,
  Button,
  Select,
  Form,
  Input,
  InputNumber,
  Space,
  Card,
  Tag,
  Tooltip,
  Popconfirm,
  message,
  Empty,
  Divider,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ReloadOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useCommandStore } from './store/commandStore';
import TemplateModal from './components/TemplateModal';
import type { CommandTemplate, VariableConfig } from '../../types';
import { renderTemplate, downloadJSON } from '../../utils';
import { useClipboard } from '../../hooks/useClipboard';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text, Paragraph } = Typography;

const CATEGORY_COLORS: Record<string, string> = {
  网络连接: 'blue',
  文件操作: 'green',
  日志分析: 'orange',
  Docker: 'cyan',
  进程管理: 'purple',
  其他: 'default',
};

const CommandBuilder: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const {
    templates,
    selectedTemplateId,
    variableValues,
    selectTemplate,
    setVariableValue,
    resetVariableValues,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    importTemplates,
  } = useCommandStore();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<CommandTemplate | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const { copied, copy } = useClipboard();
  const [messageApi, contextHolder] = message.useMessage();

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const generatedCommand = useMemo(() => {
    if (!selectedTemplate) return '';
    return renderTemplate(selectedTemplate.template, variableValues);
  }, [selectedTemplate, variableValues]);

  const categories = useMemo(() => {
    const cats = [...new Set(templates.map((t) => t.category))];
    return cats;
  }, [templates]);

  const filteredTemplates =
    categoryFilter === 'all'
      ? templates
      : templates.filter((t) => t.category === categoryFilter);

  const handleCopy = async () => {
    const ok = await copy(generatedCommand);
    if (ok) {
      messageApi.success('命令已复制到剪贴板');
    } else {
      messageApi.error('复制失败，请手动复制');
    }
  };

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (tpl: CommandTemplate) => {
    setEditingTemplate(tpl);
    setModalOpen(true);
  };

  const handleModalOk = (
    data: Omit<CommandTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (editingTemplate) {
      updateTemplate(editingTemplate.id, data);
      messageApi.success('模板已更新');
    } else {
      addTemplate(data);
      messageApi.success('模板已创建');
    }
    setModalOpen(false);
  };

  const handleDeleteTemplate = (id: string) => {
    deleteTemplate(id);
    messageApi.success('模板已删除');
  };

  const handleExport = () => {
    downloadJSON(templates, 'command-templates.json');
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (Array.isArray(data)) {
            importTemplates(data);
            messageApi.success(`已导入 ${data.length} 个模板`);
          } else {
            messageApi.error('JSON 格式不正确');
          }
        } catch {
          messageApi.error('文件解析失败');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';
  const codeBg = isDark ? '#1e1e1e' : '#f4f4f5';

  return (
    <div style={{ padding: 24, minHeight: '100vh' }}>
      {contextHolder}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            命令生成器
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            基于模板快速构建 Linux / Shell 命令
          </Text>
        </div>
        <Space>
          <Button icon={<UploadOutlined />} onClick={handleImport} size="small">
            导入
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport} size="small">
            导出
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleOpenCreate}
          >
            新建模板
          </Button>
        </Space>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* 左侧：模板列表 */}
        <div>
          <Card
            size="small"
            style={{
              background: cardBg,
              border: `1px solid ${borderColor}`,
            }}
            title={
              <Space>
                <Text strong>模板库</Text>
                <Badge count={templates.length} color="#3b82f6" />
              </Space>
            }
            extra={
              <Select
                size="small"
                value={categoryFilter}
                onChange={setCategoryFilter}
                style={{ width: 110 }}
                options={[
                  { label: '全部分类', value: 'all' },
                  ...categories.map((c) => ({ label: c, value: c })),
                ]}
              />
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredTemplates.length === 0 && (
                <Empty
                  description="暂无模板"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
              {filteredTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => selectTemplate(tpl.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: `1px solid ${
                      selectedTemplateId === tpl.id
                        ? '#3b82f6'
                        : borderColor
                    }`,
                    background:
                      selectedTemplateId === tpl.id
                        ? isDark
                          ? '#1e3a5f'
                          : '#eff6ff'
                        : isDark
                        ? '#2d2d30'
                        : '#fafafa',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <Text
                      strong
                      style={{
                        fontSize: 13,
                        flex: 1,
                        color:
                          selectedTemplateId === tpl.id ? '#3b82f6' : undefined,
                      }}
                    >
                      {tpl.name}
                    </Text>
                    <Space size={4} onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="编辑">
                        <EditOutlined
                          style={{
                            fontSize: 13,
                            color: '#a1a1aa',
                            cursor: 'pointer',
                          }}
                          onClick={() => handleOpenEdit(tpl)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="确认删除此模板？"
                        onConfirm={() => handleDeleteTemplate(tpl.id)}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <DeleteOutlined
                          style={{
                            fontSize: 13,
                            color: '#ef4444',
                            cursor: 'pointer',
                          }}
                        />
                      </Popconfirm>
                    </Space>
                  </div>
                  <div
                    style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}
                  >
                    <Tag
                      color={CATEGORY_COLORS[tpl.category] ?? 'default'}
                      style={{ fontSize: 11, lineHeight: '16px', padding: '0 6px' }}
                    >
                      {tpl.category}
                    </Tag>
                    {tpl.description && (
                      <Text
                        type="secondary"
                        style={{ fontSize: 11 }}
                        ellipsis={{ tooltip: tpl.description }}
                      >
                        {tpl.description}
                      </Text>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* 右侧：变量表单 + 命令预览 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!selectedTemplate ? (
            <Card
              style={{
                background: cardBg,
                border: `1px solid ${borderColor}`,
                minHeight: 300,
              }}
            >
              <Empty
                description="请从左侧选择一个命令模板"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </Card>
          ) : (
            <>
              {/* 变量表单 */}
              <Card
                size="small"
                title={
                  <Space>
                    <Text strong>{selectedTemplate.name}</Text>
                    <Tag
                      color={
                        CATEGORY_COLORS[selectedTemplate.category] ?? 'default'
                      }
                    >
                      {selectedTemplate.category}
                    </Tag>
                  </Space>
                }
                extra={
                  <Tooltip title="重置所有变量为默认值">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={resetVariableValues}
                    >
                      重置
                    </Button>
                  </Tooltip>
                }
                style={{ background: cardBg, border: `1px solid ${borderColor}` }}
              >
                {selectedTemplate.description && (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
                    {selectedTemplate.description}
                  </Text>
                )}
                <VariableForm
                  variables={selectedTemplate.variables}
                  values={variableValues}
                  onChange={setVariableValue}
                  isDark={isDark}
                />
              </Card>

              {/* 命令预览 */}
              <Card
                size="small"
                title={<Text strong>生成命令</Text>}
                extra={
                  <Button
                    type="primary"
                    icon={<CopyOutlined />}
                    onClick={handleCopy}
                  >
                    {copied ? '已复制' : '复制命令'}
                  </Button>
                }
                style={{ background: cardBg, border: `1px solid ${borderColor}` }}
              >
                <div
                  style={{
                    background: codeBg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: 6,
                    padding: '12px 16px',
                    fontFamily:
                      'JetBrains Mono, Fira Code, Consolas, monospace',
                    fontSize: 13,
                    lineHeight: 1.6,
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                    color: isDark ? '#e4e4e7' : '#18181b',
                    minHeight: 60,
                  }}
                >
                  {generatedCommand || (
                    <Text type="secondary" style={{ fontFamily: 'inherit' }}>
                      填写上方变量后，命令将在此处实时显示
                    </Text>
                  )}
                </div>

                <Divider style={{ margin: '12px 0' }} />

                {/* 原始模板展示 */}
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    原始模板：
                  </Text>
                  <Paragraph
                    copyable={{ text: selectedTemplate.template }}
                    style={{
                      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                      fontSize: 12,
                      color: isDark ? '#a1a1aa' : '#71717a',
                      margin: '4px 0 0',
                    }}
                  >
                    {selectedTemplate.template}
                  </Paragraph>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <TemplateModal
        open={modalOpen}
        initial={editingTemplate}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
      />
    </div>
  );
};

// 变量表单组件
interface VariableFormProps {
  variables: VariableConfig[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  isDark: boolean;
}

const VariableForm: React.FC<VariableFormProps> = ({
  variables,
  values,
  onChange,
  isDark: _isDark,
}) => {
  if (variables.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 13 }}>
        此模板无变量参数
      </Text>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: '8px 16px',
      }}
    >
      {variables.map((v) => (
        <Form.Item
          key={v.name}
          label={
            <Space size={4}>
              <Text style={{ fontSize: 13 }}>{v.label || v.name}</Text>
              {v.required && <Text type="danger">*</Text>}
            </Space>
          }
          style={{ marginBottom: 0 }}
        >
          {v.type === 'number' ? (
            <InputNumber
              value={values[v.name] !== undefined ? Number(values[v.name]) : undefined}
              onChange={(val) => onChange(v.name, String(val ?? ''))}
              placeholder={v.placeholder}
              style={{ width: '100%' }}
              min={v.validation?.min}
              max={v.validation?.max}
            />
          ) : v.type === 'select' ? (
            <Select
              value={values[v.name]}
              onChange={(val) => onChange(v.name, val)}
              placeholder={v.placeholder || `选择 ${v.label || v.name}`}
              options={v.options?.map((o) => ({ label: o, value: o }))}
              style={{ width: '100%' }}
            />
          ) : (
            <Input
              value={values[v.name] || ''}
              onChange={(e) => onChange(v.name, e.target.value)}
              placeholder={v.placeholder || `输入 ${v.label || v.name}`}
            />
          )}
        </Form.Item>
      ))}
    </div>
  );
};

export default CommandBuilder;
