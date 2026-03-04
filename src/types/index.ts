// 工具分类
export type ToolCategory = 'analyzer' | 'generator' | 'utility' | 'other';

// 工具配置（注册信息）
export interface ToolConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: ToolCategory;
  version: string;
}

// ======================== 日志分析器类型 ========================

export type ParseMode = 'REGEX' | 'C_FORMAT';
export type FieldType = 'string' | 'number' | 'date' | 'ip' | 'hex' | 'float';

// 字段映射（正则捕获组 -> 字段名）
export interface FieldMapping {
  groupIndex: number;   // 捕获组序号，从1开始
  fieldName: string;    // 字段显示名称
  fieldType: FieldType;
}

// C格式字段定义
export interface CFormatField {
  index: number;            // 捕获组序号
  name: string;             // 字段名称（可为空，等待用户命名）
  type: 'string' | 'number' | 'hex' | 'float';
  formatSpecifier: string;  // 原始格式符（如 %s, %d）
}

// 解析规则（通用）
export interface ParseRule {
  id: string;
  name: string;
  mode: ParseMode;
  // 正则模式
  pattern?: string;
  fieldMappings?: FieldMapping[];
  // C格式模式
  patternSource?: string;    // 用户输入的原始C格式串
  patternCompiled?: string;  // 系统生成的正则表达式
  fields?: CFormatField[];
  createdAt: number;
  updatedAt: number;
}

// 单行解析结果
export interface ParseResult {
  lineIndex: number;
  rawLine: string;
  matched: boolean;
  fields: Record<string, string | number>;
}

// ======================== 命令生成器类型 ========================

export type VariableType = 'text' | 'number' | 'path' | 'select';

// 变量配置
export interface VariableConfig {
  name: string;
  label: string;
  type: VariableType;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  placeholder?: string;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
  };
}

// 命令模板
export interface CommandTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  template: string;
  variables: VariableConfig[];
  createdAt: number;
  updatedAt: number;
}

// 字符串片段
export interface StringSnippet {
  id: string;
  name: string;
  category: string;
  content: string;
}

// ======================== grep -C 上下文聚合类型 ========================

// grep -C 输出中的单行（带 context 标记）
export interface GrepContextLine {
  content: string;
  isMatch: boolean; // true = 触发 grep 匹配的行（`:` 分隔符行）
}

// 一个 grep 上下文分组（两个 `--` 之间的全部行）
export interface GrepGroup {
  groupIndex: number;
  lines: GrepContextLine[];
  // 对分组内主匹配行应用解析规则后的结构化字段
  parsedFields: Record<string, string | number>;
  matchedLineContent: string; // 被命中的原始行内容
  matched: boolean;           // 当前规则是否成功解析主匹配行
}

// ======================== SOP 故障排查工具类型 ========================

// SOP 模板中的单个检查步骤
export interface SOPCheck {
  id: string;
  order: number;
  name: string;
  description: string;
  command: string;          // 支持 ${var} 占位符
  expectedNormal?: string;  // 正常输出的描述/示例
  abnormalSigns?: string;   // 异常特征描述
}

// SOP 模板（可复用的故障排查流程）
export interface SOPTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  checks: SOPCheck[];
  diagnosisHints?: string; // 常见根因提示，Markdown 格式
  createdAt: number;
  updatedAt: number;
}

// 单个检查步骤的执行结果
export interface SOPCheckResult {
  checkId: string;
  checkName: string;
  command: string;     // 渲染后的实际命令（变量已替换）
  output: string;      // 用户粘贴的命令输出
  conclusion: string;  // 用户对该步骤的分析结论
  status: 'pending' | 'normal' | 'abnormal' | 'skipped';
  executedAt?: number;
}

// SOP 执行实例（一次具体的故障排查会话）
export interface SOPInstance {
  id: string;
  templateId: string;
  templateName: string;   // 快照，防止模板改名后丢失信息
  incidentTitle: string;
  status: 'investigating' | 'resolved' | 'escalated';
  checkResults: SOPCheckResult[];
  extraChecks: SOPCheckResult[]; // 临时追加的非模板步骤
  diagnosis: {
    phenomenon: string;  // 故障现象
    rootCause: string;   // 根因分析
    solution: string;    // 解决方案
    prevention: string;  // 预防措施
  };
  createdAt: number;
  resolvedAt?: number;
}

// ======================== 全局状态类型 ========================

export type ThemeMode = 'dark' | 'light';

export interface GlobalState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}
