import type { ToolConfig } from '../types';

const toolsConfig: ToolConfig[] = [
  {
    id: 'log-analyzer',
    name: '日志分析器',
    icon: 'FileSearch',
    description: '通过正则表达式或C格式串解析和分析日志文本',
    category: 'analyzer',
    version: '1.0.0',
  },
  {
    id: 'command-builder',
    name: '命令生成器',
    icon: 'CodeOutlined',
    description: '快速构建 Linux / Shell 命令',
    category: 'generator',
    version: '1.0.0',
  },
];

export default toolsConfig;
