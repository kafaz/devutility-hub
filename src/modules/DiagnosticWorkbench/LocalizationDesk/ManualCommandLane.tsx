import { Alert, Button, Empty, Input, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';

import type { ManualCommandRun } from './useManualCommandRuns.ts';

const { Text, Paragraph } = Typography;

interface ManualCommandLaneProps {
  selectedSessionId?: string;
  runs: ManualCommandRun[];
  running?: boolean;
  errorMessage?: string | null;
  onRunCommand?(command: string): Promise<void>;
  onSendToWhiteboard?(run: ManualCommandRun): void;
}

function renderOutput(label: string, value: string, tone: 'default' | 'danger' = 'default') {
  return (
    <div>
      <Text strong>{label}</Text>
      <pre
        style={{
          margin: '8px 0 0',
          padding: 12,
          borderRadius: 8,
          background: tone === 'danger' ? '#fff2f0' : '#0f172a',
          color: tone === 'danger' ? '#a61d24' : '#dbeafe',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 220,
          overflow: 'auto',
        }}
      >
        {value}
      </pre>
    </div>
  );
}

export default function ManualCommandLane(props: ManualCommandLaneProps) {
  const [commandDraft, setCommandDraft] = useState('');

  useEffect(() => {
    setCommandDraft('');
  }, [props.selectedSessionId]);

  const trimmedCommand = commandDraft.trim();
  const canRun = Boolean(props.selectedSessionId && trimmedCommand && props.onRunCommand && !props.running);

  return (
    <section className="diagnostic-localization-desk__lane" aria-label="ManualCommandLane">
      <header className="diagnostic-localization-desk__lane-header">
        <h3>ManualCommandLane</h3>
        <Tag color={props.selectedSessionId ? 'processing' : 'default'}>
          {props.selectedSessionId || '未选择会话'}
        </Tag>
      </header>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {!props.selectedSessionId ? (
          <Alert
            type="info"
            showIcon
            message="先选择一个会话，再手动下发命令。"
            description="这里不会自动推荐或自动执行命令，只复用当前 SSH 会话的 PTY 上下文。"
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="命令执行会复用当前 Shell PTY。"
            description="sudo、cd、source 等上下文都会沿用现有会话状态，失败结果会直接保留在本地工作面。"
          />
        )}

        {props.errorMessage ? (
          <Alert type="error" showIcon message="命令执行失败" description={props.errorMessage} />
        ) : null}

        <div>
          <Text type="secondary">手动命令</Text>
          <Input.TextArea
            value={commandDraft}
            onChange={(event) => setCommandDraft(event.target.value)}
            placeholder={props.selectedSessionId ? '例如：tail -n 200 /var/log/messages' : '选择会话后才能编辑命令'}
            autoSize={{ minRows: 3, maxRows: 6 }}
            disabled={!props.selectedSessionId || props.running}
            style={{ marginTop: 8 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            仅在你点击执行时发往现有会话命令通道，不额外创建并行执行系统。
          </Paragraph>
          <Button
            type="primary"
            onClick={async () => {
              if (!canRun || !props.onRunCommand) return;
              await props.onRunCommand(trimmedCommand);
              setCommandDraft('');
            }}
            loading={props.running}
            disabled={!canRun}
          >
            执行手动命令
          </Button>
        </div>

        {props.runs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={props.selectedSessionId ? '手动命令记录会显示在这里' : '选择会话后才能开始记录手动命令'}
          />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {props.runs.map((run) => (
              <article
                key={run.id}
                style={{
                  border: '1px solid rgba(148, 163, 184, 0.28)',
                  borderRadius: 10,
                  padding: 12,
                  background: 'rgba(15, 23, 42, 0.02)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text code>{run.command}</Text>
                      <Space size={8} wrap>
                    {props.onSendToWhiteboard ? (
                      <Button size="small" onClick={() => props.onSendToWhiteboard?.(run)}>
                        发送到白板
                      </Button>
                    ) : null}
                    <Tag color={run.exitCode === 0 ? 'success' : 'error'}>exit {run.exitCode ?? '-'}</Tag>
                    <Tag>{run.durationMs} ms</Tag>
                  </Space>
                </div>
                <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 12 }}>
                  {run.stdout ? renderOutput('stdout', run.stdout) : null}
                  {run.stderr ? renderOutput('stderr', run.stderr, 'danger') : null}
                  {!run.stdout && !run.stderr ? (
                    <Text type="secondary">该命令没有返回 stdout/stderr 输出。</Text>
                  ) : null}
                </Space>
              </article>
            ))}
          </Space>
        )}
      </Space>
    </section>
  );
}
