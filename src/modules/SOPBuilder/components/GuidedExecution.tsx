/**
 * GuidedExecution — 向导式 SOP 执行组件
 *
 * 适用场景：用户已在 XShell / 终端中建立好 SSH 会话，
 * 无需任何代理服务，通过剪贴板与终端交互：
 *   1. 工具展示当前步骤命令 → 用户一键复制
 *   2. 用户在终端执行，粘贴输出回工具
 *   3. 工具自动比对"正常特征 / 异常特征"给出初步判断
 *   4. 结果实时写入 SOPInstance，最终一键导出报告
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  Button,
  Typography,
  Space,
  Tag,
  Input,
  Progress,
  Card,
  Alert,
  Divider,
  message,
} from 'antd';
import {
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
  LeftOutlined,
  RightOutlined,
  FlagOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import type { SOPInstance, SOPTemplate, SOPCheckResult } from '../../../types';
import { useClipboard } from '../../../hooks/useClipboard';
import { generateInstanceReport, evaluateStepOutput } from '../../../utils';
import { useGlobalStore } from '../../../store/globalStore';
import ResizableOutput from '../../../components/shared/ResizableOutput';

const { Text, Title } = Typography;

type StepStatus = SOPCheckResult['status'];

// ─── 输出智能分析 ──────────────────────────────────────────────────────────

/**
 * 分析输出内容，返回建议状态：
 *   1. 优先使用正则（normalRegex / abnormalRegex）精确判断
 *   2. 回退到关键词模糊匹配（expectedNormal / abnormalSigns 文本描述）
 *   3. 最终回退：无任何依据 → null
 */
function analyzeOutput(
  output: string,
  opts: {
    normalRegex?:   string;
    abnormalRegex?: string;
    expectedNormal?: string;
    abnormalSigns?:  string;
  }
): { suggestion: StepStatus | null; hints: string[] } {
  if (!output.trim()) {
    if (opts.abnormalSigns && /无输出|empty|no output/i.test(opts.abnormalSigns)) {
      return { suggestion: 'abnormal', hints: ['输出为空，与异常特征"无输出"匹配'] };
    }
    return { suggestion: null, hints: [] };
  }

  // ① 正则判断（精确，优先）
  const regexResult = evaluateStepOutput(output, {
    normalRegex:   opts.normalRegex,
    abnormalRegex: opts.abnormalRegex,
  });
  if (regexResult.status !== null) {
    return {
      suggestion: regexResult.status,
      hints:      [regexResult.reason],
    };
  }

  // ② 关键词模糊匹配（回退）
  const lowerOut = output.toLowerCase();
  const hints: string[] = [];

  const abnKws = (opts.abnormalSigns ?? '')
    .split(/[;；,，\n]/)
    .map((s) => s.replace(/^[-*✅❌\s]+/, '').replace(/[=：:（(].+/, '').trim().toLowerCase())
    .filter((s) => s.length > 2 && s.length < 40);

  for (const kw of abnKws) {
    if (lowerOut.includes(kw)) {
      hints.push(`含异常关键词：「${kw}」`);
      return { suggestion: 'abnormal', hints };
    }
  }

  const norKws = (opts.expectedNormal ?? '')
    .split(/[;；,，\n]/)
    .map((s) => s.replace(/^[-*✅❌\s]+/, '').replace(/[=：:（(].+/, '').trim().toLowerCase())
    .filter((s) => s.length > 2 && s.length < 40);

  for (const kw of norKws) {
    if (lowerOut.includes(kw)) {
      hints.push(`含正常关键词：「${kw}」`);
      return { suggestion: 'normal', hints };
    }
  }

  return { suggestion: null, hints: ['未匹配到明确特征，请手动判断'] };
}

// ─── 单步卡片 ──────────────────────────────────────────────────────────────

interface StepCardProps {
  result:        SOPCheckResult;
  templateCheck: SOPTemplate['checks'][0] | undefined;
  stepNum:       number;
  total:         number;
  isDark:        boolean;
  onUpdate:      (data: Partial<SOPCheckResult>) => void;
  onPrev:        () => void;
  onNext:        () => void;
  isFirst:       boolean;
  isLast:        boolean;
}

const StepCard: React.FC<StepCardProps> = ({
  result, templateCheck, stepNum, total,
  isDark, onUpdate, onPrev, onNext, isFirst, isLast,
}) => {
  const { copy, copied } = useClipboard();
  const [messageApi, ctx] = message.useMessage();
  const analysisOpts = {
    normalRegex:    templateCheck?.normalRegex,
    abnormalRegex:  templateCheck?.abnormalRegex,
    expectedNormal: templateCheck?.expectedNormal,
    abnormalSigns:  templateCheck?.abnormalSigns,
  };

  const analysis = analyzeOutput(result.output, analysisOpts);

  // 粘贴输出时自动触发分析并建议状态
  const handleOutputChange = useCallback(
    (val: string) => {
      onUpdate({ output: val });
      if (result.status === 'pending' && val.trim()) {
        const { suggestion } = analyzeOutput(val, analysisOpts);
        if (suggestion) onUpdate({ status: suggestion, output: val });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result.status, templateCheck, onUpdate]
  );

  const handleCopy = useCallback(async () => {
    await copy(result.command);
    messageApi.success('命令已复制到剪贴板，粘贴到终端执行');
  }, [result.command, copy, messageApi]);

  const codeBg     = isDark ? '#1e1e1e' : '#f4f4f5';
  const cardBg     = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const STATUS_BTNS: { key: StepStatus; label: string; color: string }[] = [
    { key: 'normal',   label: '✅ 正常',  color: '#22c55e' },
    { key: 'abnormal', label: '❌ 异常',  color: '#ef4444' },
    { key: 'skipped',  label: '⏭️ 跳过', color: '#eab308' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {ctx}

      {/* 步骤进度 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text strong style={{ fontSize: 16 }}>
            步骤 {stepNum} / {total}：{result.checkName}
          </Text>
          <Tag
            color={
              result.status === 'normal'   ? 'success'
            : result.status === 'abnormal' ? 'error'
            : result.status === 'skipped'  ? 'warning'
            : 'default'
            }
          >
            {result.status === 'pending'   ? '待执行'
           : result.status === 'normal'   ? '✅ 正常'
           : result.status === 'abnormal' ? '❌ 异常'
           : result.status === 'skipped'  ? '⏭️ 跳过'
           : result.status}
          </Tag>
        </div>
        <Progress
          percent={Math.round((stepNum / total) * 100)}
          strokeColor="#3b82f6"
          showInfo={false}
          size="small"
        />
      </div>

      {/* 步骤描述 */}
      {templateCheck?.description && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {templateCheck.description}
        </Text>
      )}

      {/* ① 命令区 */}
      <Card
        size="small"
        title={<Text strong style={{ fontSize: 13 }}>① 复制命令 → 粘贴到终端执行</Text>}
        style={{ background: codeBg, border: `1px solid ${borderColor}` }}
        extra={
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={handleCopy}
            size="small"
          >
            {copied ? '已复制！' : '复制命令'}
          </Button>
        }
      >
        <pre
          style={{
            margin: 0,
            fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.6,
            color: isDark ? '#e4e4e7' : '#18181b',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: 'transparent',
          }}
        >
          {result.command}
        </pre>
      </Card>

      {/* 正常 / 异常特征提示 */}
      {(templateCheck?.expectedNormal || templateCheck?.abnormalSigns) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {templateCheck.expectedNormal && (
            <div
              style={{
                padding: '6px 10px',
                background: isDark ? 'rgba(34,197,94,0.08)' : '#f0fdf4',
                border: '1px solid rgba(34,197,94,0.25)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <Text style={{ color: '#22c55e', display: 'block', fontWeight: 600, marginBottom: 2 }}>
                ✅ 正常特征
              </Text>
              <Text style={{ fontSize: 12 }}>{templateCheck.expectedNormal}</Text>
            </div>
          )}
          {templateCheck.abnormalSigns && (
            <div
              style={{
                padding: '6px 10px',
                background: isDark ? 'rgba(239,68,68,0.08)' : '#fff1f2',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <Text style={{ color: '#ef4444', display: 'block', fontWeight: 600, marginBottom: 2 }}>
                ❌ 异常特征
              </Text>
              <Text style={{ fontSize: 12 }}>{templateCheck.abnormalSigns}</Text>
            </div>
          )}
        </div>
      )}

      {/* ② 粘贴输出区（可拖拽调整高度） */}
      <Card
        size="small"
        title={
          <Space size={6}>
            <Text strong style={{ fontSize: 13 }}>② 粘贴命令输出</Text>
            {(analysisOpts.normalRegex || analysisOpts.abnormalRegex) && (
              <Tag color="blue" style={{ fontSize: 10 }}>已配置正则判断</Tag>
            )}
          </Space>
        }
        style={{ background: cardBg, border: `1px solid ${borderColor}` }}
      >
        {/* 输出区：可编辑粘贴 + 底部拖拽柄（向下拖动查看更多日志行） */}
        <ResizableOutput
          content={result.output}
          isDark={isDark}
          minHeight={100}
          maxHeight={600}
          showCopy={!!result.output}
          onChange={handleOutputChange}
          placeholder="在终端执行命令后，将输出结果粘贴到这里（Ctrl+A 全选 → Ctrl+C 复制，向下拖拽底部柄展开更多行）"
        />

        {/* 自动分析结果 */}
        {result.output.trim() && analysis.hints.length > 0 && (
          <Alert
            style={{ marginTop: 8 }}
            type={
              analysis.suggestion === 'normal'   ? 'success'
            : analysis.suggestion === 'abnormal' ? 'error'
            : 'info'
            }
            showIcon
            message={
              <span style={{ fontSize: 12 }}>
                <b>自动分析：</b>{analysis.hints.join('；')}
                {analysis.suggestion && (
                  <span style={{ marginLeft: 8, fontWeight: 600 }}>
                    → 建议「{analysis.suggestion === 'normal' ? '正常' : '异常'}」
                  </span>
                )}
              </span>
            }
          />
        )}
      </Card>

      {/* ③ 状态标记 + 结论 */}
      <Card
        size="small"
        title={<Text strong style={{ fontSize: 13 }}>③ 标记结果</Text>}
        style={{ background: cardBg, border: `1px solid ${borderColor}` }}
      >
        <Space style={{ marginBottom: 10 }}>
          {STATUS_BTNS.map((btn) => (
            <Button
              key={btn.key}
              size="small"
              type={result.status === btn.key ? 'primary' : 'default'}
              style={{
                borderColor: result.status === btn.key ? btn.color : undefined,
                color:       result.status === btn.key ? '#fff'     : undefined,
                background:  result.status === btn.key ? btn.color  : undefined,
              }}
              onClick={() => onUpdate({ status: btn.key })}
            >
              {btn.label}
            </Button>
          ))}
        </Space>
        <Input
          size="small"
          value={result.conclusion}
          onChange={(e) => onUpdate({ conclusion: e.target.value })}
          placeholder="填写此步骤的分析结论（可选，会写入报告）"
        />
      </Card>

      {/* 导航按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button icon={<LeftOutlined />} onClick={onPrev} disabled={isFirst}>
          上一步
        </Button>
        <Button
          type="primary"
          icon={isLast ? <FlagOutlined /> : <RightOutlined />}
          iconPosition="end"
          onClick={onNext}
        >
          {isLast ? '完成排查' : '下一步'}
        </Button>
      </div>
    </div>
  );
};

// ─── 完成摘要 ──────────────────────────────────────────────────────────────

const SummaryCard: React.FC<{
  instance: SOPInstance;
  templateName: string;
  isDark: boolean;
  onExport: () => void;
  onBack: () => void;
}> = ({ instance, isDark, onExport, onBack }) => {
  const all      = [...instance.checkResults, ...instance.extraChecks];
  const normal   = all.filter((r) => r.status === 'normal').length;
  const abnormal = all.filter((r) => r.status === 'abnormal').length;
  const pending  = all.filter((r) => r.status === 'pending').length;

  const cardBg     = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center' }}>
        {abnormal === 0 && pending === 0 ? (
          <CheckCircleOutlined style={{ fontSize: 48, color: '#22c55e' }} />
        ) : abnormal > 0 ? (
          <CloseCircleOutlined style={{ fontSize: 48, color: '#ef4444' }} />
        ) : (
          <MinusCircleOutlined style={{ fontSize: 48, color: '#eab308' }} />
        )}
        <Title level={4} style={{ margin: '12px 0 4px' }}>
          {abnormal === 0 && pending === 0 ? '排查完成，未发现异常' : `发现 ${abnormal} 项异常`}
        </Title>
        <Text type="secondary">{instance.incidentTitle}</Text>
      </div>

      {/* 步骤摘要 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { label: '✅ 正常', count: normal,   color: '#22c55e' },
          { label: '❌ 异常', count: abnormal, color: '#ef4444' },
          { label: '⏳ 未执行', count: pending, color: '#eab308' },
        ].map((item) => (
          <Card
            key={item.label}
            size="small"
            style={{ background: cardBg, border: `1px solid ${borderColor}`, textAlign: 'center' }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.count}</div>
            <div style={{ fontSize: 12, color: '#a1a1aa' }}>{item.label}</div>
          </Card>
        ))}
      </div>

      {/* 异常步骤列表 */}
      {abnormal > 0 && (
        <Card
          size="small"
          title={<Text type="danger" strong>异常步骤</Text>}
          style={{ background: cardBg, border: '1px solid rgba(239,68,68,0.3)' }}
        >
          {all
            .filter((r) => r.status === 'abnormal')
            .map((r) => (
              <div key={r.checkId} style={{ marginBottom: 8 }}>
                <Text strong style={{ color: '#ef4444' }}>❌ {r.checkName}</Text>
                {r.conclusion && (
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {r.conclusion}
                  </Text>
                )}
              </div>
            ))}
        </Card>
      )}

      <Divider style={{ margin: '4px 0' }} />

      <Space style={{ justifyContent: 'center' }}>
        <Button onClick={onBack}>返回查看详情</Button>
        <Button type="primary" icon={<ExportOutlined />} onClick={onExport}>
          导出 Markdown 报告
        </Button>
      </Space>
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

interface Props {
  open:           boolean;
  instance:       SOPInstance;
  template:       SOPTemplate | undefined;
  onUpdateCheck:  (checkId: string, data: Partial<SOPCheckResult>) => void;
  onUpdateStatus: (status: SOPInstance['status']) => void;
  onClose:        () => void;
}

const GuidedExecution: React.FC<Props> = ({
  open, instance, template, onUpdateCheck, onUpdateStatus, onClose,
}) => {
  const { theme } = useGlobalStore();
  const isDark    = theme === 'dark';

  const allResults = [...instance.checkResults, ...instance.extraChecks];
  const [stepIdx,   setStepIdx]   = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [messageApi, ctx]         = message.useMessage();

  // 重置到第一步（每次打开时）
  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setShowSummary(false);
    }
  }, [open]);

  const currentResult = allResults[stepIdx];
  const currentCheck  = template?.checks.find((c) => c.id === currentResult?.checkId);

  const handleUpdateCurrent = useCallback(
    (data: Partial<SOPCheckResult>) => {
      onUpdateCheck(currentResult.checkId, data);
    },
    [currentResult, onUpdateCheck]
  );

  const handleNext = useCallback(() => {
    if (currentResult.status === 'pending') {
      messageApi.warning('请先标记此步骤的结果（正常 / 异常 / 跳过）');
      return;
    }
    if (stepIdx < allResults.length - 1) {
      setStepIdx((i) => i + 1);
    } else {
      // 最后一步完成 → 进入摘要
      onUpdateStatus('resolved');
      setShowSummary(true);
    }
  }, [currentResult, stepIdx, allResults.length, messageApi, onUpdateStatus]);

  const handleExport = useCallback(() => {
    const md = generateInstanceReport({
      instance,
      templateName: template?.name ?? instance.templateName,
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `故障排查报告-${instance.incidentTitle.replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    messageApi.success('报告已导出');
  }, [instance, template, messageApi]);

  // 整体进度（已完成步骤数）
  const doneCount = allResults.filter((r) => r.status !== 'pending').length;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={720}
      footer={null}
      title={
        <Space>
          <Text strong>向导执行</Text>
          <Tag color="blue">{instance.incidentTitle}</Tag>
          {!showSummary && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              已完成 {doneCount} / {allResults.length} 步
            </Text>
          )}
        </Space>
      }
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto', paddingTop: 16 } }}
    >
      {ctx}

      {showSummary ? (
        <SummaryCard
          instance={instance}
          templateName={template?.name ?? instance.templateName}
          isDark={isDark}
          onExport={handleExport}
          onBack={() => setShowSummary(false)}
        />
      ) : currentResult ? (
        <StepCard
          result={currentResult}
          templateCheck={currentCheck}
          stepNum={stepIdx + 1}
          total={allResults.length}
          isDark={isDark}
          onUpdate={handleUpdateCurrent}
          onPrev={() => setStepIdx((i) => Math.max(0, i - 1))}
          onNext={handleNext}
          isFirst={stepIdx === 0}
          isLast={stepIdx === allResults.length - 1}
        />
      ) : (
        <Text type="secondary">暂无排查步骤</Text>
      )}
    </Modal>
  );
};

export default GuidedExecution;
