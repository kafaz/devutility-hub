/**
 * NumberConverter — 多进制转换工具
 *
 * 用户在任意一个进制输入框中粘贴/输入数字，
 * 其余三个进制实时自动更新。
 *
 * 特性：
 *   - 二进制每 4 位（nibble）插入空格，视觉上更易读
 *   - 每个进制独立复制按钮：二进制复制不含空格（直接可用于代码）
 *   - 位宽选择（8 / 16 / 32 / 64 / 自动）：自动补零，显示对齐后的位模式
 *   - 超范围警告（超出所选位宽时提示溢出）
 *   - 使用 BigInt 保证大数精度
 */
import React, { useState, useCallback } from 'react';
import {
  Typography, Input, Button, Space, Card, Tag,
  Tooltip, Segmented, Alert, message,
} from 'antd';
import {
  CopyOutlined, CheckOutlined, NumberOutlined,
} from '@ant-design/icons';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;

// ─── 类型 ──────────────────────────────────────────────────────────────────

type Base     = 'bin' | 'oct' | 'dec' | 'hex';
type BitWidth = 'auto' | '8' | '16' | '32' | '64';

// ─── 常量 ──────────────────────────────────────────────────────────────────

const BASE_RADIX: Record<Base, number> = { bin: 2, oct: 8, dec: 10, hex: 16 };

const BASE_LABEL: Record<Base, string> = {
  bin: '二进制',
  oct: '八进制',
  dec: '十进制',
  hex: '十六进制',
};

const BASE_PREFIX: Record<Base, string> = {
  bin: '0b',
  oct: '0o',
  dec: '',
  hex: '0x',
};

const BASE_COLOR: Record<Base, string> = {
  bin: '#3b82f6',
  oct: '#8b5cf6',
  dec: '#22c55e',
  hex: '#f59e0b',
};

// 合法输入字符集
const BASE_PATTERN: Record<Base, RegExp> = {
  bin: /^[01\s]*$/,
  oct: /^[0-7]*$/,
  dec: /^\d*$/,
  hex: /^[0-9a-fA-F]*$/,
};


// ─── 核心转换逻辑 ──────────────────────────────────────────────────────────

/** 将用户输入的字符串解析为 BigInt（失败返回 null） */
function parseValue(raw: string, base: Base): bigint | null {
  const clean = raw.replace(/[\s]/g, '');
  if (!clean) return null;
  if (!BASE_PATTERN[base].test(clean)) return null;
  try {
    const prefix = { bin: '0b', oct: '0o', dec: '', hex: '0x' }[base];
    return BigInt(prefix + clean.toLowerCase());
  } catch {
    return null;
  }
}

/**
 * 格式化二进制字符串：每 4 位（从右向左）插入空格
 * 示例：`11001100` → `1100 1100`
 *       `1101` → `1101`
 *       `11111` → `1 1111`
 */
function formatBinary(bin: string): string {
  const clean = bin.replace(/\s/g, '');
  if (!clean || clean === '0') return clean;
  // 从右向左每 4 位分组
  const groups: string[] = [];
  let i = clean.length;
  while (i > 0) {
    groups.unshift(clean.slice(Math.max(0, i - 4), i));
    i -= 4;
  }
  return groups.join(' ');
}

/** 将 BigInt 转换为对应进制字符串，并应用位宽填充 */
function toBased(
  value: bigint,
  base: Base,
  bitWidth: BitWidth
): string {
  let s = value.toString(BASE_RADIX[base]);
  if (base === 'hex') s = s.toUpperCase();

  if (bitWidth !== 'auto') {
    const bits   = parseInt(bitWidth);
    const digits = {
      bin: bits,
      oct: Math.ceil(bits / 3),
      dec: Math.ceil(bits / 3.32).toString().length + 1,
      hex: bits / 4,
    }[base];
    s = s.padStart(digits, '0');
  }

  if (base === 'bin') return formatBinary(s);
  return s;
}

/** 获取所选位宽对应的最大值 */
function maxForWidth(bitWidth: BitWidth): bigint | null {
  if (bitWidth === 'auto') return null;
  const bits = parseInt(bitWidth);
  return (2n ** BigInt(bits)) - 1n;
}

/** 按指定位宽进行字节交换（大小端转换） */
function byteSwap(value: bigint, bitWidth: number): bigint {
  const bytes = bitWidth / 8;
  let result = 0n;
  for (let i = 0; i < bytes; i++) {
    const byte = (value >> BigInt(i * 8)) & 0xFFn;
    result = (result << 8n) | byte;
  }
  return result;
}

/** 将数值转为可打印字符（ASCII / Unicode） */
function charFromValue(value: bigint): string | null {
  if (value < 0n || value > 0x10FFFFn) return null;
  try {
    return String.fromCodePoint(Number(value));
  } catch {
    return null;
  }
}

// ─── 单个进制输入框组件 ────────────────────────────────────────────────────

interface FieldProps {
  base:       Base;
  value:      string;          // 当前显示值（可能含空格，针对二进制）
  onChange:   (raw: string) => void;
  isDark:     boolean;
  isActive:   boolean;         // 是否正在被用户编辑
  overflow:   boolean;         // 是否超出位宽范围
  onFocus:    () => void;
  onBlur:     () => void;
}

const ConversionField: React.FC<FieldProps> = ({
  base, value, onChange, isDark, isActive, overflow, onFocus, onBlur,
}) => {
  const [copied, setCopied]   = useState(false);
  const [messageApi, ctx]     = message.useMessage();
  const color                 = BASE_COLOR[base];
  const bg                    = isDark ? '#252526' : '#ffffff';
  const border                = isDark ? '#3e3e42' : '#e4e4e7';
  const inputBg               = isDark ? '#1e1e1e' : '#f8f8f8';

  const handleCopy = async () => {
    // 二进制：复制去掉空格的纯净值（直接用于代码如 0b11001100）
    const copyValue = base === 'bin' ? value.replace(/\s/g, '') : value;
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(BASE_PREFIX[base] + copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      const hint = base === 'bin' ? '（已去除空格）' : '';
      messageApi.success(`已复制：${BASE_PREFIX[base]}${copyValue.slice(0, 20)}${copyValue.length > 20 ? '…' : ''}${hint}`);
    } catch {
      messageApi.error('复制失败');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // 二进制允许输入空格（用户可能粘贴含空格的值）
    if (base === 'bin') {
      if (/^[01\s]*$/.test(raw)) onChange(raw);
    } else if (BASE_PATTERN[base].test(raw)) {
      onChange(raw);
    }
  };

  return (
    <div style={{
      background: bg,
      border:     `1px solid ${isActive ? color : overflow ? '#ef4444' : border}`,
      borderLeft: `4px solid ${overflow ? '#ef4444' : color}`,
      borderRadius: 8,
      padding:    '12px 14px',
      transition: 'border-color 0.15s',
    }}>
      {ctx}

      {/* 标题行 */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:    8,
      }}>
        <Space size={6}>
          <Tag
            color={color}
            style={{ fontSize: 13, fontWeight: 600, padding: '1px 8px' }}
          >
            {BASE_LABEL[base]}
          </Tag>
          <Text
            type="secondary"
            style={{ fontSize: 11, fontFamily: 'JetBrains Mono, Consolas, monospace' }}
          >
            {BASE_PREFIX[base] || 'base-10'}  ·  {BASE_RADIX[base]}进制
          </Text>
          {overflow && (
            <Tag color="error" style={{ fontSize: 10 }}>⚠ 超出位宽</Tag>
          )}
        </Space>

        <Tooltip title={
          base === 'bin'
            ? `复制（不含空格）：${BASE_PREFIX[base]}${value.replace(/\s/g, '')}`
            : `复制：${BASE_PREFIX[base]}${value}`
        }>
          <Button
            size="small"
            icon={copied ? <CheckOutlined style={{ color: '#22c55e' }} /> : <CopyOutlined />}
            onClick={handleCopy}
            disabled={!value}
            style={{ minWidth: 32 }}
          />
        </Tooltip>
      </div>

      {/* 输入框 */}
      <Input
        value={value}
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={`输入${BASE_LABEL[base]}数字...`}
        style={{
          fontFamily:  'JetBrains Mono, Fira Code, Consolas, monospace',
          fontSize:     base === 'bin' ? 14 : 16,
          letterSpacing: base === 'bin' ? '0.05em' : 'normal',
          background:   inputBg,
          border:      'none',
          color:        isActive ? (isDark ? '#e4e4e7' : '#18181b') : color,
          fontWeight:   isActive ? 400 : 600,
          height:       40,
        }}
        allowClear
        onClear={() => onChange('')}
      />

      {/* 位数统计（仅二进制和十六进制显示） */}
      {value && (base === 'bin' || base === 'hex') && (
        <Text
          type="secondary"
          style={{ fontSize: 10, display: 'block', marginTop: 4 }}
        >
          {base === 'bin'
            ? `${value.replace(/\s/g, '').length} 位`
            : `${value.length} 个十六进制位 = ${value.length * 4} bits`}
        </Text>
      )}
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

const BASES: Base[] = ['bin', 'oct', 'dec', 'hex'];

const NumberConverter: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark    = theme === 'dark';

  // 每个进制的当前显示值
  const [values, setValues]     = useState<Record<Base, string>>({
    bin: '', oct: '', dec: '', hex: '',
  });
  const [bitWidth, setBitWidth] = useState<BitWidth>('auto');
  const [activeBase, setActiveBase] = useState<Base | null>(null);
  const [error, setError]       = useState('');
  const [operandB, setOperandB] = useState<string>('1');

  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  const handleByteSwap = (width: number) => {
    const decVal = values.dec.trim();
    if (!decVal) return;
    const bigVal = parseValue(decVal, 'dec');
    if (bigVal === null) return;
    const mask = (2n ** BigInt(width)) - 1n;
    const swapped = byteSwap(bigVal & mask, width);
    handleChange('dec', swapped.toString(10));
  };

  // 当用户在某个进制输入框中输入时的核心逻辑
  const handleChange = useCallback((base: Base, raw: string) => {
    const clean = raw.replace(/\s/g, '');

    if (!clean) {
      setValues({ bin: '', oct: '', dec: '', hex: '' });
      setError('');
      return;
    }

    const bigVal = parseValue(clean, base);

    if (bigVal === null) {
      // 非法字符：只更新当前字段，不影响其他字段
      setValues((prev) => ({ ...prev, [base]: raw }));
      setError(`"${clean}" 不是合法的${BASE_LABEL[base]}数`);
      return;
    }

    // 合法数字：更新所有进制
    const newValues: Record<Base, string> = {} as Record<Base, string>;
    BASES.forEach((b) => {
      if (b === base) {
        // 当前编辑的字段保留用户输入（含空格），不重新格式化
        newValues[b] = raw;
      } else {
        newValues[b] = toBased(bigVal, b, bitWidth);
      }
    });

    setValues(newValues);
    setError('');
  }, [bitWidth]);

  // 切换位宽时重新格式化所有字段（基于当前 dec 值推算）
  const handleBitWidthChange = (w: BitWidth) => {
    setBitWidth(w);
    const decVal = values.dec.trim();
    if (!decVal) return;
    const bigVal = parseValue(decVal, 'dec');
    if (bigVal === null) return;
    const newValues: Record<Base, string> = {} as Record<Base, string>;
    BASES.forEach((b) => {
      newValues[b] = toBased(bigVal, b, w);
    });
    setValues(newValues);
  };

  // 检查溢出（只有设定了具体位宽才检查）
  const maxVal = maxForWidth(bitWidth);
  const isOverflow = (base: Base): boolean => {
    if (!maxVal) return false;
    const clean = values[base].replace(/\s/g, '');
    if (!clean) return false;
    const v = parseValue(clean, base);
    return v !== null && v > maxVal;
  };

  // 快捷预设值按钮
  const QUICK_VALUES = [
    { label: '0',       dec: '0'          },
    { label: '0xFF',    dec: '255'         },
    { label: '0xFFFF',  dec: '65535'       },
    { label: '0xFFFFFFFF', dec: '4294967295' },
    { label: '1 << 31', dec: '2147483648'  },
  ];

  const handleQuickValue = (dec: string) => {
    handleChange('dec', dec);
  };

  const decValNum = values.dec.trim() ? parseValue(values.dec.trim(), 'dec') : null;
  const bValNum = operandB.trim() ? parseValue(operandB.trim(), 'dec') : null;
  const asciiChar = decValNum ? charFromValue(decValNum) : null;

  const bitwise = decValNum && bValNum ? {
    not: ~decValNum,
    and: decValNum & bValNum,
    or: decValNum | bValNum,
    xor: decValNum ^ bValNum,
    shl: decValNum << bValNum,
    shr: decValNum >> bValNum,
  } : null;

  const renderBitResult = (val: bigint) => (
    <Space size={8} wrap>
      <Text code style={{ fontSize: 12, color: '#f59e0b' }}>0x{val.toString(16).toUpperCase()}</Text>
      <Text code style={{ fontSize: 12, color: '#22c55e' }}>{val.toString(10)}</Text>
      <Text code style={{ fontSize: 12, color: '#3b82f6' }}>0b{formatBinary(val.toString(2))}</Text>
    </Space>
  );

  return (
    <div style={{ padding: 24 }}>
      {/* 标题 */}
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <NumberOutlined style={{ marginRight: 8 }} />
          进制转换
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          在任意进制输入数字，其余进制实时自动转换 · 二进制每 4 位自动分组
        </Text>
      </div>

      {/* 位宽选择 + 快捷预设 */}
      <Card
        size="small"
        style={{
          background:    isDark ? '#252526' : '#ffffff',
          border:        `1px solid ${borderColor}`,
          marginBottom:  16,
        }}
      >
        <div style={{
          display:        'flex',
          alignItems:     'center',
          gap:             16,
          flexWrap:       'wrap',
        }}>
          <Space size={8}>
            <Text style={{ fontSize: 13 }}>位宽：</Text>
            <Segmented
              size="small"
              value={bitWidth}
              onChange={(v) => handleBitWidthChange(v as BitWidth)}
              options={[
                { label: '自动',  value: 'auto' },
                { label: '8位',   value: '8'    },
                { label: '16位',  value: '16'   },
                { label: '32位',  value: '32'   },
                { label: '64位',  value: '64'   },
              ]}
            />
          </Space>

          <div
            style={{
              width:          1,
              height:         20,
              background:     borderColor,
              flexShrink:     0,
            }}
          />

          <Space size={6} wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>快捷值：</Text>
            {QUICK_VALUES.map((q) => (
              <Tag
                key={q.label}
                style={{
                  cursor:     'pointer',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  fontSize:   11,
                }}
                color="blue"
                onClick={() => handleQuickValue(q.dec)}
              >
                {q.label}
              </Tag>
            ))}
          </Space>
        </div>
      </Card>

      {/* 错误提示 */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 12 }}
          closable
          onClose={() => setError('')}
        />
      )}

      {/* 四个进制输入框 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {BASES.map((base) => (
          <ConversionField
            key={base}
            base={base}
            value={values[base]}
            onChange={(raw) => handleChange(base, raw)}
            isDark={isDark}
            isActive={activeBase === base}
            overflow={isOverflow(base)}
            onFocus={() => setActiveBase(base)}
            onBlur={() => {
              setActiveBase(null);
              // 失焦时对当前编辑字段重新格式化（特别是二进制加空格）
              const clean = values[base].replace(/\s/g, '');
              if (!clean) return;
              const v = parseValue(clean, base);
              if (v !== null) {
                setValues((prev) => ({
                  ...prev,
                  [base]: toBased(v, base, bitWidth),
                }));
              }
            }}
          />
        ))}
      </div>

      {/* ASCII / Unicode 显示 */}
      {asciiChar && (
        <Card
          size="small"
          style={{
            marginTop: 12,
            background: isDark ? '#252526' : '#ffffff',
            border: `1px solid ${borderColor}`,
          }}
        >
          <Space size={16} wrap>
            <Text style={{ fontSize: 13 }}>字符映射：</Text>
            <div
              style={{
                fontSize: 24,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                minWidth: 40,
                textAlign: 'center',
                padding: '4px 12px',
                background: isDark ? '#1e1e1e' : '#f8f8f8',
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
              }}
            >
              {asciiChar}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              U+{decValNum!.toString(16).toUpperCase().padStart(4, '0')}
            </Text>
          </Space>
        </Card>
      )}

      {/* 位运算面板 */}
      <Card
        size="small"
        title={<Text strong>位运算</Text>}
        style={{
          marginTop: 12,
          background: isDark ? '#252526' : '#ffffff',
          border: `1px solid ${borderColor}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 13 }}>操作数 B：</Text>
          <Input
            value={operandB}
            onChange={(e) => setOperandB(e.target.value.replace(/\s/g, ''))}
            placeholder="输入十进制或十六进制如 0xF"
            style={{ width: 200, fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 13 }}
          />
          {!bValNum && operandB.trim() && (
            <Text type="danger" style={{ fontSize: 12 }}>非法数字</Text>
          )}
        </div>
        {bitwise ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: '~A (NOT)', val: bitwise.not },
              { label: 'A & B (AND)', val: bitwise.and },
              { label: 'A | B (OR)', val: bitwise.or },
              { label: 'A ^ B (XOR)', val: bitwise.xor },
              { label: 'A << B (左移)', val: bitwise.shl },
              { label: 'A >> B (右移)', val: bitwise.shr },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Text type="secondary" style={{ fontSize: 12, minWidth: 90 }}>{item.label}</Text>
                {renderBitResult(item.val)}
              </div>
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            输入合法的 A（当前数值）和 B 后显示位运算结果。
          </Text>
        )}
      </Card>

      {/* 字节交换 / 大小端 */}
      <Card
        size="small"
        title={<Text strong>字节交换（大小端转换）</Text>}
        style={{
          marginTop: 12,
          background: isDark ? '#252526' : '#ffffff',
          border: `1px solid ${borderColor}`,
        }}
      >
        <Space size={8} wrap>
          {[16, 32, 64].map((w) => (
            <Button
              key={w}
              size="small"
              disabled={!decValNum}
              onClick={() => handleByteSwap(w)}
            >
              {w}-bit 交换
            </Button>
          ))}
        </Space>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          按指定位宽截取当前数值后进行字节反序（如 0x1234 → 0x3412）。
        </Text>
      </Card>

      {/* 说明提示 */}
      <div
        style={{
          marginTop:  16,
          padding:    '8px 12px',
          background: isDark ? '#252526' : '#f4f4f5',
          border:     `1px solid ${borderColor}`,
          borderRadius: 6,
        }}
      >
        <Text type="secondary" style={{ fontSize: 11 }}>
          💡 二进制复制时自动去除空格（如 <code>0b11001100</code>），可直接用于 C 代码。
          十六进制显示大写字母。位宽模式下输入超出范围时显示 ⚠ 超出位宽 警告。
        </Text>
      </div>
    </div>
  );
};

export default NumberConverter;
