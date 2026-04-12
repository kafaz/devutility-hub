import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, Divider, Row, Space, Statistic, Tag, Typography, message } from 'antd';
import React from 'react';
import { type ChaosScenario } from '../store/chaosStore';

const { Text } = Typography;

function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs || !endMs) return '—';
  const sec = Math.floor((endMs - startMs) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function buildMarkdown(scenario: ChaosScenario): string {
  const lines: string[] = [
    `# 混沌场景报告: ${scenario.name}`,
    ``,
    `- **状态**: ${scenario.status}`,
    `- **开始**: ${scenario.startedAt ? new Date(scenario.startedAt).toLocaleString() : '—'}`,
    `- **结束**: ${scenario.endedAt ? new Date(scenario.endedAt).toLocaleString() : '—'}`,
    `- **总耗时**: ${formatDuration(scenario.startedAt, scenario.endedAt)}`,
    ``,
    `## 步骤执行结果`,
    ``,
    `| # | 步骤 | 类型 | 结果 | 耗时 |`,
    `|---|------|------|------|------|`,
  ];

  scenario.steps.forEach((step, i) => {
    const res = scenario.stepResults[step.id];
    const status = res?.status || 'pending';
    const emoji = status === 'passed' ? '✅' : status === 'failed' ? '❌' : status === 'error' ? '💥' : '⏭';
    const dur = res ? formatDuration(res.startedAt, res.endedAt) : '—';
    lines.push(`| ${i + 1} | ${step.label} | ${step.type} | ${emoji} ${status} | ${dur} |`);
  });

  lines.push('', '## 校验详情', '');
  scenario.steps.filter(s => s.type === 'verify').forEach((step, i) => {
    const res = scenario.stepResults[step.id];
    lines.push(`### ${i + 1}. ${step.label}`);
    if (res?.verifyDetails) {
      res.verifyDetails.forEach(v => {
        lines.push(`- [${v.passed ? 'x' : ' '}] \`${v.rule.type}\`: \`${v.rule.value || '(exit=0)'}\``);
      });
    }
    if (res?.stdout) {
      lines.push('', '**命令输出（节选）:**', '```', res.stdout.slice(0, 800), '```');
    }
    lines.push('');
  });

  return lines.join('\n');
}

interface Props { scenario: ChaosScenario; }

export const ScenarioReport: React.FC<Props> = ({ scenario }) => {
  const results = Object.values(scenario.stepResults);
  const passCount = results.filter(r => r.status === 'passed').length;
  const failCount = results.filter(r => ['failed', 'error'].includes(r.status)).length;
  const totalSteps = scenario.steps.length;
  const duration = formatDuration(scenario.startedAt, scenario.endedAt);

  const handleExport = () => {
    const md = buildMarkdown(scenario);
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chaos-report-${scenario.name.replace(/\s+/g, '_')}-${Date.now()}.md`;
    a.click();
    message.success('报告已导出为 Markdown 文件');
  };

  if (scenario.status === 'idle') {
    return <Text type="secondary">场景尚未执行，报告待生成。</Text>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Summary stats */}
      <Row gutter={16}>
        <Col span={5}>
          <Statistic title="总步骤" value={totalSteps} />
        </Col>
        <Col span={5}>
          <Statistic title="PASS" value={passCount} valueStyle={{ color: '#22c55e' }} prefix={<CheckCircleOutlined />} />
        </Col>
        <Col span={5}>
          <Statistic title="FAIL" value={failCount} valueStyle={{ color: '#ef4444' }} prefix={<CloseCircleOutlined />} />
        </Col>
        <Col span={5}>
          <Statistic title="总耗时" value={duration} prefix={<ClockCircleOutlined />} />
        </Col>
        <Col span={4} style={{ display: 'flex', alignItems: 'center' }}>
          <Tag color={scenario.status === 'done' ? 'success' : scenario.status === 'aborted' ? 'warning' : 'processing'} style={{ fontSize: 13, padding: '4px 10px' }}>
            {scenario.status === 'done' ? '全部完成' : scenario.status === 'aborted' ? '已中止' : scenario.status}
          </Tag>
        </Col>
      </Row>

      <Divider style={{ margin: '4px 0' }} />

      {/* Per-step verify details */}
      {scenario.steps.filter(s => s.type === 'verify').map((step, i) => {
        const res = scenario.stepResults[step.id];
        if (!res) return null;
        const allPass = res.verifyDetails?.every(v => v.passed);
        return (
          <Card size="small" key={step.id}
            title={<Space><Text strong>{i + 1}. {step.label}</Text><Tag color={allPass ? 'success' : 'error'}>{allPass ? 'PASS' : 'FAIL'}</Tag></Space>}
          >
            {res.verifyDetails?.map(v => (
              <div key={v.rule.id} style={{ marginBottom: 4 }}>
                {v.passed ? <CheckCircleOutlined style={{ color: '#22c55e', marginRight: 6 }} /> : <CloseCircleOutlined style={{ color: '#ef4444', marginRight: 6 }} />}
                <Tag style={{ fontSize: 11 }}>{v.rule.type}</Tag>
                <code style={{ fontSize: 11 }}>{v.rule.value || '(exit=0)'}</code>
              </div>
            ))}
            {res.stdout && (
              <pre style={{ fontSize: 10, background: '#0d1117', color: '#d4d4d4', borderRadius: 4, padding: '6px 8px', maxHeight: 120, overflow: 'auto', margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {res.stdout.slice(0, 600)}
              </pre>
            )}
          </Card>
        );
      })}

      <Button icon={<DownloadOutlined />} onClick={handleExport} style={{ alignSelf: 'flex-start' }}>
        导出 Markdown 报告
      </Button>
    </div>
  );
};

export default ScenarioReport;
