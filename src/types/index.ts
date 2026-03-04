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

// ======================== 全局状态类型 ========================

export type ThemeMode = 'dark' | 'light';

export interface GlobalState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}
