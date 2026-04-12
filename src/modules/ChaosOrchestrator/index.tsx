import {
    DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
    Button, Card, Col, Dropdown, Empty, Input, Layout,
    Row, Space, Tabs, Tag, Typography, message
} from 'antd';
import React, { useState } from 'react';
import { ScenarioBuilder } from './components/ScenarioBuilder';
import { ScenarioReport } from './components/ScenarioReport';
import { ScenarioRunner } from './components/ScenarioRunner';
import { createBuiltinScenario, useChaosStore } from './store/chaosStore';

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, any> = {
  idle: 'default', running: 'processing', done: 'success', aborted: 'warning',
};

export const ChaosOrchestrator: React.FC = () => {
  const { scenarios, addScenario, removeScenario, updateScenario } = useChaosStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  const selected = scenarios.find(s => s.id === selectedId);

  const handleNew = () => {
    const id = addScenario('新混沌场景');
    setSelectedId(id);
  };

  const handleTemplate = (key: string) => {
    const tmpl = createBuiltinScenario(key as any);
    const id = addScenario(tmpl.name, tmpl.description);
    // Update with full steps data
    const { addStep } = useChaosStore.getState();
    tmpl.steps.forEach(step => {
      const { id: _id, ...rest } = step;
      addStep(id, rest);
    });
    setSelectedId(id);
    message.success(`已创建场景「${tmpl.name}」，请选择目标节点后执行。`);
  };

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      {/* Left: Scenario List */}
      <Sider width={240} style={{ background: 'transparent', borderRight: '1px solid #e5e7eb', paddingRight: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Title level={5} style={{ margin: 0 }}>混沌场景</Title>
          <Space size={4}>
            <Dropdown
              menu={{
                items: [
                  { key: 'disk_hang', label: '磁盘Hang + IO校验', icon: <ThunderboltOutlined /> },
                  { key: 'net_partition', label: 'IO业务 + 网络分区', icon: <ThunderboltOutlined /> },
                  { key: 'oom', label: 'OOM触发 + Killer校验', icon: <ThunderboltOutlined /> },
                ],
                onClick: ({ key }) => handleTemplate(key),
              }}
            >
              <Button size="small" icon={<ExperimentOutlined />}>模板</Button>
            </Dropdown>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNew} />
          </Space>
        </div>

        {scenarios.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击「模板」或「+」创建场景" style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scenarios.map(sc => (
              <Card
                key={sc.id}
                size="small"
                hoverable
                onClick={() => setSelectedId(sc.id)}
                style={{ cursor: 'pointer', border: selectedId === sc.id ? '1.5px solid #3b82f6' : undefined }}
                bodyStyle={{ padding: '6px 10px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {editingName === sc.id ? (
                    <Input
                      size="small"
                      value={editNameValue}
                      autoFocus
                      onChange={e => setEditNameValue(e.target.value)}
                      onBlur={() => { updateScenario(sc.id, { name: editNameValue }); setEditingName(null); }}
                      onPressEnter={() => { updateScenario(sc.id, { name: editNameValue }); setEditingName(null); }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <Text ellipsis style={{ maxWidth: 140, fontSize: 12 }}>{sc.name}</Text>
                  )}
                  <Space size={2}>
                    <Tag color={STATUS_COLOR[sc.status]} style={{ fontSize: 10 }}>{sc.status}</Tag>
                    <Button size="small" type="text" icon={<EditOutlined style={{ fontSize: 11 }} />}
                      onClick={e => { e.stopPropagation(); setEditingName(sc.id); setEditNameValue(sc.name); }} />
                    <Button size="small" type="text" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                      onClick={e => { e.stopPropagation(); removeScenario(sc.id); if (selectedId === sc.id) setSelectedId(null); }} />
                  </Space>
                </div>
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {sc.steps.length} 步骤 · {sc.status === 'done' ? `✅${Object.values(sc.stepResults).filter(r => r.status === 'passed').length}/${sc.steps.length}` : ''}
                </Text>
              </Card>
            ))}
          </div>
        )}
      </Sider>

      {/* Right: Scene Detail */}
      <Content style={{ paddingLeft: 16, overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
            <ExperimentOutlined style={{ fontSize: 48, opacity: 0.2 }} />
            <Text type="secondary">从左侧选择一个混沌场景，或点击「模板」快速创建。</Text>
            <Text type="secondary" style={{ fontSize: 12, maxWidth: 400, textAlign: 'center' }}>
              混沌场景支持：后台 IO 业务压测 + 故障注入 + 等待 + 命令输出关键字校验 + 自动恢复，全程流水线编排。
            </Text>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ marginBottom: 12 }}>
              <Title level={5} style={{ margin: 0 }}>{selected.name}</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>{selected.steps.length} 步骤 · 双面板：左侧编排步骤，右侧执行与报告</Text>
            </div>
            <Row gutter={16}>
              <Col span={11}>
                <Card size="small" title="📋 场景编排 (Builder)" bodyStyle={{ padding: '8px 10px', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
                  <ScenarioBuilder scenario={selected} />
                </Card>
              </Col>
              <Col span={13}>
                <Tabs
                  size="small"
                  items={[
                    {
                      key: 'runner',
                      label: '▶ 执行',
                      children: (
                        <Card size="small" bodyStyle={{ padding: '8px 10px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                          <ScenarioRunner scenario={selected} />
                        </Card>
                      ),
                    },
                    {
                      key: 'report',
                      label: '📊 报告',
                      children: (
                        <Card size="small" bodyStyle={{ padding: '8px 10px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                          <ScenarioReport scenario={selected} />
                        </Card>
                      ),
                    },
                  ]}
                />
              </Col>
            </Row>
          </div>
        )}
      </Content>
    </Layout>
  );
};

export default ChaosOrchestrator;
