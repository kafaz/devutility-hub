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

/**
 * 子步骤（SubStep）— SOPCheck 的原子执行单元
 *
 * 设计目标：
 *   1. 一个 SOPCheck 包含若干 SubStep，SubStep 按顺序在同一 Shell 中执行
 *   2. 每个 SubStep 可将 stdout 捕获为命名变量（captureVar）
 *   3. 后续 SubStep 的 command 可引用已捕获变量：${VAR_NAME}
 *   4. capturePattern 用正则从 stdout 精确提取目标值（默认取整个 stdout.trim()）
 */
export interface SOPSubStep {
  id: string;
  order: number;
  name: string;
  description?: string;
  command: string;            // 支持 ${USER_VAR} 和 ${CAPTURED_VAR} 占位符
  captureVar?: string;        // 将 stdout 保存为此变量名，后续步骤可引用
  capturePattern?: string;    // 正则表达式，取第 1 捕获组作为变量值（可选）
  // ── 输出判断正则 ──────────────────────────────────────────────────────────
  normalRegex?: string;       // stdout 匹配此正则 → 判定正常（优先级低于 abnormalRegex）
  abnormalRegex?: string;     // stdout 匹配此正则 → 强制判定异常（最高优先级）
  // ── Python 脚本后处理 ────────────────────────────────────────────────────
  scriptPath?: string;        // 本地 Python 脚本路径；proxy 执行时将 stdout 传入 stdin，
                              // 脚本 stdout 替换原始输出并作为 captureVar 的数据源
  expectedNormal?: string;    // 人类可读的正常特征描述（UI 提示用）
  abnormalSigns?: string;     // 人类可读的异常特征描述（UI 提示用）
  timeoutMs?: number;
}

// 子步骤运行结果（实例层，执行时填充）
export interface SOPSubStepResult {
  subStepId: string;
  name: string;
  command: string;            // 变量渲染后的实际命令
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  capturedVar?: { name: string; value: string };  // 本步骤捕获的变量
}

// SOP 模板中的检查步骤（一个检查 = 多个子步骤）
export interface SOPCheck {
  id: string;
  order: number;
  name: string;
  description: string;
  command: string;           // 兼容旧版：若 subSteps 为空则直接执行此命令
  expectedNormal?: string;
  abnormalSigns?: string;
  normalRegex?: string;      // 检查级正则：对聚合输出做整体判断（优先于关键词匹配）
  abnormalRegex?: string;
  subSteps?: SOPSubStep[];   // 子步骤列表（新版，优先级高于 command）
}

// SOP 模板（可复用的故障排查流程）
export interface SOPTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  checks: SOPCheck[];
  diagnosisHints?: string;
  createdAt: number;
  updatedAt: number;
}

// 单个检查步骤的执行结果
export interface SOPCheckResult {
  checkId: string;
  checkName: string;
  command: string;
  output: string;            // 聚合所有子步骤的输出（或单命令输出）
  conclusion: string;
  status: 'pending' | 'normal' | 'abnormal' | 'skipped';
  subSteps?: SOPSubStep[];              // 从模板复制（创建实例时快照）
  subStepResults?: SOPSubStepResult[];  // 执行时填充
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

// ======================== SOP Git 仓库源类型 ========================

/**
 * Git 仓库 SOP 模板源配置
 *
 * 支持从公共/私有 Git 仓库批量加载 SOP 模板（.md / .json 文件），
 * 每个源对应一个仓库的特定路径，可独立启用/禁用、手动触发同步。
 */
export interface GitRepoSource {
  id: string;
  name: string;          // 用户自定义显示名称
  url: string;           // Git 仓库 URL（https/ssh）
  branch: string;        // 目标分支（默认 main）
  path: string;          // 仓库内子路径（留空表示根目录，如 "sops/templates"）
  token?: string;        // Personal Access Token（私有仓库鉴权，可选）
  enabled: boolean;      // 是否启用此源
  lastSynced?: number;   // 最后一次成功同步的时间戳
  lastResult?: {
    imported: number;    // 本次新增模板数
    skipped: number;     // 跳过（重名/重复）数
    files: number;       // 读取到的文件总数
    error?: string;      // 同步失败时的错误信息
  };
  createdAt: number;
  updatedAt: number;
}

// ======================== 全局状态类型 ========================

export type ThemeMode = 'dark' | 'light';

export interface GlobalState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}
