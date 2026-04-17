import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  Form,
  Input,
  Typography,
  Space,
  Alert,
  Tag,
  Tooltip,
  Divider,
  Row,
  Col,
} from 'antd';
import type { ParseRule, CFormatField } from '../../../types';
import { parseCFormat, buildRegexFromTokens } from '../../../utils';
import { useDebounce } from '../../../hooks/useDebounce';

const { Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  initial?: ParseRule | null;
  onOk: (name: string, patternSource: string, fields: CFormatField[]) => void;
  onCancel: () => void;
}

// 格式符对应的类型
function specifierToFieldType(spec: string): CFormatField['type'] {
  const ch = spec.slice(-1);
  if (ch === 'x' || ch === 'X' || ch === 'p') return 'hex';
  if (ch === 'f' || ch === 'e' || ch === 'g' || ch === 'E' || ch === 'G') return 'float';
  if (ch === 's' || ch === 'c') return 'string';
  return 'number';
}

// 格式符颜色
function specifierColor(spec: string): string {
  const ch = spec.slice(-1);
  if (ch === 's' || ch === 'c') return '#f59e0b'; // amber
  if (ch === 'd' || ch === 'i' || ch === 'u') return '#3b82f6'; // blue
  if (ch === 'f' || ch === 'e' || ch === 'g' || ch === 'E' || ch === 'G') return '#8b5cf6'; // purple
  if (ch === 'x' || ch === 'X' || ch === 'p') return '#06b6d4'; // cyan
  return '#6b7280';
}

const FORMAT_SPECIFIER_HELP = [
  { spec: '%d / %i', desc: '有符号整数' },
  { spec: '%u', desc: '无符号整数' },
  { spec: '%f / %e / %g', desc: '浮点数' },
  { spec: '%x / %X', desc: '十六进制' },
  { spec: '%s', desc: '字符串（非空白）' },
  { spec: '%c', desc: '单个字符' },
  { spec: '%%', desc: '字面量 %' },
];

const CFormatRuleModal: React.FC<Props> = ({ open, initial, onOk, onCancel }) => {
  const [form] = Form.useForm();
  const [patternSource, setPatternSource] = useState('');
  const [batchNames, setBatchNames] = useState('');
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<{ matched: boolean; fields: Record<string, string> } | null>(null);

  const debouncedPattern = useDebounce(patternSource, 200);
  const tokens = parseCFormat(debouncedPattern);
  const formatTokens = tokens.filter((t) => t.type === 'format');
  const generatedRegex = buildRegexFromTokens(tokens);

  // 重置状态
  useEffect(() => {
    if (open) {
      if (initial && initial.mode === 'C_FORMAT') {
        form.setFieldsValue({ name: initial.name });
        setPatternSource(initial.patternSource || '');
        // 直接基于 initial.patternSource 计算初始 fieldNames，避免 debounce 空窗期被覆盖
        const initialFieldNames = (initial.fields || []).map((f) => f.name);
        const initialFormatCount = parseCFormat(initial.patternSource || '').filter(
          (t) => t.type === 'format'
        ).length;
        if (initialFormatCount > initialFieldNames.length) {
          setFieldNames([
            ...initialFieldNames,
            ...Array(initialFormatCount - initialFieldNames.length).fill(''),
          ]);
        } else {
          setFieldNames(initialFieldNames.slice(0, initialFormatCount));
        }
      } else {
        form.resetFields();
        setPatternSource('');
        setFieldNames([]);
      }
      setBatchNames('');
      setFocusedIndex(-1);
      setTestInput('');
      setTestResult(null);
    }
  }, [open, initial, form]);


  // 批量命名
  const handleBatchNames = useCallback(
    (val: string) => {
      setBatchNames(val);
      const parts = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      setFieldNames((prev) => {
        const next = [...prev];
        parts.forEach((p, i) => {
          if (i < next.length) next[i] = p;
        });
        return next;
      });
    },
    []
  );

  // 单个字段命名
  const handleFieldName = (index: number, val: string) => {
    setFieldNames((prev) => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  // Tab 键跳转到下一个胶囊
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const next = index + 1;
      if (next < formatTokens.length) {
        setFocusedIndex(next);
        const el = document.getElementById(`cformat-field-${next}`);
        el?.focus();
      } else {
        setFocusedIndex(-1);
      }
    }
  };

  // 实时测试
  const handleTest = () => {
    try {
      const re = new RegExp(generatedRegex);
      const m = re.exec(testInput);
      if (!m) {
        setTestResult({ matched: false, fields: {} });
        return;
      }
      const fields: Record<string, string> = {};
      formatTokens.forEach((_, i) => {
        const name = fieldNames[i] || `field${i + 1}`;
        fields[name] = m[i + 1] ?? '';
      });
      setTestResult({ matched: true, fields });
    } catch {
      setTestResult({ matched: false, fields: {} });
    }
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    if (!patternSource.trim()) {
      form.setFields([{ name: 'patternSource', errors: ['请输入 C 格式字符串'] }]);
      return;
    }
    const fields: CFormatField[] = formatTokens.map((tok, i) => ({
      index: i + 1,
      name: fieldNames[i] || `field${i + 1}`,
      type: specifierToFieldType(tok.raw),
      formatSpecifier: tok.raw,
    }));
    onOk(values.name, patternSource, fields);
  };

  // 渲染可视化格式串
  const renderFormatVisual = () => {
    if (!debouncedPattern) return null;
    let formatIdx = 0;
    return (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'center',
          padding: '10px 12px',
          background: 'rgba(0,0,0,0.15)',
          borderRadius: 6,
          fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.8,
        }}
      >
        {tokens.map((tok, i) => {
          if (tok.type === 'literal') {
            return (
              <span key={i} style={{ color: '#9ca3af' }}>
                {tok.raw}
              </span>
            );
          }
          const idx = formatIdx++;
          const named = fieldNames[idx];
          const color = named
            ? '#10b981' // emerald
            : specifierColor(tok.raw);
          const isActive = focusedIndex === idx;
          return (
            <Tooltip
              key={i}
              title={`捕获组 ${idx + 1}，类型：${specifierToFieldType(tok.raw)}`}
            >
              <div
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Input
                  id={`cformat-field-${idx}`}
                  size="small"
                  value={fieldNames[idx] || ''}
                  onChange={(e) => handleFieldName(idx, e.target.value)}
                  onFocus={() => setFocusedIndex(idx)}
                  onBlur={() => setFocusedIndex(-1)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  placeholder="字段名"
                  style={{
                    width: 80,
                    textAlign: 'center',
                    fontSize: 11,
                    height: 22,
                    padding: '0 4px',
                    border: `1px solid ${isActive ? '#3b82f6' : color}`,
                    borderRadius: 4,
                    background: 'transparent',
                    color,
                  }}
                />
                <span
                  style={{
                    background: `${color}22`,
                    border: `1px solid ${color}`,
                    borderRadius: 4,
                    padding: '0 6px',
                    color,
                    fontSize: 12,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setFocusedIndex(idx);
                    const el = document.getElementById(`cformat-field-${idx}`);
                    el?.focus();
                  }}
                >
                  {tok.raw}
                </span>
              </div>
            </Tooltip>
          );
        })}
      </div>
    );
  };

  return (
    <Modal
      title={initial ? '编辑 C格式规则' : '新建 C格式规则'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={760}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="name"
          label="规则名称"
          rules={[{ required: true, message: '请输入规则名称' }]}
        >
          <Input placeholder="例：自定义 C 格式日志" />
        </Form.Item>

        {/* 格式符说明 */}
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持的格式符：
          </Text>
          <Space size={4} wrap style={{ marginLeft: 8 }}>
            {FORMAT_SPECIFIER_HELP.map((h) => (
              <Tooltip key={h.spec} title={h.desc}>
                <Tag
                  style={{
                    fontFamily:
                      'JetBrains Mono, Fira Code, Consolas, monospace',
                    cursor: 'default',
                    fontSize: 11,
                  }}
                >
                  {h.spec}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        </div>

        <Form.Item
          name="patternSource"
          label="C 格式字符串"
          extra={
            <Text type="secondary" style={{ fontSize: 11 }}>
              例：[INFO] User %s login, id: %d, elapsed: %fms
            </Text>
          }
        >
          <Input
            style={{
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              fontSize: 13,
            }}
            value={patternSource}
            onChange={(e) => {
              const val = e.target.value;
              setPatternSource(val);
              form.setFieldValue('patternSource', val);
              // 同步 resize fieldNames，避免独立 effect 造成竞态覆盖
              const nextTokens = parseCFormat(val).filter((t) => t.type === 'format');
              setFieldNames((prev) => {
                if (nextTokens.length === prev.length) return prev;
                if (nextTokens.length > prev.length) {
                  return [
                    ...prev,
                    ...Array(nextTokens.length - prev.length).fill(''),
                  ];
                }
                return prev.slice(0, nextTokens.length);
              });
            }}
            placeholder="[INFO] User %s login, id: %d"
          />
        </Form.Item>
      </Form>

      {/* 可视化格式映射器 */}
      {formatTokens.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0 8px' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              可视化字段命名（点击或 Tab 切换）
            </Text>
          </Divider>

          {/* 批量命名输入 */}
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={24}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  size="small"
                  prefix={<Text type="secondary" style={{ fontSize: 12 }}>批量命名：</Text>}
                  value={batchNames}
                  onChange={(e) => handleBatchNames(e.target.value)}
                  placeholder={`逗号分隔，共 ${formatTokens.length} 个字段，例：uid, username, age`}
                  style={{ flex: 1 }}
                />
              </Space.Compact>
            </Col>
          </Row>

          {renderFormatVisual()}

          {/* 字段名称总览 */}
          {fieldNames.some(Boolean) && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                字段映射预览：
              </Text>
              <Space wrap size={4} style={{ marginLeft: 8 }}>
                {formatTokens.map((tok, i) => (
                  <Tag
                    key={i}
                    color={fieldNames[i] ? 'green' : 'default'}
                    style={{ fontSize: 11 }}
                  >
                    {fieldNames[i] || `field${i + 1}`}
                    <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                      ({tok.raw})
                    </Text>
                  </Tag>
                ))}
              </Space>
            </div>
          )}
        </>
      )}

      {/* 生成的正则预览 */}
      {debouncedPattern && (
        <>
          <Divider style={{ margin: '12px 0 8px' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              生成的正则表达式（只读）
            </Text>
          </Divider>
          <Paragraph
            copyable={{ text: generatedRegex }}
            style={{
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              fontSize: 12,
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.1)',
              borderRadius: 4,
              wordBreak: 'break-all',
              margin: 0,
            }}
          >
            {generatedRegex}
          </Paragraph>
        </>
      )}

      {/* 测试区 */}
      {debouncedPattern && (
        <>
          <Divider style={{ margin: '12px 0 8px' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              测试日志行
            </Text>
          </Divider>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="small"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="粘贴一行日志进行匹配测试"
              style={{
                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                fontSize: 12,
              }}
              onPressEnter={handleTest}
            />
            <Input.Search
              size="small"
              enterButton="测试"
              onSearch={handleTest}
              style={{ width: 80 }}
            />
          </Space.Compact>
          {testResult !== null && (
            <div style={{ marginTop: 8 }}>
              {!testResult.matched ? (
                <Alert message="未匹配" type="error" showIcon banner />
              ) : (
                <Alert
                  message={
                    <div>
                      <Text type="success" style={{ marginRight: 8 }}>
                        匹配成功
                      </Text>
                      {Object.entries(testResult.fields).map(([k, v]) => (
                        <Tag key={k} color="green" style={{ marginBottom: 2 }}>
                          <b>{k}</b>: {v}
                        </Tag>
                      ))}
                    </div>
                  }
                  type="success"
                  showIcon={false}
                  banner
                />
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

export default CFormatRuleModal;
