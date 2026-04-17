import React from 'react';
import { Card, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ConsistencyCheck, InconsistencyItem } from '../types';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<ConsistencyCheck['status'], string> = {
  pending: 'default',
  running: 'processing',
  pass: 'success',
  fail: 'error',
  error: 'warning',
};

const STATUS_LABELS: Record<ConsistencyCheck['status'], string> = {
  pending: '待执行',
  running: '执行中',
  pass: '通过',
  fail: '失败',
  error: '异常',
};

interface Props {
  check: ConsistencyCheck | null;
}

const AnalysisReportPanel: React.FC<Props> = ({ check }) => {
  if (!check) {
    return (
      <Empty description="请选择一项检测规则查看报告" style={{ marginTop: 48 }} />
    );
  }

  const result = check.result;
  const hasInconsistencies = result && result.inconsistencies.length > 0;

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: InconsistencyItem['type']) => {
        const labels: Record<string, string> = {
          crc_mismatch: 'CRC 不一致',
          lba_diverge: 'LBA 偏离',
          metadata_diff: '元数据差异',
          custom: '自定义',
        };
        return <Tag>{labels[type] ?? type}</Tag>;
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: '位置',
      dataIndex: 'location',
      key: 'location',
      render: (location?: string) => location ?? '-',
    },
    {
      title: '预期值',
      dataIndex: 'expected',
      key: 'expected',
      render: (expected?: string) => expected ?? '-',
    },
    {
      title: '实际值',
      dataIndex: 'actual',
      key: 'actual',
      render: (actual?: Record<string, string>) => {
        if (!actual) return '-';
        return (
          <Space direction="vertical" size="small">
            {Object.entries(actual).map(([nodeId, value]) => (
              <Text key={nodeId} code>
                {nodeId}: {value}
              </Text>
            ))}
          </Space>
        );
      },
    },
    {
      title: '涉及节点',
      dataIndex: 'nodeIds',
      key: 'nodeIds',
      render: (nodeIds: string[]) => nodeIds.join(', '),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card size="small">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space>
              <Title level={5} style={{ margin: 0 }}>{check.name}</Title>
              <Tag color={STATUS_COLORS[check.status]}>{STATUS_LABELS[check.status]}</Tag>
            </Space>
            {result?.summary && <Text>{result.summary}</Text>}
            <Space size="large">
              <Text type="secondary">类型: {check.checkType}</Text>
              <Text type="secondary">触发时间: {check.triggeredAt ? new Date(check.triggeredAt).toLocaleString() : '-'}</Text>
              {check.completedAt && (
                <Text type="secondary">完成时间: {new Date(check.completedAt).toLocaleString()}</Text>
              )}
            </Space>
          </Space>
        </Card>

        {hasInconsistencies && (
          <Card size="small" title="不一致项">
            <Table
              dataSource={result!.inconsistencies}
              columns={columns}
              rowKey={(record, index) => `${record.type}-${index}`}
              pagination={false}
              size="small"
            />
          </Card>
        )}

        {result && (
          <Card size="small" title="各节点原始输出">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {Object.entries(result.rawOutputs).map(([nodeId, output]) => (
                <Card
                  key={nodeId}
                  size="small"
                  title={
                    <Space>
                      <Text strong>{nodeId}</Text>
                      <Tag color={output.exitCode === 0 ? 'success' : 'error'}>
                        exit: {output.exitCode}
                      </Tag>
                    </Space>
                  }
                  style={{ width: '100%' }}
                >
                  {output.stdout && (
                    <div style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>stdout</Text>
                      <pre style={{ background: '#f6f8fa', padding: 8, borderRadius: 4, overflow: 'auto', fontSize: 12, margin: 0 }}>
                        {output.stdout}
                      </pre>
                    </div>
                  )}
                  {output.stderr && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>stderr</Text>
                      <pre style={{ background: '#fff2f0', padding: 8, borderRadius: 4, overflow: 'auto', fontSize: 12, margin: 0 }}>
                        {output.stderr}
                      </pre>
                    </div>
                  )}
                </Card>
              ))}
            </Space>
          </Card>
        )}
      </Space>
    </div>
  );
};

export default AnalysisReportPanel;
