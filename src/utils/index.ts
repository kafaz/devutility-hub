import type { GrepContextLine, GrepGroup, SOPTemplate, SOPCheck, SOPInstance } from '../types';

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

// ======================== SOP 模板 Markdown 格式规范 ========================
//
// 设计原则：人类可读、Git 友好、可逆解析（导出后再导入能还原完整结构）
//
// 格式示意：
//
//   # SOP: {name}
//
//   **分类**: {category}
//   **描述**: {description}
//
//   ## 常见根因提示
//
//   {diagnosisHints}
//
//   ## 排查步骤
//
//   ### 步骤 1: {check.name}
//
//   > {check.description}
//
//   ```bash
//   {check.command}
//   ```
//
//   - ✅ **正常**: {check.expectedNormal}
//   - ❌ **异常**: {check.abnormalSigns}
//
//   ---

/**
 * 将 SOPTemplate 序列化为 Markdown 字符串
 */
export function exportSOPTemplateToMarkdown(tpl: SOPTemplate): string {
  const checksSection = tpl.checks
    .sort((a, b) => a.order - b.order)
    .map(
      (c, i) =>
        `### 步骤 ${i + 1}: ${c.name}\n\n` +
        (c.description ? `> ${c.description}\n\n` : '') +
        `\`\`\`bash\n${c.command}\n\`\`\`\n\n` +
        (c.expectedNormal ? `- ✅ **正常**: ${c.expectedNormal}\n` : '') +
        (c.abnormalSigns ? `- ❌ **异常**: ${c.abnormalSigns}\n` : '')
    )
    .join('\n---\n\n');

  return `# SOP: ${tpl.name}

**分类**: ${tpl.category}
**描述**: ${tpl.description || ''}

## 常见根因提示

${tpl.diagnosisHints || '（暂无）'}

## 排查步骤

${checksSection}
`;
}

/**
 * 将 SOPTemplate 列表批量导出为单个 Markdown 文件
 * 各模板之间以 `---` + 两个换行分隔
 */
export function exportSOPTemplatesToMarkdown(tpls: SOPTemplate[]): string {
  return tpls
    .map((t) => exportSOPTemplateToMarkdown(t))
    .join('\n\n---\n\n');
}

/**
 * 从 Markdown 字符串解析 SOPTemplate（单个）
 *
 * 解析逻辑：
 *   1. `# SOP: {name}` 提取模板名
 *   2. `**分类**: {v}` / `**描述**: {v}` 提取元信息
 *   3. `## 常见根因提示` 下一段落作为 diagnosisHints
 *   4. `### 步骤 N: {name}` 开始每个 check；
 *      - `> {desc}` 提取描述
 *      - ````bash\n...\n``` ` 提取命令
 *      - `✅ **正常**: {v}` / `❌ **异常**: {v}` 提取预期特征
 */
export function parseSOPTemplateFromMarkdown(
  md: string
): Omit<SOPTemplate, 'id' | 'createdAt' | 'updatedAt'> | null {
  const lines = md.split('\n');

  // 提取模板名称
  const titleLine = lines.find((l) => /^#\s+SOP:\s+/.test(l));
  if (!titleLine) return null;
  const name = titleLine.replace(/^#\s+SOP:\s+/, '').trim();

  // 提取元信息字段
  const getMeta = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`**${key}**:`));
    return line ? line.replace(`**${key}**:`, '').trim() : '';
  };
  const category = getMeta('分类') || '其他';
  const description = getMeta('描述');

  // 提取常见根因提示（## 常见根因提示 到下一个 ## 之间的内容）
  let diagnosisHints = '';
  const hintsStart = lines.findIndex((l) => /^##\s+常见根因提示/.test(l));
  if (hintsStart !== -1) {
    const hintsLines: string[] = [];
    for (let i = hintsStart + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) break;
      hintsLines.push(lines[i]);
    }
    diagnosisHints = hintsLines.join('\n').trim();
    if (diagnosisHints === '（暂无）') diagnosisHints = '';
  }

  // 提取排查步骤（以 ### 步骤 N: 开头的段落）
  const checks: SOPCheck[] = [];
  let inCodeBlock = false;
  let currentCheck: Partial<SOPCheck> | null = null;
  let codeLines: string[] = [];
  let inChecksSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^##\s+排查步骤/.test(line)) {
      inChecksSection = true;
      continue;
    }
    if (!inChecksSection) continue;

    // 新步骤开始
    const stepMatch = line.match(/^###\s+步骤\s+\d+:\s+(.+)$/);
    if (stepMatch) {
      if (currentCheck) {
        currentCheck.command = codeLines.join('\n').trim();
        checks.push(finalizeCheck(currentCheck, checks.length));
      }
      currentCheck = { name: stepMatch[1].trim(), description: '', command: '', expectedNormal: '', abnormalSigns: '' };
      codeLines = [];
      inCodeBlock = false;
      continue;
    }

    if (!currentCheck) continue;

    // 代码块开闭
    if (line.startsWith('```bash') || line.startsWith('```shell')) {
      inCodeBlock = true;
      codeLines = [];
      continue;
    }
    if (line === '```' && inCodeBlock) {
      inCodeBlock = false;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // 描述行（> 开头）
    if (line.startsWith('> ') && !currentCheck.description) {
      currentCheck.description = line.replace(/^>\s+/, '').trim();
      continue;
    }

    // 正常/异常特征
    const normalMatch = line.match(/[-*]\s+✅\s+\*\*正常\*\*:\s+(.+)/);
    if (normalMatch) { currentCheck.expectedNormal = normalMatch[1].trim(); continue; }
    const abnormalMatch = line.match(/[-*]\s+❌\s+\*\*异常\*\*:\s+(.+)/);
    if (abnormalMatch) { currentCheck.abnormalSigns = abnormalMatch[1].trim(); continue; }
  }

  // 处理最后一个 check
  if (currentCheck) {
    if (codeLines.length > 0) currentCheck.command = codeLines.join('\n').trim();
    checks.push(finalizeCheck(currentCheck, checks.length));
  }

  return { name, category, description, diagnosisHints, checks };
}

function finalizeCheck(
  partial: Partial<SOPCheck>,
  index: number
): SOPCheck {
  return {
    id: generateId(),
    order: index + 1,
    name: partial.name || `步骤 ${index + 1}`,
    description: partial.description || '',
    command: partial.command || '',
    expectedNormal: partial.expectedNormal || '',
    abnormalSigns: partial.abnormalSigns || '',
  };
}

/**
 * 从包含多个模板的 Markdown 文件中批量解析
 * 文件中各模板之间以独立的 `---` 行分隔（不是步骤之间的 ---）
 */
export function parseSOPTemplatesFromMarkdown(
  md: string
): Array<Omit<SOPTemplate, 'id' | 'createdAt' | 'updatedAt'>> {
  // 以 `\n---\n` 且该行前后都是 `# SOP:` 级别内容为界分割
  // 简化策略：以 `\n# SOP:` 为分割点
  const parts = md.split(/(?=^# SOP:)/m).filter((p) => p.trim());
  return parts
    .map((part) => parseSOPTemplateFromMarkdown(part))
    .filter((t): t is Omit<SOPTemplate, 'id' | 'createdAt' | 'updatedAt'> => t !== null);
}

// ======================== 增强版故障报告 Markdown 导出 ========================

export interface ReportParams {
  instance: SOPInstance;
  templateName: string;
}

/**
 * 将 SOPInstance 导出为完整的故障排查报告 Markdown
 *
 * 包含：元信息、耗时、步骤执行记录（命令+输出+结论）、诊断结论四项
 */
export function generateInstanceReport(params: ReportParams): string {
  const { instance, templateName } = params;
  const allChecks = [...instance.checkResults, ...instance.extraChecks];

  const statusEmoji: Record<string, string> = {
    normal: '✅',
    abnormal: '❌',
    skipped: '⏭️',
    pending: '⏳',
  };
  const statusLabel: Record<string, string> = {
    normal: '正常',
    abnormal: '异常',
    skipped: '已跳过',
    pending: '未执行',
  };
  const instanceStatusLabel: Record<string, string> = {
    investigating: '排查中',
    resolved: '已解决',
    escalated: '已升级',
  };

  const startTime = new Date(instance.createdAt);
  const endTime = instance.resolvedAt ? new Date(instance.resolvedAt) : null;
  const durationMs = endTime ? endTime.getTime() - startTime.getTime() : null;
  const durationStr = durationMs
    ? (() => {
        const mins = Math.floor(durationMs / 60000);
        const secs = Math.floor((durationMs % 60000) / 1000);
        return mins > 0 ? `${mins} 分 ${secs} 秒` : `${secs} 秒`;
      })()
    : '进行中';

  const abnormalCount = allChecks.filter((r) => r.status === 'abnormal').length;

  // 进度摘要表格
  const summaryRows = allChecks
    .map(
      (r, i) =>
        `| ${i + 1} | ${r.checkName} | ${statusEmoji[r.status]} ${statusLabel[r.status]} | ${r.conclusion || '—'} |`
    )
    .join('\n');

  // 步骤详情
  const stepsSection = allChecks
    .map(
      (r, i) =>
        `### ${statusEmoji[r.status]} 步骤 ${i + 1}：${r.checkName}\n\n` +
        `**执行命令**\n\n\`\`\`bash\n${r.command || '（未记录）'}\n\`\`\`\n\n` +
        (r.output
          ? `**命令输出**\n\n\`\`\`\n${r.output}\n\`\`\`\n\n`
          : '') +
        (r.conclusion
          ? `**分析结论**：${r.conclusion}\n`
          : '_（未填写结论）_\n')
    )
    .join('\n---\n\n');

  return `# 故障排查报告

## 基本信息

| 项目 | 内容 |
|------|------|
| 故障标题 | ${instance.incidentTitle} |
| 排查模板 | ${templateName} |
| 排查状态 | ${statusEmoji[instance.status] ?? ''} ${instanceStatusLabel[instance.status] ?? instance.status} |
| 开始时间 | ${startTime.toLocaleString('zh-CN')} |
| 结束时间 | ${endTime ? endTime.toLocaleString('zh-CN') : '—'} |
| 排查耗时 | ${durationStr} |
| 步骤数量 | ${allChecks.length} 步（异常 ${abnormalCount} 项） |

## 步骤执行摘要

| # | 步骤 | 状态 | 结论 |
|---|------|------|------|
${summaryRows}

## 详细排查过程

${stepsSection}

## 诊断结论

### 故障现象

${instance.diagnosis.phenomenon || '_（未填写）_'}

### 根因分析

${instance.diagnosis.rootCause || '_（未填写）_'}

### 解决方案

${instance.diagnosis.solution || '_（未填写）_'}

### 预防措施

${instance.diagnosis.prevention || '_（未填写）_'}

---

> 由 **DevUtility Hub · SOP 故障排查工具** 生成  
> 生成时间：${new Date().toLocaleString('zh-CN')}
`;
}

// 保持旧函数不删除（InstanceRunner 还在调用）
export function generateMarkdownReport(params: {
  title: string;
  incidentTime: string;
  steps: { name: string; command: string; output: string; status: string; conclusion: string }[];
  diagnosis: { phenomenon: string; rootCause: string; solution: string; prevention: string };
}): string {
  const { title, incidentTime, steps, diagnosis } = params;
  const statusEmoji: Record<string, string> = {
    normal: '✅', abnormal: '❌', skipped: '⏭️', pending: '⏳',
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
  return `# 故障排查报告：${title}\n\n> 排查时间：${incidentTime}\n\n## 一、排查步骤\n\n${stepsSection}\n\n## 二、诊断结论\n\n### 故障现象\n\n${diagnosis.phenomenon || '（未填写）'}\n\n### 根因分析\n\n${diagnosis.rootCause || '（未填写）'}\n\n### 解决方案\n\n${diagnosis.solution || '（未填写）'}\n\n### 预防措施\n\n${diagnosis.prevention || '（未填写）'}\n\n---\n\n*由 DevUtility Hub SOP 工具生成*\n`;
}

/**
 * 统一的步骤输出判断函数
 *
 * 优先级：
 *   1. abnormalRegex 匹配 → 强制异常（无论 exit code）
 *   2. normalRegex   匹配 → 正常
 *   3. normalRegex   存在但未匹配 → 异常（期望匹配但没有）
 *   4. exit code 0   → 正常，非 0 → 异常
 *   5. 无任何信息    → null（由调用方决定）
 */
export function evaluateStepOutput(
  output: string,
  opts: {
    normalRegex?:   string;
    abnormalRegex?: string;
    exitCode?:      number;
  }
): { status: 'normal' | 'abnormal' | null; reason: string } {
  const text = output ?? '';

  // ① 异常正则优先（最高优先级）
  if (opts.abnormalRegex) {
    try {
      if (new RegExp(opts.abnormalRegex, 'im').test(text)) {
        return {
          status: 'abnormal',
          reason: `异常正则命中: /${opts.abnormalRegex}/`,
        };
      }
    } catch {
      // 无效正则：跳过
    }
  }

  // ② 正常正则
  if (opts.normalRegex) {
    try {
      const matched = new RegExp(opts.normalRegex, 'im').test(text);
      return {
        status: matched ? 'normal' : 'abnormal',
        reason: matched
          ? `正常正则命中: /${opts.normalRegex}/`
          : `正常正则未匹配: /${opts.normalRegex}/`,
      };
    } catch {
      // 无效正则：跳过
    }
  }

  // ③ exit code 回退
  if (opts.exitCode !== undefined) {
    return {
      status: opts.exitCode === 0 ? 'normal' : 'abnormal',
      reason: `exit ${opts.exitCode}`,
    };
  }

  return { status: null, reason: '无判断依据' };
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
