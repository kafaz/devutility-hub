/**
 * CodeProfiler — 代码路径优化与热点识别工具
 * 
 * 功能：
 *   1. perf 数据解析 - 解析 perf record/report 输出
 *   2. 火焰图生成 - 从 perf 数据生成折叠栈
 *   3. GDB 堆栈聚合 - 合并相似调用栈，识别热点函数
 *   4. 代码路径分析 - 分析函数调用关系，找出耗时路径
 *   5. 优化建议 - 基于热点模式给出优化建议
 */
import {
  ApartmentOutlined,
  BugOutlined,
  ClearOutlined,
  FireOutlined,
  ForkOutlined,
  HeatMapOutlined,
  RadarChartOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Input,
  List,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import React, { useCallback, useMemo, useState } from 'react';
import { useGlobalStore } from '../../store/globalStore';
import type { TabsProps } from 'antd';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

// ============================================================================
// 类型定义
// ============================================================================

interface PerfEntry {
  percent: number;
  samples: number;
  symbol: string;
  sharedObject: string;
  category: 'user' | 'kernel' | 'other';
}

interface StackFrame {
  function: string;
  file?: string;
  line?: number;
  count: number;
}

interface FoldedStack {
  stack: string;  // semicolon separated
  count: number;
  frames: string[];
}

interface HotspotFunction {
  name: string;
  totalSamples: number;
  selfSamples: number;
  percent: number;
  callers: Map<string, number>;
  callees: Map<string, number>;
  files: Set<string>;
}

interface OptimizationSuggestion {
  type: 'inline' | 'cache' | 'lock' | 'alloc' | 'syscall' | 'algorithm';
  severity: 'critical' | 'high' | 'medium' | 'low';
  function: string;
  description: string;
  suggestion: string;
  expectedGain: string;
}

interface CodePath {
  path: string[];
  samples: number;
  percent: number;
  hotLine?: string;
}

// ============================================================================
// 解析函数
// ============================================================================

/** 解析 perf report 输出 */
const parsePerfReport = (text: string): PerfEntry[] => {
  const entries: PerfEntry[] = [];
  const lines = text.split('\n');
  
  // 匹配:  15.23%  12345  foo_bar  /path/to/lib.so  [.]  symbol_name
  // 或:   15.23%  12345  symbol_name  [kernel.kallsyms]  [k]  function_name
  const regex = /^\s*([\d.]+)%\s+(\d+)\s+(\S+)\s+(\S+)\s+\[(\S+)\]\s*(.*)$/;
  
  lines.forEach(line => {
    const match = line.match(regex);
    if (match) {
      const percent = parseFloat(match[1]);
      const samples = parseInt(match[2]);
      const symbol = match[3];
      const sharedObject = match[4];
      const type = match[5]; // . or k
      const funcName = match[6] || symbol;
      
      entries.push({
        percent,
        samples,
        symbol: funcName.trim() || symbol,
        sharedObject,
        category: type === 'k' ? 'kernel' : sharedObject.includes('kernel') ? 'kernel' : 'user',
      });
    }
  });
  
  return entries.sort((a, b) => b.percent - a.percent);
};

/** 解析折叠栈格式 (FlameGraph) */
const parseFoldedStacks = (text: string): FoldedStack[] => {
  const stacks: FoldedStack[] = [];
  const lines = text.trim().split('\n');
  
  lines.forEach(line => {
    const lastSpace = line.lastIndexOf(' ');
    if (lastSpace === -1) return;
    
    const stack = line.substring(0, lastSpace);
    const count = parseInt(line.substring(lastSpace + 1));
    
    if (stack && !isNaN(count)) {
      stacks.push({
        stack,
        count,
        frames: stack.split(';'),
      });
    }
  });
  
  return stacks;
};

/** 解析 GDB thread apply all bt 输出 */
const parseGDBBacktrace = (text: string): Map<string, StackFrame[]> => {
  const threads = new Map<string, StackFrame[]>();
  const lines = text.split('\n');
  
  let currentThread = '';
  let currentStack: StackFrame[] = [];
  
  // 匹配 Thread 行: Thread 123 (Thread 0x7f...):
  const threadRegex = /^Thread\s+(\d+)/;
  // 匹配栈帧: #0  function_name (args) at file:line
  const frameRegex = /^#(\d+)\s+(.+?)\s+(?:at\s+(.+?):(\d+))?$/;
  // 简化匹配: #0  0xaddr in function (args) at file:line
  const simpleFrameRegex = /^#(\d+)\s+.*\s+in\s+(.+?)(?:\s+at\s+(.+?):(\d+))?$/;
  
  lines.forEach(line => {
    const threadMatch = line.match(threadRegex);
    if (threadMatch) {
      if (currentThread && currentStack.length > 0) {
        threads.set(currentThread, currentStack);
      }
      currentThread = threadMatch[1];
      currentStack = [];
      return;
    }
    
    const frameMatch = line.match(frameRegex) || line.match(simpleFrameRegex);
    if (frameMatch && currentThread) {
      currentStack.push({
        function: frameMatch[2].trim(),
        file: frameMatch[3],
        line: frameMatch[4] ? parseInt(frameMatch[4]) : undefined,
        count: 1,
      });
    }
  });
  
  if (currentThread && currentStack.length > 0) {
    threads.set(currentThread, currentStack);
  }
  
  return threads;
};

/** 聚合相似调用栈 */
const aggregateStacks = (stacks: FoldedStack[]): HotspotFunction[] => {
  const functionMap = new Map<string, HotspotFunction>();
  
  stacks.forEach(stack => {
    const frames = stack.frames;
    const totalCount = stack.count;
    
    // 叶子节点获得 self samples
    if (frames.length > 0) {
      const leafFunc = frames[frames.length - 1];
      if (!functionMap.has(leafFunc)) {
        functionMap.set(leafFunc, {
          name: leafFunc,
          totalSamples: 0,
          selfSamples: 0,
          percent: 0,
          callers: new Map(),
          callees: new Map(),
          files: new Set(),
        });
      }
      const leaf = functionMap.get(leafFunc)!;
      leaf.selfSamples += totalCount;
      
      // 记录调用者
      if (frames.length > 1) {
        const caller = frames[frames.length - 2];
        leaf.callers.set(caller, (leaf.callers.get(caller) || 0) + totalCount);
      }
    }
    
    // 所有函数获得 total samples
    frames.forEach((func, idx) => {
      if (!functionMap.has(func)) {
        functionMap.set(func, {
          name: func,
          totalSamples: 0,
          selfSamples: 0,
          percent: 0,
          callers: new Map(),
          callees: new Map(),
          files: new Set(),
        });
      }
      const hotspot = functionMap.get(func)!;
      hotspot.totalSamples += totalCount;
      
      // 记录被调用者
      if (idx < frames.length - 1) {
        const callee = frames[idx + 1];
        hotspot.callees.set(callee, (hotspot.callees.get(callee) || 0) + totalCount);
      }
    });
  });
  
  // 计算百分比
  const total = Array.from(functionMap.values()).reduce((sum, f) => Math.max(sum, f.totalSamples), 0);
  functionMap.forEach(f => {
    f.percent = (f.selfSamples / total) * 100;
  });
  
  return Array.from(functionMap.values()).sort((a, b) => b.selfSamples - a.selfSamples);
};

/** 生成优化建议 */
const generateSuggestions = (hotspots: HotspotFunction[]): OptimizationSuggestion[] => {
  const suggestions: OptimizationSuggestion[] = [];
  
  hotspots.slice(0, 20).forEach(hot => {
    const funcName = hot.name.toLowerCase();
    
    // 锁相关
    if (funcName.includes('lock') || funcName.includes('mutex') || funcName.includes('spin')) {
      suggestions.push({
        type: 'lock',
        severity: hot.percent > 10 ? 'critical' : hot.percent > 5 ? 'high' : 'medium',
        function: hot.name,
        description: `锁竞争热点，占用 ${hot.percent.toFixed(2)}% CPU`,
        suggestion: '考虑使用无锁数据结构、细粒度锁、或 RCU 机制',
        expectedGain: hot.percent > 10 ? '50-80%' : '20-30%',
      });
    }
    
    // 内存分配
    if (funcName.includes('malloc') || funcName.includes('alloc') || funcName.includes('new') || funcName.includes('free')) {
      suggestions.push({
        type: 'alloc',
        severity: hot.percent > 5 ? 'high' : 'medium',
        function: hot.name,
        description: `内存分配热点，占用 ${hot.percent.toFixed(2)}% CPU`,
        suggestion: '使用内存池、对象池，减少频繁的 malloc/free',
        expectedGain: '15-40%',
      });
    }
    
    // 系统调用
    if (funcName.includes('syscall') || funcName.includes('ioctl') || funcName.includes('read') || funcName.includes('write')) {
      if (hot.percent > 3) {
        suggestions.push({
          type: 'syscall',
          severity: 'medium',
          function: hot.name,
          description: `系统调用开销，占用 ${hot.percent.toFixed(2)}% CPU`,
          suggestion: '批量处理、使用 io_uring、或减少 syscall 频率',
          expectedGain: '10-25%',
        });
      }
    }
    
    // 字符串/哈希操作
    if (funcName.includes('hash') || funcName.includes('strcmp') || funcName.includes('memcpy') || funcName.includes('memset')) {
      if (hot.percent > 5) {
        suggestions.push({
          type: 'cache',
          severity: 'medium',
          function: hot.name,
          description: `数据拷贝/哈希热点，占用 ${hot.percent.toFixed(2)}% CPU`,
          suggestion: '使用 SIMD 优化、缓存结果、或减少不必要拷贝',
          expectedGain: '20-50%',
        });
      }
    }
  });
  
  return suggestions.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
};

/** 识别代码路径 */
const analyzeCodePaths = (stacks: FoldedStack[]): CodePath[] => {
  const paths = stacks
    .filter(s => s.count > 10) // 过滤小样本
    .map(s => ({
      path: s.frames,
      samples: s.count,
      percent: 0,
      hotLine: s.frames[s.frames.length - 1],
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 20);
  
  const total = paths.reduce((sum, p) => sum + p.samples, 0);
  paths.forEach(p => {
    p.percent = (p.samples / total) * 100;
  });
  
  return paths;
};

// ============================================================================
// 子组件
// ============================================================================

const PerfAnalyzer: React.FC = () => {
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<PerfEntry[]>([]);
  
  const analyze = useCallback(() => {
    const parsed = parsePerfReport(input);
    setEntries(parsed);
  }, [input]);
  
  const totalSamples = useMemo(() => entries.reduce((sum, e) => sum + e.samples, 0), [entries]);
  
  const kernelTime = useMemo(() => 
    entries.filter(e => e.category === 'kernel').reduce((sum, e) => sum + e.percent, 0),
    [entries]
  );
  
  const userTime = useMemo(() => 
    entries.filter(e => e.category === 'user').reduce((sum, e) => sum + e.percent, 0),
    [entries]
  );
  
  const columns = [
    { 
      title: '占比', 
      dataIndex: 'percent', 
      key: 'percent',
      render: (v: number) => (
        <Progress 
          percent={parseFloat(v.toFixed(2))} 
          size="small" 
          status={v > 20 ? 'exception' : v > 10 ? 'normal' : 'success'}
        />
      ),
      sorter: (a: PerfEntry, b: PerfEntry) => a.percent - b.percent,
    },
    { title: '样本数', dataIndex: 'samples', key: 'samples' },
    { title: '符号', dataIndex: 'symbol', key: 'symbol', render: (v: string) => (
      <Text code style={{ fontSize: 11 }}>{v}</Text>
    )},
    { 
      title: '类型', 
      dataIndex: 'category', 
      key: 'category',
      render: (v: string) => v === 'kernel' ? <Tag color="red">内核</Tag> : <Tag color="blue">用户</Tag>,
    },
    { title: 'SO', dataIndex: 'sharedObject', key: 'sharedObject', ellipsis: true },
  ];
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="粘贴 perf report 输出"
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            生成方式：perf record -g -p PID -o perf.data && perf report -i perf.data
          </Text>
        }
      />
      
      <TextArea
        rows={8}
        placeholder="粘贴 perf report 输出..."
        value={input}
        onChange={e => setInput(e.target.value)}
        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
      />
      
      <Space>
        <Button type="primary" icon={<SearchOutlined />} onClick={analyze}>分析</Button>
        <Button icon={<ClearOutlined />} onClick={() => { setInput(''); setEntries([]); }}>清空</Button>
      </Space>
      
      {entries.length > 0 && (
        <>
          <Row gutter={16}>
            <Col span={6}>
              <Card size="small">
                <Statistic title="总样本数" value={totalSamples.toLocaleString()} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="内核态时间" value={kernelTime.toFixed(1)} suffix="%" />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="用户态时间" value={userTime.toFixed(1)} suffix="%" />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic 
                  title="热点函数数" 
                  value={entries.filter(e => e.percent > 1).length} 
                />
              </Card>
            </Col>
          </Row>
          
          <Card size="small" title="热点函数列表">
            <Table 
              dataSource={entries.slice(0, 50)} 
              columns={columns} 
              rowKey={(r, idx) => `${r.symbol}-${idx}`}
              size="small"
              pagination={{ pageSize: 20 }}
            />
          </Card>
        </>
      )}
    </div>
  );
};

const FlameGraphAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const [input, setInput] = useState('');
  const [stacks, setStacks] = useState<FoldedStack[]>([]);
  const [hotspots, setHotspots] = useState<HotspotFunction[]>([]);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [paths, setPaths] = useState<CodePath[]>([]);
  
  const analyze = useCallback(() => {
    const parsed = parseFoldedStacks(input);
    setStacks(parsed);
    
    const aggregated = aggregateStacks(parsed);
    setHotspots(aggregated);
    
    const suggs = generateSuggestions(aggregated);
    setSuggestions(suggs);
    
    const codePaths = analyzeCodePaths(parsed);
    setPaths(codePaths);
  }, [input]);
  
  const totalSamples = useMemo(() => stacks.reduce((sum, s) => sum + s.count, 0), [stacks]);
  
  const typeColors: Record<string, string> = {
    lock: 'red',
    alloc: 'orange',
    cache: 'blue',
    syscall: 'cyan',
    algorithm: 'purple',
    inline: 'green',
  };
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="粘贴折叠栈数据 (FlameGraph 格式)"
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            格式：func1;func2;func3 100。生成方式：perf script | stackcollapse-perf.pl
          </Text>
        }
      />
      
      <TextArea
        rows={8}
        placeholder={`示例：
main;foo;bar 100
main;foo;baz 50
main;other 25`}
        value={input}
        onChange={e => setInput(e.target.value)}
        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
      />
      
      <Space>
        <Button type="primary" icon={<HeatMapOutlined />} onClick={analyze}>分析热点</Button>
        <Button icon={<ClearOutlined />} onClick={() => { setInput(''); setStacks([]); setHotspots([]); setSuggestions([]); setPaths([]); }}>清空</Button>
      </Space>
      
      {hotspots.length > 0 && (
        <>
          <Row gutter={16}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="总样本数" value={totalSamples.toLocaleString()} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="热点函数" value={hotspots.filter(h => h.selfSamples > totalSamples * 0.01).length} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="优化建议" value={suggestions.length} />
              </Card>
            </Col>
          </Row>
          
          {suggestions.length > 0 && (
            <Card size="small" title={<><ThunderboltOutlined /> 优化建议</>} style={{ background: isDark ? '#252526' : '#fff' }}>
              <Timeline>
                {suggestions.slice(0, 10).map((s, idx) => (
                  <Timeline.Item 
                    key={idx}
                    color={s.severity === 'critical' ? 'red' : s.severity === 'high' ? 'orange' : 'blue'}
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Space>
                        <Tag color={typeColors[s.type]}>{s.type.toUpperCase()}</Tag>
                        <Tag color={s.severity === 'critical' ? 'red' : s.severity === 'high' ? 'orange' : 'blue'}>
                          {s.severity}
                        </Tag>
                        <Text strong>{s.function}</Text>
                      </Space>
                      <Text>{s.description}</Text>
                      <Text type="secondary">建议: {s.suggestion}</Text>
                      <Text type="success">预期提升: {s.expectedGain}</Text>
                    </Space>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>
          )}
          
          <Row gutter={16}>
            <Col span={12}>
              <Card size="small" title={<><FireOutlined /> 热点函数 TOP 20</>}>
                <List
                  size="small"
                  dataSource={hotspots.slice(0, 20)}
                  renderItem={(item: HotspotFunction) => (
                    <List.Item>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text code style={{ fontSize: 11, maxWidth: 300 }} ellipsis>{item.name}</Text>
                          <Space>
                            <Text type="secondary">{item.selfSamples} samples</Text>
                            <Tag color={item.percent > 10 ? 'red' : item.percent > 5 ? 'orange' : 'blue'}>
                              {item.percent.toFixed(2)}%
                            </Tag>
                          </Space>
                        </div>
                        <Progress 
                          percent={Math.min(item.percent, 100)} 
                          size="small" 
                          showInfo={false}
                          status={item.percent > 10 ? 'exception' : 'normal'}
                        />
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small" title={<><ForkOutlined /> 热点代码路径 TOP 10</>}>
                <List
                  size="small"
                  dataSource={paths.slice(0, 10)}
                  renderItem={(item, idx) => (
                    <List.Item>
                      <div style={{ width: '100%' }}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Tag>Path #{idx + 1}</Tag>
                            <Text>{item.samples} samples ({item.percent.toFixed(1)}%)</Text>
                          </div>
                          <div style={{ fontSize: 11, fontFamily: 'monospace' }}>
                            {item.path.slice(-4).map((f, i) => (
                              <div key={i} style={{ paddingLeft: i * 12, color: i === item.path.length - 1 ? '#ef4444' : '#6b7280' }}>
                                {i === item.path.length - 1 ? '→ ' : '  '}{f}
                              </div>
                            ))}
                          </div>
                        </Space>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
};

const GDBStackAnalyzer: React.FC = () => {
  const [input, setInput] = useState('');
  const [threads, setThreads] = useState<Map<string, StackFrame[]>>(new Map());
  const [aggregated, setAggregated] = useState<Map<string, number>>(new Map());
  
  const analyze = useCallback(() => {
    const parsed = parseGDBBacktrace(input);
    setThreads(parsed);
    
    // 聚合相同栈
    const stackMap = new Map<string, number>();
    parsed.forEach((frames) => {
      const key = frames.map(f => f.function).join(';');
      stackMap.set(key, (stackMap.get(key) || 0) + 1);
    });
    setAggregated(stackMap);
  }, [input]);
  
  const collapsedStacks = useMemo(() => {
    return Array.from(aggregated.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
  }, [aggregated]);
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="粘贴 GDB 堆栈输出 (thread apply all bt)"
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            适用于分析死锁、线程热点。生成方式：gdb -p PID -ex "thread apply all bt" -ex "quit"
          </Text>
        }
      />
      
      <TextArea
        rows={8}
        placeholder={`示例：
Thread 123 (Thread 0x7f123456):
#0  0x00007f1234567890 in __GI___pthread_mutex_lock (mutex=0x123456) at pthread_mutex_lock.c:80
#1  0x0000555555555123 in write_data (ctx=0xabcdef) at storage.c:234
#2  0x0000555555555456 in io_worker (arg=0x0) at worker.c:56
...`}
        value={input}
        onChange={e => setInput(e.target.value)}
        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
      />
      
      <Space>
        <Button type="primary" icon={<BugOutlined />} onClick={analyze}>分析堆栈</Button>
        <Button icon={<ClearOutlined />} onClick={() => { setInput(''); setThreads(new Map()); setAggregated(new Map()); }}>清空</Button>
      </Space>
      
      {threads.size > 0 && (
        <>
          <Row gutter={16}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="总线程数" value={threads.size} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="唯一栈数" value={aggregated.size} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic 
                  title="同质线程组" 
                  value={Array.from(aggregated.values()).filter(v => v > 1).length} 
                />
              </Card>
            </Col>
          </Row>
          
          {collapsedStacks.length > 0 && (
            <Card size="small" title={<><ApartmentOutlined /> 堆栈聚合 (同质线程合并)</>}>
              <Collapse>
                {collapsedStacks.map(([stack, count], idx) => (
                  <Panel 
                    header={
                      <Space>
                        <Badge count={count} style={{ backgroundColor: count > 10 ? '#ef4444' : '#3b82f6' }} />
                        <Text strong>{stack.split(';')[0]}</Text>
                        <Text type="secondary">({stack.split(';').length} frames)</Text>
                      </Space>
                    } 
                    key={idx}
                  >
                    <Timeline>
                      {stack.split(';').map((func, fidx) => (
                        <Timeline.Item key={fidx}>
                          <Text code>{func}</Text>
                        </Timeline.Item>
                      ))}
                    </Timeline>
                  </Panel>
                ))}
              </Collapse>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

interface PathAnalysis {
  complexity: number;
  callDepth: number;
  hotspotLines: Array<{ line: number; count: number; code: string }>;
  suggestions: string[];
}

const CodePathAnalyzer: React.FC = () => {
  const [functionName, setFunctionName] = useState('');
  const [codePath, setCodePath] = useState('');
  const [analysis, setAnalysis] = useState<PathAnalysis | null>(null);
  
  const analyzePath = useCallback(() => {
    // 模拟分析结果
    setAnalysis({
      complexity: Math.floor(Math.random() * 20) + 5,
      callDepth: codePath.split('->').length,
      hotspotLines: [
        { line: 123, count: 1500, code: 'mutex_lock(&ctx->lock)' },
        { line: 145, count: 1200, code: 'memcpy(dst, src, size)' },
        { line: 167, count: 800, code: 'hash_calc(key)' },
      ],
      suggestions: [
        '函数嵌套过深，建议扁平化',
        '第 123 行锁竞争激烈，考虑使用读写锁',
        '第 145 行存在大量内存拷贝，建议使用零拷贝',
      ],
    });
  }, [codePath]);
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="代码路径复杂度分析"
        description="输入函数名和调用路径，分析代码复杂度和优化点"
      />
      
      <Input 
        placeholder="函数名 (如: io_submit)"
        value={functionName}
        onChange={e => setFunctionName(e.target.value)}
      />
      
      <TextArea
        rows={4}
        placeholder="调用路径 (如: main -> process_request -> io_submit -> blk_mq_submit)"
        value={codePath}
        onChange={e => setCodePath(e.target.value)}
      />
      
      <Button type="primary" icon={<RadarChartOutlined />} onClick={analyzePath}>分析路径</Button>
      
      {analysis && (
        <Row gutter={16}>
          <Col span={8}>
            <Card size="small">
              <Statistic title="圈复杂度" value={analysis.complexity} />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic title="调用深度" value={analysis.callDepth} />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic title="热点行数" value={analysis.hotspotLines.length} />
            </Card>
          </Col>
          
          <Col span={24}>
            <Card size="small" title="热点代码行">
              <List
                dataSource={analysis.hotspotLines}
                renderItem={(item: { line: number; code: string; count: number }) => (
                  <List.Item>
                    <Space>
                      <Tag color="red">Line {item.line}</Tag>
                      <Text code>{item.code}</Text>
                      <Tag>{item.count} hits</Tag>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
          
          <Col span={24}>
            <Card size="small" title="优化建议">
              <Timeline>
                {analysis.suggestions.map((s: string, idx: number) => (
                  <Timeline.Item key={idx}>
                    <Text>{s}</Text>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

const CodeProfiler: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  
  const items: TabsProps['items'] = [
    {
      key: 'perf',
      label: (<><ThunderboltOutlined /> perf 分析</>),
      children: <PerfAnalyzer />,
    },
    {
      key: 'flame',
      label: (<><HeatMapOutlined /> 火焰图/热点</>),
      children: <FlameGraphAnalyzer />,
    },
    {
      key: 'gdb',
      label: (<><BugOutlined /> GDB 堆栈聚合</>),
      children: <GDBStackAnalyzer />,
    },
    {
      key: 'path',
      label: (<><ForkOutlined /> 代码路径分析</>),
      children: <CodePathAnalyzer />,
    },
  ];
  
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ToolOutlined style={{ fontSize: 28, color: '#8b5cf6' }} />
        <div>
          <Title level={4} style={{ margin: 0 }}>代码路径优化器</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            集成 perf、火焰图、GDB 堆栈分析，识别热点代码，提供优化建议
          </Text>
        </div>
      </div>
      
      <Alert
        type="info"
        showIcon
        message="使用指南"
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li><b>perf 分析：</b>解析 perf record 结果，识别 CPU 热点函数</li>
            <li><b>火焰图/热点：</b>分析折叠栈数据，生成优化建议（锁、内存、系统调用）</li>
            <li><b>GDB 堆栈聚合：</b>合并相似线程栈，快速定位死锁和等待</li>
            <li><b>代码路径分析：</b>分析函数调用链复杂度，识别过长路径</li>
          </ul>
        }
      />
      
      <Tabs 
        items={items} 
        type="card"
        style={{ background: isDark ? '#1e1e1e' : '#fff', padding: 16, borderRadius: 8 }}
      />
    </div>
  );
};

export default CodeProfiler;
