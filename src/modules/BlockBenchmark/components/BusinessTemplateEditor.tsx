import React, { useState, useMemo } from 'react';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { generateId } from '../../../utils';
import { useBenchmarkStore } from '../store/benchmarkStore';
import type { BusinessTemplate, BusinessStep, TemplateVariable } from '../types';
import BusinessStepModal from './BusinessStepModal';
import BusinessExecutionPanel from './BusinessExecutionPanel';

const { Text, Title } = Typography;
const { TextArea } = Input;

const emptyTemplate = (): BusinessTemplate => ({
  id: generateId(),
  name: '',
  description: '',
  steps: [],
  variables: [],
  createdAt: Date.now(),
});

const BusinessTemplateEditor: React.FC = () => {
  const { businessTemplates, addBusinessTemplate, updateBusinessTemplate, removeBusinessTemplate } =
    useBenchmarkStore();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<BusinessTemplate | null>(null);
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

  const selectedTemplate = useMemo(
    () => businessTemplates.find((t) => t.id === selectedTemplateId) ?? null,
    [businessTemplates, selectedTemplateId]
  );

  const handleCreate = () => {
    const tpl = emptyTemplate();
    setIsCreating(true);
    setSelectedTemplateId(tpl.id);
    setEditingTemplate(tpl);
  };

  const handleSelect = (id: string) => {
    setSelectedTemplateId(id);
    setIsCreating(false);
    const tpl = businessTemplates.find((t) => t.id === id);
    setEditingTemplate(tpl ? { ...tpl } : null);
  };

  const handleSave = () => {
    if (!editingTemplate) return;
    if (!editingTemplate.name.trim()) return;
    if (isCreating) {
      addBusinessTemplate({ ...editingTemplate, updatedAt: Date.now() });
      setIsCreating(false);
    } else {
      updateBusinessTemplate(editingTemplate.id, editingTemplate);
    }
  };

  const handleDelete = (id: string) => {
    removeBusinessTemplate(id);
    if (selectedTemplateId === id) {
      setSelectedTemplateId(null);
      setEditingTemplate(null);
      setIsCreating(false);
    }
  };

  const handleAddStep = () => {
    setEditingStepIndex(null);
    setStepModalOpen(true);
  };

  const handleEditStep = (index: number) => {
    setEditingStepIndex(index);
    setStepModalOpen(true);
  };

  const handleDeleteStep = (index: number) => {
    if (!editingTemplate) return;
    const steps = [...editingTemplate.steps];
    steps.splice(index, 1);
    setEditingTemplate({ ...editingTemplate, steps });
  };

  const handleMoveStep = (index: number, direction: -1 | 1) => {
    if (!editingTemplate) return;
    const steps = [...editingTemplate.steps];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const temp = steps[index];
    steps[index] = steps[newIndex];
    steps[newIndex] = temp;
    setEditingTemplate({ ...editingTemplate, steps });
  };

  const handleStepModalOk = (step: BusinessStep) => {
    if (!editingTemplate) return;
    const steps = [...editingTemplate.steps];
    if (editingStepIndex !== null) {
      steps[editingStepIndex] = step;
    } else {
      steps.push(step);
    }
    setEditingTemplate({ ...editingTemplate, steps });
    setStepModalOpen(false);
    setEditingStepIndex(null);
  };

  const handleAddVariable = () => {
    if (!editingTemplate) return;
    const newVar: TemplateVariable = {
      name: '',
      label: '',
      required: false,
      scope: 'global',
    };
    setEditingTemplate({ ...editingTemplate, variables: [...editingTemplate.variables, newVar] });
  };

  const handleUpdateVariable = (index: number, updates: Partial<TemplateVariable>) => {
    if (!editingTemplate) return;
    const variables = [...editingTemplate.variables];
    variables[index] = { ...variables[index], ...updates };
    setEditingTemplate({ ...editingTemplate, variables });
  };

  const handleDeleteVariable = (index: number) => {
    if (!editingTemplate) return;
    const variables = [...editingTemplate.variables];
    variables.splice(index, 1);
    setEditingTemplate({ ...editingTemplate, variables });
  };

  const handleToggleVarScope = (index: number) => {
    if (!editingTemplate) return;
    const variables = [...editingTemplate.variables];
    const v = variables[index];
    variables[index] = { ...v, scope: v.scope === 'global' ? 'perNode' : 'global' };
    setEditingTemplate({ ...editingTemplate, variables });
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left Column: Template List */}
      <Card
        title="业务模板"
        style={{ width: 260, minWidth: 260, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, overflow: 'auto', padding: '12px' }}
        extra={
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>
            新建
          </Button>
        }
      >
        {businessTemplates.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模板" />
        ) : (
          <List
            dataSource={businessTemplates}
            renderItem={(tpl) => (
              <List.Item
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: selectedTemplateId === tpl.id ? '#e6f7ff' : undefined,
                  borderRadius: 4,
                }}
                onClick={() => handleSelect(tpl.id)}
                actions={[
                  <Popconfirm
                    key="del"
                    title="确认删除?"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDelete(tpl.id);
                    }}
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>,
                ]}
              >
                <div style={{ overflow: 'hidden' }}>
                  <Text strong style={{ display: 'block' }} ellipsis>
                    {tpl.name}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                    {tpl.description || '无描述'}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* Middle Column: Editor */}
      <Card
        title={isCreating ? '新建模板' : editingTemplate ? '编辑模板' : '模板详情'}
        style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, overflow: 'auto', padding: '16px' }}
        extra={
          editingTemplate ? (
            <Space>
              <Button type="primary" onClick={handleSave} disabled={!editingTemplate.name.trim()}>
                保存
              </Button>
            </Space>
          ) : null
        }
      >
        {!editingTemplate ? (
          <Empty description="请从左侧选择或新建模板" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Basic Info */}
            <div>
              <Title level={5} style={{ marginTop: 0 }}>基本信息</Title>
              <Form layout="vertical">
                <Form.Item label="模板名称" required>
                  <Input
                    value={editingTemplate.name}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, name: e.target.value })
                    }
                    placeholder="输入模板名称"
                  />
                </Form.Item>
                <Form.Item label="描述">
                  <TextArea
                    rows={2}
                    value={editingTemplate.description}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, description: e.target.value })
                    }
                    placeholder="输入模板描述"
                  />
                </Form.Item>
              </Form>
            </div>

            {/* Steps */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Title level={5} style={{ margin: 0 }}>执行步骤</Title>
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={handleAddStep}>
                  添加步骤
                </Button>
              </div>
              {editingTemplate.steps.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无步骤" />
              ) : (
                <List
                  bordered
                  dataSource={editingTemplate.steps}
                  renderItem={(step, index) => (
                    <List.Item
                      actions={[
                        <Button
                          key="up"
                          type="text"
                          size="small"
                          icon={<ArrowUpOutlined />}
                          disabled={index === 0}
                          onClick={() => handleMoveStep(index, -1)}
                        />,
                        <Button
                          key="down"
                          type="text"
                          size="small"
                          icon={<ArrowDownOutlined />}
                          disabled={index === editingTemplate.steps.length - 1}
                          onClick={() => handleMoveStep(index, 1)}
                        />,
                        <Button
                          key="edit"
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => handleEditStep(index)}
                        />,
                        <Popconfirm
                          key="del"
                          title="确认删除该步骤?"
                          onConfirm={() => handleDeleteStep(index)}
                        >
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            <Text strong>{index + 1}. {step.name}</Text>
                            {step.blocking ? <Tag size="small">阻塞</Tag> : <Tag size="small" color="orange">非阻塞</Tag>}
                          </Space>
                        }
                        description={
                          <div>
                            <Text code style={{ fontSize: 12 }}>{step.cmd}</Text>
                            <div style={{ marginTop: 4 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                目标: {Array.isArray(step.target) ? step.target.join(', ') : 'all'} | 超时: {step.timeout}ms
                              </Text>
                              {step.captureVar && (
                                <Tag size="small" color="blue" style={{ marginLeft: 8 }}>
                                  捕获: {step.captureVar.name}
                                </Tag>
                              )}
                            </div>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </div>

            {/* Variables */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Title level={5} style={{ margin: 0 }}>变量定义</Title>
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={handleAddVariable}>
                  添加变量
                </Button>
              </div>
              {editingTemplate.variables.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变量" />
              ) : (
                <List
                  bordered
                  dataSource={editingTemplate.variables}
                  renderItem={(v, index) => (
                    <List.Item
                      actions={[
                        <Button
                          key="scope"
                          type="text"
                          size="small"
                          onClick={() => handleToggleVarScope(index)}
                        >
                          {v.scope === 'global' ? '全局' : '节点'}
                        </Button>,
                        <Popconfirm
                          key="del"
                          title="确认删除该变量?"
                          onConfirm={() => handleDeleteVariable(index)}
                        >
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}
                    >
                      <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center' }}>
                        <Input
                          size="small"
                          placeholder="变量名"
                          value={v.name}
                          onChange={(e) => handleUpdateVariable(index, { name: e.target.value })}
                          style={{ width: 120 }}
                        />
                        <Input
                          size="small"
                          placeholder="显示标签"
                          value={v.label}
                          onChange={(e) => handleUpdateVariable(index, { label: e.target.value })}
                          style={{ width: 140 }}
                        />
                        <Input
                          size="small"
                          placeholder="默认值"
                          value={v.defaultValue ?? ''}
                          onChange={(e) =>
                            handleUpdateVariable(index, {
                              defaultValue: e.target.value || undefined,
                            })
                          }
                          style={{ width: 120 }}
                        />
                        <Tag color={v.required ? 'red' : 'default'} style={{ cursor: 'pointer' }} onClick={() => handleUpdateVariable(index, { required: !v.required })}>
                          {v.required ? '必填' : '可选'}
                        </Tag>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Right Column: Execution Panel */}
      <Card
        title="执行面板"
        style={{ width: 380, minWidth: 380, display: 'flex', flexDirection: 'column' }}
        bodyStyle={{ flex: 1, overflow: 'auto', padding: '16px' }}
      >
        <BusinessExecutionPanel template={selectedTemplate} />
      </Card>

      <BusinessStepModal
        open={stepModalOpen}
        initial={editingStepIndex !== null ? editingTemplate?.steps[editingStepIndex] : undefined}
        onOk={handleStepModalOk}
        onCancel={() => {
          setStepModalOpen(false);
          setEditingStepIndex(null);
        }}
      />
    </div>
  );
};

export default BusinessTemplateEditor;
