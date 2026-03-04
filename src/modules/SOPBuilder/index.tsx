import React, { useState } from 'react';
import {
  Typography,
  Button,
  Space,
  Card,
  Tag,
  Empty,
  Input,
  Modal,
  Form,
  Select,
  Tooltip,
  Popconfirm,
  message,
  Tabs,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  HistoryOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useSOPStore } from './store/sopStore';
import TemplateEditor from './components/TemplateEditor';
import InstanceRunner from './components/InstanceRunner';
import type { SOPTemplate, SOPInstance } from '../../types';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;

const CATEGORY_COLOR: Record<string, string> = {
  服务异常: 'red',
  性能劣化: 'orange',
  网络问题: 'blue',
  数据库问题: 'purple',
  部署问题: 'cyan',
  安全事件: 'magenta',
  其他: 'default',
};

const INSTANCE_STATUS_COLOR: Record<SOPInstance['status'], string> = {
  investigating: 'processing',
  resolved: 'success',
  escalated: 'error',
};

const INSTANCE_STATUS_LABEL: Record<SOPInstance['status'], string> = {
  investigating: '排查中',
  resolved: '已解决',
  escalated: '已上升',
};

const SOPBuilder: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const {
    templates,
    instances,
    activeInstanceId,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    startInstance,
    setActiveInstance,
    updateCheckResult,
    addExtraCheck,
    updateDiagnosis,
    setInstanceStatus,
    deleteInstance,
  } = useSOPStore();

  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SOPTemplate | null>(null);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [startForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState<'templates' | 'history'>('templates');

  const activeInstance = instances.find((i) => i.id === activeInstanceId) ?? null;
  const activeTemplate = templates.find((t) => t.id === activeInstance?.templateId);

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const handleStartInstance = async () => {
    const values = await startForm.validateFields();
    const id = startInstance(values.templateId, values.incidentTitle);
    if (id) {
      messageApi.success('已开始排查');
    }
    startForm.resetFields();
    setStartModalOpen(false);
  };

  const handleOpenStart = (templateId?: string) => {
    if (templateId) {
      setSelectedTemplateId(templateId);
      startForm.setFieldValue('templateId', templateId);
    }
    setStartModalOpen(true);
  };

  const handleTemplateOk = (
    data: Omit<SOPTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (editingTemplate) {
      updateTemplate(editingTemplate.id, data);
      messageApi.success('模板已更新');
    } else {
      addTemplate(data);
      messageApi.success('模板已创建');
    }
    setTemplateEditorOpen(false);
  };

  return (
    <div style={{ padding: 24 }}>
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
            SOP 故障排查
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            标准化操作流程 · 逐步排查 · 一键导出报告
          </Text>
        </div>
        <Space>
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingTemplate(null);
              setTemplateEditorOpen(true);
            }}
          >
            新建模板
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => handleOpenStart()}
          >
            开始排查
          </Button>
        </Space>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '300px 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* 左侧：模板库 + 历史记录 */}
        <div>
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as 'templates' | 'history')}
            size="small"
            items={[
              {
                key: 'templates',
                label: (
                  <Space size={4}>
                    <FileTextOutlined />
                    模板库
                    <Badge count={templates.length} color="#3b82f6" size="small" />
                  </Space>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {templates.length === 0 ? (
                      <Empty
                        description="暂无模板"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    ) : (
                      templates.map((tpl) => (
                        <Card
                          key={tpl.id}
                          size="small"
                          style={{
                            background: cardBg,
                            border: `1px solid ${borderColor}`,
                            cursor: 'pointer',
                          }}
                          onClick={() => handleOpenStart(tpl.id)}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text strong style={{ fontSize: 13 }}>
                                {tpl.name}
                              </Text>
                              <div style={{ marginTop: 4 }}>
                                <Tag
                                  color={CATEGORY_COLOR[tpl.category] ?? 'default'}
                                  style={{ fontSize: 11 }}
                                >
                                  {tpl.category}
                                </Tag>
                                <Tag style={{ fontSize: 11 }}>
                                  {tpl.checks.length} 步
                                </Tag>
                              </div>
                              {tpl.description && (
                                <Text
                                  type="secondary"
                                  style={{ fontSize: 11, display: 'block', marginTop: 2 }}
                                  ellipsis={{ tooltip: tpl.description }}
                                >
                                  {tpl.description}
                                </Text>
                              )}
                            </div>
                            <Space
                              size={4}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Tooltip title="编辑模板">
                                <EditOutlined
                                  style={{ color: '#a1a1aa', cursor: 'pointer', fontSize: 13 }}
                                  onClick={() => {
                                    setEditingTemplate(tpl);
                                    setTemplateEditorOpen(true);
                                  }}
                                />
                              </Tooltip>
                              <Popconfirm
                                title="删除此模板？"
                                onConfirm={() => {
                                  deleteTemplate(tpl.id);
                                  messageApi.success('模板已删除');
                                }}
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                              >
                                <DeleteOutlined
                                  style={{ color: '#ef4444', cursor: 'pointer', fontSize: 13 }}
                                />
                              </Popconfirm>
                            </Space>
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                ),
              },
              {
                key: 'history',
                label: (
                  <Space size={4}>
                    <HistoryOutlined />
                    历史记录
                    <Badge
                      count={instances.filter((i) => i.status === 'investigating').length}
                      color="#3b82f6"
                      size="small"
                    />
                  </Space>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {instances.length === 0 ? (
                      <Empty
                        description="暂无排查记录"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    ) : (
                      instances.map((inst) => (
                        <Card
                          key={inst.id}
                          size="small"
                          style={{
                            background: cardBg,
                            border: `1px solid ${
                              activeInstanceId === inst.id
                                ? '#3b82f6'
                                : borderColor
                            }`,
                            cursor: 'pointer',
                          }}
                          onClick={() => setActiveInstance(inst.id)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text
                                strong
                                style={{
                                  fontSize: 12,
                                  color:
                                    activeInstanceId === inst.id
                                      ? '#3b82f6'
                                      : undefined,
                                }}
                                ellipsis={{ tooltip: inst.incidentTitle }}
                              >
                                {inst.incidentTitle}
                              </Text>
                              <div style={{ marginTop: 2 }}>
                                <Badge
                                  status={
                                    INSTANCE_STATUS_COLOR[inst.status] as
                                      | 'processing'
                                      | 'success'
                                      | 'error'
                                  }
                                />
                                <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                                  {INSTANCE_STATUS_LABEL[inst.status]}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                                  {new Date(inst.createdAt).toLocaleDateString('zh-CN')}
                                </Text>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>

        {/* 右侧：实例执行区 */}
        <div>
          {!activeInstance ? (
            <Card
              style={{
                background: cardBg,
                border: `1px solid ${borderColor}`,
                minHeight: 400,
              }}
            >
              <Empty
                description={
                  <Space direction="vertical" size={8} align="center">
                    <Text type="secondary">点击左侧模板「开始排查」，或从历史记录中选择一条继续</Text>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleOpenStart()}
                    >
                      开始新的排查
                    </Button>
                  </Space>
                }
              />
            </Card>
          ) : (
            <InstanceRunner
              instance={activeInstance}
              template={activeTemplate}
              onUpdateCheck={(checkId, data) =>
                updateCheckResult(activeInstance.id, checkId, data)
              }
              onAddExtraCheck={(check) =>
                addExtraCheck(activeInstance.id, check)
              }
              onUpdateDiagnosis={(field, value) =>
                updateDiagnosis(activeInstance.id, field, value)
              }
              onSetStatus={(status) =>
                setInstanceStatus(activeInstance.id, status)
              }
              onDelete={() => {
                deleteInstance(activeInstance.id);
                messageApi.success('记录已删除');
              }}
            />
          )}
        </div>
      </div>

      {/* 模板编辑弹窗 */}
      <TemplateEditor
        open={templateEditorOpen}
        initial={editingTemplate}
        onOk={handleTemplateOk}
        onCancel={() => setTemplateEditorOpen(false)}
      />

      {/* 开始排查弹窗 */}
      <Modal
        title="开始故障排查"
        open={startModalOpen}
        onOk={handleStartInstance}
        onCancel={() => {
          setStartModalOpen(false);
          startForm.resetFields();
        }}
        okText="开始排查"
        cancelText="取消"
      >
        <Form form={startForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="incidentTitle"
            label="故障标题"
            rules={[{ required: true, message: '请输入故障标题' }]}
          >
            <Input placeholder="例：用户服务 2024-01-15 10:23 报错" />
          </Form.Item>
          <Form.Item
            name="templateId"
            label="排查模板"
            rules={[{ required: true, message: '请选择排查模板' }]}
            initialValue={selectedTemplateId || undefined}
          >
            <Select
              placeholder="选择适合此故障场景的模板"
              options={templates.map((t) => ({
                label: (
                  <Space size={6}>
                    <span>{t.name}</span>
                    <Tag
                      color={CATEGORY_COLOR[t.category] ?? 'default'}
                      style={{ fontSize: 10 }}
                    >
                      {t.category}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {t.checks.length}步
                    </Text>
                  </Space>
                ),
                value: t.id,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SOPBuilder;
