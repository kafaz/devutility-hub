import {
    AlertOutlined, BugOutlined,
    ClockCircleOutlined, DeleteOutlined,
    PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, SyncOutlined, ThunderboltOutlined
} from '@ant-design/icons';
import {
    Badge, Button, Card, Checkbox, Col, Collapse, Form, Input, InputNumber,
    Modal, Radio, Row, Select, Space, Tag,
    Typography,
    message,
    notification
} from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBackgroundJobStore, type BackgroundJob, type JobMode } from '../store/backgroundJobStore';
import { useSSHStore } from '../store/sshStore';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;
const { TextArea } = Input;

// ────────────────────────────────────────────────────────────
// Preset Templates
// ────────────────────────────────────────────────────────────
interface JobPreset {
  key: string;
  label: string;
  icon: React.ReactNode;
  cmd: string;
  mode: JobMode;
  watchInterval: number;
  alertPattern?: string;
  alertLabel?: string;
  description: string;
}

const PRESETS: JobPreset[] = [
  {
    key: 'stuck_io',
    label: '卡IO 多节点嗅探',
    icon: <AlertOutlined />,
    // Shell-side detection: only emit lines when util>5% AND r/s<0.1 AND w/s<0.1
    // iostat -xd 2: extended stats, disk only, 2s interval
    cmd: `iostat -xd 2 | awk '
/^Device/ { header=1; next }
header && NF >= 14 {
  dev=$1; rs=$2; ws=$8; util=$NF
  if (util+0 > 5 && rs+0 < 0.1 && ws+0 < 0.1)
    printf "[%s] STUCK_IO dev=%s util=%.1f%% r/s=%.2f w/s=%.2f\\n",
      strftime("%H:%M:%S"), dev, util+0, rs+0, ws+0
}'`,
    mode: 'once',
    watchInterval: 2,
    alertPattern: 'STUCK_IO',
    alertLabel: '🚨 卡IO 检测到！',
    description: '持续采集 iostat -xd 2，仅当 %util > 5% 且 r/s/w/s ≈ 0 时才记录告警行（Shell AWK 过滤，日志零噪音）。',
  },
  {
    key: 'tail_log',
    label: '长尾日志追踪',
    icon: <BugOutlined />,
    cmd: 'tail -f /var/log/syslog',
    mode: 'once',
    watchInterval: 2,
    alertPattern: 'ERROR|FATAL|PANIC|OOM',
    alertLabel: '⚠️ 日志异常行',
    description: '持续追踪系统日志，ERROR/FATAL/PANIC/OOM 关键字自动触发告警。',
  },
  {
    key: 'periodic_iostat',
    label: '周期 iostat 全盘报告',
    icon: <ThunderboltOutlined />,
    cmd: 'iostat -xd',
    mode: 'watch',
    watchInterval: 10,
    description: '每 10 秒抓取一次全盘 IO 报告，持续记录到日志以供事后回溯。',
  },
];

const TAIL_INTERVAL_MS = 2000;
const TAIL_LINES = 200;

const statusColor: Record<BackgroundJob['status'], any> = {
  launching: 'processing', running: 'success', done: 'default', killed: 'warning', error: 'error',
};
const statusLabel: Record<BackgroundJob['status'], string> = {
  launching: '启动中', running: '运行中', done: '已完成', killed: '已终止', error: '异常',
};

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

// Render log with alert lines highlighted red
function renderLog(output: string, alertPattern?: string): React.ReactNode {
  if (!alertPattern || !output) {
    return <span style={{ color: '#e6edf3' }}>{output || '（无输出）'}</span>;
  }
  let re: RegExp;
  try { re = new RegExp(alertPattern, 'i'); } catch { return output; }

  return (
    <>
      {output.split('\n').map((line, i) => (
        <span
          key={i}
          style={{ color: re.test(line) ? '#ff6b6b' : '#e6edf3', display: 'block' }}
        >
          {line || ' '}
        </span>
      ))}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────
export const BackgroundJobMonitor: React.FC = () => {
  const { jobs, createJob, killJob, removeJob, updateJobOutput, updateJobStatus, recordAlertMatch } = useBackgroundJobStore();
  const { sessions, execCommandOnSession } = useSSHStore();
  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<JobPreset | null>(null);
  const [presetSelectedSessions, setPresetSelectedSessions] = useState<string[]>([]);
  const [form] = Form.useForm();
  const pollingRef = useRef<number | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set()); // track per-job notifications

  const connectedSessions = sessions.filter(s => s.status === 'connected');

  // ── Live tail + alert detection ──────────────────────────────
  const pollJobs = useCallback(async () => {
    const runningJobs = useBackgroundJobStore.getState().jobs.filter(
      j => j.status === 'running' || j.status === 'launching'
    );

    for (const job of runningJobs) {
      try {
        if (job.pid) {
          const aliveRes = await execCommandOnSession(
            job.sessionId,
            `kill -0 ${job.pid} 2>/dev/null && echo alive || echo dead`,
            3000,
            { journal: false }
          );
          if (aliveRes.stdout.trim() === 'dead') {
            updateJobStatus(job.id, 'done');
            continue;
          }
        }

        const tailRes = await execCommandOnSession(
          job.sessionId,
          `tail -n ${TAIL_LINES} "${job.logPath}" 2>/dev/null`,
          4000,
          { journal: false }
        );
        const output = tailRes.stdout || '（无输出）';
        updateJobOutput(job.id, output);

        // Alert pattern detection
        if (job.alertPattern) {
          let re: RegExp;
          try { re = new RegExp(job.alertPattern, 'im'); } catch { continue; }

          const newLines = output.split('\n').filter(l => re.test(l));
          if (newLines.length > 0) {
            const lastLine = newLines[newLines.length - 1];
            recordAlertMatch(job.id, lastLine);

            // Fire notification (throttle: once per unique line content)
            const notifKey = `${job.id}::${lastLine}`;
            if (!notifiedRef.current.has(notifKey)) {
              notifiedRef.current.add(notifKey);
              // Limit set size
              if (notifiedRef.current.size > 200) {
                const first = notifiedRef.current.values().next().value;
                if (first) notifiedRef.current.delete(first);
              }
              notification.error({
                message: `${job.sessionName} — 告警命中`,
                description: lastLine,
                duration: 8,
                placement: 'topRight',
                key: notifKey,
              });
            }
          }
        }
      } catch {
        // Session may have disconnected
      }
    }
  }, [execCommandOnSession, updateJobOutput, updateJobStatus, recordAlertMatch]);

  useEffect(() => {
    pollingRef.current = window.setInterval(pollJobs, TAIL_INTERVAL_MS);
    return () => { if (pollingRef.current !== null) clearInterval(pollingRef.current); };
  }, [pollJobs]);

  // ── Handlers ─────────────────────────────────────────────────
  const handleLaunch = async () => {
    try {
      const vals = await form.validateFields();
      const sess = sessions.find(s => s.id === vals.sessionId);
      if (!sess) { message.error('请选择有效的 SSH 会话'); return; }

      await createJob(
        { sessionId: vals.sessionId, sessionName: sess.name, cmd: vals.cmd, mode: vals.mode, watchInterval: vals.watchInterval ?? 2, alertPattern: vals.alertPattern },
        execCommandOnSession
      );
      message.success('后台任务已提交！');
      setLaunchModalOpen(false);
      form.resetFields();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('启动失败：' + e.message);
    }
  };

  const handlePresetLaunch = async () => {
    if (!activePreset || presetSelectedSessions.length === 0) {
      message.warning('请至少选择一个目标节点'); return;
    }
    let success = 0;
    for (const sessId of presetSelectedSessions) {
      const sess = sessions.find(s => s.id === sessId);
      if (!sess) continue;
      await createJob(
        { sessionId: sessId, sessionName: sess.name, cmd: activePreset.cmd, mode: activePreset.mode, watchInterval: activePreset.watchInterval, alertPattern: activePreset.alertPattern },
        execCommandOnSession
      );
      success++;
    }
    message.success(`已在 ${success} 个节点上启动「${activePreset.label}」`);
    setPresetModalOpen(false);
    setPresetSelectedSessions([]);
  };

  const handleKill = async (id: string) => {
    await killJob(id, execCommandOnSession);
    message.warning('任务已发送终止信号。');
  };

  // ── Render ────────────────────────────────────────────────────
  const runningCount = jobs.filter(j => j.status === 'running').length;
  const totalAlerts = jobs.reduce((a, j) => a + j.alertCount, 0);

  return (
    <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Text strong>后台任务监控</Text>
          {runningCount > 0 && <Badge count={runningCount} style={{ background: '#22c55e' }} />}
          {totalAlerts > 0 && <Badge count={totalAlerts} style={{ background: '#ef4444' }} title="告警命中次数" />}
        </Space>
        <Space>
          <Tag icon={<SyncOutlined spin={runningCount > 0} />} color={runningCount > 0 ? 'green' : 'default'}>
            {runningCount > 0 ? '实时追踪中' : '空闲'}
          </Tag>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => setPresetModalOpen(true)}
            disabled={connectedSessions.length === 0}
          >
            快速预设
          </Button>
          <Button
            type="primary" size="small" icon={<PlusOutlined />}
            onClick={() => setLaunchModalOpen(true)}
            disabled={connectedSessions.length === 0}
          >
            自定义任务
          </Button>
        </Space>
      </div>

      {/* Job List */}
      {jobs.length === 0 ? (
        <Card size="small" style={{ textAlign: 'center', padding: '32px 0' }}>
          <BugOutlined style={{ fontSize: 32, opacity: 0.3 }} /><br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            点击「快速预设」一键启动多节点卡IO检测，或「自定义任务」配置任意后台命令。
          </Text>
        </Card>
      ) : (
        <Collapse size="small">
          {jobs.map(job => (
            <Panel
              key={job.id}
              header={
                <Row align="middle" gutter={8}>
                  <Col flex="none"><Badge status={statusColor[job.status]} text={statusLabel[job.status]} /></Col>
                  <Col flex="auto">
                    <Text ellipsis style={{ maxWidth: 250, display: 'inline-block', fontSize: 12 }}>
                      {job.sessionName}: <code>{job.cmd.slice(0, 60)}{job.cmd.length > 60 ? '…' : ''}</code>
                    </Text>
                  </Col>
                  <Col flex="none">
                    <Space size={4}>
                      {job.alertCount > 0 && (
                        <Tag color="error" icon={<AlertOutlined />} style={{ fontSize: 11 }}>
                          告警 ×{job.alertCount}
                        </Tag>
                      )}
                      <Tag icon={<ClockCircleOutlined />} color="blue" style={{ fontSize: 11 }}>
                        {job.mode === 'watch' ? `watch -n ${job.watchInterval}s` : 'once'}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {formatDuration(Date.now() - job.startedAt)}
                      </Text>
                    </Space>
                  </Col>
                </Row>
              }
              extra={
                <Space size={4} onClick={e => e.stopPropagation()}>
                  {(job.status === 'running' || job.status === 'launching') && (
                    <Button size="small" danger icon={<PauseCircleOutlined />} onClick={() => handleKill(job.id)}>
                      终止
                    </Button>
                  )}
                  <Button size="small" icon={<DeleteOutlined />} onClick={() => removeJob(job.id)} disabled={job.status === 'running'}>
                    移除
                  </Button>
                </Space>
              }
            >
              {/* Alert lines summary */}
              {job.alertLines.length > 0 && (
                <div style={{ background: '#2d1515', border: '1px solid #7f1d1d', borderRadius: 4, padding: '6px 10px', marginBottom: 8 }}>
                  <Text style={{ color: '#fca5a5', fontSize: 11 }}>
                    <AlertOutlined /> 最近告警（{job.alertLines.length} 条）:
                  </Text>
                  {job.alertLines.slice(-5).map((l, i) => (
                    <div key={i} style={{ color: '#ff6b6b', fontSize: 11, fontFamily: 'monospace' }}>{l}</div>
                  ))}
                </div>
              )}

              {/* Live log */}
              <pre style={{
                background: '#0d1117', color: '#e6edf3', padding: '10px 12px', borderRadius: 6,
                fontSize: 11, fontFamily: 'JetBrains Mono, Fira Code, monospace',
                maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
              }}>
                {renderLog(job.output, job.alertPattern)}
              </pre>
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 10 }}>
                  PID: {job.pid ?? '—'} · {job.logPath} · 1GB 限额自动截断
                  {job.alertPattern && ` · 告警规则: /${job.alertPattern}/`}
                </Text>
              </div>
            </Panel>
          ))}
        </Collapse>
      )}

      {/* ── Preset Modal ──────────────────────────────────────── */}
      <Modal
        title={<Space><ThunderboltOutlined /> 快速预设检测任务</Space>}
        open={presetModalOpen}
        onOk={handlePresetLaunch}
        onCancel={() => setPresetModalOpen(false)}
        okText="一键启动到选中节点"
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Row gutter={[10, 10]}>
            {PRESETS.map(p => (
              <Col span={24} key={p.key}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => setActivePreset(p)}
                  style={{ border: activePreset?.key === p.key ? '1.5px solid #3b82f6' : undefined, cursor: 'pointer' }}
                >
                  <Space>
                    {p.icon}
                    <Text strong>{p.label}</Text>
                    {p.alertPattern && <Tag color="error" icon={<AlertOutlined />}>告警: {p.alertLabel}</Tag>}
                  </Space>
                  <Paragraph type="secondary" style={{ fontSize: 11, margin: '4px 0 0' }}>{p.description}</Paragraph>
                  <pre style={{ fontSize: 10, color: '#6b7280', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f5f5f5', borderRadius: 3, padding: '4px 6px' }}>
                    {p.cmd.slice(0, 120)}{p.cmd.length > 120 ? '…' : ''}
                  </pre>
                </Card>
              </Col>
            ))}
          </Row>

          {activePreset && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>选择目标节点（可多选）：</Text>
              <Checkbox.Group
                style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}
                options={connectedSessions.map(s => ({ label: s.name, value: s.id }))}
                value={presetSelectedSessions}
                onChange={v => setPresetSelectedSessions(v as string[])}
              />
            </div>
          )}
        </Space>
      </Modal>

      {/* ── Custom Launch Modal ───────────────────────────────── */}
      <Modal
        title={<Space><PlayCircleOutlined /> 新建自定义后台任务</Space>}
        open={launchModalOpen}
        onOk={handleLaunch}
        onCancel={() => setLaunchModalOpen(false)}
        okText="提交到后台"
        width={560}
      >
        <Form form={form} layout="vertical" initialValues={{ mode: 'once', watchInterval: 2 }}>
          <Form.Item label="目标 SSH 会话" name="sessionId" rules={[{ required: true }]}>
            <Select placeholder="选择已连接的节点" options={connectedSessions.map(s => ({ label: s.name, value: s.id }))} />
          </Form.Item>
          <Form.Item label="执行命令" name="cmd" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="iostat -xd 2 | awk '...'" style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
          <Form.Item label="执行模式" name="mode">
            <Radio.Group buttonStyle="solid">
              <Radio.Button value="once"><PlayCircleOutlined /> 长时间单次</Radio.Button>
              <Radio.Button value="watch"><SyncOutlined /> 周期重复 (watch)</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.mode !== c.mode}>
            {({ getFieldValue }) => getFieldValue('mode') === 'watch' ? (
              <Form.Item label="执行间隔（秒）" name="watchInterval">
                <InputNumber min={1} max={3600} style={{ width: 120 }} addonAfter="秒" />
              </Form.Item>
            ) : null}
          </Form.Item>
          <Form.Item label="告警正则（可选）" name="alertPattern" extra="匹配到该模式的日志行将触发页面顶部红色 Notification，并在任务栏显示告警次数。例如: STUCK_IO">
            <Input placeholder="STUCK_IO|ERROR|FATAL" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default BackgroundJobMonitor;
