import {
    ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined
} from '@ant-design/icons';
import {
    Button, Card, Checkbox, Col,
    Form, Input, InputNumber, Modal,
    Row, Select, Space, Switch, Tag, Tooltip, Typography
} from 'antd';
import React, { useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';
import {
    useChaosStore,
    type ChaosScenario, type ScenarioStep, type StepType
} from '../store/chaosStore';
import { FAULT_TEMPLATES } from './faultTemplates';

const { Text } = Typography;
const { TextArea } = Input;

const STEP_TYPE_OPTIONS: { label: string; value: StepType }[] = [
  { label: '⬛ 后台任务 (background)', value: 'background' },
  { label: '💥 故障注入 (inject)', value: 'inject' },
  { label: '⏳ 等待 (wait)', value: 'wait' },
  { label: '✅ 结果校验 (verify)', value: 'verify' },
  { label: '♻️ 恢复故障 (recover)', value: 'recover' },
  { label: '⏹ 终止后台 (kill_bg)', value: 'kill_bg' },
];

const VERIFY_TYPE_OPTIONS = [
  { label: '包含关键字 (contains)', value: 'contains' },
  { label: '不包含 (not_contains)', value: 'not_contains' },
  { label: '正则匹配 (regex)', value: 'regex' },
  { label: '退出码为0 (exit_code_zero)', value: 'exit_code_zero' },
];

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

interface StepFormProps {
  step: ScenarioStep;
  scenarioId: string;
  allSteps: ScenarioStep[];
}

const StepForm: React.FC<StepFormProps> = ({ step, scenarioId, allSteps }) => {
  const { updateStep } = useChaosStore();
  const { sessions } = useSSHStore();
  const connectedSessions = sessions.filter(s => s.status === 'connected');
  const up = (patch: Partial<ScenarioStep>) => updateStep(scenarioId, step.id, patch);

  const bgSteps = allSteps.filter(s => s.type === 'background');

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Form layout="vertical" size="small">
        <Form.Item label="步骤名称">
          <Input value={step.label} onChange={e => up({ label: e.target.value })} />
        </Form.Item>

        {/* Session selector (most types need it) */}
        {step.type !== 'wait' && step.type !== 'kill_bg' && (
          <Form.Item label="目标节点">
            <Checkbox.Group
              options={connectedSessions.map(s => ({ label: s.name, value: s.id }))}
              value={step.sessionIds}
              onChange={v => up({ sessionIds: v as string[] })}
            />
          </Form.Item>
        )}

        {step.type === 'wait' && (
          <Form.Item label="等待时长（秒）">
            <InputNumber min={1} value={step.waitSeconds} onChange={v => up({ waitSeconds: v ?? 10 })} addonAfter="秒" style={{ width: 140 }} />
          </Form.Item>
        )}

        {step.type === 'background' && (
          <>
            <Form.Item label="后台命令">
              <TextArea rows={2} value={step.bgCmd} onChange={e => up({ bgCmd: e.target.value })} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Form.Item>
            <Form.Item label="模式">
              <Select value={step.bgMode} onChange={v => up({ bgMode: v })} style={{ width: 180 }}
                options={[{ label: '长时间单次 (once)', value: 'once' }, { label: '周期 (watch)', value: 'watch' }]} />
              {step.bgMode === 'watch' && (
                <InputNumber min={1} value={step.bgInterval} onChange={v => up({ bgInterval: v ?? 2 })} addonAfter="秒" style={{ marginLeft: 8, width: 120 }} />
              )}
            </Form.Item>
            <Form.Item label="告警正则（可选）">
              <Input value={step.bgAlertPattern} onChange={e => up({ bgAlertPattern: e.target.value })} placeholder="STUCK_IO|ERROR" style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          </>
        )}

        {(step.type === 'inject' || step.type === 'recover') && (
          <>
            <Form.Item label="故障模板">
              <Select allowClear placeholder="选择内置模板（可选）" value={step.faultTemplateId} onChange={v => up({ faultTemplateId: v })} style={{ width: '100%' }}
                options={FAULT_TEMPLATES.map(t => ({ label: t.name, value: t.id }))} />
            </Form.Item>
            {step.faultTemplateId && (
              <Form.Item label="模板参数（JSON）">
                <TextArea rows={2}
                  value={JSON.stringify(step.faultParams || {}, null, 2)}
                  onChange={e => { try { up({ faultParams: JSON.parse(e.target.value) }); } catch {} }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </Form.Item>
            )}
            <Form.Item label={step.type === 'inject' ? '注入命令（覆盖模板）' : '恢复命令'}>
              <TextArea rows={2}
                value={step.type === 'inject' ? step.rawCmd : step.recoverCmd}
                onChange={e => up(step.type === 'inject' ? { rawCmd: e.target.value } : { recoverCmd: e.target.value })}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder={step.faultTemplateId ? '（留空则用模板生成）' : '请输入命令'} />
            </Form.Item>
          </>
        )}

        {step.type === 'verify' && (
          <>
            <Form.Item label="校验命令">
              <TextArea rows={2} value={step.verifyCmd} onChange={e => up({ verifyCmd: e.target.value })} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Form.Item>
            <Form.Item label="校验规则">
              <Space direction="vertical" style={{ width: '100%' }}>
                {(step.verifyRules || []).map((rule, i) => (
                  <Row gutter={6} key={rule.id} align="middle">
                    <Col span={9}>
                      <Select size="small" value={rule.type} onChange={v => {
                        const rules = [...(step.verifyRules || [])];
                        rules[i] = { ...rules[i], type: v as any };
                        up({ verifyRules: rules });
                      }} options={VERIFY_TYPE_OPTIONS} style={{ width: '100%' }} />
                    </Col>
                    <Col span={12}>
                      <Input size="small" value={rule.value} placeholder="关键字 / 正则"
                        onChange={e => {
                          const rules = [...(step.verifyRules || [])];
                          rules[i] = { ...rules[i], value: e.target.value };
                          up({ verifyRules: rules });
                        }} disabled={rule.type === 'exit_code_zero'} />
                    </Col>
                    <Col span={3}>
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => {
                        up({ verifyRules: (step.verifyRules || []).filter((_, j) => j !== i) });
                      }} />
                    </Col>
                  </Row>
                ))}
                <Button size="small" icon={<PlusOutlined />} onClick={() =>
                  up({ verifyRules: [...(step.verifyRules || []), { id: uid(), type: 'contains', value: '' }] })
                }>
                  添加规则
                </Button>
              </Space>
            </Form.Item>
            <Form.Item label={<span>失败时继续 <Tooltip title="开启后校验 FAIL 场景仍继续执行，不中止"><Tag>可选</Tag></Tooltip></span>}>
              <Switch checked={step.continueOnFail} onChange={v => up({ continueOnFail: v })} />
            </Form.Item>
          </>
        )}

        {step.type === 'kill_bg' && (
          <Form.Item label="终止哪个后台步骤">
            <Select value={step.bgJobStepRef} onChange={v => up({ bgJobStepRef: v })} style={{ width: '100%' }}
              placeholder="选择 background 步骤"
              options={bgSteps.map(s => ({ label: s.label, value: s.id }))} />
          </Form.Item>
        )}
      </Form>
    </Space>
  );
};

interface Props { scenario: ChaosScenario; }

export const ScenarioBuilder: React.FC<Props> = ({ scenario }) => {
  const { addStep, removeStep, moveStep } = useChaosStore();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStepType, setNewStepType] = useState<StepType>('verify');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const handleAddStep = () => {
    const label = STEP_TYPE_OPTIONS.find(o => o.value === newStepType)?.label.replace(/^.+?(\s)/, '') || newStepType;
    addStep(scenario.id, { type: newStepType, label, sessionIds: [] });
    setAddModalOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {scenario.steps.length === 0 && (
        <Card size="small" style={{ textAlign: 'center', opacity: 0.6, padding: '16px 0' }}>
          <Text type="secondary">暂无步骤。点击「添加步骤」或选择内置模板开始编排。</Text>
        </Card>
      )}

      {scenario.steps.map((step, i) => (
        <Card
          key={step.id}
          size="small"
          style={{ borderLeft: `3px solid ${step.type === 'verify' ? '#22c55e' : step.type === 'inject' ? '#ef4444' : step.type === 'background' ? '#3b82f6' : '#94a3b8'}` }}
          title={
            <div style={{ cursor: 'pointer' }} onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}>
              <Space>
                <Tag style={{ fontSize: 10 }}>{i + 1}</Tag>
                <Tag color="processing">{step.type}</Tag>
                <Text style={{ fontSize: 13 }}>{step.label}</Text>
              </Space>
            </div>
          }
          extra={
            <Space size={4}>
              <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => moveStep(scenario.id, i, i - 1)} />
              <Button size="small" icon={<ArrowDownOutlined />} disabled={i === scenario.steps.length - 1} onClick={() => moveStep(scenario.id, i, i + 1)} />
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeStep(scenario.id, step.id)} />
            </Space>
          }
        >
          {expandedStep === step.id && (
            <StepForm step={step} scenarioId={scenario.id} allSteps={scenario.steps} />
          )}
        </Card>
      ))}

      <Button icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)} style={{ width: '100%' }}>
        添加步骤
      </Button>

      <Modal title="选择步骤类型" open={addModalOpen} onOk={handleAddStep} onCancel={() => setAddModalOpen(false)} okText="添加">
        <Select value={newStepType} onChange={setNewStepType} style={{ width: '100%' }} options={STEP_TYPE_OPTIONS} size="large" />
      </Modal>
    </div>
  );
};

export default ScenarioBuilder;
