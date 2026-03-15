import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  HistoryOutlined,
  PlusOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import ResizableOutput from '../../components/shared/ResizableOutput';
import { useGlobalStore } from '../../store/globalStore';
import { generateId } from '../../utils';
import {
  type DiagnosticAnalysisRule,
  type DiagnosticBusinessAction,
  type DiagnosticCollectionStep,
  type DiagnosticPlaybook,
  useDiagnosticStore,
} from './store/diagnosticStore';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const PROXY_HTTP = 'http://127.0.0.1:3001';

interface SessionOption {
  sessionId: string;
  host: string;
  username: string;
}

interface SimilarCase {
  runId: string;
  title: string;
  score: number;
  matchedSignals: string[];
  reportSummary: string;
  topFindings: string[];
  startedAt?: number;
}

interface DiagnosticFinding {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  evidence: string;
  sourceStepName: string;
}

interface DiagnosticReport {
  summary: string;
  rootCauseHypothesis: string;
  recommendations: string[];
  nextActions: string[];
  similarCaseHint?: string;
  notes?: string;
}

interface DiagnosticRunRecord {
  id: string;
  title: string;
  symptom: string;
  notes?: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  sessionLabel?: string;
  findingCount?: number;
  summary?: string;
  collectionSteps?: Array<{
    id: string;
    name: string;
    command: string;
    resolvedCommand?: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    status: string;
    conclusion?: string;
  }>;
  businessActions?: Array<{
    id: string;
    name: string;
    scriptPath: string;
    resolvedPath?: string;
    args: string[];
    stdinPayload: string;
    runMode: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    status: string;
  }>;
  findings?: DiagnosticFinding[];
  similarCases?: SimilarCase[];
  report?: DiagnosticReport;
}

interface CommandPolicySnapshot {
  storeFile?: string;
  allowedBaseCommands: string[];
  defaultAllowedBaseCommands: string[];
  customAddedCommands: string[];
  customRemovedCommands: string[];
  blockedRules: Array<{
    id: string;
    reason: string;
  }>;
}

function normalizeCommandPolicySnapshot(snapshot: Partial<CommandPolicySnapshot> | null | undefined): CommandPolicySnapshot {
  return {
    storeFile: typeof snapshot?.storeFile === 'string' ? snapshot.storeFile : undefined,
    allowedBaseCommands: Array.isArray(snapshot?.allowedBaseCommands)
      ? snapshot.allowedBaseCommands.map((item) => String(item)).filter(Boolean)
      : [],
    defaultAllowedBaseCommands: Array.isArray(snapshot?.defaultAllowedBaseCommands)
      ? snapshot.defaultAllowedBaseCommands.map((item) => String(item)).filter(Boolean)
      : [],
    customAddedCommands: Array.isArray(snapshot?.customAddedCommands)
      ? snapshot.customAddedCommands.map((item) => String(item)).filter(Boolean)
      : [],
    customRemovedCommands: Array.isArray(snapshot?.customRemovedCommands)
      ? snapshot.customRemovedCommands.map((item) => String(item)).filter(Boolean)
      : [],
    blockedRules: Array.isArray(snapshot?.blockedRules)
      ? snapshot.blockedRules
          .map((rule) => ({
            id: String(rule?.id || ''),
            reason: String(rule?.reason || ''),
          }))
          .filter((rule) => rule.id && rule.reason)
      : [],
  };
}

const statusColorMap: Record<string, string> = {
  completed: 'success',
  attention: 'warning',
  failed: 'error',
  done: 'success',
};

const severityColorMap: Record<string, string> = {
  info: 'blue',
  warning: 'orange',
  critical: 'red',
};

function formatTs(ts?: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

const DiagnosticWorkbench: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const { playbooks, activePlaybookId, setActivePlaybook, addPlaybook, updatePlaybook, deletePlaybook } = useDiagnosticStore();
  const [messageApi, contextHolder] = message.useMessage();

  const safePlaybooks = Array.isArray(playbooks) ? playbooks : [];
  const activePlaybook = safePlaybooks.find((item) => item.id === activePlaybookId) || safePlaybooks[0];

  const [title, setTitle] = useState(activePlaybook?.name || '');
  const [symptom, setSymptom] = useState(activePlaybook?.symptomTemplate || '');
  const [notes, setNotes] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [historyRuns, setHistoryRuns] = useState<DiagnosticRunRecord[]>([]);
  const [activeRun, setActiveRun] = useState<DiagnosticRunRecord | null>(null);
  const [matches, setMatches] = useState<SimilarCase[]>([]);
  const [running, setRunning] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [commandPolicy, setCommandPolicy] = useState<CommandPolicySnapshot | null>(null);
  const [newAllowedCommand, setNewAllowedCommand] = useState('');
  const [policyEditorValue, setPolicyEditorValue] = useState('');

  useEffect(() => {
    if (!activePlaybook) return;
    setTitle(activePlaybook.name);
    setSymptom(activePlaybook.symptomTemplate);
    setMatches([]);
  }, [activePlaybook?.id]);

  useEffect(() => {
    void fetchSessions();
    void fetchRuns();
    void fetchCommandPolicy();
  }, []);

  async function fetchSessions() {
    setLoadingSessions(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/sessions`);
      const data = await response.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      if (!selectedSessionId && data.sessions?.[0]?.sessionId) {
        setSelectedSessionId(data.sessions[0].sessionId);
      }
    } catch {
      messageApi.warning('未获取到 SSH 会话，请确认代理服务已启动');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function fetchRuns() {
    setLoadingRuns(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/runs?limit=30`);
      const data = await response.json();
      setHistoryRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      messageApi.warning('未能加载诊断知识库历史记录');
    } finally {
      setLoadingRuns(false);
    }
  }

  function syncPolicyState(snapshot: CommandPolicySnapshot) {
    const normalized = normalizeCommandPolicySnapshot(snapshot);
    setCommandPolicy(normalized);
    setPolicyEditorValue(normalized.allowedBaseCommands.join('\n'));
  }

  async function fetchCommandPolicy() {
    setLoadingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy`);
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '命令白名单加载失败');
        return;
      }
      syncPolicyState(data.policy);
    } catch {
      messageApi.error('命令白名单加载失败');
    } finally {
      setLoadingPolicy(false);
    }
  }

  async function addAllowedCommand() {
    const command = newAllowedCommand.trim();
    if (!command) {
      messageApi.warning('请输入要加入白名单的命令名');
      return;
    }

    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/allow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '白名单更新失败');
        return;
      }
      syncPolicyState(data.policy);
      setNewAllowedCommand('');
      messageApi.success(`已允许命令 ${command}`);
    } catch {
      messageApi.error('白名单更新失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function removeAllowedCommand(command: string) {
    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/allow/${encodeURIComponent(command)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '移除白名单命令失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success(`已移除命令 ${command}`);
    } catch {
      messageApi.error('移除白名单命令失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveCommandPolicy() {
    const commands = Array.from(
      new Set(
        policyEditorValue
          .split(/[\n,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );

    if (commands.length === 0) {
      messageApi.warning('白名单不能为空');
      return;
    }

    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedBaseCommands: commands }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '白名单保存失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success(`白名单已保存，共 ${data.policy?.allowedBaseCommands?.length || commands.length} 条命令`);
    } catch {
      messageApi.error('白名单保存失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function resetPolicyToDefault() {
    setSavingPolicy(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/agent/command-policy/reset`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '白名单重置失败');
        return;
      }
      syncPolicyState(data.policy);
      messageApi.success('白名单已恢复默认策略');
    } catch {
      messageApi.error('白名单重置失败');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function loadRun(runId: string) {
    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/runs/${runId}`);
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '诊断记录加载失败');
        return;
      }
      setActiveRun(data.run);
      setMatches(data.run.similarCases || []);
    } catch {
      messageApi.error('诊断记录加载失败');
    }
  }

  function patchPlaybook(data: Partial<DiagnosticPlaybook>) {
    if (!activePlaybook) return;
    updatePlaybook(activePlaybook.id, data);
  }

  function updateCollectionStep(stepId: string, patch: Partial<DiagnosticCollectionStep>) {
    if (!activePlaybook) return;
    patchPlaybook({
      collectionPlan: activePlaybook.collectionPlan.map((step) =>
        step.id === stepId ? { ...step, ...patch } : step
      ),
    });
  }

  function updateAnalysisRule(ruleId: string, patch: Partial<DiagnosticAnalysisRule>) {
    if (!activePlaybook) return;
    patchPlaybook({
      analysisRules: activePlaybook.analysisRules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule
      ),
    });
  }

  function updateBusinessAction(actionId: string, patch: Partial<DiagnosticBusinessAction>) {
    if (!activePlaybook) return;
    patchPlaybook({
      businessActions: activePlaybook.businessActions.map((action) =>
        action.id === actionId ? { ...action, ...patch } : action
      ),
    });
  }

  function addCollectionStep() {
    if (!activePlaybook) return;
    patchPlaybook({
      collectionPlan: [
        ...activePlaybook.collectionPlan,
        { id: generateId(), name: '新采集步骤', command: 'echo "replace me"', timeoutMs: 15000 },
      ],
    });
  }

  function addAnalysisRule() {
    if (!activePlaybook) return;
    patchPlaybook({
      analysisRules: [
        ...activePlaybook.analysisRules,
        { id: generateId(), name: '新规则', pattern: 'error|failed', source: 'all', severity: 'warning', summary: '' },
      ],
    });
  }

  function addBusinessAction() {
    if (!activePlaybook) return;
    patchPlaybook({
      businessActions: [
        ...activePlaybook.businessActions,
        {
          id: generateId(),
          name: '新业务动作',
          scriptPath: '',
          argsText: '[]',
          stdinPayload: '',
          runMode: 'before_collection',
          timeoutMs: 15000,
        },
      ],
    });
  }

  function removeCollectionStep(stepId: string) {
    if (!activePlaybook) return;
    patchPlaybook({
      collectionPlan: activePlaybook.collectionPlan.filter((step) => step.id !== stepId),
    });
  }

  function removeAnalysisRule(ruleId: string) {
    if (!activePlaybook) return;
    patchPlaybook({
      analysisRules: activePlaybook.analysisRules.filter((rule) => rule.id !== ruleId),
    });
  }

  function removeBusinessAction(actionId: string) {
    if (!activePlaybook) return;
    patchPlaybook({
      businessActions: activePlaybook.businessActions.filter((action) => action.id !== actionId),
    });
  }

  async function runRecall() {
    if (!activePlaybook) return;
    if (!title.trim() || !symptom.trim()) {
      messageApi.warning('请输入本次诊断标题和故障现象');
      return;
    }

    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          symptom,
          notes,
          collectionPlan: activePlaybook.collectionPlan,
          businessActions: activePlaybook.businessActions.map((action) => ({
            ...action,
            args: action.argsText,
          })),
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '预召回失败');
        return;
      }
      setMatches(data.matches || []);
      messageApi.success(`已召回 ${data.matches?.length || 0} 条相似案例`);
    } catch {
      messageApi.error('预召回失败');
    }
  }

  async function runOrchestration() {
    if (!activePlaybook) return;
    if (!title.trim() || !symptom.trim()) {
      messageApi.warning('请输入本次诊断标题和故障现象');
      return;
    }

    if (activePlaybook.collectionPlan.length > 0 && !selectedSessionId) {
      messageApi.warning('当前编排包含采集步骤，需要选择 SSH 会话');
      return;
    }

    setRunning(true);
    try {
      const response = await fetch(`${PROXY_HTTP}/api/diagnostic/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          symptom,
          notes,
          sessionId: selectedSessionId,
          collectionPlan: activePlaybook.collectionPlan,
          analysisRules: activePlaybook.analysisRules,
          businessActions: activePlaybook.businessActions.map((action) => ({
            ...action,
            args: action.argsText,
          })),
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        messageApi.error(data.error || '诊断编排执行失败');
        return;
      }
      setActiveRun(data.run);
      setMatches(data.run.similarCases || []);
      await fetchRuns();
      messageApi.success('诊断编排执行完成，结果已归档入知识库');
    } catch {
      messageApi.error('诊断编排执行失败');
    } finally {
      setRunning(false);
    }
  }

  const currentSession = sessions.find((item) => item.sessionId === selectedSessionId);
  const detailRun = activeRun;

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>诊断工作台</Title>
          <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
            把连接采集、日志分析、报告归纳和 Python 业务测试放进一条编排链，同时自动沉淀到诊断知识库。
          </Paragraph>
        </div>
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={() => addPlaybook()}>
            新建 Playbook
          </Button>
          <Button icon={<SearchOutlined />} onClick={() => void runRecall()}>
            相似预召回
          </Button>
          <Button type="primary" icon={<RobotOutlined />} loading={running} onClick={() => void runOrchestration()}>
            执行多 Agent 编排
          </Button>
        </Space>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.2fr) minmax(320px, 0.8fr)', gap: 16, alignItems: 'start' }}>
        <Card title="本次诊断配置" extra={<Tag color="blue">Collector / Analyst / Summarizer</Tag>}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">选择编排模板</Text>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Select
                  style={{ flex: 1 }}
                  value={activePlaybook?.id}
                  options={safePlaybooks.map((playbook) => ({ label: playbook.name, value: playbook.id }))}
                  onChange={(value) => setActivePlaybook(String(value))}
                />
                <Popconfirm title="删除当前 Playbook？" onConfirm={() => activePlaybook && deletePlaybook(activePlaybook.id)}>
                  <Button danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            </div>

            <div>
              <Text type="secondary">Playbook 描述</Text>
              <Input
                value={activePlaybook?.description}
                onChange={(e) => patchPlaybook({ description: e.target.value })}
                placeholder="描述这套诊断编排适用于什么故障"
                style={{ marginTop: 8 }}
                suffix={<SaveOutlined />}
              />
            </div>

            <div>
              <Text type="secondary">本次 Run 标题</Text>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginTop: 8 }} placeholder="例如：订单接口超时诊断" />
            </div>

            <div>
              <Text type="secondary">故障现象</Text>
              <TextArea
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 5 }}
                style={{ marginTop: 8 }}
                placeholder="描述现象、影响范围、怀疑方向"
              />
            </div>

            <div>
              <Text type="secondary">补充备注</Text>
              <TextArea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ marginTop: 8 }}
                placeholder="例如：刚做过发布、只影响某个 AZ、业务验证点等"
              />
            </div>

            <div>
              <Text type="secondary">目标 SSH 会话</Text>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Select
                  style={{ flex: 1 }}
                  loading={loadingSessions}
                  value={selectedSessionId}
                  placeholder="选择一个已连接 SSH 会话"
                  options={sessions.map((session) => ({
                    value: session.sessionId,
                    label: `${session.username}@${session.host}`,
                  }))}
                  onChange={(value) => setSelectedSessionId(String(value))}
                />
                <Button onClick={() => void fetchSessions()}>刷新会话</Button>
              </div>
              {currentSession && (
                <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                  当前采集目标：{currentSession.username}@{currentSession.host}
                </Text>
              )}
            </div>

            <Alert
              type="info"
              showIcon
              message="编排阶段"
              description="业务脚本会先执行 before_collection，再执行远程采集，最后执行 after_collection。日志分析与报告归纳在全部动作结束后统一生成。"
            />
          </Space>
        </Card>

        <Card title="相似案例召回" extra={<RadarChartOutlined />}>
          {matches.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有预召回结果" />
          ) : (
            <List
              dataSource={matches}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="open" type="link" onClick={() => void loadRun(item.runId)}>
                      查看
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Text strong>{item.title}</Text>
                        <Tag color="geekblue">相似度 {item.score}</Tag>
                      </div>
                    }
                    description={
                      <Space direction="vertical" size={6}>
                        <Text type="secondary">{item.reportSummary || '暂无摘要'}</Text>
                        <div>
                          {item.matchedSignals?.map((signal) => (
                            <Tag key={signal}>{signal}</Tag>
                          ))}
                        </div>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="命令白名单策略"
          extra={
            <Space wrap>
              <Tag color="blue">{commandPolicy?.allowedBaseCommands?.length || 0} 条允许命令</Tag>
              <Tag color="green">服务层实时生效</Tag>
            </Space>
          }
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type="warning"
              showIcon
              message="固定安全规则仍然生效"
              description="这里仅管理基础命令白名单。危险模式拦截、只读限制和特殊命令约束仍由服务层强制执行，UI 不能关闭。"
            />

            {loadingPolicy ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Spin />
              </div>
            ) : !commandPolicy ? (
              <Alert type="error" showIcon message="未能加载命令策略" />
            ) : (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <Card size="small">
                    <Text type="secondary">当前允许命令</Text>
                    <Title level={4} style={{ margin: '8px 0 0' }}>{commandPolicy.allowedBaseCommands.length}</Title>
                  </Card>
                  <Card size="small">
                    <Text type="secondary">动态新增</Text>
                    <Title level={4} style={{ margin: '8px 0 0' }}>{commandPolicy.customAddedCommands.length}</Title>
                  </Card>
                  <Card size="small">
                    <Text type="secondary">移出默认</Text>
                    <Title level={4} style={{ margin: '8px 0 0' }}>{commandPolicy.customRemovedCommands.length}</Title>
                  </Card>
                </div>

                <div>
                  <Text type="secondary">策略存储文件</Text>
                  <div style={{ marginTop: 8 }}>
                    <Text code>{commandPolicy.storeFile || 'server/data/command-policy.json'}</Text>
                  </div>
                </div>

                <div>
                  <Text type="secondary">快速新增允许命令</Text>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <Input
                      value={newAllowedCommand}
                      onChange={(e) => setNewAllowedCommand(e.target.value)}
                      placeholder="例如 kubectl"
                      style={{ flex: 1, minWidth: 220 }}
                      onPressEnter={() => void addAllowedCommand()}
                    />
                    <Button type="primary" icon={<PlusOutlined />} loading={savingPolicy} onClick={() => void addAllowedCommand()}>
                      加入白名单
                    </Button>
                    <Button icon={<ReloadOutlined />} loading={loadingPolicy} onClick={() => void fetchCommandPolicy()}>
                      刷新策略
                    </Button>
                    <Popconfirm title="恢复默认白名单？" onConfirm={() => void resetPolicyToDefault()}>
                      <Button loading={savingPolicy}>恢复默认</Button>
                    </Popconfirm>
                  </div>
                </div>

                <div>
                  <Text type="secondary">批量编辑基础命令白名单</Text>
                  <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                    支持换行、空格或逗号分隔；保存后立即写入服务端运行策略。
                  </Text>
                  <TextArea
                    value={policyEditorValue}
                    onChange={(e) => setPolicyEditorValue(e.target.value)}
                    autoSize={{ minRows: 6, maxRows: 12 }}
                    style={{ marginTop: 8 }}
                    placeholder="一行一个命令，例如&#10;curl&#10;journalctl&#10;kubectl"
                  />
                  <div style={{ marginTop: 8 }}>
                    <Button type="primary" icon={<SaveOutlined />} loading={savingPolicy} onClick={() => void saveCommandPolicy()}>
                      保存整套白名单
                    </Button>
                  </div>
                </div>

                <div>
                  <Text type="secondary">当前允许命令</Text>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {commandPolicy.allowedBaseCommands.map((command) => (
                      <Tag
                        key={command}
                        closable
                        onClose={(event) => {
                          event.preventDefault();
                          void removeAllowedCommand(command);
                        }}
                        color={commandPolicy.customAddedCommands.includes(command) ? 'green' : 'blue'}
                        style={{ paddingInline: 10 }}
                      >
                        {command}
                      </Tag>
                    ))}
                  </div>
                </div>

                {(commandPolicy.customAddedCommands.length > 0 || commandPolicy.customRemovedCommands.length > 0) && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                    <Card size="small" title={`动态新增 (${commandPolicy.customAddedCommands.length})`}>
                      {commandPolicy.customAddedCommands.length === 0 ? (
                        <Text type="secondary">当前没有额外放开的命令</Text>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {commandPolicy.customAddedCommands.map((command) => (
                            <Tag key={command} color="green">{command}</Tag>
                          ))}
                        </div>
                      )}
                    </Card>
                    <Card size="small" title={`移出默认 (${commandPolicy.customRemovedCommands.length})`}>
                      {commandPolicy.customRemovedCommands.length === 0 ? (
                        <Text type="secondary">默认命令尚未被移除</Text>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {commandPolicy.customRemovedCommands.map((command) => (
                            <Tag key={command} color="orange">{command}</Tag>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                )}

                <div>
                  <Text type="secondary">固定安全规则（只读）</Text>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {commandPolicy.blockedRules.map((rule) => (
                      <Tag key={rule.id} color="red">
                        {rule.id}: {rule.reason}
                      </Tag>
                    ))}
                  </div>
                </div>
              </Space>
            )}
          </Space>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.1fr) minmax(360px, 0.9fr)', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <Card title="Playbook 设计" extra={<Tag color="processing">可持久化复用</Tag>}>
          {!activePlaybook ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可编辑 Playbook" />
          ) : (
            <Collapse
              defaultActiveKey={['collection', 'rules']}
              items={[
                {
                  key: 'collection',
                  label: `连接采集 Agent (${activePlaybook.collectionPlan.length})`,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      {activePlaybook.collectionPlan.map((step) => (
                        <Card
                          key={step.id}
                          size="small"
                          title={step.name}
                          extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeCollectionStep(step.id)} />}
                        >
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Input value={step.name} onChange={(e) => updateCollectionStep(step.id, { name: e.target.value })} placeholder="步骤名" />
                            <TextArea
                              value={step.command}
                              onChange={(e) => updateCollectionStep(step.id, { command: e.target.value })}
                              autoSize={{ minRows: 2, maxRows: 4 }}
                              placeholder="填写远程采集命令"
                            />
                            <Input
                              value={String(step.timeoutMs)}
                              onChange={(e) => updateCollectionStep(step.id, { timeoutMs: Number(e.target.value || 0) })}
                              placeholder="超时毫秒"
                            />
                          </Space>
                        </Card>
                      ))}
                      <Button icon={<PlusOutlined />} onClick={addCollectionStep}>添加采集步骤</Button>
                    </Space>
                  ),
                },
                {
                  key: 'rules',
                  label: `日志分析 Agent (${activePlaybook.analysisRules.length})`,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      {activePlaybook.analysisRules.map((rule) => (
                        <Card
                          key={rule.id}
                          size="small"
                          title={rule.name}
                          extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeAnalysisRule(rule.id)} />}
                        >
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Input value={rule.name} onChange={(e) => updateAnalysisRule(rule.id, { name: e.target.value })} placeholder="规则名称" />
                            <Input value={rule.pattern} onChange={(e) => updateAnalysisRule(rule.id, { pattern: e.target.value })} placeholder="正则或关键词" />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <Select
                                value={rule.source}
                                options={[
                                  { label: 'stdout + stderr', value: 'all' },
                                  { label: '仅 stdout', value: 'stdout' },
                                  { label: '仅 stderr', value: 'stderr' },
                                ]}
                                onChange={(value) => updateAnalysisRule(rule.id, { source: value as DiagnosticAnalysisRule['source'] })}
                              />
                              <Select
                                value={rule.severity}
                                options={[
                                  { label: 'Info', value: 'info' },
                                  { label: 'Warning', value: 'warning' },
                                  { label: 'Critical', value: 'critical' },
                                ]}
                                onChange={(value) => updateAnalysisRule(rule.id, { severity: value as DiagnosticAnalysisRule['severity'] })}
                              />
                            </div>
                            <Input value={rule.summary} onChange={(e) => updateAnalysisRule(rule.id, { summary: e.target.value })} placeholder="命中后的人类可读说明" />
                          </Space>
                        </Card>
                      ))}
                      <Button icon={<PlusOutlined />} onClick={addAnalysisRule}>添加分析规则</Button>
                    </Space>
                  ),
                },
                {
                  key: 'biz',
                  label: `业务测试控制 (${activePlaybook.businessActions.length})`,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Alert
                        type="warning"
                        showIcon
                        message="Python 业务脚本"
                        description="参数支持 JSON 数组或空格分隔字符串；stdin 可传入 JSON 负载。脚本路径支持绝对路径、相对 server 目录路径，或仓库根目录相对路径。"
                      />
                      {activePlaybook.businessActions.map((action) => (
                        <Card
                          key={action.id}
                          size="small"
                          title={action.name}
                          extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeBusinessAction(action.id)} />}
                        >
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Input value={action.name} onChange={(e) => updateBusinessAction(action.id, { name: e.target.value })} placeholder="动作名称" />
                            <Input value={action.scriptPath} onChange={(e) => updateBusinessAction(action.id, { scriptPath: e.target.value })} placeholder="Python 脚本路径" />
                            <Input value={action.argsText} onChange={(e) => updateBusinessAction(action.id, { argsText: e.target.value })} placeholder='例如 ["--action","health-check"]' />
                            <TextArea
                              value={action.stdinPayload}
                              onChange={(e) => updateBusinessAction(action.id, { stdinPayload: e.target.value })}
                              autoSize={{ minRows: 2, maxRows: 4 }}
                              placeholder="传给脚本 stdin 的内容，可为空"
                            />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <Select
                                value={action.runMode}
                                options={[
                                  { label: '采集前执行', value: 'before_collection' },
                                  { label: '采集后执行', value: 'after_collection' },
                                ]}
                                onChange={(value) => updateBusinessAction(action.id, { runMode: value as DiagnosticBusinessAction['runMode'] })}
                              />
                              <Input
                                value={String(action.timeoutMs)}
                                onChange={(e) => updateBusinessAction(action.id, { timeoutMs: Number(e.target.value || 0) })}
                                placeholder="超时毫秒"
                              />
                            </div>
                          </Space>
                        </Card>
                      ))}
                      <Button icon={<PlusOutlined />} onClick={addBusinessAction}>添加业务动作</Button>
                    </Space>
                  ),
                },
              ]}
            />
          )}
        </Card>

        <Card title="运行结果与知识库" extra={<HistoryOutlined />}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Text strong>最近归档</Text>
              <div style={{ marginTop: 12 }}>
                {loadingRuns ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <Spin />
                  </div>
                ) : historyRuns.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="知识库还没有历史 Run" />
                ) : (
                  <List
                    size="small"
                    dataSource={historyRuns}
                    renderItem={(run) => (
                      <List.Item
                        actions={[
                          <Button key="view" type="link" onClick={() => void loadRun(run.id)}>
                            查看详情
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <Text strong>{run.title}</Text>
                              <Tag color={statusColorMap[run.status] || 'default'}>{run.status}</Tag>
                            </div>
                          }
                          description={
                            <Space direction="vertical" size={2}>
                              <Text type="secondary">{run.summary || run.symptom}</Text>
                              <Text type="secondary">{formatTs(run.startedAt)}</Text>
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                  />
                )}
              </div>
            </div>

            {!detailRun ? (
              <Alert type="info" showIcon message="执行一次编排或点开历史 Run 后，这里会展示结构化详情。" />
            ) : (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card size="small" title={detailRun.title} extra={<Tag color={statusColorMap[detailRun.status] || 'default'}>{detailRun.status}</Tag>}>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Text type="secondary">故障现象：{detailRun.symptom}</Text>
                    <Text type="secondary">运行时间：{formatTs(detailRun.startedAt)} {detailRun.finishedAt ? `- ${formatTs(detailRun.finishedAt)}` : ''}</Text>
                    <Text type="secondary">目标会话：{detailRun.sessionLabel || '未绑定 SSH 会话'}</Text>
                  </Space>
                </Card>

                {detailRun.report && (
                  <Card size="small" title="报告归纳 Agent">
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <Alert type="success" showIcon message={detailRun.report.summary} />
                      <div>
                        <Text strong>根因假设</Text>
                        <Paragraph style={{ marginBottom: 0 }}>{detailRun.report.rootCauseHypothesis}</Paragraph>
                      </div>
                      {detailRun.report.similarCaseHint && (
                        <Text type="secondary">{detailRun.report.similarCaseHint}</Text>
                      )}
                      {detailRun.report.recommendations?.length > 0 && (
                        <div>
                          <Text strong>建议动作</Text>
                          <List
                            size="small"
                            dataSource={detailRun.report.recommendations}
                            renderItem={(item) => <List.Item>{item}</List.Item>}
                          />
                        </div>
                      )}
                      {detailRun.report.nextActions?.length > 0 && (
                        <div>
                          <Text strong>下一步</Text>
                          <List
                            size="small"
                            dataSource={detailRun.report.nextActions}
                            renderItem={(item) => <List.Item>{item}</List.Item>}
                          />
                        </div>
                      )}
                    </Space>
                  </Card>
                )}

                <Card size="small" title="日志分析 Agent Findings" extra={<Tag>{detailRun.findings?.length || 0}</Tag>}>
                  {!detailRun.findings?.length ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次未提取到明确 Finding" />
                  ) : (
                    <List
                      dataSource={detailRun.findings || []}
                      renderItem={(finding) => (
                        <List.Item>
                          <List.Item.Meta
                            title={
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Text strong>{finding.title}</Text>
                                <Tag color={severityColorMap[finding.severity] || 'default'}>{finding.severity}</Tag>
                                <Tag>{finding.sourceStepName}</Tag>
                              </div>
                            }
                            description={
                              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                <Text>{finding.summary}</Text>
                                <ResizableOutput content={finding.evidence || ''} isDark={isDark} minHeight={52} maxHeight={180} />
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  )}
                </Card>

                <Collapse
                  defaultActiveKey={['collector']}
                  items={[
                    {
                      key: 'collector',
                      label: `连接采集结果 (${detailRun.collectionSteps?.length || 0})`,
                      children: !detailRun.collectionSteps?.length ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有采集步骤结果" />
                      ) : (
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          {(detailRun.collectionSteps || []).map((step) => (
                            <Card key={step.id} size="small" title={step.name} extra={<Tag color={statusColorMap[step.status] || 'default'}>{step.status}</Tag>}>
                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Text code>{step.resolvedCommand || step.command}</Text>
                                <Text type="secondary">exit={step.exitCode} / duration={step.durationMs}ms</Text>
                                <ResizableOutput content={step.stdout || step.stderr || ''} isDark={isDark} minHeight={84} maxHeight={260} />
                                {step.stderr && (
                                  <>
                                    <Text strong>stderr</Text>
                                    <ResizableOutput content={step.stderr} isDark={isDark} minHeight={60} maxHeight={200} />
                                  </>
                                )}
                              </Space>
                            </Card>
                          ))}
                        </Space>
                      ),
                    },
                    {
                      key: 'biz-actions',
                      label: `业务脚本结果 (${detailRun.businessActions?.length || 0})`,
                      children: !detailRun.businessActions?.length ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有业务脚本执行结果" />
                      ) : (
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          {(detailRun.businessActions || []).map((action) => (
                            <Card key={action.id} size="small" title={action.name} extra={<Tag color={statusColorMap[action.status] || 'default'}>{action.status}</Tag>}>
                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Text code>{action.scriptPath}</Text>
                                <Text type="secondary">
                                  phase={action.runMode} / exit={action.exitCode} / duration={action.durationMs}ms
                                </Text>
                                <ResizableOutput content={action.stdout || action.stderr || ''} isDark={isDark} minHeight={72} maxHeight={240} />
                                {action.stdinPayload && (
                                  <>
                                    <Text strong>stdin payload</Text>
                                    <ResizableOutput content={action.stdinPayload} isDark={isDark} minHeight={52} maxHeight={180} />
                                  </>
                                )}
                              </Space>
                            </Card>
                          ))}
                        </Space>
                      ),
                    },
                  ]}
                />
              </Space>
            )}
          </Space>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Alert
          type="warning"
          showIcon
          icon={<ThunderboltOutlined />}
          message="MVP 范围说明"
          description="当前实现采用本地 JSON 知识库和可解释关键词召回，不依赖外部向量库或大模型；重点是先把每次 run 的结构化沉淀和编排闭环跑通。"
        />
      </div>
    </div>
  );
};

export default DiagnosticWorkbench;
