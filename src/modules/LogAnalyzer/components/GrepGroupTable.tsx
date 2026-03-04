import React, { useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Button,
  Input,
  Tooltip,
  Tag,
  Statistic,
  Row,
  Col,
  Card,
} from 'antd';
import {
  SearchOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { ColumnType } from 'antd/es/table';
import type { GrepGroup, ParseRule } from '../../../types';
// downloadJSON not needed here; CSV export is handled inline
import { useGlobalStore } from '../../../store/globalStore';

const { Text } = Typography;

interface Props {
  groups: GrepGroup[];
  rule: ParseRule | null;
  loading?: boolean;
}

// 将 grep context 行渲染为带高亮的代码块
const ContextBlock: React.FC<{
  lines: GrepGroup['lines'];
  isDark: boolean;
}> = ({ lines, isDark }) => (
  <div
    style={{
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.6,
      padding: '8px 12px',
      background: isDark ? '#1e1e1e' : '#f4f4f5',
      borderRadius: 4,
      maxHeight: 300,
      overflowY: 'auto',
    }}
  >
    {lines.map((line, i) => (
      <div
        key={i}
        style={{
          background: line.isMatch
            ? isDark
              ? 'rgba(59,130,246,0.15)'
              : 'rgba(59,130,246,0.08)'
            : 'transparent',
          borderLeft: line.isMatch ? '3px solid #3b82f6' : '3px solid transparent',
          paddingLeft: 6,
          marginBottom: 1,
          color: line.isMatch
            ? isDark
              ? '#93c5fd'
              : '#1d4ed8'
            : isDark
            ? '#9ca3af'
            : '#6b7280',
        }}
      >
        {line.isMatch && (
          <span style={{ color: '#3b82f6', marginRight: 4, userSelect: 'none' }}>▶</span>
        )}
        {line.content}
      </div>
    ))}
  </div>
);

const GrepGroupTable: React.FC<Props> = ({ groups, rule, loading }) => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const [globalFilter, setGlobalFilter] = useState('');

  const matched = groups.filter((g) => g.matched);
  const unmatched = groups.filter((g) => !g.matched);

  const fieldNames = useMemo(() => {
    if (!rule) return [];
    if (rule.mode === 'REGEX') return rule.fieldMappings?.map((m) => m.fieldName) ?? [];
    return rule.fields?.map((f) => f.name || `field${f.index}`) ?? [];
  }, [rule]);

  // 从实际数据中收集字段名（防止字段名为空）
  const allFields = useMemo(() => {
    if (fieldNames.length > 0) return fieldNames;
    const keys = new Set<string>();
    matched.forEach((g) => Object.keys(g.parsedFields).forEach((k) => keys.add(k)));
    return [...keys];
  }, [fieldNames, matched]);

  const filtered = useMemo(() => {
    if (!globalFilter.trim()) return matched;
    const q = globalFilter.toLowerCase();
    return matched.filter(
      (g) =>
        g.matchedLineContent.toLowerCase().includes(q) ||
        g.lines.some((l) => l.content.toLowerCase().includes(q)) ||
        Object.values(g.parsedFields).some((v) =>
          String(v).toLowerCase().includes(q)
        )
    );
  }, [matched, globalFilter]);

  const handleExportCSV = () => {
    const header = ['group', 'matched_line', ...allFields, 'context_lines'].join(',');
    const rows = filtered.map((g) =>
      [
        g.groupIndex + 1,
        `"${g.matchedLineContent}"`,
        ...allFields.map((f) => `"${String(g.parsedFields[f] ?? '')}"`),
        `"${g.lines.map((l) => l.content).join(' | ')}"`,
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grep-groups.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const columns: ColumnType<GrepGroup>[] = [
    {
      title: '组',
      dataIndex: 'groupIndex',
      width: 52,
      render: (v: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          #{v + 1}
        </Text>
      ),
    },
    ...allFields.map((field): ColumnType<GrepGroup> => ({
      title: field,
      dataIndex: ['parsedFields', field],
      ellipsis: { showTitle: false },
      render: (v: string | number) => (
        <Tooltip title={String(v ?? '').length > 50 ? String(v ?? '') : undefined}>
          <Text style={{ fontSize: 12 }}>{String(v ?? '')}</Text>
        </Tooltip>
      ),
      sorter: (a, b) => {
        const va = a.parsedFields[field] ?? '';
        const vb = b.parsedFields[field] ?? '';
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
            <Button type="primary" size="small" onClick={() => confirm()}>筛选</Button>
            <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>重置</Button>
          </Space>
        </div>
      ),
      filterIcon: (filtered) => (
        <SearchOutlined style={{ color: filtered ? '#3b82f6' : undefined }} />
      ),
      onFilter: (value, record) =>
        String(record.parsedFields[field] ?? '')
          .toLowerCase()
          .includes(String(value).toLowerCase()),
    })),
    {
      title: '主匹配行',
      dataIndex: 'matchedLineContent',
      ellipsis: { showTitle: false },
      render: (v: string) => (
        <Tooltip title={v}>
          <Text
            style={{
              fontSize: 11,
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              color: isDark ? '#93c5fd' : '#1d4ed8',
            }}
          >
            {v}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '上下文行数',
      width: 90,
      render: (_: unknown, record: GrepGroup) => (
        <Tag color="default" style={{ fontSize: 11 }}>
          {record.lines.length} 行
        </Tag>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 统计栏 */}
      <Row gutter={12}>
        {[
          { label: '总分组数', value: groups.length, color: undefined },
          {
            label: <Space size={4}><CheckCircleOutlined style={{ color: '#22c55e' }} />规则命中</Space>,
            value: matched.length,
            color: '#22c55e',
          },
          {
            label: <Space size={4}><CloseCircleOutlined style={{ color: '#ef4444' }} />未命中</Space>,
            value: unmatched.length,
            color: unmatched.length > 0 ? '#ef4444' : undefined,
          },
          {
            label: '平均上下文',
            value:
              groups.length > 0
                ? (groups.reduce((s, g) => s + g.lines.length, 0) / groups.length).toFixed(1)
                : 0,
            color: undefined,
          },
        ].map((stat, i) => (
          <Col key={i} span={6}>
            <Card size="small" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
              <Statistic
                title={stat.label}
                value={stat.value}
                valueStyle={{ fontSize: 20, color: stat.color }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 操作栏 */}
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Input
          size="small"
          prefix={<SearchOutlined />}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="搜索字段值或上下文内容"
          allowClear
          style={{ width: 280 }}
        />
        <Button size="small" icon={<DownloadOutlined />} onClick={handleExportCSV}>
          导出 CSV
        </Button>
      </Space>

      {/* 分组表格（带可展开上下文） */}
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey={(r) => r.groupIndex}
        size="small"
        loading={loading}
        expandable={{
          expandedRowRender: (record) => (
            <div style={{ padding: '4px 0' }}>
              <Text
                type="secondary"
                style={{ fontSize: 11, display: 'block', marginBottom: 6 }}
              >
                完整上下文（{record.lines.length} 行，蓝色高亮行为规则命中行）
              </Text>
              <ContextBlock lines={record.lines} isDark={isDark} />
            </div>
          ),
          rowExpandable: (record) => record.lines.length > 0,
        }}
        pagination={{
          pageSize: 50,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (total) => `${total} 个分组`,
        }}
        scroll={{ x: 'max-content' }}
        style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
        }}
      />

      {/* 未命中分组 */}
      {unmatched.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#a1a1aa' }}>
            <Text type="secondary">
              {unmatched.length} 个分组未被规则命中（点击展开）
            </Text>
          </summary>
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: isDark ? '#2d2d30' : '#f4f4f5',
              borderRadius: 6,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {unmatched.map((g) => (
              <div key={g.groupIndex} style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  分组 #{g.groupIndex + 1}（{g.lines.length} 行）
                </Text>
                <ContextBlock lines={g.lines} isDark={isDark} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default GrepGroupTable;
