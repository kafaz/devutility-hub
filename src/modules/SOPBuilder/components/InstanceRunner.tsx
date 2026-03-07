import React, { useState } from 'react';
import ResizableOutput from '../../../components/shared/ResizableOutput';
import {
  Typography,
  Button,
  Space,
  Card,
  Tag,
  Input,
  Tooltip,
  Badge,
  Collapse,
  Alert,
  Modal,
  Form,
  Select,
  message,
  Popconfirm,
} from 'antd';
import {
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  ExportOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { SOPInstance, SOPTemplate, SOPCheckResult } from '../../../types';
import { useClipboard } from '../../../hooks/useClipboard';
import { generateInstanceReport } from '../../../utils';
import { useGlobalStore } from '../../../store/globalStore';

const { Title, Text } = Typography;
const { TextArea } = Input;

type CheckStatus = SOPCheckResult['status'];

const STATUS_CONFIG: Record<
  CheckStatus,
  { color: string; label: string; icon: React.ReactNode }
> = {
  pending: {
    color: 'default',
    label: '待执行',
    icon: <ClockCircleOutlined />,
  },
  normal: {
    color: 'success',
    label: '正常',
    icon: <CheckCircleOutlined style={{ color: '#22c55e' }} />,
  },
  abnormal: {
    color: 'error',
    label: '异常',
    icon: <CloseCircleOutlined style={{ color: '#ef4444' }} />,
  },
  skipped: {
    color: 'warning',
    label: '已跳过',
    icon: <MinusCircleOutlined style={{ color: '#eab308' }} />,
  },
};

const INSTANCE_STATUS: Record<
  SOPInstance['status'],
  { color: string; label: string }
> = {
  investigating: { color: 'processing', label: '排查中' },
  resolved: { color: 'success', label: '已解决' },
  escalated: { color: 'error', label: '已上升' },
};

interface Props {
  instance: SOPInstance;
  template: SOPTemplate | undefined;
  onUpdateCheck: (checkId: string, data: Partial<SOPCheckResult>) => void;
  onAddExtraCheck: (check: Omit<SOPCheckResult, 'checkId'>) => void;
  onUpdateDiagnosis: (field: keyof SOPInstance['diagnosis'], value: string) => void;
  onSetStatus: (status: SOPInstance['status']) => void;
  onDelete: () => void;
}

// 单个检查步骤卡片
const CheckCard: React.FC<{
  result: SOPCheckResult;
  stepNum: number;
  templateCheck?: SOPTemplate['checks'][0];
  isDark: boolean;
  onUpdate: (data: Partial<SOPCheckResult>) => void;
}> = ({ result, stepNum, templateCheck, isDark, onUpdate }) => {
  const { copy } = useClipboard();
  const [messageApi, contextHolder] = message.useMessage();
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  const cardBg = isDark ? '#2d2d30' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';
  const codeBg = isDark ? '#1e1e1e' : '#f4f4f5';

  const statusCfg = STATUS_CONFIG[result.status];

  // 从命令模板中提取变量名
  const vars = Array.from(
    new Set([...(result.command.matchAll(/\$\{([^}]+)\}/g))].map((m) => m[1]))
  );
  const hasUnresolvedVars = vars.length > 0 && vars.some((v) => !varValues[v]);

  // 渲染命令（替换变量）
  const renderedCommand = result.command.replace(
    /\$\{([^}]+)\}/g,
    (_, name) => varValues[name] || `\${${name}}`
  );

  const handleCopy = async () => {
    const ok = await copy(renderedCommand);
    if (ok) messageApi.success('命令已复制');
  };

  return (
    <Card
      size="small"
      style={{
        background: cardBg,
        border: `1px solid ${
          result.status === 'abnormal'
            ? '#ef4444'
            : result.status === 'normal'
            ? '#22c55e'
            : borderColor
        }`,
        marginBottom: 8,
      }}
    >
      {contextHolder}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* 步骤序号 */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background:
              result.status === 'normal'
                ? '#22c55e'
                : result.status === 'abnormal'
                ? '#ef4444'
                : '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 12,
            color: '#fff',
            fontWeight: 600,
          }}
        >
          {stepNum}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 步骤标题行 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}
          >
            <Space size={8}>
              <Text strong style={{ fontSize: 14 }}>
                {result.checkName}
              </Text>
              <Tag
                color={statusCfg.color}
                icon={statusCfg.icon}
                style={{ fontSize: 11 }}
              >
                {statusCfg.label}
              </Tag>
            </Space>
            {/* 状态切换按钮 */}
            <Space size={4}>
              {(['normal', 'abnormal', 'skipped'] as CheckStatus[]).map((s) => (
                <Button
                  key={s}
                  size="small"
                  type={result.status === s ? 'primary' : 'default'}
                  danger={s === 'abnormal' && result.status !== s}
                  onClick={() => onUpdate({ status: s })}
                  style={{ fontSize: 11, padding: '0 8px' }}
                >
                  {STATUS_CONFIG[s].label}
                </Button>
              ))}
            </Space>
          </div>

          {/* 步骤描述 */}
          {templateCheck?.description && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              {templateCheck.description}
            </Text>
          )}

          {/* 变量填写区（如果命令含有占位符） */}
          {vars.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '4px 8px',
                marginBottom: 6,
              }}
            >
              {vars.map((v) => (
                <Input
                  key={v}
                  size="small"
                  prefix={
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {v}:
                    </Text>
                  }
                  value={varValues[v] || ''}
                  onChange={(e) =>
                    setVarValues((prev) => ({ ...prev, [v]: e.target.value }))
                  }
                  placeholder={`填写 ${v}`}
                  style={{ fontSize: 12 }}
                />
              ))}
            </div>
          )}

          {/* 命令展示区 */}
          <div
            style={{
              background: codeBg,
              borderRadius: 4,
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <Text
              style={{
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                fontSize: 12,
                flex: 1,
                wordBreak: 'break-all',
                color: hasUnresolvedVars
                  ? isDark
                    ? '#fbbf24'
                    : '#d97706'
                  : isDark
                  ? '#e4e4e7'
                  : '#18181b',
              }}
            >
              {renderedCommand}
            </Text>
            <Tooltip title="复制命令">
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={handleCopy}
                disabled={hasUnresolvedVars}
              />
            </Tooltip>
          </div>

          {/* 预期正常/异常提示 */}
          {(templateCheck?.expectedNormal || templateCheck?.abnormalSigns) && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
                marginBottom: 6,
              }}
            >
              {templateCheck.expectedNormal && (
                <div
                  style={{
                    background: isDark ? 'rgba(34,197,94,0.08)' : '#f0fdf4',
                    border: '1px solid rgba(34,197,94,0.3)',
                    borderRadius: 4,
                    padding: '4px 8px',
                  }}
                >
                  <Text style={{ fontSize: 11, color: '#22c55e' }}>
                    ✅ 正常：{templateCheck.expectedNormal}
                  </Text>
                </div>
              )}
              {templateCheck.abnormalSigns && (
                <div
                  style={{
                    background: isDark ? 'rgba(239,68,68,0.08)' : '#fff1f2',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 4,
                    padding: '4px 8px',
                  }}
                >
                  <Text style={{ fontSize: 11, color: '#ef4444' }}>
                    ❌ 异常：{templateCheck.abnormalSigns}
                  </Text>
                </div>
              )}
            </div>
          )}

          {/* 命令输出区（可拖拽调整高度 / 可编辑粘贴） */}
          {result.output ? (
            <div style={{ marginBottom: 6 }}>
              <ResizableOutput
                content={result.output}
                isDark={isDark}
                minHeight={60}
                maxHeight={500}
                highlights={
                  templateCheck?.abnormalRegex
                    ? [{ pattern: templateCheck.abnormalRegex, color: 'rgba(239,68,68,0.2)', label: '异常' }]
                    : []
                }
              />
            </div>
          ) : (
            <TextArea
              rows={3}
              value={result.output}
              onChange={(e) => onUpdate({ output: e.target.value })}
              placeholder="粘贴命令输出结果..."
              style={{
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                fontSize: 11,
                marginBottom: 6,
                background: isDark ? '#1e1e1e' : '#fafafa',
                resize: 'vertical',
              }}
            />
          )}

          {/* 分析结论 */}
          <Input
            value={result.conclusion}
            onChange={(e) => onUpdate({ conclusion: e.target.value })}
            placeholder="填写此步骤的分析结论（可选）"
            style={{ fontSize: 12 }}
            prefix={
              <Text type="secondary" style={{ fontSize: 11 }}>
                结论：
              </Text>
            }
          />
        </div>
      </div>
    </Card>
  );
};

const InstanceRunner: React.FC<Props> = ({
  instance,
  template,
  onUpdateCheck,
  onAddExtraCheck,
  onUpdateDiagnosis,
  onSetStatus,
  onDelete,
}) => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const [extraModalOpen, setExtraModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [extraForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  // 步骤完成进度
  const totalChecks = instance.checkResults.length + instance.extraChecks.length;
  const doneChecks = [...instance.checkResults, ...instance.extraChecks].filter(
    (r) => r.status !== 'pending'
  ).length;
  const abnormalCount = [...instance.checkResults, ...instance.extraChecks].filter(
    (r) => r.status === 'abnormal'
  ).length;

  const statusCfg = INSTANCE_STATUS[instance.status];

  // 生成 Markdown 报告（使用增强版导出函数）
  const handleExport = () => {
    const markdown = generateInstanceReport({
      instance,
      templateName: template?.name ?? instance.templateName,
    });

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `故障排查报告-${instance.incidentTitle.replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    messageApi.success('报告已导出');
  };

  const handleAddExtra = async () => {
    const values = await extraForm.validateFields();
    onAddExtraCheck({
      checkName:      values.name,
      command:        values.command,
      output:         '',
      conclusion:     '',
      status:         'pending',
      subSteps:       [],
      subStepResults: [],
    });
    extraForm.resetFields();
    setExtraModalOpen(false);
  };

  return (
    <div>
      {contextHolder}

      {/* 实例标题栏 */}
      <Card
        size="small"
        style={{ background: cardBg, border: `1px solid ${borderColor}`, marginBottom: 12 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <Space size={8} align="start">
              <Title level={5} style={{ margin: 0 }}>
                {instance.incidentTitle}
              </Title>
              <Badge status={statusCfg.color as 'processing' | 'success' | 'error'} />
              <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
            </Space>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
              模板：{instance.templateName} · 开始时间：
              {new Date(instance.createdAt).toLocaleString('zh-CN')}
            </Text>
          </div>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              进度：{doneChecks}/{totalChecks}
            </Text>
            {abnormalCount > 0 && (
              <Tag color="error" icon={<CloseCircleOutlined />}>
                {abnormalCount} 项异常
              </Tag>
            )}
            <Select
              size="small"
              value={instance.status}
              onChange={onSetStatus}
              style={{ width: 110 }}
              options={Object.entries(INSTANCE_STATUS).map(([k, v]) => ({
                label: v.label,
                value: k,
              }))}
            />
            <Tooltip title="导出 Markdown 报告">
              <Button size="small" icon={<ExportOutlined />} onClick={() => setExportOpen(true)}>
                导出报告
              </Button>
            </Tooltip>
            <Popconfirm
              title="确认删除此排查记录？"
              onConfirm={onDelete}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        </div>

        {/* 根因提示折叠区 */}
        {template?.diagnosisHints && (
          <Collapse
            size="small"
            ghost
            style={{ marginTop: 8 }}
            items={[{
              key: '1',
              label: (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <ThunderboltOutlined style={{ marginRight: 4 }} />
                  常见根因提示（展开参考）
                </Text>
              ),
              children: (
                <Alert
                  message={
                    <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
                      {template.diagnosisHints.replace(/\*\*/g, '')}
                    </div>
                  }
                  type="info"
                  showIcon={false}
                />
              ),
            }]}
          />
        )}
      </Card>

      {/* 排查步骤列表 */}
      <div style={{ marginBottom: 12 }}>
        {instance.checkResults.map((result, i) => {
          const templateCheck = template?.checks.find((c) => c.id === result.checkId);
          return (
            <CheckCard
              key={result.checkId}
              result={result}
              stepNum={i + 1}
              templateCheck={templateCheck}
              isDark={isDark}
              onUpdate={(data) => onUpdateCheck(result.checkId, data)}
            />
          );
        })}

        {/* 临时追加的步骤 */}
        {instance.extraChecks.map((result, i) => (
          <CheckCard
            key={result.checkId}
            result={result}
            stepNum={instance.checkResults.length + i + 1}
            isDark={isDark}
            onUpdate={(data) => onUpdateCheck(result.checkId, data)}
          />
        ))}

        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setExtraModalOpen(true)}
          style={{ width: '100%', marginTop: 4 }}
          size="small"
        >
          追加临时排查步骤
        </Button>
      </div>

      {/* 诊断结论区 */}
      <Card
        size="small"
        title={
          <Space>
            <Text strong>诊断结论</Text>
            {abnormalCount > 0 && (
              <Tag color="error">{abnormalCount} 项异常需处理</Tag>
            )}
          </Space>
        }
        style={{ background: cardBg, border: `1px solid ${borderColor}` }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
          }}
        >
          {(
            [
              { field: 'phenomenon', label: '故障现象', placeholder: '描述用户感知到的故障表现...' },
              { field: 'rootCause', label: '根因分析', placeholder: '分析故障的根本原因...' },
              { field: 'solution', label: '解决方案', placeholder: '描述执行了哪些操作解决了问题...' },
              { field: 'prevention', label: '预防措施', placeholder: '如何避免此类故障再次发生...' },
            ] as const
          ).map(({ field, label, placeholder }) => (
            <div key={field}>
              <Text
                strong
                style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
              >
                {label}
              </Text>
              <TextArea
                rows={3}
                value={instance.diagnosis[field]}
                onChange={(e) => onUpdateDiagnosis(field, e.target.value)}
                placeholder={placeholder}
                style={{ fontSize: 12, resize: 'vertical' }}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* 追加步骤弹窗 */}
      <Modal
        title="追加临时排查步骤"
        open={extraModalOpen}
        onOk={handleAddExtra}
        onCancel={() => setExtraModalOpen(false)}
        okText="添加"
        cancelText="取消"
      >
        <Form form={extraForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label="步骤名称"
            rules={[{ required: true, message: '请输入步骤名称' }]}
          >
            <Input placeholder="例：查看内存使用详情" />
          </Form.Item>
          <Form.Item
            name="command"
            label="执行命令（支持 ${var} 占位符）"
          >
            <Input
              placeholder="例：cat /proc/${pid}/status"
              style={{ fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导出确认弹窗 */}
      <Modal
        title="导出故障排查报告"
        open={exportOpen}
        onOk={handleExport}
        onCancel={() => setExportOpen(false)}
        okText="导出 Markdown"
        cancelText="取消"
      >
        <div style={{ padding: '8px 0' }}>
          <Text>
            将当前排查记录导出为 Markdown 格式，包含：
          </Text>
          <ul style={{ marginTop: 8, fontSize: 13 }}>
            <li>全部 {instance.checkResults.length + instance.extraChecks.length} 个排查步骤及命令输出</li>
            <li>故障诊断结论（现象/根因/方案/预防）</li>
            <li>适合粘贴到 Confluence / 飞书文档归档</li>
          </ul>
        </div>
      </Modal>
    </div>
  );
};

export default InstanceRunner;
