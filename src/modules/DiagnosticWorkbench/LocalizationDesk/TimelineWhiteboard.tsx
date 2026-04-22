import {
  ClearOutlined,
  DeleteOutlined,
  EditOutlined,
  RiseOutlined,
  UpOutlined,
  DownOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';

import type {
  TimelineWhiteboardManualNoteInput,
  TimelineWhiteboardNode,
} from './useTimelineWhiteboard.ts';

const { Paragraph, Text, Title } = Typography;

export interface TimelineWhiteboardProps {
  nodes: TimelineWhiteboardNode[];
  selectedNodeId?: string | null;
  isDark?: boolean;
  creatingNote?: boolean;
  onSelectNode?(nodeId: string): void;
  onCreateNote?(input: TimelineWhiteboardManualNoteInput): void;
  onMoveNode?(nodeId: string, direction: 'up' | 'down'): void;
  onRemoveNode?(nodeId: string): void;
  onClearBoard?(): void;
}

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) return '未标注时间';
  return new Date(timestamp).toLocaleString('zh-CN');
}

function getKindLabel(kind: TimelineWhiteboardNode['kind']) {
  if (kind === 'command') return '命令';
  if (kind === 'source') return '源码';
  if (kind === 'note') return '备注';
  return '日志';
}

function getAccentColor(node: TimelineWhiteboardNode) {
  if (node.accent === 'error') return '#ef4444';
  if (node.accent === 'warning') return '#f59e0b';
  if (node.kind === 'note') return '#38bdf8';
  if (node.kind === 'command') return '#22c55e';
  if (node.kind === 'source') return '#a78bfa';
  return '#60a5fa';
}

export default function TimelineWhiteboard(props: TimelineWhiteboardProps) {
  const [noteTitleDraft, setNoteTitleDraft] = useState('');
  const [noteExcerptDraft, setNoteExcerptDraft] = useState('');
  const selectedNode = props.nodes.find((item) => item.id === props.selectedNodeId) || null;
  const dark = props.isDark !== false;
  const canCreateNote = Boolean(props.onCreateNote && noteExcerptDraft.trim());

  const surfaceStyle = {
    background: dark ? '#050816' : '#f8fafc',
    border: dark ? '1px solid rgba(96, 165, 250, 0.22)' : '1px solid rgba(15, 23, 42, 0.08)',
  };

  return (
    <section className="diagnostic-localization-desk__whiteboard" aria-label="TimelineWhiteboard">
      <Card
        title={
          <Space size={10}>
            <RiseOutlined style={{ color: '#60a5fa' }} />
            <span>时序白板</span>
            <Tag color="blue">{props.nodes.length} 个节点</Tag>
          </Space>
        }
        extra={
          <Button
            size="small"
            danger
            icon={<ClearOutlined />}
            disabled={!props.onClearBoard || props.nodes.length === 0}
            onClick={props.onClearBoard}
          >
            清空白板
          </Button>
        }
        styles={{ body: surfaceStyle }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="手动整理时序节点，不做自动分析或建议"
            description="操作员可以手动加入日志、命令、源码片段和备注节点，再按自己的判断调整顺序、删除或清空。"
          />

          <Card
            size="small"
            title={
              <Space size={8}>
                <EditOutlined />
                <span>新增备注</span>
              </Space>
            }
            styles={{
              body: {
                background: dark ? 'rgba(15, 23, 42, 0.82)' : '#ffffff',
                borderRadius: 12,
              },
            }}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Input
                value={noteTitleDraft}
                onChange={(event) => setNoteTitleDraft(event.target.value)}
                placeholder="备注标题，例如：第一次异常扩散点"
                disabled={!props.onCreateNote || props.creatingNote}
              />
              <Input.TextArea
                value={noteExcerptDraft}
                onChange={(event) => setNoteExcerptDraft(event.target.value)}
                placeholder="手动记录你确认过的时序判断，不自动生成。"
                autoSize={{ minRows: 3, maxRows: 5 }}
                disabled={!props.onCreateNote || props.creatingNote}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <Text type="secondary">备注只在你点击新增时进入白板。</Text>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  loading={props.creatingNote}
                  disabled={!canCreateNote}
                  onClick={() => {
                    if (!props.onCreateNote || !noteExcerptDraft.trim()) return;
                    props.onCreateNote({
                      title: noteTitleDraft.trim() || undefined,
                      excerpt: noteExcerptDraft.trim(),
                      timestamp: Date.now(),
                    });
                    setNoteTitleDraft('');
                    setNoteExcerptDraft('');
                  }}
                >
                  新增备注
                </Button>
              </div>
            </Space>
          </Card>

          {props.nodes.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有时序节点。先从日志、命令或源码片段手动发送进来，或直接添加备注。"
            />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {props.nodes.map((node, index) => {
                const selected = node.id === selectedNode?.id;
                const accentColor = getAccentColor(node);
                return (
                  <article
                    key={node.id}
                    style={{
                      borderRadius: 14,
                      padding: 14,
                      border: selected
                        ? `1px solid ${accentColor}`
                        : dark
                          ? '1px solid rgba(148, 163, 184, 0.22)'
                          : '1px solid rgba(15, 23, 42, 0.08)',
                      background: dark ? 'rgba(15, 23, 42, 0.88)' : '#ffffff',
                      boxShadow: selected ? `0 0 0 1px ${accentColor} inset` : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <Space size={[8, 8]} wrap>
                        <Tag color="blue">#{index + 1}</Tag>
                        <Tag color={node.accent === 'error' ? 'error' : node.accent === 'warning' ? 'warning' : 'processing'}>
                          {getKindLabel(node.kind)}
                        </Tag>
                        <Tag>{formatTimestamp(node.timestamp)}</Tag>
                        <Tag>{node.sourceType}</Tag>
                        {node.sourceId ? <Tag>{node.sourceId}</Tag> : null}
                      </Space>
                      <Space size={[4, 4]} wrap>
                        <Button size="small" onClick={() => props.onSelectNode?.(node.id)}>
                          聚焦
                        </Button>
                        <Button
                          size="small"
                          icon={<UpOutlined />}
                          disabled={!props.onMoveNode || index === 0}
                          onClick={() => props.onMoveNode?.(node.id, 'up')}
                        >
                          上移
                        </Button>
                        <Button
                          size="small"
                          icon={<DownOutlined />}
                          disabled={!props.onMoveNode || index === props.nodes.length - 1}
                          onClick={() => props.onMoveNode?.(node.id, 'down')}
                        >
                          下移
                        </Button>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={!props.onRemoveNode}
                          onClick={() => props.onRemoveNode?.(node.id)}
                        >
                          移除
                        </Button>
                      </Space>
                    </div>

                    <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 12 }}>
                      <Title level={5} style={{ margin: 0, color: dark ? '#f8fafc' : '#0f172a' }}>
                        {node.title}
                      </Title>
                      <Paragraph
                        style={{
                          marginBottom: 0,
                          whiteSpace: 'pre-wrap',
                          color: dark ? '#cbd5e1' : '#334155',
                        }}
                      >
                        {node.excerpt || '该节点目前还没有补充内容。'}
                      </Paragraph>
                    </Space>
                  </article>
                );
              })}
            </Space>
          )}
        </Space>
      </Card>
    </section>
  );
}
