/**
 * SOPScheduler — 定时任务管理页
 *
 * 布局：
 *   左侧（340px）任务列表
 *     - 每卡片：名称、Cron 描述、模式标签、上次/下次执行时间、启用开关、操作按钮
 *   右侧 执行日志流
 *     - 筛选 + 滚动展示最近 200 条执行记录
 *     - 每条记录按节点展开各步骤汇总
 *
 * 调度器激活时右上角显示「调度中」Badge；
 * 浏览器标签关闭/后台休眠时调度暂停，激活时自动恢复。
 */
import React, { useState } from 'react';
import {
  Typography, Button, Space, Card, Tag, Badge, Switch, Tooltip,
  Popconfirm, Empty, Select, message, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ClockCircleOutlined,
  PlayCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  CloseCircleOutlined, MinusCircleOutlined, SyncOutlined, HistoryOutlined,
} from '@ant-design/icons';
import { useSchedulerStore } from './store/schedulerStore';
import { useSSHStore }       from '../SSHManager/store/sshStore';
import { useSOPStore }       from '../SOPBuilder/store/sopStore';
import { useGlobalStore }    from '../../store/globalStore';
import TaskEditor            from './components/TaskEditor';
import type { SOPScheduledTask, SOPScheduleRunLog } from '../../types';
import { getCronDescription, getNextCronRun, generateId } from '../../utils';

const { Title, Text } = Typography;

// ─── 常量 ────────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, React.ReactNode> = {
  running:  <SyncOutlined spin  style={{ color: '#3b82f6' }} />,
  success:  <CheckCircleOutlined      style={{ color: '#22c55e' }} />,
  partial:  <ExclamationCircleOutlined style={{ color: '#eab308' }} />,
  failed:   <CloseCircleOutlined      style={{ color: '#ef4444' }} />,
  skipped:  <MinusCircleOutlined      style={{ color: '#a1a1aa' }} />,
};

const STATUS_LABEL: Record<string, string> = {
  running: '执行中', success: '成功', partial: '部分成功', failed: '失败', skipped: '已跳过',
};

const STATUS_COLOR: Record<string, string> = {
  running: 'processing', success: 'success', partial: 'warning', failed: 'error',
};

// ─── 辅助：格式化时间 ─────────────────────────────────────────────────────────

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function fmtDuration(start: number, end?: number): string {
  if (!end) return '—';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── RunLog 卡片 ──────────────────────────────────────────────────────────────

const RunLogCard: React.FC<{ log: SOPScheduleRunLog; isDark: boolean }> = ({ log, isDark }) => {
  const cardBg = isDark ? '#2d2d30' : '#fafafa';

  return (
    <Card
      size="small"
      style={{ background: cardBg, marginBottom: 8 }}
      bodyStyle={{ padding: '8px 12px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <Space size={6}>
            {STATUS_ICON[log.status]}
            <Text strong style={{ fontSize: 13 }}>{log.taskName}</Text>
            <Tag color={STATUS_COLOR[log.status] ?? 'default'} style={{ fontSize: 10 }}>
              {STATUS_LABEL[log.status]}
            </Tag>
            <Tag color={log.mode === 'broadcast' ? 'blue' : 'purple'} style={{ fontSize: 10 }}>
              {log.mode === 'broadcast' ? '广播' : '独立'}
            </Tag>
          </Space>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmtTime(log.startedAt)}
              {log.finishedAt && ` · 耗时 ${fmtDuration(log.startedAt, log.finishedAt)}`}
            </Text>
          </div>
        </div>
      </div>

      {/* 节点结果列表 */}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {log.nodeResults.map((nr) => (
          <div
            key={nr.sessionId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 6px',
              background: isDark ? '#1e1e1e' : '#f4f4f5',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {STATUS_ICON[nr.status]}
            <Text style={{ fontSize: 12, flex: 1 }}>{nr.sessionName}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{nr.templateName}</Text>
            {nr.stepsTotal > 0 && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {nr.stepsTotal - nr.stepsFailed}/{nr.stepsTotal} 步通过
              </Text>
            )}
            {nr.error && (
              <Tooltip title={nr.error}>
                <ExclamationCircleOutlined style={{ color: '#ef4444' }} />
              </Tooltip>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const SOPScheduler: React.FC = () => {
  const { theme }   = useGlobalStore();
  const isDark      = theme === 'dark';
  const cardBg      = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const {
    tasks, runLogs,
    addTask, updateTask, deleteTask, toggleTask, clearRunLogs,
  } = useSchedulerStore();
  const { sessions } = useSSHStore();
  const { templates } = useSOPStore();

  const [messageApi, contextHolder] = message.useMessage();
  const [editorOpen,    setEditorOpen]    = useState(false);
  const [editingTask,   setEditingTask]   = useState<SOPScheduledTask | null>(null);
  const [filterTaskId,  setFilterTaskId]  = useState<string | null>(null);

  const enabledCount = tasks.filter((t) => t.enabled).length;

  // 过滤日志
  const filteredLogs = filterTaskId
    ? runLogs.filter((l) => l.taskId === filterTaskId)
    : runLogs;

  // 立即执行（手动触发，忽略 cron）
  const handleRunNow = async (task: SOPScheduledTask) => {
    const { executeSOPPlanForScheduler } = useSSHStore.getState();
    const { updateTask: ut, addRunLog, updateRunLog } = useSchedulerStore.getState();

    messageApi.open({ type: 'loading', content: `「${task.name}」执行中…`, key: task.id, duration: 0 });

    // 与 useScheduler.executeTask 相同的逻辑，直接内联触发
    const assignments = task.mode === 'broadcast'
      ? (task.broadcastSessionIds ?? []).map((sid) => ({
          sessionId: sid, templateId: task.broadcastTemplateId ?? '',
          varValues: task.broadcastVarValues ?? {},
        }))
      : (task.nodeAssignments ?? []).map((a) => ({
          sessionId: a.sessionId, templateId: a.templateId, varValues: a.varValues ?? {},
        }));

    const runId = generateId();
    const runLog: SOPScheduleRunLog = {
      id: runId, taskId: task.id, taskName: task.name,
      startedAt: Date.now(), mode: task.mode,
      nodeResults: assignments.map((a) => {
        const sess = sessions.find((s) => s.id === a.sessionId);
        const tmpl = templates.find((t) => t.id === a.templateId);
        return {
          sessionId: a.sessionId, sessionName: sess?.name ?? a.sessionId,
          templateId: a.templateId, templateName: tmpl?.name ?? '—',
          status: 'running' as const, stepsTotal: tmpl?.checks?.length ?? 0, stepsFailed: 0,
        };
      }),
      status: 'running',
    };
    addRunLog(runLog);

    const { buildPlanStepsFromTemplate } = await import('../../utils');
    const results = await Promise.allSettled(
      assignments.map(async (a) => {
        const sess = sessions.find((s) => s.id === a.sessionId);
        if (!sess || sess.status !== 'connected')
          return { sessionId: a.sessionId, status: 'skipped' as const, error: '未连接', stepsTotal: 0, stepsFailed: 0 };
        const tmpl = templates.find((t) => t.id === a.templateId);
        if (!tmpl)
          return { sessionId: a.sessionId, status: 'failed' as const, error: '模板不存在', stepsTotal: 0, stepsFailed: 0 };
        const steps = buildPlanStepsFromTemplate(tmpl, a.varValues);
        const r = await executeSOPPlanForScheduler(a.sessionId, steps);
        const failed = Object.values(r.results).filter((x) => x.status === 'failed').length;
        return {
          sessionId: a.sessionId,
          status: (r.success && failed === 0 ? 'success' : r.success ? 'partial' : 'failed') as SOPScheduleRunLog['nodeResults'][0]['status'],
          stepsTotal: steps.length, stepsFailed: failed, error: r.error,
        };
      })
    );

    const nodeResults = runLog.nodeResults.map((nr, i) => {
      const s = results[i];
      return s.status === 'fulfilled' ? { ...nr, ...s.value } : { ...nr, status: 'failed' as const, error: String(s.reason) };
    });
    const overall: SOPScheduleRunLog['status'] =
      nodeResults.every((r) => r.status === 'success' || r.status === 'skipped') ? 'success'
      : nodeResults.some((r) => r.status === 'success') ? 'partial' : 'failed';

    updateRunLog(runId, { finishedAt: Date.now(), nodeResults, status: overall });
    ut(task.id, { lastRunAt: Date.now(), lastRunStatus: overall });
    messageApi.open({ type: overall === 'success' ? 'success' : 'warning',
      content: `「${task.name}」执行完成（${STATUS_LABEL[overall]}）`, key: task.id });
  };

  const handleEditorOk = (data: Omit<SOPScheduledTask, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingTask) {
      updateTask(editingTask.id, data);
      messageApi.success('任务已更新');
    } else {
      addTask(data);
      messageApi.success('定时任务已创建');
    }
    setEditorOpen(false);
  };

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}

      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Space size={8}>
            <Title level={4} style={{ margin: 0 }}>SOP 定时调度</Title>
            {enabledCount > 0 ? (
              <Badge status="processing" text={<Text type="secondary" style={{ fontSize: 12 }}>调度运行中（{enabledCount} 个任务）</Text>} />
            ) : (
              <Badge status="default" text={<Text type="secondary" style={{ fontSize: 12 }}>暂无启用任务</Text>} />
            )}
          </Space>
          <div style={{ marginTop: 2 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              基于 Cron 表达式对指定节点定时执行 SOP · 浏览器页面保持打开时持续调度
            </Text>
          </div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { setEditingTask(null); setEditorOpen(true); }}
        >
          新建任务
        </Button>
      </div>

      {sessions.filter((s) => s.status !== 'connected').length === sessions.length && sessions.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="当前无已连接的 SSH 会话，定时任务执行时将被标记为跳过"
          style={{ marginBottom: 16 }}
          closable
        />
      )}

      {/* 两栏布局 */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>

        {/* 左栏：任务列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.length === 0 ? (
            <Card style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
              <Empty description="暂无定时任务" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingTask(null); setEditorOpen(true); }}>
                  创建第一个任务
                </Button>
              </Empty>
            </Card>
          ) : (
            tasks.map((task) => {
              const nextRun = task.enabled ? getNextCronRun(task.cronExpr) : null;
              const tmplCount = task.mode === 'broadcast'
                ? 1
                : new Set((task.nodeAssignments ?? []).map((a) => a.templateId)).size;
              const nodeCount = task.mode === 'broadcast'
                ? (task.broadcastSessionIds?.length ?? 0)
                : (task.nodeAssignments?.length ?? 0);

              return (
                <Card
                  key={task.id}
                  size="small"
                  style={{
                    background: cardBg,
                    border: `1px solid ${task.enabled ? '#3b82f6' : borderColor}`,
                    opacity: task.enabled ? 1 : 0.7,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ fontSize: 13 }}>{task.name}</Text>
                      <div style={{ marginTop: 4 }}>
                        <Space size={4} wrap>
                          <Tag color={task.mode === 'broadcast' ? 'blue' : 'purple'} style={{ fontSize: 10 }}>
                            {task.mode === 'broadcast' ? '广播' : '独立'}
                          </Tag>
                          <Tag style={{ fontSize: 10, fontFamily: 'monospace' }}>{task.cronExpr}</Tag>
                          <Tag style={{ fontSize: 10 }} color="cyan">{nodeCount} 节点</Tag>
                          {tmplCount > 1 && <Tag style={{ fontSize: 10 }}>{tmplCount} 模板</Tag>}
                        </Space>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {getCronDescription(task.cronExpr)}
                        </Text>
                      </div>
                      <div style={{ marginTop: 2 }}>
                        {task.lastRunAt && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            上次：{fmtTime(task.lastRunAt)}
                            {task.lastRunStatus && (
                              <span style={{ marginLeft: 4 }}>
                                {STATUS_ICON[task.lastRunStatus]}
                              </span>
                            )}
                          </Text>
                        )}
                      </div>
                      {nextRun && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            <ClockCircleOutlined style={{ marginRight: 4 }} />
                            下次：{fmtTime(nextRun.getTime())}
                          </Text>
                        </div>
                      )}
                    </div>
                    {/* 操作按钮 */}
                    <Space direction="vertical" size={4} style={{ marginLeft: 8 }}>
                      <Switch
                        size="small"
                        checked={task.enabled}
                        onChange={() => toggleTask(task.id)}
                      />
                      <Tooltip title="立即执行">
                        <Button
                          size="small"
                          icon={<PlayCircleOutlined />}
                          onClick={() => handleRunNow(task)}
                        />
                      </Tooltip>
                      <Tooltip title="编辑">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => { setEditingTask(task); setEditorOpen(true); }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="删除此任务？"
                        description="相关执行记录也会一并删除"
                        onConfirm={() => { deleteTask(task.id); messageApi.success('已删除'); }}
                        okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        {/* 右栏：执行日志 */}
        <div>
          <Card
            title={
              <Space>
                <HistoryOutlined />
                执行记录
                <Tag>{runLogs.length} 条</Tag>
              </Space>
            }
            extra={
              <Space>
                <Select
                  size="small"
                  style={{ width: 160 }}
                  placeholder="筛选任务"
                  allowClear
                  value={filterTaskId || undefined}
                  onChange={(v) => setFilterTaskId(v ?? null)}
                  options={[...new Set(runLogs.map((l) => l.taskId))].map((id) => {
                    const t   = tasks.find((x) => x.id === id);
                    const log = runLogs.find((l) => l.taskId === id);
                    return { label: t?.name ?? log?.taskName ?? id, value: id };
                  })}
                />
                <Tooltip title="清空记录">
                  <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled={runLogs.length === 0}
                    onClick={() => { clearRunLogs(filterTaskId ?? undefined); messageApi.success('记录已清空'); }}
                  />
                </Tooltip>
              </Space>
            }
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            {filteredLogs.length === 0 ? (
              <Empty description="暂无执行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
                {filteredLogs.map((log) => (
                  <RunLogCard key={log.id} log={log} isDark={isDark} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* 任务编辑弹窗 */}
      <TaskEditor
        open={editorOpen}
        initial={editingTask}
        onOk={handleEditorOk}
        onCancel={() => setEditorOpen(false)}
      />
    </div>
  );
};

export default SOPScheduler;
