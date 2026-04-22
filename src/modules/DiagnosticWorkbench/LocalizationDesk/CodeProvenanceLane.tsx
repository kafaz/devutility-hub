import {
  BranchesOutlined,
  CodeOutlined,
  ExpandAltOutlined,
  NodeIndexOutlined,
  RollbackOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  List,
  Space,
  Tag,
  Typography,
} from 'antd';

import type { LocalizationDeskCodeContextSummary } from './types.ts';

const { Paragraph, Text } = Typography;

export interface CodeProvenanceNavigationEntry {
  symbolId: string;
  symbolName: string;
  filePath?: string;
  line?: number;
  endLine?: number;
  signature?: string;
}

export interface CodeProvenanceForwardTarget {
  symbolId: string;
  symbolName: string;
  filePath?: string;
  line?: number;
  endLine?: number;
  signature?: string;
  relationLabel?: string;
  summary?: string;
}

export interface CodeProvenanceFocusFrame {
  symbolId: string;
  symbolName: string;
  filePath?: string;
  line?: number;
  endLine?: number;
  signature?: string;
  summary?: string;
  preview?: string;
}

export interface CodeProvenanceLaneProps {
  binding: LocalizationDeskCodeContextSummary | null;
  isDark?: boolean;
  loading?: boolean;
  currentFrame?: CodeProvenanceFocusFrame | null;
  navigationStack?: CodeProvenanceNavigationEntry[];
  forwardTargets?: CodeProvenanceForwardTarget[];
  onExpandAbove?(): void;
  onExpandBelow?(): void;
  onOpenFullFunction?(): void;
  onNavigateForward?(target: CodeProvenanceForwardTarget): void;
  onJumpBack?(index: number): void;
  onSendCurrentFrameToWhiteboard?(): void;
}

function formatLineRange(line?: number, endLine?: number) {
  if (typeof line !== 'number') return '行号待补';
  if (typeof endLine === 'number' && endLine > line) {
    return `L${line}-L${endLine}`;
  }
  return `L${line}`;
}

function clipWorktreePath(pathValue?: string) {
  const value = String(pathValue || '').trim();
  if (!value) return '工作树路径待补';
  return value.length > 72 ? `...${value.slice(-72)}` : value;
}

function renderFrameLabel(frame: CodeProvenanceNavigationEntry | CodeProvenanceFocusFrame) {
  const lineLabel = formatLineRange(frame.line, frame.endLine);
  return frame.filePath ? `${frame.symbolName} · ${lineLabel}` : frame.symbolName;
}

function renderPreview(preview: string | undefined, isDark: boolean | undefined) {
  const value = String(preview || '').trim();
  if (!value) {
    return (
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        等待主线程接入函数正文预览。这里会承接手动展开后的代码上下文。
      </Paragraph>
    );
  }

  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        borderRadius: 10,
        border: `1px solid ${isDark ? 'rgba(71, 85, 105, 0.7)' : 'rgba(148, 163, 184, 0.28)'}`,
        background: isDark ? '#0f172a' : '#0b12201a',
        color: isDark ? '#e2e8f0' : '#0f172a',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 280,
        overflow: 'auto',
      }}
    >
      {value}
    </pre>
  );
}

export default function CodeProvenanceLane(props: CodeProvenanceLaneProps) {
  const hasBinding = Boolean(props.binding);
  const navigationStack = props.navigationStack || [];
  const currentFrame: CodeProvenanceFocusFrame | null = props.currentFrame
    || (navigationStack.length > 0 ? { ...navigationStack[navigationStack.length - 1] } : null);
  const forwardTargets = props.forwardTargets || [];
  const canExpand = Boolean(hasBinding && currentFrame);

  return (
    <section className="diagnostic-localization-desk__lane" aria-label="CodeProvenanceLane">
      <Card
        title="手动代码溯源"
        extra={
          <Space wrap size={[8, 8]}>
            <Tag color={hasBinding ? 'processing' : 'default'}>
              {hasBinding ? '代码版本已绑定' : '未绑定代码版本'}
            </Tag>
            {currentFrame ? (
              <Tag color="cyan">{renderFrameLabel(currentFrame)}</Tag>
            ) : null}
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="不做自动推荐，所有展开和跳转都由你手动触发。"
            description="Expand above、Expand below、Full function、Click function forward、Jump back 都只响应显式操作。"
          />

          {!hasBinding ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="请先绑定 repo/branch/commit，Code Provenance lane 才能工作。"
            />
          ) : (
            <Card size="small" title="当前绑定">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap size={[8, 8]}>
                  <Tag icon={<CodeOutlined />}>{props.binding?.repoDisplayName}</Tag>
                  <Tag icon={<BranchesOutlined />}>{props.binding?.branch}</Tag>
                  <Tag>{props.binding?.commit.slice(0, 12)}</Tag>
                </Space>
                <Text type="secondary">{clipWorktreePath(props.binding?.worktreePath)}</Text>
              </Space>
            </Card>
          )}

          <Card
            size="small"
            title="当前函数"
            extra={
              <Space wrap size={[8, 8]}>
                <Button
                  size="small"
                  icon={<NodeIndexOutlined />}
                  disabled={!currentFrame || !props.onSendCurrentFrameToWhiteboard}
                  onClick={props.onSendCurrentFrameToWhiteboard}
                >
                  发送到白板
                </Button>
                <Button
                  size="small"
                  icon={<VerticalAlignTopOutlined />}
                  disabled={!canExpand}
                  onClick={props.onExpandAbove}
                >
                  Expand above / 向上展开
                </Button>
                <Button
                  size="small"
                  icon={<VerticalAlignBottomOutlined />}
                  disabled={!canExpand}
                  onClick={props.onExpandBelow}
                >
                  Expand below / 向下展开
                </Button>
                <Button
                  size="small"
                  icon={<ExpandAltOutlined />}
                  disabled={!canExpand}
                  onClick={props.onOpenFullFunction}
                >
                  Full function / 完整函数
                </Button>
              </Space>
            }
          >
            {!currentFrame ? (
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                还没有当前函数焦点。主线程接入后，这里会显示当前定位到的函数签名、文件和代码片段。
              </Paragraph>
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space wrap size={[8, 8]}>
                  <Tag color="blue">{currentFrame.symbolName}</Tag>
                  <Tag>{formatLineRange(currentFrame.line, currentFrame.endLine)}</Tag>
                  {currentFrame.filePath ? <Tag>{currentFrame.filePath}</Tag> : null}
                </Space>
                {currentFrame.signature ? <Text code>{currentFrame.signature}</Text> : null}
                {currentFrame.summary ? (
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {currentFrame.summary}
                  </Paragraph>
                ) : null}
                {renderPreview(currentFrame.preview, props.isDark)}
              </Space>
            )}
          </Card>

          <Card
            size="small"
            title="跳转栈 / Breadcrumb"
            extra={
              <Button
                size="small"
                icon={<RollbackOutlined />}
                disabled={navigationStack.length <= 1 || !props.onJumpBack}
                onClick={() => props.onJumpBack?.(navigationStack.length - 2)}
              >
                Jump back / 跳回上一个函数
              </Button>
            }
          >
            {navigationStack.length === 0 ? (
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                还没有函数跳转历史。点击函数前进后，这里会按时间顺序累积 breadcrumb，便于回退。
              </Paragraph>
            ) : (
              <Space wrap size={[8, 8]}>
                {navigationStack.map((item, index) => {
                  const isCurrent = index === navigationStack.length - 1;
                  return (
                    <Button
                      key={`${item.symbolId}-${index}`}
                      size="small"
                      type={isCurrent ? 'primary' : 'default'}
                      icon={<RollbackOutlined />}
                      disabled={isCurrent || !props.onJumpBack}
                      onClick={() => props.onJumpBack?.(index)}
                    >
                      {item.symbolName}
                    </Button>
                  );
                })}
              </Space>
            )}
          </Card>

          <Card
            size="small"
            title="可点击前进函数"
            extra={<Tag icon={<NodeIndexOutlined />}>{forwardTargets.length}</Tag>}
            loading={props.loading}
          >
            {forwardTargets.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={hasBinding ? '还没有可点击的前进函数。' : '绑定代码上下文后才会显示可点击函数。'}
              />
            ) : (
              <List
                size="small"
                dataSource={forwardTargets}
                renderItem={(target) => (
                  <List.Item
                    actions={[
                      <Button
                        key="forward"
                        type="link"
                        icon={<CodeOutlined />}
                        disabled={!props.onNavigateForward}
                        onClick={() => props.onNavigateForward?.(target)}
                      >
                        Click function forward / 点击函数前进
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space wrap size={[8, 8]}>
                          <Text strong>{target.symbolName}</Text>
                          <Tag>{formatLineRange(target.line, target.endLine)}</Tag>
                          {target.relationLabel ? <Tag color="purple">{target.relationLabel}</Tag> : null}
                        </Space>
                      }
                      description={
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          {target.signature ? <Text code>{target.signature}</Text> : null}
                          {target.filePath ? <Text type="secondary">{target.filePath}</Text> : null}
                          {target.summary ? (
                            <Text type="secondary">{target.summary}</Text>
                          ) : (
                            <Text type="secondary">等待主线程接入调用关系或上下文摘要。</Text>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Space>
      </Card>
    </section>
  );
}
