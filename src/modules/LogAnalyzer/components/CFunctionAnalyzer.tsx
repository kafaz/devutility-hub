/**
 * CFunctionAnalyzer — C 日志函数调用参数分析器
 *
 * 工作流：
 *   ① 粘贴 C 日志宏调用（含格式串和参数名）
 *   ② 一键解析 → 自动提取格式串 + 参数名 + 生成正则
 *   ③ 粘贴实际日志输出（支持多行）
 *   ④ 展示：每行日志 → 字段名 : 值 的结构化结果
 *
 * 示例：
 *   输入：LOG_ERROR_WITH_TRACE("%u ,%u, %u, %u", age, status, time, fail_times);
 *   日志：12 ,5, 1609459200, 3
 *   输出：
 *     age        : 12
 *     status     : 5
 *     time       : 1609459200
 *     fail_times : 3
 */
import React, { useState, useCallback } from 'react';
import {
  Typography, Input, Button, Space, Card, Tag, Alert,
  Table, Tooltip, Switch, Divider, Badge, message,
} from 'antd';
import {
  SearchOutlined, CopyOutlined, CheckCircleOutlined,
  CloseCircleOutlined, InfoCircleOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { parseCLogMacroCall, applyCLogRule, cFormatToRegex, downloadJSON } from '../../../utils';
import type { ParsedCLogCall } from '../../../utils';
import { useGlobalStore } from '../../../store/globalStore';
import { useClipboard } from '../../../hooks/useClipboard';
import ResizableOutput from '../../../components/shared/ResizableOutput';

const { Text } = Typography;
const { TextArea } = Input;

// ─── 类型 ──────────────────────────────────────────────────────────────────

interface MatchResult {
  lineIndex: number;
  rawLine:   string;
  matched:   boolean;
  fields:    Record<string, string>;
}

// ─── 行结果卡片（<=3行时使用，更直观） ────────────────────────────────────

const FieldCard: React.FC<{
  result:     MatchResult;
  paramNames: string[];
  isDark:     boolean;
}> = ({ result, paramNames, isDark }) => {
  const { copy } = useClipboard();
  const maxLen = Math.max(...paramNames.map((n) => n.length), 4);

  return (
    <div
      style={{
        padding:       '10px 14px',
        background:    isDark ? '#2d2d30' : '#fafafa',
        border:        `1px solid ${result.matched
          ? isDark ? '#22c55e33' : '#bbf7d0'
          : isDark ? '#ef444433' : '#fecaca'}`,
        borderLeft:    `4px solid ${result.matched ? '#22c55e' : '#ef4444'}`,
        borderRadius:   6,
        marginBottom:   8,
        fontFamily:    'JetBrains Mono, Fira Code, Consolas, monospace',
      }}
    >
      {/* 行号 + 原始行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <Space size={6}>
          {result.matched
            ? <CheckCircleOutlined style={{ color: '#22c55e' }} />
            : <CloseCircleOutlined style={{ color: '#ef4444' }} />}
          <Text type="secondary" style={{ fontSize: 11 }}>
            行 {result.lineIndex + 1}
          </Text>
        </Space>
        <Tooltip title="复制原始行">
          <CopyOutlined
            style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
            onClick={() => copy(result.rawLine)}
          />
        </Tooltip>
      </div>

      {!result.matched ? (
        <Text type="danger" style={{ fontSize: 12 }}>
          ✗ 未匹配：{result.rawLine}
        </Text>
      ) : (
        <div>
          {paramNames.map((name) => (
            <div
              key={name}
              style={{
                display:      'flex',
                alignItems:   'baseline',
                gap:           12,
                marginBottom:  4,
                fontSize:      13,
              }}
            >
              {/* 参数名（对齐） */}
              <span
                style={{
                  minWidth:   maxLen * 8,
                  color:      isDark ? '#93c5fd' : '#1d4ed8',
                  fontWeight: 600,
                  flexShrink:  0,
                }}
              >
                {name.padEnd(maxLen)}
              </span>
              <span style={{ color: isDark ? '#9ca3af' : '#6b7280', flexShrink: 0 }}>:</span>
              {/* 值 */}
              <span
                style={{
                  color:    isDark ? '#fbbf24' : '#92400e',
                  wordBreak: 'break-all',
                }}
              >
                {result.fields[name] ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

const CFunctionAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark    = theme === 'dark';
  const [messageApi, ctx] = message.useMessage();

  // ① 函数调用输入
  const [macroInput, setMacroInput] = useState('');
  const [parsed,     setParsed]     = useState<ParsedCLogCall | null>(null);
  const [parseError, setParseError] = useState('');
  const [anchored,   setAnchored]   = useState(false); // false=日志行含前缀时也能匹配

  // ② 日志输入
  const [logInput,   setLogInput]   = useState('');
  const [results,    setResults]    = useState<MatchResult[]>([]);

  const cardBg     = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  // ── 解析 C 函数调用 ──────────────────────────────────────────────────────
  const handleParse = useCallback(() => {
    if (!macroInput.trim()) { setParseError('请输入 C 日志宏调用'); return; }
    const result = parseCLogMacroCall(macroInput);
    if (!result) {
      setParseError('解析失败：请确认格式为 MACRO("格式串", 参数1, 参数2, ...)');
      setParsed(null);
      return;
    }
    setParsed(result);
    setParseError('');
    setResults([]);
  }, [macroInput]);

  // ── 分析日志行 ────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(() => {
    if (!parsed)          { messageApi.warning('请先解析函数调用'); return; }
    if (!logInput.trim()) { messageApi.warning('请输入日志内容');   return; }

    const lines = logInput.split('\n').filter((l) => l.trim());
    const matchResults: MatchResult[] = lines.map((line, i) => {
      const { matched, fields } = applyCLogRule(line, parsed, anchored);
      return { lineIndex: i, rawLine: line, matched, fields };
    });
    setResults(matchResults);
  }, [parsed, logInput, anchored, messageApi]);

  // ── 导出结果 ──────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (results.length === 0) return;
    const data = results.map((r) => ({
      line:    r.lineIndex + 1,
      matched: r.matched,
      raw:     r.rawLine,
      ...r.fields,
    }));
    downloadJSON(data, `c-log-analysis.json`);
  };

  const matchCount   = results.filter((r) => r.matched).length;
  const useCardView  = results.length <= 5;

  // 生成当前正则预览
  const regexPreview = parsed
    ? (() => { try { return cFormatToRegex(parsed.formatString, anchored).regex; } catch { return ''; } })()
    : '';

  // Table 列（多行模式）
  const tableColumns = parsed
    ? [
        {
          title:      '行号',
          dataIndex:  'lineIndex',
          width:       52,
          render:     (v: number) => <Text type="secondary" style={{ fontSize: 11 }}>{v + 1}</Text>,
        },
        {
          title:      '状态',
          dataIndex:  'matched',
          width:       60,
          render:     (v: boolean) =>
            v ? <CheckCircleOutlined style={{ color: '#22c55e' }} />
              : <CloseCircleOutlined style={{ color: '#ef4444' }} />,
        },
        ...parsed.paramNames.map((name) => ({
          title:      name,
          key:        name,
          ellipsis:   { showTitle: false },
          render:     (_: unknown, rec: MatchResult) => (
            <Tooltip title={rec.fields[name]}>
              <Text
                style={{
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  fontSize:    12,
                  color:       isDark ? '#fbbf24' : '#92400e',
                }}
              >
                {rec.matched ? (rec.fields[name] ?? '—') : <Text type="secondary">—</Text>}
              </Text>
            </Tooltip>
          ),
        })),
        {
          title:      '原始行',
          dataIndex:  'rawLine',
          ellipsis:   { showTitle: false },
          render:     (v: string) => (
            <Tooltip title={v}>
              <Text type="secondary" style={{ fontSize: 11, fontFamily: 'JetBrains Mono, Consolas, monospace' }}>
                {v}
              </Text>
            </Tooltip>
          ),
        },
      ]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ctx}

      {/* ① 输入 C 函数调用 */}
      <Card
        size="small"
        title={
          <Space>
            <Text strong>① 粘贴 C 日志宏调用</Text>
            <Tooltip title="支持任意 C 日志宏，如 LOG_ERROR / printf / LOGTRACE 等，要求第一个参数是格式字符串">
              <InfoCircleOutlined style={{ color: '#6b7280' }} />
            </Tooltip>
          </Space>
        }
        style={{ background: cardBg, border: `1px solid ${borderColor}` }}
      >
        <TextArea
          value={macroInput}
          onChange={(e) => setMacroInput(e.target.value)}
          rows={3}
          placeholder={
            'LOG_ERROR_WITH_TRACE("%u ,%u, %u, %u", age, status, time, fail_times);\n' +
            '// 或：\n' +
            'LOG_DEBUG("[%s] action=%d elapsed=%lu", ctx->name, action_type, elapsed_ms);'
          }
          style={{
            fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
            fontSize:    12,
            background:  isDark ? '#1e1e1e' : '#f8f8f8',
            resize:     'vertical',
          }}
          onPressEnter={(e) => { if (e.ctrlKey) handleParse(); }}
        />
        <Space style={{ marginTop: 8 }}>
          <Button type="primary" icon={<SearchOutlined />} onClick={handleParse}>
            解析函数调用
          </Button>
          <Text type="secondary" style={{ fontSize: 11 }}>Ctrl+Enter</Text>
        </Space>
        {parseError && (
          <Alert type="error" showIcon message={parseError} style={{ marginTop: 8 }} />
        )}
      </Card>

      {/* 解析结果预览 */}
      {parsed && (
        <Card
          size="small"
          title={<Text strong>解析结果</Text>}
          style={{ background: cardBg, border: `1px solid #22c55e44` }}
          extra={
            parsed.mismatch && (
              <Tag color="warning">
                ⚠️ 格式符 {parsed.specifierCount} 个 ≠ 参数 {parsed.paramNames.length} 个
              </Tag>
            )
          }
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {/* 宏名 */}
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>函数/宏名</Text>
              <div>
                <Tag color="purple" style={{ fontSize: 12, fontFamily: 'JetBrains Mono, Consolas, monospace' }}>
                  {parsed.macroName}
                </Tag>
              </div>
            </div>

            {/* 格式串 */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>格式字符串</Text>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                  fontSize:    12,
                  color:       isDark ? '#93c5fd' : '#1d4ed8',
                  background:  isDark ? '#1e3a5f' : '#eff6ff',
                  padding:    '2px 8px',
                  borderRadius: 4,
                  marginTop:   2,
                }}
              >
                &quot;{parsed.formatString}&quot;
              </div>
            </div>

            {/* 参数列表 */}
            <div style={{ flex: 2, minWidth: 280 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                参数名（{parsed.paramNames.length} 个）
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {parsed.paramNames.map((name, i) => (
                  <Tooltip
                    key={i}
                    title={
                      parsed.paramExprs[i] !== name
                        ? `原始表达式: ${parsed.paramExprs[i]}`
                        : undefined
                    }
                  >
                    <Tag
                      color="blue"
                      style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
                    >
                      {name}
                    </Tag>
                  </Tooltip>
                ))}
              </div>
            </div>
          </div>

          {/* 生成的正则 */}
          <Divider style={{ margin: '10px 0 8px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>生成正则：</Text>
            <Text
              copyable={{ text: regexPreview }}
              style={{
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                fontSize:    11,
                color:       isDark ? '#a1a1aa' : '#6b7280',
                wordBreak:  'break-all',
              }}
            >
              {regexPreview}
            </Text>
            <Space size={6}>
              <Switch
                size="small"
                checked={anchored}
                onChange={setAnchored}
              />
              <Tooltip title="开启后正则加 ^ $ 锚点，要求格式串占满整行。日志行有时间戳/级别前缀时请关闭。">
                <Text type="secondary" style={{ fontSize: 11, cursor: 'help' }}>
                  严格匹配 ⓘ
                </Text>
              </Tooltip>
            </Space>
          </div>
        </Card>
      )}

      {/* ② 粘贴日志内容 */}
      {parsed && (
        <Card
          size="small"
          title={<Text strong>② 粘贴日志输出（支持多行）</Text>}
          style={{ background: cardBg, border: `1px solid ${borderColor}` }}
        >
          <ResizableOutput
            content={logInput}
            isDark={isDark}
            minHeight={100}
            maxHeight={400}
            showCopy={false}
            onChange={setLogInput}
            placeholder={
              '粘贴日志输出，每行对应一条日志记录，例如：\n' +
              '12 ,5, 1609459200, 3\n' +
              '18 ,2, 1609459230, 0'
            }
          />
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleAnalyze}>
              分析日志
            </Button>
            {results.length > 0 && (
              <>
                <Badge
                  count={matchCount}
                  color="#22c55e"
                  overflowCount={9999}
                  title={`${matchCount} 行匹配`}
                >
                  <Tag color="success">✅ 匹配</Tag>
                </Badge>
                {results.length - matchCount > 0 && (
                  <Badge
                    count={results.length - matchCount}
                    color="#ef4444"
                    overflowCount={9999}
                  >
                    <Tag color="error">❌ 未匹配</Tag>
                  </Badge>
                )}
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={handleExport}
                >
                  导出 JSON
                </Button>
              </>
            )}
          </Space>
        </Card>
      )}

      {/* ③ 分析结果 */}
      {results.length > 0 && parsed && (
        <Card
          size="small"
          title={
            <Space>
              <Text strong>分析结果</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {results.length} 行 · {matchCount} 匹配
              </Text>
            </Space>
          }
          style={{ background: cardBg, border: `1px solid ${borderColor}` }}
        >
          {useCardView ? (
            /* 少量行：卡片式展示，字段名对齐 */
            results.map((r) => (
              <FieldCard
                key={r.lineIndex}
                result={r}
                paramNames={parsed.paramNames}
                isDark={isDark}
              />
            ))
          ) : (
            /* 多行：紧凑表格 */
            <Table
              dataSource={results}
              columns={tableColumns}
              rowKey="lineIndex"
              size="small"
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                pageSizeOptions: [20, 50, 100],
                showTotal: (t) => `共 ${t} 行`,
              }}
              scroll={{ x: 'max-content' }}
              rowClassName={(r: MatchResult) => r.matched ? '' : 'ant-table-row-error'}
              style={{ borderRadius: 6, border: `1px solid ${borderColor}` }}
            />
          )}
        </Card>
      )}
    </div>
  );
};

export default CFunctionAnalyzer;
