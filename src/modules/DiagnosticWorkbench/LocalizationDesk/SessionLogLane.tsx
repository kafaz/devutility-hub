import {
  CodeOutlined,
  PushpinOutlined,
  ProfileOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';

import ResizableOutput from '../../../components/shared/ResizableOutput';
import {
  extractCLookupHints,
  type FunctionCandidateToken,
} from '../../../utils/sourceLookupHints';

import type {
  LocalizationDeskSessionLogItem,
  LocalizationDeskSourceLocatePreferred,
  LocalizationDeskSourceLocateRequest,
  LogContextWindow,
} from './types.ts';

const { Text } = Typography;

function buildLookupText(parts: Array<string | undefined>) {
  return parts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

function clipText(value: string | undefined, limit = 120) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function formatTs(ts?: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

export interface SessionLogLaneProps {
  sessionLogs: LocalizationDeskSessionLogItem[];
  selectedSessionId?: string;
  currentSessionLabel?: string;
  loading?: boolean;
  evidenceCount?: number;
  isDark?: boolean;
  currentAnchorLogId?: string | null;
  logContextWindow: LogContextWindow;
  onSelectAnchor?(logId: string): void;
  onExpandBefore?(): void;
  onExpandAfter?(): void;
  onOpenRawLogs(): void;
  onOpenEvidenceBasket(): void;
  onLockEvidence?(log: LocalizationDeskSessionLogItem): void;
  onSendToWhiteboard?(log: LocalizationDeskSessionLogItem): void;
  onLocateSource(
    request: LocalizationDeskSourceLocateRequest,
    preferred?: LocalizationDeskSourceLocatePreferred
  ): void;
  canLocateSource?(lookupText: string): boolean;
}

function renderNavigatorSummary(log: LocalizationDeskSessionLogItem) {
  return clipText(log.message || log.cmd || log.stderr || log.stdout, 88) || '当前日志没有可预览的文本字段';
}

function buildSessionLogSourceRequest(
  item: LocalizationDeskSessionLogItem,
  lookupText: string
): LocalizationDeskSourceLocateRequest {
  return {
    title: `会话日志: ${item.type}`,
    summary: item.message || `exit=${item.exitCode ?? '-'} / duration=${item.durationMs ?? '-'}ms`,
    sourceType: 'session_log',
    text: lookupText,
    parts: [item.type, item.message, item.stdout, item.stderr],
    command: item.cmd,
  };
}

export default function SessionLogLane(props: SessionLogLaneProps) {
  const anchorLog = props.sessionLogs.find((item) => item.id === props.currentAnchorLogId) || props.sessionLogs.at(-1) || null;
  const anchorIndex = anchorLog ? props.sessionLogs.findIndex((item) => item.id === anchorLog.id) : -1;
  const contextStart = anchorIndex >= 0 ? Math.max(0, anchorIndex - props.logContextWindow.before) : 0;
  const contextEnd = anchorIndex >= 0 ? Math.min(props.sessionLogs.length, anchorIndex + props.logContextWindow.after + 1) : 0;
  const contextualLogs = anchorIndex >= 0 ? props.sessionLogs.slice(contextStart, contextEnd) : [];
  const navigatorLogs = [...props.sessionLogs].reverse();
  const selectAnchor = props.onSelectAnchor || (() => {});
  const expandBefore = props.onExpandBefore || (() => {});
  const expandAfter = props.onExpandAfter || (() => {});
  const lockEvidence = props.onLockEvidence || (() => {});
  const sendToWhiteboard = props.onSendToWhiteboard || (() => {});

  return (
    <section className="diagnostic-localization-desk__lane" aria-label="SessionLogLane">
      <Card
        title="会话日志定位"
        extra={
          <Space wrap size={[8, 8]}>
            <Tag color={props.selectedSessionId ? 'processing' : 'default'}>
              {props.currentSessionLabel || props.selectedSessionId || '未选择会话'}
            </Tag>
            <Button
              size="small"
              icon={<UnorderedListOutlined />}
              disabled={!props.selectedSessionId}
              onClick={props.onOpenRawLogs}
            >
              原始日志
            </Button>
            <Button size="small" icon={<PushpinOutlined />} onClick={props.onOpenEvidenceBasket}>
              证据篮 {props.evidenceCount || 0}
            </Button>
          </Space>
        }
      >
        {!props.selectedSessionId ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择目标 SSH 会话" />
        ) : props.loading && props.sessionLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin />
          </div>
        ) : props.sessionLogs.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前会话暂无日志" />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type={anchorLog?.level === 'error' || (anchorLog?.exitCode ?? 0) !== 0 ? 'warning' : 'info'}
              showIcon
              message={anchorLog ? `当前锚点: ${anchorLog.type}` : '当前没有可用锚点'}
              description={
                anchorLog ? (
                  <Space direction="vertical" size={4}>
                    <Text type="secondary">
                      {props.currentAnchorLogId
                        ? '切换锚点时会自动重置上下文窗口。'
                        : '当前以最新一条日志作为临时锚点，点击任一日志可重置窗口。'}
                    </Text>
                    <Text type="secondary">
                      上下文窗口: 前 {props.logContextWindow.before} 条 / 后 {props.logContextWindow.after} 条
                    </Text>
                  </Space>
                ) : null
              }
            />

            <Card
              size="small"
              title="锚点上下文"
              extra={
                <Space wrap size={[8, 8]}>
                  <Button size="small" onClick={expandBefore}>
                    向上展开 20 行
                  </Button>
                  <Button size="small" onClick={expandAfter}>
                    向下展开 20 行
                  </Button>
                </Space>
              }
            >
              <List
                size="small"
                dataSource={contextualLogs}
                renderItem={(item) => {
                  const lookupText = buildLookupText([item.type, item.message, item.stdout, item.stderr]);
                  const canLocate = props.canLocateSource?.(lookupText) ?? false;
                  const functionCandidates = extractCLookupHints(lookupText).functions.slice(0, 6);
                  const isAnchor = item.id === anchorLog?.id;
                  const locateFunction = (candidate: FunctionCandidateToken) => {
                    const request = buildSessionLogSourceRequest(item, lookupText);
                    props.onLocateSource(request, { functionCandidate: candidate });
                  };
                  const locateSelectedText = (text: string, streamName: 'stdout' | 'stderr') => {
                    const selectedFunctions = extractCLookupHints(text).functions;
                    props.onLocateSource(
                      {
                        title: `会话日志 ${streamName}: ${item.type}`,
                        summary: item.message || `手动选取 ${streamName} 中的线索`,
                        sourceType: 'session_log_selection',
                        text,
                        command: item.cmd,
                      },
                      selectedFunctions.length === 1
                        ? { functionCandidate: selectedFunctions[0] }
                        : undefined
                    );
                  };
                  return (
                    <List.Item
                      actions={[
                        !isAnchor ? (
                          <Button key="anchor" type="link" onClick={() => selectAnchor(item.id)}>
                            设为锚点
                          </Button>
                        ) : (
                          <Tag key="anchor-tag" color="blue">当前锚点</Tag>
                        ),
                        ...(canLocate
                          ? [
                              <Button
                                key="source"
                                type="link"
                                icon={<CodeOutlined />}
                                onClick={() => props.onLocateSource(buildSessionLogSourceRequest(item, lookupText))}
                              >
                                看源码
                              </Button>,
                            ]
                          : []),
                        <Button
                          key="lock"
                          type="link"
                          icon={<PushpinOutlined />}
                          onClick={() => lockEvidence(item)}
                        >
                          锁定
                        </Button>,
                        <Button
                          key="whiteboard"
                          type="link"
                          onClick={() => sendToWhiteboard(item)}
                        >
                          发送到白板
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Text strong>{item.type}</Text>
                            <Tag color={item.level === 'error' ? 'red' : item.level === 'warning' ? 'orange' : 'blue'}>
                              {item.level || 'info'}
                            </Tag>
                            <Text type="secondary">{formatTs(item.ts)}</Text>
                            {typeof item.exitCode === 'number' && (
                              <Tag color={item.exitCode === 0 ? 'green' : 'red'}>exit {item.exitCode}</Tag>
                            )}
                            {typeof item.durationMs === 'number' && <Tag>{item.durationMs}ms</Tag>}
                            {item.mode && <Tag>{item.mode}</Tag>}
                          </div>
                        }
                        description={
                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            {item.cmd && <Text code>{item.cmd}</Text>}
                            {item.message && <Text>{item.message}</Text>}
                            {functionCandidates.length > 0 && (
                              <Space wrap size={[6, 6]}>
                                <Text type="secondary">函数线索</Text>
                                {functionCandidates.map((candidate) => (
                                  <Tag
                                    key={`${candidate.query}-${candidate.hits}`}
                                    color="geekblue"
                                    onClick={() => locateFunction(candidate)}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    {candidate.query}
                                  </Tag>
                                ))}
                              </Space>
                            )}
                            {item.stdout && (
                              <div>
                                <Text strong>stdout</Text>
                                <ResizableOutput
                                  content={item.stdout}
                                  isDark={props.isDark}
                                  minHeight={56}
                                  maxHeight={180}
                                  onTextSelect={(text) => locateSelectedText(text, 'stdout')}
                                />
                              </div>
                            )}
                            {item.stderr && (
                              <div>
                                <Text strong>stderr</Text>
                                <ResizableOutput
                                  content={item.stderr}
                                  isDark={props.isDark}
                                  minHeight={56}
                                  maxHeight={180}
                                  onTextSelect={(text) => locateSelectedText(text, 'stderr')}
                                />
                              </div>
                            )}
                          </Space>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            </Card>

            <Card size="small" title="锚点选择">
              <List
                size="small"
                dataSource={navigatorLogs}
                renderItem={(item) => {
                  const isAnchor = item.id === anchorLog?.id;
                  return (
                    <List.Item
                      extra={isAnchor ? (
                        <Tag color="blue">当前锚点</Tag>
                      ) : (
                        <Button size="small" onClick={() => selectAnchor(item.id)}>
                          设为锚点
                        </Button>
                      )}
                    >
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Text strong>{item.type}</Text>
                          <Text type="secondary">{formatTs(item.ts)}</Text>
                          {item.level && (
                            <Tag color={item.level === 'error' ? 'red' : item.level === 'warning' ? 'orange' : 'blue'}>
                              {item.level}
                            </Tag>
                          )}
                        </div>
                        <Text type="secondary">{renderNavigatorSummary(item)}</Text>
                      </Space>
                    </List.Item>
                  );
                }}
              />
            </Card>

            <Space wrap size={[8, 8]}>
              <Button size="small" icon={<ProfileOutlined />} onClick={props.onOpenRawLogs}>
                在抽屉里看完整原始日志
              </Button>
              <Button size="small" icon={<PushpinOutlined />} onClick={props.onOpenEvidenceBasket}>
                打开证据篮
              </Button>
            </Space>
          </Space>
        )}
      </Card>
    </section>
  );
}
