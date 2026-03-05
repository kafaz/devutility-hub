import React, { useEffect, useState } from 'react';
import {
  Modal, Form, Input, Select, Button, Space, Typography,
  Table, Popconfirm, Tag, Tooltip, Collapse, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, HolderOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import type { SOPTemplate, SOPCheck, SOPSubStep } from '../../../types';
import { generateId } from '../../../utils';
import SubStepPicker from './SubStepPicker';

const { TextArea } = Input;
const { Text } = Typography;
const { Panel } = Collapse;

interface Props {
  open: boolean;
  initial?: SOPTemplate | null;
  allTemplates: SOPTemplate[];       // 用于 SubStepPicker 引用其他 SOP
  onOk: (data: Omit<SOPTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

const CATEGORY_OPTIONS = [
  '服务异常', '性能劣化', '网络问题', '数据库问题',
  '部署问题', '安全事件', '其他',
];

// ─── 子步骤内联编辑表格 ────────────────────────────────────────────────────

interface SubStepTableProps {
  checkId: string;
  subSteps: SOPSubStep[];
  onChange: (checkId: string, subSteps: SOPSubStep[]) => void;
  allTemplates: SOPTemplate[];
  currentTemplateId?: string;
}

const SubStepTable: React.FC<SubStepTableProps> = ({
  checkId, subSteps, onChange, allTemplates, currentTemplateId,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  const update = (id: string, field: keyof SOPSubStep, value: string | number) => {
    onChange(checkId, subSteps.map((s) => s.id === id ? { ...s, [field]: value } : s));
  };

  const remove = (id: string) => {
    onChange(checkId, subSteps.filter((s) => s.id !== id));
  };

  const add = () => {
    onChange(checkId, [
      ...subSteps,
      {
        id: generateId(), order: subSteps.length + 1,
        name: `子步骤 ${subSteps.length + 1}`, command: '',
        subSteps: [],
      } as unknown as SOPSubStep,
    ]);
  };

  const handleImport = (imported: SOPSubStep[]) => {
    const next = [
      ...subSteps,
      ...imported.map((s) => ({
        ...s,
        id: generateId(),
        order: subSteps.length + imported.indexOf(s) + 1,
      })),
    ];
    onChange(checkId, next);
    setPickerOpen(false);
  };

  const cols = [
    {
      title: '', width: 20,
      render: () => <HolderOutlined style={{ color: '#6b7280', cursor: 'grab' }} />,
    },
    {
      title: '子步骤名称', dataIndex: 'name', width: 140,
      render: (v: string, rec: SOPSubStep) => (
        <Input size="small" value={v}
          onChange={(e) => update(rec.id, 'name', e.target.value)}
          placeholder="步骤名称" />
      ),
    },
    {
      title: (
        <Space size={4}>
          命令
          <Tooltip title="支持 ${用户变量} 和 ${CAPTURED_VAR} 引用前序步骤捕获的变量">
            <Text type="secondary" style={{ fontSize: 11, cursor: 'help' }}>ⓘ 支持变量</Text>
          </Tooltip>
        </Space>
      ),
      dataIndex: 'command',
      render: (v: string, rec: SOPSubStep) => (
        <Input size="small" value={v}
          onChange={(e) => update(rec.id, 'command', e.target.value)}
          placeholder="ps aux | grep ${service_name} 或引用 ${CAPTURED_VAR}"
          style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }} />
      ),
    },
    {
      title: (
        <Tooltip title="将 stdout 保存为变量，后续子步骤可用 ${VAR_NAME} 引用">
          <span>捕获变量 ⓘ</span>
        </Tooltip>
      ),
      dataIndex: 'captureVar', width: 120,
      render: (v: string, rec: SOPSubStep) => (
        <Input size="small" value={v ?? ''}
          onChange={(e) => update(rec.id, 'captureVar', e.target.value)}
          placeholder="如 PID, PORT"
          style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }} />
      ),
    },
    {
      title: (
        <Tooltip title="正则表达式，取第 1 捕获组作为变量值。留空则保存整个 stdout.trim()">
          <span>提取模式 ⓘ</span>
        </Tooltip>
      ),
      dataIndex: 'capturePattern', width: 130,
      render: (v: string, rec: SOPSubStep) => (
        <Input size="small" value={v ?? ''}
          onChange={(e) => update(rec.id, 'capturePattern', e.target.value)}
          placeholder="如 (\d+)"
          style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 }} />
      ),
    },
    {
      title: '超时(s)', dataIndex: 'timeoutMs', width: 70,
      render: (v: number, rec: SOPSubStep) => (
        <Input size="small" type="number" value={v ? Math.round(v / 1000) : ''}
          onChange={(e) => update(rec.id, 'timeoutMs', parseInt(e.target.value) * 1000 || 30000)}
          placeholder="30" />
      ),
    },
    {
      title: '', width: 36,
      render: (_: unknown, rec: SOPSubStep) => (
        <Popconfirm title="删除此子步骤？" onConfirm={() => remove(rec.id)}
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <DeleteOutlined style={{ color: '#ef4444', cursor: 'pointer' }} />
        </Popconfirm>
      ),
    },
  ];

  // 计算已定义的捕获变量，供后续子步骤提示
  const definedVars = subSteps
    .filter((s) => s.captureVar)
    .map((s) => s.captureVar!);

  return (
    <div>
      {definedVars.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>已定义变量：</Text>
          {definedVars.map((v) => (
            <Tag key={v} color="blue" style={{ fontSize: 10, marginLeft: 4 }}>
              ${'{'}
              {v}
              {'}'}
            </Tag>
          ))}
          <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
            可在后续子步骤命令中引用
          </Text>
        </div>
      )}

      <Table
        dataSource={subSteps}
        columns={cols}
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ x: 760 }}
        locale={{ emptyText: '暂无子步骤，点击「添加」创建或从其他 SOP 导入' }}
      />

      <Space style={{ marginTop: 8 }}>
        <Button size="small" icon={<PlusOutlined />} type="dashed" onClick={add}>
          添加子步骤
        </Button>
        <Button
          size="small"
          icon={<ImportOutlined />}
          onClick={() => setPickerOpen(true)}
        >
          从其他 SOP 导入
        </Button>
      </Space>

      <SubStepPicker
        open={pickerOpen}
        allTemplates={allTemplates.filter((t) => t.id !== currentTemplateId)}
        onOk={handleImport}
        onCancel={() => setPickerOpen(false)}
      />
    </div>
  );
};

// ─── 主编辑器 ──────────────────────────────────────────────────────────────

const TemplateEditor: React.FC<Props> = ({
  open, initial, allTemplates, onOk, onCancel,
}) => {
  const [form] = Form.useForm();
  const [checks, setChecks] = useState<SOPCheck[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      if (initial) {
        form.setFieldsValue({
          name: initial.name, category: initial.category,
          description: initial.description, diagnosisHints: initial.diagnosisHints,
        });
        setChecks(initial.checks.map((c) => ({ ...c, subSteps: c.subSteps ?? [] })));
      } else {
        form.resetFields();
        setChecks([]);
      }
      setActiveKeys([]);
    }
  }, [open, initial, form]);

  const addCheck = () => {
    const newCheck: SOPCheck = {
      id: generateId(), order: checks.length + 1,
      name: `检查步骤 ${checks.length + 1}`,
      description: '', command: '',
      expectedNormal: '', abnormalSigns: '',
      subSteps: [],
    };
    setChecks((prev) => [...prev, newCheck]);
    setActiveKeys((prev) => [...prev, newCheck.id]);
  };

  const updateCheckField = (
    id: string, field: keyof Omit<SOPCheck, 'subSteps'>, value: string | number
  ) => {
    setChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const updateSubSteps = (checkId: string, subSteps: SOPSubStep[]) => {
    setChecks((prev) =>
      prev.map((c) => (c.id === checkId ? { ...c, subSteps } : c))
    );
  };

  const removeCheck = (id: string) => {
    setChecks((prev) => prev.filter((c) => c.id !== id));
    setActiveKeys((prev) => prev.filter((k) => k !== id));
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    onOk({
      name: values.name,
      category: values.category || '其他',
      description: values.description || '',
      diagnosisHints: values.diagnosisHints || '',
      checks: checks.map((c, i) => ({ ...c, order: i + 1 })),
    });
  };

  return (
    <Modal
      title={initial ? '编辑 SOP 模板' : '新建 SOP 模板'}
      open={open} onOk={handleOk} onCancel={onCancel}
      width={980} okText="保存" cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
            <Input placeholder="例：服务不可用排查" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select options={CATEGORY_OPTIONS.map((c) => ({ label: c, value: c }))}
              placeholder="选择故障分类" />
          </Form.Item>
        </div>
        <Form.Item name="description" label="场景描述">
          <Input placeholder="适用于哪些故障场景" />
        </Form.Item>
        <Form.Item name="diagnosisHints" label="常见根因提示（Markdown）">
          <TextArea rows={2} placeholder="- 进程 OOM 被 kill&#10;- 依赖服务连接耗尽" />
        </Form.Item>
      </Form>

      <Alert
        type="info" showIcon={false} style={{ marginBottom: 10, fontSize: 12 }}
        message={
          <Text style={{ fontSize: 12 }}>
            每个检查步骤可包含多个<b>子步骤</b>，子步骤顺序执行。
            通过<b>捕获变量</b>可将输出传递给后续步骤：如捕获 PID 后，下一步可用 <code>${'{'}PID{'}'}</code> 引用。
          </Text>
        }
      />

      {/* 检查步骤列表（Collapse 折叠面板） */}
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Text strong>检查步骤（{checks.length} 个，点击展开编辑子步骤）</Text>
        <Button size="small" icon={<PlusOutlined />} type="dashed" onClick={addCheck}>
          添加检查步骤
        </Button>
      </div>

      {checks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280', fontSize: 13 }}>
          点击「添加检查步骤」开始构建排查流程
        </div>
      ) : (
        <Collapse
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(keys as string[])}
          style={{ maxHeight: 500, overflowY: 'auto' }}
        >
          {checks.map((check, idx) => (
            <Panel
              key={check.id}
              header={
                <Space style={{ width: '100%', justifyContent: 'space-between' }}
                  onClick={(e) => e.stopPropagation()}>
                  <Space size={8}>
                    <Text type="secondary" style={{ fontSize: 11 }}>#{idx + 1}</Text>
                    <Input
                      size="small"
                      value={check.name}
                      onChange={(e) => updateCheckField(check.id, 'name', e.target.value)}
                      style={{ width: 200, fontWeight: 600 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Tag color="blue" style={{ fontSize: 10 }}>
                      {( check.subSteps?.length ?? 0) > 0
                        ? `${( check.subSteps?.length ?? 0)} 个子步骤`
                        : '单命令'}
                    </Tag>
                    {(check.subSteps ?? []).some((s) => s.captureVar) && (
                      <Tag color="green" style={{ fontSize: 10 }}>含变量捕获</Tag>
                    )}
                  </Space>
                  <Popconfirm
                    title="删除此检查步骤？"
                    onConfirm={() => removeCheck(check.id)}
                    okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                  >
                    <DeleteOutlined
                      style={{ color: '#ef4444', cursor: 'pointer' }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </Space>
              }
            >
              {/* 步骤基本信息 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 12 }}>
                <div>
                  <Text style={{ fontSize: 12 }}>描述</Text>
                  <Input
                    size="small"
                    value={check.description}
                    onChange={(e) => updateCheckField(check.id, 'description', e.target.value)}
                    placeholder="此步骤的检查目标"
                    style={{ marginTop: 2 }}
                  />
                </div>
                <div>
                  <Text style={{ fontSize: 12 }}>
                    兜底命令（子步骤为空时执行）
                  </Text>
                  <Input
                    size="small"
                    value={check.command}
                    onChange={(e) => updateCheckField(check.id, 'command', e.target.value)}
                    placeholder="ps aux | grep ${service_name}"
                    style={{
                      marginTop: 2,
                      fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11,
                    }}
                  />
                </div>
                <div>
                  <Text style={{ fontSize: 12 }}>正常特征</Text>
                  <Input
                    size="small"
                    value={check.expectedNormal ?? ''}
                    onChange={(e) => updateCheckField(check.id, 'expectedNormal', e.target.value)}
                    placeholder="输出包含..."
                    style={{ marginTop: 2 }}
                  />
                </div>
                <div>
                  <Text style={{ fontSize: 12 }}>异常特征</Text>
                  <Input
                    size="small"
                    value={check.abnormalSigns ?? ''}
                    onChange={(e) => updateCheckField(check.id, 'abnormalSigns', e.target.value)}
                    placeholder="无输出 / Connection refused"
                    style={{ marginTop: 2 }}
                  />
                </div>
              </div>

              {/* 子步骤编辑 */}
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                子步骤（顺序执行，支持变量传递）
              </Text>
              <SubStepTable
                checkId={check.id}
                subSteps={check.subSteps ?? []}
                onChange={updateSubSteps}
                allTemplates={allTemplates}
                currentTemplateId={initial?.id}
              />
            </Panel>
          ))}
        </Collapse>
      )}
    </Modal>
  );
};

export default TemplateEditor;
