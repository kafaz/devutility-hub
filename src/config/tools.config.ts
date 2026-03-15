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
  {
    id: 'sop-builder',
    name: 'SOP 排查',
    icon: 'ApartmentOutlined',
    description: '标准化故障排查流程，逐步执行并导出报告',
    category: 'utility',
    version: '1.0.0',
  },
  {
    id: 'number-converter',
    name: '进制转换',
    icon: 'NumberOutlined',
    description: '二进制/八进制/十进制/十六进制实时互转，二进制 4 位分组',
    category: 'utility',
    version: '1.0.0',
  },
  {
    id: 'io-analyzer',
    name: 'IO 性能分析',
    icon: 'BarChartOutlined',
    description: '集成 iostat、dd、blktrace 等多种 IO 工具分析性能瓶颈',
    category: 'analyzer',
    version: '1.0.0',
  },
  {
    id: 'code-profiler',
    name: '代码路径优化',
    icon: 'ToolOutlined',
    description: 'perf、火焰图、GDB 堆栈分析，识别热点代码优化点',
    category: 'analyzer',
    version: '1.0.0',
  },
  {
    id: 'diagnostic-workbench',
    name: '诊断工作台',
    icon: 'RadarChartOutlined',
    description: '结构化归档诊断 Run，做相似故障召回与多 Agent 编排',
    category: 'utility',
    version: '1.0.0',
  },
];

export default toolsConfig;
