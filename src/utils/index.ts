import type { GrepContextLine, GrepGroup } from '../types';

// 生成唯一 ID
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 转义正则元字符
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * C格式字符串转正则表达式
 *
 * 解析 C printf-style 格式符并替换为对应的正则捕获组，
 * 非格式符部分的正则元字符会被自动转义。
 *
 * 支持的格式符:
 *   %d, %i  → ([-+]?\d+)
 *   %u      → (\d+)
 *   %f, %e, %g, %F, %E, %G  → ([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)
 *   %x, %X  → ([0-9a-fA-F]+)
 *   %s      → (\S+) 或在有后续定界文本时使用非贪婪 (.*?)
 *   %c      → (.)
 *   %%      → 字面量 %（不产生捕获组）
 *   长度修饰符 h/l/L/ll/hh 均被忽略
 */
export interface CFormatToken {
  type: 'literal' | 'format';
  raw: string;
  formatType?: string;
  captureGroup?: string;
  fieldType?: 'string' | 'number' | 'hex' | 'float';
}

export function parseCFormat(pattern: string): CFormatToken[] {
  const tokens: CFormatToken[] = [];
  // 匹配格式符: % [标志] [宽度] [精度] [长度修饰符] 类型字符
  const formatRe = /%%|%[-+ #0]*\d*(?:\.\d+)?(?:hh?|ll?|[Ljzt])?([diouxXeEfgGscp])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = formatRe.exec(pattern)) !== null) {
    // 处理格式符之前的字面量部分
    if (match.index > lastIndex) {
      tokens.push({
        type: 'literal',
        raw: pattern.slice(lastIndex, match.index),
      });
    }

    const full = match[0];
    if (full === '%%') {
      tokens.push({ type: 'literal', raw: '%' });
    } else {
      const typeChar = match[1];
      let captureGroup: string;
      let fieldType: CFormatToken['fieldType'];

      switch (typeChar) {
        case 'd':
        case 'i':
          captureGroup = '([-+]?\\d+)';
          fieldType = 'number';
          break;
        case 'o':
          captureGroup = '([0-7]+)';
          fieldType = 'number';
          break;
        case 'u':
          captureGroup = '(\\d+)';
          fieldType = 'number';
          break;
        case 'x':
        case 'X':
          captureGroup = '([0-9a-fA-F]+)';
          fieldType = 'hex';
          break;
        case 'e':
        case 'E':
        case 'f':
        case 'g':
        case 'G':
          captureGroup = '([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)';
          fieldType = 'float';
          break;
        case 's':
          // 默认先用 (\S+)，后续在组合阶段根据紧随文本决定是否改为 (.*?)
          captureGroup = '(\\S+)';
          fieldType = 'string';
          break;
        case 'c':
          captureGroup = '(.)';
          fieldType = 'string';
          break;
        case 'p':
          captureGroup = '(0x[0-9a-fA-F]+|\\d+)';
          fieldType = 'hex';
          break;
        default:
          captureGroup = '(.+?)';
          fieldType = 'string';
      }

      tokens.push({
        type: 'format',
        raw: full,
        formatType: typeChar,
        captureGroup,
        fieldType,
      });
    }

    lastIndex = match.index + full.length;
  }

  // 处理末尾剩余字面量
  if (lastIndex < pattern.length) {
    tokens.push({ type: 'literal', raw: pattern.slice(lastIndex) });
  }

  return tokens;
}

/**
 * 将 CFormatToken 列表转换为最终正则表达式字符串
 *
 * 对 %s 采用智能边界处理：若后面紧跟非空字面量定界符，
 * 则使用非贪婪 (.*?) 替代 (\S+)，避免过度匹配。
 */
export function buildRegexFromTokens(tokens: CFormatToken[]): string {
  let result = '^';

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'literal') {
      result += escapeRegex(tok.raw);
    } else {
      // %s 智能边界：若下一个 token 是非空字面量，则用非贪婪
      if (
        tok.formatType === 's' &&
        i + 1 < tokens.length &&
        tokens[i + 1].type === 'literal' &&
        tokens[i + 1].raw.trim().length > 0
      ) {
        result += '(.*?)';
      } else {
        result += tok.captureGroup!;
      }
    }
  }

  result += '$';
  return result;
}

// 解析 C 格式字符串，返回 { regex, fields }
export function cFormatToRegex(pattern: string): {
  regex: string;
  tokens: CFormatToken[];
} {
  const tokens = parseCFormat(pattern);
  const regex = buildRegexFromTokens(tokens);
  return { regex, tokens };
}

// 从模板字符串中提取变量名 ${varName}
export function extractTemplateVariables(template: string): string[] {
  const re = /\$\{([a-zA-Z_]\w*)\}/g;
  const vars: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      vars.push(m[1]);
    }
  }
  return vars;
}

// 根据变量值渲染命令模板
export function renderTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\$\{([a-zA-Z_]\w*)\}/g, (_, name) =>
    values[name] !== undefined ? values[name] : `\${${name}}`
  );
}

// 根据变量名推断控件类型
export function inferVariableType(
  name: string
): 'text' | 'number' | 'path' | 'select' {
  const lower = name.toLowerCase();
  if (/path|file|dir|folder/.test(lower)) return 'path';
  if (/port|num|count|size|limit|timeout/.test(lower)) return 'number';
  return 'text';
}

/**
 * 解析 grep -C N 的标准输出
 *
 * 输入格式（以下三种均支持）：
 *   1) 纯内容模式（无文件名/行号前缀）
 *   2) 带行号模式：`12-context` / `13:match`
 *   3) 带文件名模式：`file.log-12-ctx` / `file.log:13:match`
 *
 * 各分组之间以 `--` 单独一行分隔，函数将每个分组解析为
 * { lines: GrepContextLine[] } 结构，调用方决定哪行作为"主行"。
 */

export function parseGrepCOutput(text: string): GrepGroup[] {
  const rawGroups = text.split(/^--$/m);
  const groups: GrepGroup[] = [];

  rawGroups.forEach((block, gi) => {
    const rawLines = block.split('\n').filter((l) => l !== '');
    if (rawLines.length === 0) return;

    const lines: GrepContextLine[] = rawLines.map((raw) => {
      // 尝试匹配带文件名或行号的前缀
      // file.log:123:content  → match
      // file.log-123-content  → context
      // 123:content           → match
      // 123-content           → context
      const withFile = raw.match(/^(?:.+?)([:−-])(\d+)\1(.*)$/);
      if (withFile) {
        const sep = withFile[1];
        return {
          content: withFile[3],
          isMatch: sep === ':',
        };
      }
      // 无前缀：无法区分 match/context，全部标记为 context
      // 后续由调用方的正则规则来识别主匹配行
      return { content: raw, isMatch: false };
    });

    groups.push({
      groupIndex: gi,
      lines,
      parsedFields: {},
      matchedLineContent: '',
      matched: false,
    });
  });

  return groups;
}

// 从文本中提取 Markdown 导出内容（用于 SOP 报告）
export function generateMarkdownReport(params: {
  title: string;
  incidentTime: string;
  steps: { name: string; command: string; output: string; status: string; conclusion: string }[];
  diagnosis: { phenomenon: string; rootCause: string; solution: string; prevention: string };
}): string {
  const { title, incidentTime, steps, diagnosis } = params;
  const statusEmoji: Record<string, string> = {
    normal: '✅',
    abnormal: '❌',
    skipped: '⏭️',
    pending: '⏳',
  };

  const stepsSection = steps
    .map(
      (s, i) =>
        `### Step ${i + 1}: ${s.name} ${statusEmoji[s.status] ?? ''}\n\n` +
        `**命令**\n\`\`\`bash\n${s.command}\n\`\`\`\n\n` +
        (s.output ? `**输出**\n\`\`\`\n${s.output}\n\`\`\`\n\n` : '') +
        (s.conclusion ? `**分析**：${s.conclusion}\n` : '')
    )
    .join('\n---\n\n');

  return `# 故障排查报告：${title}

> 排查时间：${incidentTime}

## 一、排查步骤

${stepsSection}

## 二、诊断结论

### 故障现象

${diagnosis.phenomenon || '（未填写）'}

### 根因分析

${diagnosis.rootCause || '（未填写）'}

### 解决方案

${diagnosis.solution || '（未填写）'}

### 预防措施

${diagnosis.prevention || '（未填写）'}

---

*由 DevUtility Hub SOP 工具生成*
`;
}

// 导出 JSON 数据为文件下载
export function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
