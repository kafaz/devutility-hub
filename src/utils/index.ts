import type {
  GrepContextLine,
  GrepGroup,
  SOPCheck,
  SOPInstance,
  SOPSubStep,
  SOPTemplate,
} from '../types';

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
/**
 * 将 CFormatToken 列表转换为最终正则表达式字符串
 *
 * anchored（默认 true）：在首尾加 ^ $ 锚点，适合整行匹配。
 * anchored=false：去掉锚点，允许在日志行的任意位置匹配（有时间戳前缀时使用）。
 */
export function buildRegexFromTokens(
  tokens: CFormatToken[],
  anchored = true
): string {
  let result = anchored ? '^' : '';

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'literal') {
      result += escapeRegex(tok.raw);
    } else {
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

  result += anchored ? '$' : '';
  return result;
}

// 解析 C 格式字符串，返回 { regex, fields }
export function cFormatToRegex(pattern: string, anchored = true): {
  regex: string;
  tokens: CFormatToken[];
} {
  const tokens = parseCFormat(pattern);
  const regex = buildRegexFromTokens(tokens, anchored);
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

// 从 SOP 实例中提取全部占位符（含步骤命令与子步骤命令）
export function extractInstancePlaceholders(instance: SOPInstance): string[] {
  const seen = new Set<string>();
  const collect = (text: string) => {
    if (!text) return;
    extractTemplateVariables(text).forEach((name) => seen.add(name));
  };

  [...instance.checkResults, ...instance.extraChecks].forEach((result) => {
    collect(result.command);
    (result.subSteps ?? []).forEach((subStep) => collect(subStep.command));
  });

  return Array.from(seen);
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
 * 将单个子步骤序列化为 Markdown 片段（含高级设置）
 */
function exportSubStepToMarkdown(subStep: SOPSubStep, index: number): string {
  let block =
    `#### 子步骤 ${index}: ${subStep.name}\n\n` +
    (subStep.description ? `> ${subStep.description}\n\n` : '') +
    `\`\`\`bash\n${subStep.command}\n\`\`\`\n\n`;

  const extras: string[] = [];
  if (subStep.captureVar) {
    extras.push(
      subStep.capturePattern
        ? `- 📥 **捕获变量**: ${subStep.captureVar} (提取: \`${subStep.capturePattern}\`)`
        : `- 📥 **捕获变量**: ${subStep.captureVar}`
    );
  }
  if (subStep.normalRegex) extras.push(`- ✅ **正常正则**: \`${subStep.normalRegex}\``);
  if (subStep.abnormalRegex) extras.push(`- ❌ **异常正则**: \`${subStep.abnormalRegex}\``);
  if (subStep.scriptPath) extras.push(`- 🐍 **处理脚本**: \`${subStep.scriptPath}\``);
  if (subStep.timeoutMs) extras.push(`- 🕒 **超时**: ${subStep.timeoutMs}ms`);
  if (subStep.expectedNormal) extras.push(`- ✅ **正常描述**: ${subStep.expectedNormal}`);
  if (subStep.abnormalSigns) extras.push(`- ❌ **异常描述**: ${subStep.abnormalSigns}`);
  if (extras.length > 0) {
    block += `${extras.join('\n')}\n\n`;
  }

  return block.trimEnd();
}

/**
 * 将 SOPTemplate 序列化为 Markdown 字符串
 */
export function exportSOPTemplateToMarkdown(tpl: SOPTemplate): string {
  const variablesSection = (tpl.variables && tpl.variables.length > 0)
    ? `## 变量设置\n\n` + tpl.variables.map(v => `- **${v.name}**: ${v.label} (类型: \`${v.type}\`, 必填: \`${v.required}\`, 默认: \`${v.defaultValue || ''}\`)`).join('\n') + `\n\n`
    : '';

  const checksSection = tpl.checks
    .sort((a, b) => a.order - b.order)
    .map((c, i) => {
      let checkStr = `### 步骤 ${i + 1}: ${c.name}\n\n`;
      if (c.description) checkStr += `> ${c.description}\n\n`;
      checkStr += `\`\`\`bash\n${c.command}\n\`\`\`\n\n`;
      if (c.expectedNormal) checkStr += `- ✅ **正常**: ${c.expectedNormal}\n`;
      if (c.abnormalSigns) checkStr += `- ❌ **异常**: ${c.abnormalSigns}\n`;
      if (c.normalRegex) checkStr += `- ✅ **正常正则**: ${c.normalRegex}\n`;
      if (c.abnormalRegex) checkStr += `- ❌ **异常正则**: ${c.abnormalRegex}\n`;
      if (c.subSteps && c.subSteps.length > 0) {
        checkStr += `\n${c.subSteps
          .sort((a, b) => a.order - b.order)
          .map((subStep, index) => exportSubStepToMarkdown(subStep, index + 1))
          .join('\n\n')}\n`;
      }
      return checkStr.trimEnd();
    })
    .join('\n\n---\n\n');

  return `# SOP: ${tpl.name}

**分类**: ${tpl.category}
**描述**: ${tpl.description || ''}

## 常见根因提示

${tpl.diagnosisHints || '（暂无）'}

${variablesSection}## 排查步骤

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

  const titleLine = lines.find((l) => /^#\s+SOP:\s+/.test(l));
  if (!titleLine) return null;
  const name = titleLine.replace(/^#\s+SOP:\s+/, '').trim();

  const getMeta = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`**${key}**:`));
    return line ? line.replace(`**${key}**:`, '').trim() : '';
  };
  const category = getMeta('分类') || '其他';
  const description = getMeta('描述');

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

  const variables: import('../types').VariableConfig[] = [];
  const varStart = lines.findIndex((l) => /^##\s+变量设置/.test(l));
  if (varStart !== -1) {
    for (let i = varStart + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) break;
      const m = lines[i].match(/[-*]\s+\*\*([^]+)\*\*:\s+([^]+)\s+\(类型:\s+`([^]+)`,\s+必填:\s+`([^]+)`,\s+默认:\s+`(.*)`\)/);
      if (m) {
        variables.push({
          name: m[1],
          label: m[2],
          type: m[3] as 'text' | 'number' | 'path' | 'select',
          required: m[4] === 'true',
          defaultValue: m[5] || undefined,
        });
      }
    }
  }

  const checks: SOPCheck[] = [];
  let inCodeBlock = false;
  let codeBlockFor: 'check' | 'substep' = 'check';
  let currentCheck: (Partial<SOPCheck> & { subSteps?: SOPSubStep[] }) | null = null;
  let currentSubSteps: SOPSubStep[] = [];
  let currentSubStep: Partial<SOPSubStep> | null = null;
  let codeLines: string[] = [];
  let inChecksSection = false;
  let inSubStepBlock = false;

  const flushSubStep = () => {
    if (!currentSubStep) return;
    currentSubSteps.push(finalizeSubStep(currentSubStep, currentSubSteps.length));
    currentSubStep = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^##\s+排查步骤/.test(line)) {
      inChecksSection = true;
      continue;
    }
    if (!inChecksSection) continue;

    const stepMatch = line.match(/^###\s+步骤\s+\d+:\s+(.+)$/);
    if (stepMatch) {
      if (currentCheck) {
        if (codeLines.length > 0 && !inSubStepBlock) {
          currentCheck.command = codeLines.join('\n').trim();
        }
        flushSubStep();
        currentCheck.subSteps = currentSubSteps.length > 0 ? currentSubSteps : undefined;
        checks.push(finalizeCheck(currentCheck, checks.length));
      }
      currentCheck = {
        name: stepMatch[1].trim(),
        description: '',
        command: '',
        expectedNormal: '',
        abnormalSigns: '',
      };
      currentSubSteps = [];
      currentSubStep = null;
      codeLines = [];
      inCodeBlock = false;
      inSubStepBlock = false;
      continue;
    }

    const subStepMatch = line.match(/^####\s+子步骤\s+\d+(?:\.\d+)?\s*:?\s*(.*)$/);
    if (subStepMatch) {
      if (currentCheck && codeLines.length > 0 && inCodeBlock) {
        if (codeBlockFor === 'check') currentCheck.command = codeLines.join('\n').trim();
        else if (currentSubStep) currentSubStep.command = codeLines.join('\n').trim();
        inCodeBlock = false;
        codeLines = [];
      }
      flushSubStep();
      currentSubStep = {
        name: subStepMatch[1].trim() || `子步骤 ${currentSubSteps.length + 1}`,
        command: '',
        order: currentSubSteps.length + 1,
      };
      inSubStepBlock = true;
      continue;
    }

    if (!currentCheck) continue;

    if (line.startsWith('```bash') || line.startsWith('```shell')) {
      inCodeBlock = true;
      codeBlockFor = inSubStepBlock ? 'substep' : 'check';
      codeLines = [];
      continue;
    }
    if (line === '```' && inCodeBlock) {
      if (codeBlockFor === 'check') currentCheck.command = codeLines.join('\n').trim();
      else if (currentSubStep) currentSubStep.command = codeLines.join('\n').trim();
      inCodeBlock = false;
      codeLines = [];
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('> ')) {
      const desc = line.replace(/^>\s+/, '').trim();
      if (inSubStepBlock && currentSubStep) currentSubStep.description = desc;
      else if (!currentCheck.description) currentCheck.description = desc;
      continue;
    }

    const applyTo = inSubStepBlock && currentSubStep ? currentSubStep : currentCheck;
    if (applyTo) {
      const normalMatch = line.match(/[-*]\s+✅\s+\*\*正常\*\*:\s+(.+)/);
      if (normalMatch) { applyTo.expectedNormal = normalMatch[1].trim(); continue; }
      const abnormalMatch = line.match(/[-*]\s+❌\s+\*\*异常\*\*:\s+(.+)/);
      if (abnormalMatch) { applyTo.abnormalSigns = abnormalMatch[1].trim(); continue; }
      const normalRegexMatch = line.match(/[-*]\s+✅\s+\*\*正常正则\*\*:\s+`?([^`]+)`?/);
      if (normalRegexMatch) { applyTo.normalRegex = normalRegexMatch[1].trim(); continue; }
      const abnormalRegexMatch = line.match(/[-*]\s+❌\s+\*\*异常正则\*\*:\s+`?([^`]+)`?/);
      if (abnormalRegexMatch) { applyTo.abnormalRegex = abnormalRegexMatch[1].trim(); continue; }

      if (inSubStepBlock && currentSubStep) {
        const captureMatch = line.match(/[-*]\s+📥\s+\*\*捕获变量\*\*:\s+([^\s]+)(?:\s+\(提取:\s+`([^`]+)`\))?/);
        if (captureMatch) {
          currentSubStep.captureVar = captureMatch[1];
          currentSubStep.capturePattern = captureMatch[2];
          continue;
        }
        const scriptMatch = line.match(/[-*]\s+🐍\s+\*\*处理脚本\*\*:\s+`?([^`]+)`?/);
        if (scriptMatch) { currentSubStep.scriptPath = scriptMatch[1].trim(); continue; }
        const timeoutMatch = line.match(/[-*]\s+🕒\s+\*\*超时\*\*:\s+(\d+)ms/);
        if (timeoutMatch) { currentSubStep.timeoutMs = parseInt(timeoutMatch[1], 10); continue; }
      }
    }
  }

  if (currentCheck) {
    if (inCodeBlock && codeLines.length > 0) {
      if (codeBlockFor === 'check') currentCheck.command = codeLines.join('\n').trim();
      else if (currentSubStep) currentSubStep.command = codeLines.join('\n').trim();
    }
    flushSubStep();
    currentCheck.subSteps = currentSubSteps.length > 0 ? currentSubSteps : undefined;
    checks.push(finalizeCheck(currentCheck, checks.length));
  }

  return { name, category, description, diagnosisHints, variables, checks };
}

function finalizeSubStep(partial: Partial<SOPSubStep>, index: number): SOPSubStep {
  return {
    id: generateId(),
    order: index + 1,
    name: partial.name || `子步骤 ${index + 1}`,
    description: partial.description,
    command: partial.command || '',
    captureVar: partial.captureVar,
    capturePattern: partial.capturePattern,
    normalRegex: partial.normalRegex,
    abnormalRegex: partial.abnormalRegex,
    scriptPath: partial.scriptPath,
    expectedNormal: partial.expectedNormal,
    abnormalSigns: partial.abnormalSigns,
    timeoutMs: partial.timeoutMs,
  };
}

function finalizeCheck(
  partial: Partial<SOPCheck> & { subSteps?: SOPSubStep[] },
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
    normalRegex: partial.normalRegex,
    abnormalRegex: partial.abnormalRegex,
    subSteps: partial.subSteps?.map((subStep, subIndex) => ({
      ...subStep,
      id: subStep.id || generateId(),
      order: subIndex + 1,
    })),
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

  // Phase 13: 拼装白板图片段落
  const whiteboardSection = instance.whiteboardSvg
    ? `\n## 问题定位白板\n\n<img src="${instance.whiteboardSvg}" alt="问题定位白板" style="max-width:100%;border:1px solid #e4e4e7;border-radius:8px;" />\n`
    : '';

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
${whiteboardSection}
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

// ======================== 多节点故障报告 ========================

export interface NodeReportData {
  sessionName:      string;
  host?:            string;
  instanceTitle:    string;
  templateName:     string;
  status:           'done' | 'failed' | 'pending' | 'running';
  steps: Array<{
    name:        string;
    command:     string;
    stdout:      string;
    stderr:      string;
    exitCode:    number;
    durationMs:  number;
    statusReason?: string;
    capturedVar?: { name: string; value: string };
  }>;
  finalVarContext?: Record<string, string>;
}

/**
 * 将多节点执行结果导出为 Markdown 格式报告
 *
 * 结构：
 *   1. 执行摘要表格（节点 × 状态 × 异常数 × 耗时）
 *   2. 每个节点的详细步骤执行记录
 *   3. 各节点捕获的变量汇总
 */
export function generateMultiNodeReport(params: {
  runId:    string;
  mode:     'broadcast' | 'targeted';
  startedAt: number;
  nodes:    NodeReportData[];
}): string {
  const { mode, startedAt, nodes } = params;

  const modeLabel = mode === 'broadcast' ? '广播模式（所有节点执行相同 SOP）' : '定向模式（各节点独立 SOP）';
  const startTime = new Date(startedAt).toLocaleString('zh-CN');

  const statusEmoji: Record<string, string> = {
    done: '✅', failed: '❌', running: '⏳', pending: '⏸️',
  };
  const statusLabel: Record<string, string> = {
    done: '正常', failed: '异常', running: '执行中', pending: '未执行',
  };

  // 摘要表格
  const summaryRows = nodes
    .map((n) => {
      const abnormal = n.steps.filter((s) => s.exitCode !== 0).length;
      const totalMs  = n.steps.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
      return `| ${n.sessionName} | ${n.instanceTitle} | ${statusEmoji[n.status]} ${statusLabel[n.status]} | ${abnormal} | ${(totalMs / 1000).toFixed(2)}s |`;
    })
    .join('\n');

  // 每个节点详情
  const nodeDetails = nodes
    .map((n) => {
      const abnormal = n.steps.filter((s) => s.exitCode !== 0).length;
      const stepsSection = n.steps
        .map((s, i) => {
          const emoji   = s.exitCode === 0 ? '✅' : '❌';
          const reason  = s.statusReason ? ` _(${s.statusReason})_` : '';
          const capVar  = s.capturedVar ? `\n> 🔵 已捕获 \`\${${s.capturedVar.name}}\` = \`${s.capturedVar.value}\`` : '';
          return (
            `#### ${emoji} 步骤 ${i + 1}：${s.name}${reason}\n\n` +
            `**命令**\n\`\`\`bash\n${s.command}\n\`\`\`\n\n` +
            (s.stdout ? `**输出**\n\`\`\`\n${s.stdout}\n\`\`\`\n` : '') +
            (s.stderr ? `**错误**\n\`\`\`\n${s.stderr}\n\`\`\`\n` : '') +
            capVar
          );
        })
        .join('\n---\n\n');

      const varSection = n.finalVarContext && Object.keys(n.finalVarContext).length > 0
        ? '\n#### 捕获变量汇总\n\n' +
          Object.entries(n.finalVarContext)
            .map(([k, v]) => `- \`\${${k}}\` = \`${v}\``)
            .join('\n')
        : '';

      return (
        `### ${statusEmoji[n.status]} ${n.sessionName}${n.host ? ` (${n.host})` : ''}\n\n` +
        `> **SOP**：${n.instanceTitle} · **模板**：${n.templateName}\n` +
        `> **状态**：${statusLabel[n.status]}，异常步骤 **${abnormal}** 项\n\n` +
        stepsSection +
        varSection
      );
    })
    .join('\n\n---\n\n');

  return `# 多节点故障排查报告

## 执行概况

| 项目 | 值 |
|------|-----|
| 执行时间 | ${startTime} |
| 执行模式 | ${modeLabel} |
| 节点数量 | ${nodes.length} |
| 正常节点 | ${nodes.filter((n) => n.status === 'done').length} |
| 异常节点 | ${nodes.filter((n) => n.status === 'failed').length} |

## 节点摘要

| 节点 | SOP 实例 | 状态 | 异常步骤 | 总耗时 |
|------|---------|------|---------|--------|
${summaryRows}

## 节点详情

${nodeDetails}

---

> 由 **DevUtility Hub · SSH Manager 多节点执行** 生成  
> 生成时间：${new Date().toLocaleString('zh-CN')}
`;
}

// ======================== C 日志函数调用解析 ========================

export interface ParsedCLogCall {
  macroName:   string;         // 宏/函数名，如 LOG_ERROR_WITH_TRACE
  formatString: string;        // 格式字符串内容（去掉外层引号）
  paramExprs:  string[];       // 原始参数表达式，如 ["ctx->fail_times", "age+1"]
  paramNames:  string[];       // 推导出的显示名，如 ["fail_times", "age"]
  specifierCount: number;      // 格式串中的格式符数量
  mismatch:    boolean;        // paramNames.length !== specifierCount
}

/**
 * 将参数表达式规范化为字段名称（保留完整路径，仅清理空白）
 *
 * 原则：保留完整表达式供用户识别，例如：
 *   data->attr.key.value  →  data->attr.key.value（完整保留）
 *   (int)ctx->size        →  ctx->size（去掉类型转换前缀）
 *   get_val(ptr)          →  get_val(ptr)（完整保留）
 */
function extractParamDisplayName(expr: string): string {
  let s = expr.trim().replace(/\s+/g, ' ');

  // 去除最外层的 C 强制类型转换 (type) 前缀，保留后面的表达式
  const castMatch = s.match(/^\(\s*[A-Za-z_][\w\s*]*\)\s*(.+)$/);
  if (castMatch) s = castMatch[1].trim();

  return s;
}

/**
 * 按顶层逗号分割 C 函数参数列表
 *
 * 跳过字符串字面量内的逗号，以及括号/方括号内的逗号（嵌套函数调用）。
 */
function splitCArgs(argsStr: string): string[] {
  const args: string[] = [];
  let   cur      = '';
  let   depth    = 0;
  let   inStr    = false;
  let   i        = 0;

  while (i < argsStr.length) {
    const ch = argsStr[i];

    if (inStr) {
      if (ch === '\\') { cur += ch + (argsStr[i + 1] ?? ''); i += 2; continue; }
      if (ch === '"')  inStr = false;
      cur += ch;
    } else {
      if (ch === '"')  { inStr = true;  cur += ch; }
      else if (ch === '(' || ch === '[') { depth++; cur += ch; }
      else if (ch === ')' || ch === ']') { depth--; cur += ch; }
      else if (ch === ',' && depth === 0) {
        args.push(cur);
        cur = '';
        i++;
        continue;
      } else {
        cur += ch;
      }
    }
    i++;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

/**
 * 解析 C 日志宏调用，提取宏名、格式字符串和参数列表
 *
 * 支持格式：
 *   LOG_ERROR("%u ,%u", age, status);
 *   LOG_DEBUG_WITH_TRACE("[%s] val=%d", ctx->name, ctx->val);
 *   printf("count=%lu\n", (unsigned long)count);
 *
 * 返回 null 表示解析失败（非函数调用格式 / 首参不是字符串字面量）。
 */
export function parseCLogMacroCall(source: string): ParsedCLogCall | null {
  // 去除行尾分号和空白
  const s = source.trim().replace(/;+$/, '').trim();

  // 提取宏名
  const nameMatch = s.match(/^([A-Za-z_]\w*)\s*\(/);
  if (!nameMatch) return null;
  const macroName = nameMatch[1];

  // 找到最外层括号的内容
  const openIdx = s.indexOf('(');
  if (openIdx === -1) return null;

  let depth = 0, closeIdx = -1;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break; } }
  }
  if (closeIdx === -1) return null;

  const argsStr = s.slice(openIdx + 1, closeIdx);
  const args    = splitCArgs(argsStr);
  if (args.length === 0) return null;

  // 第一个参数必须是字符串字面量（格式串）
  const firstArg = args[0].trim();
  // 支持 "fmt" 和 L"fmt"（宽字符）
  const fmtMatch = firstArg.match(/^L?"((?:[^"\\]|\\.)*)"$/);
  if (!fmtMatch) return null;

  const formatString   = fmtMatch[1];                      // 去掉外层引号
  const paramExprs     = args.slice(1).map((a) => a.trim());
  const paramNames     = paramExprs.map(extractParamDisplayName);

  // 统计格式串中的格式符数量（用于检测不匹配）
  const tokens         = parseCFormat(formatString);
  const specifierCount = tokens.filter((t) => t.type === 'format').length;

  return {
    macroName,
    formatString,
    paramExprs,
    paramNames,
    specifierCount,
    mismatch: paramNames.length !== specifierCount,
  };
}

/**
 * 对一行日志文本应用已解析的 C 函数调用规则，返回字段→值映射
 *
 * anchored=false：允许前缀（时间戳、日志级别等），只要格式串内容出现在行中即可匹配。
 */
export function applyCLogRule(
  line:   string,
  parsed: ParsedCLogCall,
  anchored = false
): { matched: boolean; fields: Record<string, string>; rawGroups: string[] } {
  const { regex, tokens } = cFormatToRegex(parsed.formatString, anchored);
  let re: RegExp;
  try { re = new RegExp(regex); } catch { return { matched: false, fields: {}, rawGroups: [] }; }

  const m = re.exec(line);
  if (!m) return { matched: false, fields: {}, rawGroups: [] };

  const formatTokens = tokens.filter((t) => t.type === 'format');
  const fields: Record<string, string> = {};
  const rawGroups: string[] = [];

  formatTokens.forEach((_, i) => {
    const val   = m[i + 1] ?? '';
    const name  = parsed.paramNames[i] ?? `field${i + 1}`;
    fields[name] = val;
    rawGroups.push(val);
  });

  return { matched: true, fields, rawGroups };
}

// ======================== Cron 表达式工具 ========================

/**
 * 匹配单个 cron 字段
 * 支持: * | n | n-m | *\/n | n,m,... 及其组合
 */
function cronFieldMatch(field: string, value: number): boolean {
  for (const part of field.split(',')) {
    const p = part.trim();
    if (p === '*') return true;
    if (p.includes('/')) {
      const [rangeStr, stepStr] = p.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;
      let lo = 0, hi = 59;
      if (rangeStr !== '*') {
        const bounds = rangeStr.split('-').map(Number);
        lo = bounds[0]; hi = bounds[1] ?? bounds[0];
      }
      for (let i = lo; i <= hi; i += step) { if (i === value) return true; }
    } else if (p.includes('-')) {
      const [lo, hi] = p.split('-').map(Number);
      if (value >= lo && value <= hi) return true;
    } else {
      if (parseInt(p, 10) === value) return true;
    }
  }
  return false;
}

/** 检查某个时刻是否匹配 5 段 cron 表达式 */
export function cronMatches(expr: string, d: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hr, dom, mon, dow] = fields;
  return (
    cronFieldMatch(min, d.getMinutes())    &&
    cronFieldMatch(hr,  d.getHours())      &&
    cronFieldMatch(dom, d.getDate())       &&
    cronFieldMatch(mon, d.getMonth() + 1)  &&
    cronFieldMatch(dow, d.getDay())
  );
}

/** 计算 cron 的下次触发时间（从 from 的下一分钟开始，最多查找 1 年） */
export function getNextCronRun(expr: string, from: Date = new Date()): Date | null {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  for (let i = 0; i < 365 * 24 * 60; i++) {
    if (cronMatches(expr, next)) return new Date(next);
    next.setMinutes(next.getMinutes() + 1);
  }
  return null;
}

/** 将 cron 表达式转换为人类可读描述 */
export function getCronDescription(expr: string): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return '无效的 Cron 表达式（需要 5 段）';
  const [min, hr] = fields;
  if (expr === '* * * * *') return '每分钟执行';
  const everyMin = expr.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMin) return `每 ${everyMin[1]} 分钟执行`;
  const everyHr = expr.match(/^0 \*\/(\d+) \* \* \*$/);
  if (everyHr)  return `每 ${everyHr[1]} 小时执行`;
  const dailyHM = expr.match(/^(\d+) (\d+) \* \* \*$/);
  if (dailyHM)  return `每天 ${hr.padStart(2,'0')}:${min.padStart(2,'0')} 执行`;
  const weeklyDays = ['周日','周一','周二','周三','周四','周五','周六'];
  const weekly = expr.match(/^0 0 \* \* (\d)$/);
  if (weekly)   return `每${weeklyDays[parseInt(weekly[1])] ?? '?'} 00:00 执行`;
  if (expr === '0 0 1 * *') return '每月 1 日 00:00 执行';
  return `Cron: ${expr}`;
}

/** 验证 cron 表达式格式是否合法（返回错误信息，null 表示合法） */
export function validateCronExpr(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return '需要恰好 5 段，以空格分隔（分 时 日 月 周）';
  const limits = [[0,59],[0,23],[1,31],[1,12],[0,6]];
  const names  = ['分钟','小时','日期','月份','星期'];
  for (let i = 0; i < 5; i++) {
    const f = fields[i];
    if (f === '*') continue;
    const parts = f.split(',');
    for (const part of parts) {
      if (part.includes('/')) {
        const [range, step] = part.split('/');
        const s = parseInt(step, 10);
        if (isNaN(s) || s <= 0) return `${names[i]} 字段步进值无效`;
        if (range !== '*' && range.includes('-')) {
          const [lo, hi] = range.split('-').map(Number);
          if (isNaN(lo) || isNaN(hi) || lo > hi) return `${names[i]} 字段范围无效`;
        }
      } else if (part.includes('-')) {
        const [lo, hi] = part.split('-').map(Number);
        if (isNaN(lo) || isNaN(hi) || lo > hi ||
            lo < limits[i][0] || hi > limits[i][1])
          return `${names[i]} 字段范围 ${lo}-${hi} 超出 [${limits[i][0]},${limits[i][1]}]`;
      } else {
        const n = parseInt(part, 10);
        if (isNaN(n) || n < limits[i][0] || n > limits[i][1])
          return `${names[i]} 字段值 ${part} 超出 [${limits[i][0]},${limits[i][1]}]`;
      }
    }
  }
  return null;
}

// ======================== SOP Plan Steps 构建（调度器共享） ========================

/**
 * 从 SOP 模板直接构建执行步骤数组，供调度器批量执行使用。
 * 不创建 SOPInstance，避免污染 SOP 历史记录。
 *
 * 执行逻辑：
 *   - 若 check 有 subSteps → 展开为独立步骤（粒度细，支持变量捕获）
 *   - 若 check 无 subSteps → 使用 check.command 作为单步
 *   - varValues 中的占位符会被 renderTemplate 渲染
 *
 * 返回类型与 PlanStep（sshStore）兼容，避免循环引用使用 inline type。
 */
export function buildPlanStepsFromTemplate(
  template:  SOPTemplate,
  varValues: Record<string, string> = {}
): Array<{
  id: string; cmd: string; name: string;
  captureVar?: string; capturePattern?: string;
  normalRegex?: string; abnormalRegex?: string;
  scriptPath?: string; timeout?: number;
  checkId?: string; isSubStep?: boolean;
}> {
  const steps: ReturnType<typeof buildPlanStepsFromTemplate> = [];
  for (const check of (template.checks ?? [])) {
    if (check.subSteps && check.subSteps.length > 0) {
      for (const sub of check.subSteps) {
        steps.push({
          id:             sub.id || generateId(),
          cmd:            renderTemplate(sub.command, varValues),
          name:           sub.name,
          captureVar:     sub.captureVar,
          capturePattern: sub.capturePattern,
          normalRegex:    sub.normalRegex,
          abnormalRegex:  sub.abnormalRegex,
          scriptPath:     sub.scriptPath,
          timeout:        sub.timeoutMs,
          checkId:        check.id,
          isSubStep:      true,
        });
      }
    } else {
      steps.push({
        id:           check.id || generateId(),
        cmd:          renderTemplate(check.command, varValues),
        name:         check.name,
        normalRegex:  check.normalRegex,
        abnormalRegex: check.abnormalRegex,
        checkId:      check.id,
        isSubStep:    false,
      });
    }
  }
  return steps;
}

/**
 * 从模板的所有命令中提取变量占位符名称（${VAR_NAME}）
 * 用于在 TaskEditor 中自动展示需要填写的变量
 */
export function extractTemplateVars(template: SOPTemplate): string[] {
  const varSet = new Set<string>();
  const re = /\$\{([^}]+)\}/g;
  for (const check of (template.checks ?? [])) {
    let m: RegExpExecArray | null;
    if (check.subSteps?.length) {
      for (const sub of check.subSteps) {
        while ((m = re.exec(sub.command)) !== null) varSet.add(m[1]);
        re.lastIndex = 0;
      }
    } else {
      while ((m = re.exec(check.command ?? '')) !== null) varSet.add(m[1]);
      re.lastIndex = 0;
    }
  }
  return [...varSet];
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
