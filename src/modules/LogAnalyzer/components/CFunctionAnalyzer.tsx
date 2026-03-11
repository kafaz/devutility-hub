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
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    CopyOutlined,
    DownloadOutlined,
    EditOutlined,
    InfoCircleOutlined,
    SearchOutlined,
    ThunderboltOutlined
} from '@ant-design/icons';
import {
    Alert,
    Badge,
    Button,
    Card,
    Divider,
    Input,
    message,
    Space,
    Switch,
    Table,
    Tabs,
    Tag,
    Tooltip,
    Typography
} from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import ResizableOutput from '../../../components/shared/ResizableOutput';
import { useClipboard } from '../../../hooks/useClipboard';
import { useGlobalStore } from '../../../store/globalStore';
import { applyCLogRule, cFormatToRegex, downloadJSON, parseCLogMacroCall } from '../../../utils';
import { useLogStore } from '../store/logStore';

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
  paramNames: string[];  // 完整表达式，如 data->attr.key.value
  isDark:     boolean;
}> = ({ result, paramNames, isDark }) => {
  const { copy } = useClipboard();

  return (
    <div
      style={{
        padding:      '10px 14px',
        background:   isDark ? '#2d2d30' : '#fafafa',
        border:       `1px solid ${result.matched
          ? isDark ? '#22c55e33' : '#bbf7d0'
          : isDark ? '#ef444433' : '#fecaca'}`,
        borderLeft:   `4px solid ${result.matched ? '#22c55e' : '#ef4444'}`,
        borderRadius:  6,
        marginBottom:  8,
        fontFamily:   'JetBrains Mono, Fira Code, Consolas, monospace',
      }}
    >
      {/* 行号 + 原始行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space size={6}>
          {result.matched
            ? <CheckCircleOutlined style={{ color: '#22c55e' }} />
            : <CloseCircleOutlined style={{ color: '#ef4444' }} />}
          <Text type="secondary" style={{ fontSize: 11 }}>
            行 {result.lineIndex + 1}
          </Text>
          <Text
            type="secondary"
            style={{
              fontSize: 11, maxWidth: 360,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {result.rawLine}
          </Text>
        </Space>
        <Tooltip title="复制原始行">
          <CopyOutlined
            style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer', flexShrink: 0 }}
            onClick={() => copy(result.rawLine)}
          />
        </Tooltip>
      </div>

      {!result.matched ? (
        <Text type="danger" style={{ fontSize: 12 }}>
          ✗ 未匹配此行，请检查格式串是否与日志格式一致
        </Text>
      ) : (
        /* 表格式布局：变量名 | : | 值 */
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {paramNames.map((name, idx) => (
              <tr key={`${name}-${idx}`}>
                {/* 变量名列：完整显示，hover 展示全称 */}
                <td
                  style={{
                    verticalAlign:  'top',
                    paddingBottom:   4,
                    paddingRight:    8,
                    whiteSpace:     'nowrap',
                    maxWidth:        280,
                    overflow:       'hidden',
                    textOverflow:   'ellipsis',
                  }}
                >
                  <Tooltip title={name} placement="topLeft">
                    <span
                      style={{
                        color:      isDark ? '#93c5fd' : '#1d4ed8',
                        fontWeight:  600,
                        fontSize:    13,
                        display:    'inline-block',
                        maxWidth:    280,
                        overflow:   'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        verticalAlign: 'bottom',
                      }}
                    >
                      {name}
                    </span>
                  </Tooltip>
                </td>
                {/* 分隔符列 */}
                <td style={{ color: isDark ? '#6b7280' : '#9ca3af', paddingRight: 8, verticalAlign: 'top', paddingBottom: 4 }}>:</td>
                {/* 值列：可换行 */}
                <td style={{ verticalAlign: 'top', paddingBottom: 4 }}>
                  <span
                    style={{
                      color:      isDark ? '#fbbf24' : '#92400e',
                      fontSize:    13,
                      wordBreak:  'break-all',
                    }}
                  >
                    {result.fields[name] !== undefined ? result.fields[name] : '—'}
                  </span>
                </td>
                {/* 复制值 */}
                <td style={{ verticalAlign: 'top', paddingBottom: 4, paddingLeft: 8 }}>
                  {result.fields[name] !== undefined && (
                    <Tooltip title="复制值">
                      <CopyOutlined
                        style={{ fontSize: 11, color: '#6b7280', cursor: 'pointer' }}
                        onClick={() => copy(result.fields[name])}
                      />
                    </Tooltip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── 标签页名称编辑组件 ──────────────────────────────────────────────────────
const EditableTabName: React.FC<{
  name: string;
  onSave: (newName: string) => void;
}> = ({ name, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);

  if (editing) {
    return (
      <Input
        size="small"
        value={val}
        autoFocus
        onChange={e => setVal(e.target.value)}
        onBlur={() => { setEditing(false); if (val.trim()) onSave(val.trim()); else setVal(name); }}
        onPressEnter={() => { setEditing(false); if (val.trim()) onSave(val.trim()); else setVal(name); }}
        style={{ width: 120, fontSize: 12 }}
      />
    );
  }
  return (
    <Space size={4}>
      <Text style={{ fontSize: 13 }}>{name}</Text>
      <EditOutlined
        style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      />
    </Space>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

const CFunctionAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark    = theme === 'dark';
  const [messageApi, ctx] = message.useMessage();

  const {
    cMacroTabs, activeCMacroTabId, cfuncLogInput, cfuncAnchored, cfuncParsed, cfuncResults,
    addCMacroTab, updateCMacroTab, deleteCMacroTab, setActiveCMacroTab,
    setCfuncLogInput, setCfuncAnchored, setCfuncParsed, setCfuncResults
  } = useLogStore();

  const [parseError, setParseError] = useState('');

  // 初始化默认 Tab
  useEffect(() => {
    if (cMacroTabs.length === 0) {
      addCMacroTab('默认函数', '');
    }
  }, [cMacroTabs.length, addCMacroTab]);

  const activeTab = cMacroTabs.find(t => t.id === activeCMacroTabId) ?? cMacroTabs[0];
  const macroInput = activeTab?.macroInput ?? '';

  const cardBg     = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  // ── 解析 C 函数调用（已由下方 useEffect 自动触发，此处保留备用） ────────
  // const handleParse = useCallback((input: string) => {
  //   if (!input.trim()) { setParseError('请输入 C 日志宏调用'); setCfuncParsed(null); return; }
  //   const result = parseCLogMacroCall(input);
  //   if (!result) {
  //     setParseError('解析失败：请确认格式为 MACRO("格式串", 参数1, 参数2, ...)');
  //     setCfuncParsed(null);
  //     return;
  //   }
  //   setCfuncParsed(result);
  //   setParseError('');
  // }, [setCfuncParsed]);

  // 当 Tab 或宏内容变化时自动静默解析（以确保预览更新）
  useEffect(() => {
    // Use queueMicrotask to avoid cascading renders while preserving functionality
    queueMicrotask(() => {
      if (macroInput) {
        const result = parseCLogMacroCall(macroInput);
        if (result) {
          setCfuncParsed(result);
          setParseError('');
        } else {
          setParseError('解析失败：请确认格式符合 C/C++ 宏规范');
          setCfuncParsed(null);
        }
      } else {
        setParseError('');
        setCfuncParsed(null);
      }
    });
  }, [macroInput, setCfuncParsed]);


  const handleMacroChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (activeTab) {
      updateCMacroTab(activeTab.id, { macroInput: e.target.value });
      // Clear matching results when pattern changes
      setCfuncResults([]);
    }
  };

  // ── 自动匹配最佳 Tab ──────────────────────────────────────────────────────
  const handleAutoMatch = () => {
    if (!cfuncLogInput.trim()) { messageApi.warning('请先粘贴日志内容'); return; }
    if (cMacroTabs.length === 0) return;

    const lines = cfuncLogInput.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;
    const firstLine = lines[0];

    // 寻找匹配的模式
    for (const tab of cMacroTabs) {
      if (!tab.macroInput.trim()) continue;
      const parsed = parseCLogMacroCall(tab.macroInput);
      if (!parsed) continue;

      const { matched } = applyCLogRule(firstLine, parsed, cfuncAnchored);
      if (matched) {
        if (activeCMacroTabId !== tab.id) {
          setActiveCMacroTab(tab.id);
        }
        messageApi.success(`已自动匹配至: ${tab.name}`);
        
        // 自动触发一次分析
        const matchResults = lines.map((line, i) => {
          const { matched: m, fields } = applyCLogRule(line, parsed, cfuncAnchored);
          return { lineIndex: i, rawLine: line, matched: m, fields };
        });
        setCfuncResults(matchResults);
        return;
      }
    }
    messageApi.warning('未找到任何匹配的函数格式标签页');
  };

  // ── 分析日志行 ────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(() => {
    if (!cfuncParsed) { messageApi.warning('请确保函数调用解析成功'); return; }
    if (!cfuncLogInput.trim()) { messageApi.warning('请输入日志内容'); return; }

    const lines = cfuncLogInput.split('\n').filter((l) => l.trim());
    const matchResults = lines.map((line, i) => {
      const { matched, fields } = applyCLogRule(line, cfuncParsed, cfuncAnchored);
      return { lineIndex: i, rawLine: line, matched, fields };
    });
    setCfuncResults(matchResults);
  }, [cfuncParsed, cfuncLogInput, cfuncAnchored, setCfuncResults, messageApi]);

  // ── 导出结果 ──────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (cfuncResults.length === 0) return;
    const data = cfuncResults.map((r: MatchResult) => ({
      line:    r.lineIndex + 1,
      matched: r.matched,
      raw:     r.rawLine,
      ...r.fields,
    }));
    downloadJSON(data, 'c-log-analysis.json');
  };

  const matchCount   = cfuncResults.filter((r: MatchResult) => r.matched).length;
  const useCardView  = cfuncResults.length <= 5;

  // 生成当前正则预览
  const regexPreview = cfuncParsed
    ? (() => { try { return cFormatToRegex(cfuncParsed.formatString, cfuncAnchored).regex; } catch { return ''; } })()
    : '';

  // Table 列（多行模式）
  const tableColumns = cfuncParsed
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
        ...cfuncParsed.paramNames.map((name) => ({
          width:    Math.min(280, Math.max(120, name.length * 9 + 24)),
          ellipsis: { showTitle: false },
          title: (
            <Tooltip title={name} placement="topLeft">
              <span
                style={{
                  fontFamily:    'JetBrains Mono, Consolas, monospace',
                  fontSize:       12,
                  display:       'inline-block',
                  maxWidth:       260,
                  overflow:      'hidden',
                  textOverflow:  'ellipsis',
                  whiteSpace:    'nowrap',
                  verticalAlign: 'bottom',
                  color:          isDark ? '#93c5fd' : '#1d4ed8',
                  fontWeight:     600,
                }}
              >
                {name}
              </span>
            </Tooltip>
          ),
          key:      name,
          render:   (_: unknown, rec: MatchResult) => {
            const val = rec.matched ? (rec.fields[name] ?? '—') : '—';
            return (
              <Tooltip title={rec.matched && rec.fields[name] ? rec.fields[name] : undefined}>
                <Text
                  style={{
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                    fontSize:    12,
                    color:       rec.matched && rec.fields[name] !== undefined
                      ? (isDark ? '#fbbf24' : '#92400e')
                      : (isDark ? '#6b7280' : '#9ca3af'),
                  }}
                >
                  {val}
                </Text>
              </Tooltip>
            );
          },
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

  if (!activeTab) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ctx}

      {/* ① 分页选项卡与 C 函数调用 */}
      <Card
        size="small"
        style={{ background: cardBg, border: `1px solid \${borderColor}` }}
        bodyStyle={{ paddingTop: 0 }}
      >
        <Tabs
          type="editable-card"
          onChange={(k) => setActiveCMacroTab(k)}
          activeKey={activeTab.id}
          onEdit={(targetKey, action) => {
            if (action === 'add') {
              addCMacroTab(`新函数\${cMacroTabs.length + 1}`, '');
            } else if (action === 'remove' && typeof targetKey === 'string') {
              deleteCMacroTab(targetKey);
            }
          }}
          items={cMacroTabs.map((tab) => ({
            key: tab.id,
            label: <EditableTabName name={tab.name} onSave={(v) => updateCMacroTab(tab.id, { name: v })} />,
            children: null,
          }))}
          style={{ marginBottom: 16 }}
        />

        <div style={{ padding: '0 8px' }}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong>① 粘贴 C 日志宏调用</Text>
            <Tooltip title="支持任意 C 日志宏要求第一个参数是格式字符串。这会保存在当前标签页供随时复用。">
              <InfoCircleOutlined style={{ color: '#6b7280' }} />
            </Tooltip>
          </Space>

          <TextArea
            value={macroInput}
            onChange={handleMacroChange}
            rows={2}
            placeholder={
              'LOG_ERROR_WITH_TRACE("%u ,%u, %u", age, time, fail_times);\n' +
              '// 或：\n' +
              'printf("[%s] act=%d", name, action);'
            }
            style={{
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              fontSize:    12,
              background:  isDark ? '#1e1e1e' : '#f8f8f8',
              resize:     'vertical',
            }}
          />
          {parseError && (
            <Alert type="error" showIcon message={parseError} style={{ marginTop: 8, padding: '4px 12px' }} />
          )}
        </div>
      </Card>

      {/* 解析结果预览 */}
      {cfuncParsed && !parseError && (
        <Card
          size="small"
          title={<Text strong>解析结果</Text>}
          style={{ background: cardBg, border: `1px solid #22c55e44` }}
          extra={
            cfuncParsed.mismatch && (
              <Tag color="warning">
                ⚠️ 格式符 {cfuncParsed.specifierCount} 个 ≠ 参数 {cfuncParsed.paramNames.length} 个
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
                  {cfuncParsed.macroName}
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
                &quot;{cfuncParsed.formatString}&quot;
              </div>
            </div>

            {/* 参数列表：展示完整表达式，长名截断后 hover 显示全称 */}
            <div style={{ flex: 2, minWidth: 280 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                参数名（{cfuncParsed.paramNames.length} 个）
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {cfuncParsed.paramNames.map((name, i) => (
                  <Tooltip
                    key={i}
                    title={name.length > 30 ? name : undefined}
                    placement="top"
                  >
                    <Tag
                      color="blue"
                      style={{
                        fontFamily: 'JetBrains Mono, Consolas, monospace',
                        fontSize:    12,
                        maxWidth:    240,
                        overflow:   'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display:    'inline-block',
                        verticalAlign: 'middle',
                      }}
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
                checked={cfuncAnchored}
                onChange={setCfuncAnchored}
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
      <Card
        size="small"
        title={
          <Space>
            <Text strong>② 粘贴记录的日志</Text>
            <Tooltip title="在任何保存的页签下直接粘贴，然后点击自动匹配">
              <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} onClick={handleAutoMatch}>
                自动匹配标签页并分析
              </Button>
            </Tooltip>
          </Space>
        }
        style={{ background: cardBg, border: `1px solid \${borderColor}` }}
      >
        <ResizableOutput
          content={cfuncLogInput}
          isDark={isDark}
          minHeight={100}
          maxHeight={400}
          showCopy={false}
          onChange={setCfuncLogInput}
          placeholder={
            '粘贴日志输出，每行对应一条日志记录，例如：\n' +
            '12 ,5, 1609459200, 3\n' +
            '18 ,2, 1609459230, 0'
          }
        />
        <Space style={{ marginTop: 8 }}>
          <Button type="primary" icon={<SearchOutlined />} onClick={handleAnalyze} disabled={!cfuncParsed}>
            使用当前格式分析
          </Button>
          <Button onClick={() => setCfuncResults([])}>清空结果</Button>
          {cfuncResults.length > 0 && (
            <>
              <Badge
                count={matchCount}
                color="#22c55e"
                overflowCount={9999}
                title={`\${matchCount} 行匹配`}
              >
                <Tag color="success">✅ 匹配</Tag>
              </Badge>
              {cfuncResults.length - matchCount > 0 && (
                <Badge
                  count={cfuncResults.length - matchCount}
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

      {/* ③ 分析结果 */}
      {cfuncResults.length > 0 && cfuncParsed && (
        <Card
          size="small"
          title={
            <Space>
              <Text strong>分析结果</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {cfuncResults.length} 行 · {matchCount} 匹配
              </Text>
            </Space>
          }
          style={{ background: cardBg, border: `1px solid \${borderColor}` }}
        >
          {useCardView ? (
            /* 少量行：卡片式展示，字段名对齐 */
            cfuncResults.map((r: MatchResult) => (
              <FieldCard
                key={r.lineIndex}
                result={r}
                paramNames={cfuncParsed.paramNames}
                isDark={isDark}
              />
            ))
          ) : (
            /* 多行：紧凑表格 */
            <Table
              dataSource={cfuncResults}
              columns={tableColumns}
              rowKey="lineIndex"
              size="small"
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                pageSizeOptions: [20, 50, 100],
                showTotal: (total: number) => `共 ${total} 行`,
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
