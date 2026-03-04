import React, { useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Button,
  Input,
  Tooltip,
  Empty,
  Statistic,
  Row,
  Col,
  Card,
} from 'antd';
import {
  DownloadOutlined,
  SearchOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import type { ParseResult, ParseRule } from '../../../types';
import { downloadJSON } from '../../../utils';
import { useGlobalStore } from '../../../store/globalStore';

const { Text } = Typography;

interface Props {
  results: ParseResult[];
  rule: ParseRule | null;
  loading?: boolean;
}

const ResultTable: React.FC<Props> = ({ results, rule, loading }) => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const [globalFilter, setGlobalFilter] = useState('');
  const [showStats, setShowStats] = useState(false);

  const matchedResults = results.filter((r) => r.matched);
  const unmatchedResults = results.filter((r) => !r.matched);

  const fieldNames = useMemo(() => {
    if (!rule) return [];
    if (rule.mode === 'REGEX') {
      return rule.fieldMappings?.map((m) => m.fieldName) ?? [];
    }
    return rule.fields?.map((f) => f.name || `field${f.index}`) ?? [];
  }, [rule]);

  // 从实际结果中获取所有字段名（防止字段名为空时使用占位）
  const allFields = useMemo(() => {
    if (fieldNames.length > 0) return fieldNames;
    const allKeys = new Set<string>();
    matchedResults.forEach((r) => Object.keys(r.fields).forEach((k) => allKeys.add(k)));
    return [...allKeys];
  }, [fieldNames, matchedResults]);

  const filteredResults = useMemo(() => {
    if (!globalFilter.trim()) return matchedResults;
    const q = globalFilter.toLowerCase();
    return matchedResults.filter((r) => {
      if (r.rawLine.toLowerCase().includes(q)) return true;
      return Object.values(r.fields).some((v) =>
        String(v).toLowerCase().includes(q)
      );
    });
  }, [matchedResults, globalFilter]);

  const handleExportCSV = () => {
    if (filteredResults.length === 0) return;
    const header = ['line', ...allFields].join(',');
    const rows = filteredResults.map((r) =>
      [r.lineIndex + 1, ...allFields.map((f) => `"${String(r.fields[f] ?? '')}"`)]
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'log-analysis.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = () => {
    downloadJSON(filteredResults, 'log-analysis.json');
  };

  // 统计分析
  const statsData = useMemo(() => {
    const stats: Record<string, Record<string, number>> = {};
    allFields.forEach((field) => {
      const counter: Record<string, number> = {};
      matchedResults.forEach((r) => {
        const val = String(r.fields[field] ?? '');
        counter[val] = (counter[val] || 0) + 1;
      });
      // 只对枚举型字段做统计（唯一值数量 <= 50）
      if (Object.keys(counter).length <= 50) {
        stats[field] = counter;
      }
    });
    return stats;
  }, [allFields, matchedResults]);

  const columns: ColumnType<ParseResult>[] = [
    {
      title: '行号',
      dataIndex: 'lineIndex',
      width: 64,
      render: (v: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v + 1}
        </Text>
      ),
      sorter: (a, b) => a.lineIndex - b.lineIndex,
    },
    ...allFields.map((field): ColumnType<ParseResult> => ({
      title: field,
      dataIndex: ['fields', field],
      ellipsis: { showTitle: false },
      render: (v: string | number) => {
        const str = String(v ?? '');
        return (
          <Tooltip title={str.length > 50 ? str : undefined}>
            <Text style={{ fontSize: 12 }}>{str}</Text>
          </Tooltip>
        );
      },
      sorter: (a, b) => {
        const va = a.fields[field] ?? '';
        const vb = b.fields[field] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return va - vb;
        return String(va).localeCompare(String(vb));
      },
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
        <div style={{ padding: 8 }}>
          <Input
            size="small"
            value={selectedKeys[0] as string}
            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={() => confirm()}
            placeholder={`筛选 ${field}`}
            style={{ width: 180, marginBottom: 8, display: 'block' }}
          />
          <Space>
            <Button type="primary" size="small" onClick={() => confirm()}>
              筛选
            </Button>
            <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>
              重置
            </Button>
          </Space>
        </div>
      ),
      filterIcon: (filtered) => (
        <SearchOutlined style={{ color: filtered ? '#3b82f6' : undefined }} />
      ),
      onFilter: (value, record) =>
        String(record.fields[field] ?? '')
          .toLowerCase()
          .includes(String(value).toLowerCase()),
    })),
    {
      title: '原始行',
      dataIndex: 'rawLine',
      ellipsis: { showTitle: false },
      render: (v: string) => (
        <Tooltip title={v}>
          <Text
            type="secondary"
            style={{
              fontSize: 11,
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
            }}
          >
            {v}
          </Text>
        </Tooltip>
      ),
    },
  ];

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  if (!rule) {
    return (
      <Card
        style={{ background: cardBg, border: `1px solid ${borderColor}` }}
      >
        <Empty description="请先选择解析规则并运行解析" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 统计栏 */}
      <Row gutter={12}>
        <Col span={4}>
          <Card
            size="small"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            <Statistic
              title="总行数"
              value={results.length}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            size="small"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            <Statistic
              title={
                <Space size={4}>
                  <CheckCircleOutlined style={{ color: '#22c55e' }} />
                  匹配成功
                </Space>
              }
              value={matchedResults.length}
              valueStyle={{ fontSize: 20, color: '#22c55e' }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            size="small"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            <Statistic
              title={
                <Space size={4}>
                  <CloseCircleOutlined style={{ color: '#ef4444' }} />
                  未匹配
                </Space>
              }
              value={unmatchedResults.length}
              valueStyle={{ fontSize: 20, color: unmatchedResults.length > 0 ? '#ef4444' : undefined }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            size="small"
            style={{ background: cardBg, border: `1px solid ${borderColor}` }}
          >
            <Statistic
              title="匹配率"
              value={
                results.length > 0
                  ? ((matchedResults.length / results.length) * 100).toFixed(1)
                  : 0
              }
              suffix="%"
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 操作栏 */}
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Input
          size="small"
          prefix={<SearchOutlined />}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="全局搜索（行内容/字段值）"
          allowClear
          style={{ width: 260 }}
        />
        <Space>
          <Button
            size="small"
            icon={<BarChartOutlined />}
            onClick={() => setShowStats((v) => !v)}
          >
            {showStats ? '隐藏统计' : '字段统计'}
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExportCSV}>
            导出 CSV
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExportJSON}>
            导出 JSON
          </Button>
        </Space>
      </Space>

      {/* 字段频次统计 */}
      {showStats && Object.keys(statsData).length > 0 && (
        <Card
          size="small"
          title="字段频次统计"
          style={{ background: cardBg, border: `1px solid ${borderColor}` }}
        >
          <Row gutter={[12, 8]}>
            {Object.entries(statsData).map(([field, counter]) => {
              const sorted = Object.entries(counter).sort((a, b) => b[1] - a[1]);
              const top5 = sorted.slice(0, 8);
              return (
                <Col key={field} xs={24} sm={12} md={8}>
                  <Text strong style={{ fontSize: 12 }}>
                    {field}
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    {top5.map(([val, cnt]) => (
                      <div
                        key={val}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginBottom: 2,
                        }}
                      >
                        <div
                          style={{
                            height: 14,
                            width: `${Math.min(
                              100,
                              (cnt / matchedResults.length) * 100 * 3
                            )}%`,
                            background: '#3b82f6',
                            borderRadius: 2,
                            minWidth: 2,
                          }}
                        />
                        <Text style={{ fontSize: 11 }}>
                          {val || '<空>'} ({cnt})
                        </Text>
                      </div>
                    ))}
                    {sorted.length > 8 && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        ... 共 {sorted.length} 个不同值
                      </Text>
                    )}
                  </div>
                </Col>
              );
            })}
          </Row>
        </Card>
      )}

      {/* 结果表格 */}
      <Table
        dataSource={filteredResults}
        columns={columns}
        rowKey={(r) => r.lineIndex}
        size="small"
        loading={loading}
        pagination={{
          pageSize: 100,
          showSizeChanger: true,
          pageSizeOptions: [50, 100, 200, 500],
          showTotal: (total) => `共 ${total} 条匹配结果`,
        }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无匹配结果' }}
        style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
        }}
      />

      {/* 未匹配行 */}
      {unmatchedResults.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#a1a1aa' }}>
            <Text type="secondary">
              {unmatchedResults.length} 行未匹配（点击展开）
            </Text>
          </summary>
          <div
            style={{
              marginTop: 8,
              maxHeight: 200,
              overflow: 'auto',
              padding: 8,
              background: isDark ? '#2d2d30' : '#f4f4f5',
              borderRadius: 6,
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              fontSize: 11,
            }}
          >
            {unmatchedResults.slice(0, 200).map((r) => (
              <div key={r.lineIndex} style={{ lineHeight: 1.5 }}>
                <Text type="secondary">{r.lineIndex + 1}:</Text>{' '}
                <Text>{r.rawLine}</Text>
              </div>
            ))}
            {unmatchedResults.length > 200 && (
              <Text type="secondary">... 仅显示前200行</Text>
            )}
          </div>
        </details>
      )}
    </div>
  );
};

export default ResultTable;
