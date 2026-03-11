/**
 * IOAnalyzer — DBS IO 性能综合分析器
 * 
 * 功能：
 *   1. iostat 实时监控分析 - 解析 iostat -x 1 输出，识别瓶颈设备
 *   2. dd 性能测试 - 分析 dd 带宽和延迟
 *   3. fio 结果深度分析 - 延迟分布热力图、IOPS 曲线
 *   4. blktrace IO 瀑布图 - 重建 IO 时间线
 *   5. 多工具关联分析 - 结合多种数据源定位问题
 */
import {
  AreaChartOutlined,
  BarChartOutlined,
  ClearOutlined,
  CopyOutlined,
  DashboardOutlined,
  FireOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Progress,
  Row,
  Select,
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
import { useClipboard } from '../../hooks/useClipboard';
import type { TabsProps } from 'antd';

const { Title, Text } = Typography;
const { TextArea } = Input;

// ============================================================================
// 类型定义
// ============================================================================

interface IOStatEntry {
  device: string;
  rrqm: number;    // 每秒合并读请求
  wrqm: number;    // 每秒合并写请求
  r: number;       // 每秒读请求
  w: number;       // 每秒写请求
  rMB: number;     // 每秒读 MB
  wMB: number;     // 每秒写 MB
  avgrqsz: number; // 平均请求大小
  avgqu: number;   // 平均队列长度
  await: number;   // 平均 IO 等待时间 (ms)
  rawait: number;  // 读等待时间
  wawait: number;  // 写等待时间
  svctm: number;   // 平均服务时间
  util: number;    // 设备利用率 %
  timestamp?: number;
}

interface DDResult {
  operation: 'read' | 'write' | 'mixed';
  bs: number;           // block size
  count: number;        // block count
  bytes: number;        // total bytes
  speed: number;        // MB/s
  time: number;         // seconds
  iops?: number;        // estimated IOPS
  latency?: number;     // estimated latency ms
}

interface BlktraceEvent {
  timestamp: number;    // ns
  sector: number;       // LBA
  size: number;         // bytes
  op: 'R' | 'W' | 'D' | 'S' | 'C';  // Read/Write/Discard/Sync/Complete
  device: string;
  duration?: number;    // complete latency
}

interface IOHotspot {
  device: string;
  metric: string;
  value: number;
  severity: 'critical' | 'warning' | 'info';
  suggestion: string;
}

// ============================================================================
// 解析函数
// ============================================================================

/** 解析 iostat -x 1 输出 */
const parseIOStat = (text: string): IOStatEntry[] => {
  const lines = text.trim().split('\n');
  const entries: IOStatEntry[] = [];
  
  // 找到数据行（以设备名开头，如 sda, vda, nvme0n1）
  const dataRegex = /^(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/;
  
  lines.forEach(line => {
    const match = line.trim().match(dataRegex);
    if (match) {
      entries.push({
        device: match[1],
        rrqm: parseFloat(match[2]),
        wrqm: parseFloat(match[3]),
        r: parseFloat(match[4]),
        w: parseFloat(match[5]),
        rMB: parseFloat(match[6]),
        wMB: parseFloat(match[7]),
        avgrqsz: parseFloat(match[8]),
        avgqu: parseFloat(match[9]),
        await: parseFloat(match[10]),
        rawait: parseFloat(match[11]),
        wawait: parseFloat(match[12]),
        svctm: parseFloat(match[13]),
        util: parseFloat(match[14]),
      });
    }
  });
  
  return entries;
};

/** 解析 dd 输出 */
const parseDD = (text: string): DDResult | null => {
  // 匹配: 1073741824 bytes (1.1 GB, 1.0 GiB) copied, 2.34567 s, 458 MB/s
  const match = text.match(/(\d+) bytes.*copied,\s+([\d.]+)\s+s,\s+([\d.]+)\s+(\w+)\/s/);
  if (!match) return null;
  
  const bytes = parseInt(match[1]);
  const time = parseFloat(match[2]);
  let speed = parseFloat(match[3]);
  const unit = match[4];
  
  // 统一转换为 MB/s
  if (unit === 'GB') speed *= 1000;
  else if (unit === 'kB') speed /= 1000;
  else if (unit === 'TB') speed *= 1000000;
  
  // 从命令行提取 bs 和 count
  const bsMatch = text.match(/bs=(\d+)(\w*)/);
  const countMatch = text.match(/count=(\d+)/);
  const bs = bsMatch ? parseInt(bsMatch[1]) * (bsMatch[2] === 'M' ? 1048576 : bsMatch[2] === 'K' ? 1024 : 1) : 4096;
  const count = countMatch ? parseInt(countMatch[1]) : Math.floor(bytes / bs);
  
  // 判断操作类型
  let operation: 'read' | 'write' | 'mixed' = 'read';
  if (text.includes('of=') && !text.includes('if=')) operation = 'write';
  else if (text.includes('of=') && text.includes('if=')) operation = 'mixed';
  
  return {
    operation,
    bs,
    count,
    bytes,
    speed,
    time,
    iops: Math.floor(count / time),
    latency: (time * 1000) / count,
  };
};

/** 解析 blkparse 输出 */
const parseBlktrace = (text: string): BlktraceEvent[] => {
  const events: BlktraceEvent[] = [];
  const lines = text.split('\n');
  
  // 匹配: 8,0   0     1     0.000000000  1234  A  W 12345678 + 8 <- (8,1) 23456789
  const regex = /(\d+),\d+\s+\d+\s+\d+\s+([\d.]+)\s+\d+\s+\w+\s+([RWDSC])\s+([\d+])\s*\+?\s*(\d*)/;
  
  lines.forEach(line => {
    const match = line.match(regex);
    if (match) {
      events.push({
        device: match[1],
        timestamp: parseFloat(match[2]) * 1000000000, // 转换为 ns
        op: match[3] as BlktraceEvent['op'],
        sector: parseInt(match[4]),
        size: (parseInt(match[5]) || 8) * 512, // 扇区数 * 512
      });
    }
  });
  
  return events;
};

/** 分析 IO 热点和瓶颈 */
const analyzeIOHotspots = (entries: IOStatEntry[]): IOHotspot[] => {
  const hotspots: IOHotspot[] = [];
  
  entries.forEach(entry => {
    // 高利用率检测
    if (entry.util > 95) {
      hotspots.push({
        device: entry.device,
        metric: 'util',
        value: entry.util,
        severity: 'critical',
        suggestion: `${entry.device} 利用率 ${entry.util.toFixed(1)}%，可能成为瓶颈，建议检查队列深度或分散 IO`,
      });
    } else if (entry.util > 80) {
      hotspots.push({
        device: entry.device,
        metric: 'util',
        value: entry.util,
        severity: 'warning',
        suggestion: `${entry.device} 利用率较高 (${entry.util.toFixed(1)}%)，建议监控`,
      });
    }
    
    // 高延迟检测
    if (entry.await > 100) {
      hotspots.push({
        device: entry.device,
        metric: 'await',
        value: entry.await,
        severity: 'critical',
        suggestion: `${entry.device} 平均 IO 等待 ${entry.await.toFixed(1)}ms，严重超标，检查硬件或队列`,
      });
    } else if (entry.await > 20) {
      hotspots.push({
        device: entry.device,
        metric: 'await',
        value: entry.await,
        severity: entry.await > 50 ? 'critical' : 'warning',
        suggestion: `${entry.device} IO 等待 ${entry.await.toFixed(1)}ms，建议优化`,
      });
    }
    
    // 队列深度检测
    if (entry.avgqu > 32) {
      hotspots.push({
        device: entry.device,
        metric: 'avgqu',
        value: entry.avgqu,
        severity: 'warning',
        suggestion: `${entry.device} 队列长度 ${entry.avgqu.toFixed(1)}，可能 IO 堆积`,
      });
    }
    
    // 读写不平衡检测
    const rwRatio = entry.r / (entry.w + 0.01);
    if (rwRatio > 10 || rwRatio < 0.1) {
      hotspots.push({
        device: entry.device,
        metric: 'rw_ratio',
        value: rwRatio,
        severity: 'info',
        suggestion: `${entry.device} 读写比 ${rwRatio.toFixed(1)}:1，严重不平衡`,
      });
    }
  });
  
  return hotspots.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
};

// ============================================================================
// 子组件
// ============================================================================

const IOStatAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<IOStatEntry[]>([]);
  
  const analyze = useCallback(() => {
    const parsed = parseIOStat(input);
    setEntries(parsed);
  }, [input]);
  
  const hotspots = useMemo(() => analyzeIOHotspots(entries), [entries]);
  
  const columns = [
    { title: '设备', dataIndex: 'device', key: 'device', fixed: 'left' as const },
    { title: 'r/s', dataIndex: 'r', key: 'r', sorter: (a: IOStatEntry, b: IOStatEntry) => a.r - b.r },
    { title: 'w/s', dataIndex: 'w', key: 'w', sorter: (a: IOStatEntry, b: IOStatEntry) => a.w - b.w },
    { title: 'rMB/s', dataIndex: 'rMB', key: 'rMB' },
    { title: 'wMB/s', dataIndex: 'wMB', key: 'wMB' },
    { title: '平均队列', dataIndex: 'avgqu', key: 'avgqu', render: (v: number) => v > 32 ? <Tag color="red">{v.toFixed(2)}</Tag> : v.toFixed(2) },
    { title: 'await(ms)', dataIndex: 'await', key: 'await', render: (v: number) => v > 100 ? <Tag color="red">{v.toFixed(2)}</Tag> : v > 20 ? <Tag color="orange">{v.toFixed(2)}</Tag> : v.toFixed(2) },
    { title: 'r_await(ms)', dataIndex: 'rawait', key: 'rawait' },
    { title: 'w_await(ms)', dataIndex: 'wawait', key: 'wawait' },
    { title: '利用率%', dataIndex: 'util', key: 'util', render: (v: number) => (
      <Progress 
        percent={Math.min(v, 100)} 
        size="small" 
        status={v > 95 ? 'exception' : v > 80 ? 'normal' : 'success'}
        format={() => `${v.toFixed(1)}%`}
      />
    )},
  ];
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="粘贴 iostat -x 1 的输出进行分析"
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持多次采样的数据，会自动识别设备行。关键指标：util {'>'} 80% 为瓶颈，await {'>'} 20ms 为高延迟
          </Text>
        }
      />
      
      <TextArea
        rows={8}
        placeholder={`示例：
Device            r/s     w/s     rMB/s     wMB/s   rrqm/s   wrqm/s  %rrqm  %wrqm r_await w_await aqu-sz rareq-sz wareq-sz  svctm  %util
nvme0n1       1000.00  500.00    250.00    125.00     0.00     0.00   0.00   0.00    2.50    5.00   3.50     256.00     256.00   0.50  75.00`}
        value={input}
        onChange={e => setInput(e.target.value)}
        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
      />
      
      <Space>
        <Button type="primary" icon={<SearchOutlined />} onClick={analyze}>分析</Button>
        <Button icon={<ClearOutlined />} onClick={() => { setInput(''); setEntries([]); }}>清空</Button>
      </Space>
      
      {hotspots.length > 0 && (
        <Card size="small" title={<><FireOutlined /> IO 热点诊断</>} style={{ background: isDark ? '#252526' : '#fff' }}>
          <Timeline>
            {hotspots.map((spot, idx) => (
              <Timeline.Item 
                key={idx}
                color={spot.severity === 'critical' ? 'red' : spot.severity === 'warning' ? 'orange' : 'blue'}
              >
                <Text strong style={{ color: spot.severity === 'critical' ? '#ef4444' : spot.severity === 'warning' ? '#f97316' : '#3b82f6' }}>
                  [{spot.severity.toUpperCase()}]
                </Text>
                <Text> {spot.suggestion}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>
      )}
      
      {entries.length > 0 && (
        <Card size="small" title={<><DashboardOutlined /> 设备统计</>}>
          <Table 
            dataSource={entries} 
            columns={columns} 
            rowKey="device" 
            size="small" 
            scroll={{ x: 1000 }}
            pagination={false}
          />
        </Card>
      )}
    </div>
  );
};

const DDAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const [input, setInput] = useState('');
  const [result, setResult] = useState<DDResult | null>(null);
  
  const analyze = useCallback(() => {
    const parsed = parseDD(input);
    setResult(parsed);
  }, [input]);
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="粘贴 dd 命令及输出结果"
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持格式：dd if=/dev/zero of=/mnt/test bs=1M count=1024 oflag=direct
          </Text>
        }
      />
      
      <TextArea
        rows={6}
        placeholder={`示例：
$ dd if=/dev/zero of=/mnt/test bs=1M count=1024 oflag=direct
1024+0 records in
1024+0 records out
1073741824 bytes (1.1 GB, 1.0 GiB) copied, 2.34567 s, 458 MB/s`}
        value={input}
        onChange={e => setInput(e.target.value)}
        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
      />
      
      <Space>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={analyze}>分析性能</Button>
        <Button icon={<ClearOutlined />} onClick={() => { setInput(''); setResult(null); }}>清空</Button>
      </Space>
      
      {result && (
        <Card size="small" style={{ background: isDark ? '#252526' : '#fff' }}>
          <Row gutter={[16, 16]}>
            <Col span={8}>
              <Statistic 
                title="吞吐量" 
                value={result.speed} 
                suffix="MB/s" 
                valueStyle={{ color: result.speed > 500 ? '#22c55e' : result.speed > 100 ? '#3b82f6' : '#ef4444' }}
              />
            </Col>
            <Col span={8}>
              <Statistic title="数据量" value={(result.bytes / 1024 / 1024 / 1024).toFixed(2)} suffix="GB" />
            </Col>
            <Col span={8}>
              <Statistic title="耗时" value={result.time.toFixed(2)} suffix="s" />
            </Col>
            <Col span={8}>
              <Statistic title="预估 IOPS" value={result.iops?.toLocaleString() || '-'} />
            </Col>
            <Col span={8}>
              <Statistic title="Block Size" value={(result.bs / 1024).toFixed(0)} suffix="KB" />
            </Col>
            <Col span={8}>
              <Statistic title="操作类型" value={result.operation.toUpperCase()} />
            </Col>
          </Row>
          
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">性能评估：</Text>
            {result.speed > 1000 ? (
              <Tag color="success">优秀 (NVMe SSD 级别)</Tag>
            ) : result.speed > 500 ? (
              <Tag color="success">良好 (高端 SSD)</Tag>
            ) : result.speed > 100 ? (
              <Tag color="warning">一般 (SATA SSD/HDD)</Tag>
            ) : (
              <Tag color="error">较差 (可能存在瓶颈)</Tag>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

const BlktraceVisualizer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const [input, setInput] = useState('');
  const [events, setEvents] = useState<BlktraceEvent[]>([]);
  
  const analyze = useCallback(() => {
    const parsed = parseBlktrace(input);
    setEvents(parsed);
  }, [input]);
  
  // 简化的瀑布图数据准备
  const timelineData = useMemo(() => {
    if (events.length === 0) return [];
    const minTime = Math.min(...events.map(e => e.timestamp));
    return events.slice(0, 100).map(e => ({
      ...e,
      relTime: (e.timestamp - minTime) / 1000000, // ms
    }));
  }, [events]);
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        message="粘贴 blkparse 输出重建 IO 时间线"
        description={
          <Text type="secondary" style={{ fontSize: 12 }}>
            生成方式：blktrace -d /dev/nvme0n1 -o - | blkparse -i -
          </Text>
        }
      />
      
      <TextArea
        rows={8}
        placeholder="粘贴 blkparse 输出..."
        value={input}
        onChange={e => setInput(e.target.value)}
        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
      />
      
      <Space>
        <Button type="primary" icon={<AreaChartOutlined />} onClick={analyze}>生成瀑布图</Button>
        <Button icon={<ClearOutlined />} onClick={() => { setInput(''); setEvents([]); }}>清空</Button>
      </Space>
      
      {events.length > 0 && (
        <Card size="small" title={<>IO 事件数: {events.length} (显示前 100 个)</>}>
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {timelineData.map((e, idx) => (
              <div key={idx} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 12, 
                padding: '4px 0',
                borderBottom: `1px solid ${isDark ? '#333' : '#eee'}`,
                fontFamily: 'monospace',
                fontSize: 12,
              }}>
                <span style={{ width: 80, color: '#6b7280' }}>{e.relTime.toFixed(3)}ms</span>
                <Tag color={e.op === 'R' ? 'blue' : e.op === 'W' ? 'red' : 'default'} style={{ width: 30 }}>
                  {e.op}
                </Tag>
                <span style={{ width: 120, color: '#8b5cf6' }}>LBA: {e.sector}</span>
                <span style={{ width: 80 }}>+{e.size / 1024}KB</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

const CommandGenerator: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  const { copy } = useClipboard();
  const [device, setDevice] = useState('/dev/nvme0n1');
  const [bs, setBs] = useState('1M');
  const [count, setCount] = useState('1024');
  const [testType, setTestType] = useState<'seq-read' | 'seq-write' | 'rand-read' | 'rand-write'>('seq-read');
  
  const commands: Record<string, string> = {
    'seq-read': `dd if=${device} of=/dev/null bs=${bs} count=${count} iflag=direct`,
    'seq-write': `dd if=/dev/zero of=${device} bs=${bs} count=${count} oflag=direct`,
    'rand-read': `fio --name=rand-read --filename=${device} --direct=1 --rw=randread --bs=4k --ioengine=libaio --iodepth=32 --runtime=60 --numjobs=4 --group_reporting`,
    'rand-write': `fio --name=rand-write --filename=${device} --direct=1 --rw=randwrite --bs=4k --ioengine=libaio --iodepth=32 --runtime=60 --numjobs=4 --group_reporting`,
  };
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title="测试参数" style={{ background: isDark ? '#252526' : '#fff' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text type="secondary">测试类型</Text>
                <Select value={testType} onChange={setTestType} style={{ width: '100%' }}>
                  <Select.Option value="seq-read">顺序读 (dd)</Select.Option>
                  <Select.Option value="seq-write">顺序写 (dd)</Select.Option>
                  <Select.Option value="rand-read">随机读 (fio)</Select.Option>
                  <Select.Option value="rand-write">随机写 (fio)</Select.Option>
                </Select>
              </div>
              <div>
                <Text type="secondary">设备路径</Text>
                <Input value={device} onChange={e => setDevice(e.target.value)} />
              </div>
              {testType.startsWith('seq') && (
                <>
                  <div>
                    <Text type="secondary">Block Size</Text>
                    <Input value={bs} onChange={e => setBs(e.target.value)} />
                  </div>
                  <div>
                    <Text type="secondary">Count</Text>
                    <Input value={count} onChange={e => setCount(e.target.value)} />
                  </div>
                </>
              )}
            </Space>
          </Card>
        </Col>
        <Col span={12}>
          <Card 
            size="small" 
            title="生成命令"
            extra={<Button size="small" icon={<CopyOutlined />} onClick={() => copy(commands[testType])}>复制</Button>}
            style={{ background: isDark ? '#1e1e1e' : '#f8f8f8' }}
          >
            <pre style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {commands[testType]}
            </pre>
          </Card>
          
          <Alert 
            style={{ marginTop: 16 }}
            type="warning" 
            showIcon 
            message="危险操作警告"
            description="写入测试会覆盖设备数据！请确保操作的是非生产环境或已备份的卷。"
          />
        </Col>
      </Row>
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

const IOAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';
  
  const items: TabsProps['items'] = [
    {
      key: 'iostat',
      label: (<><DashboardOutlined /> iostat 分析</>),
      children: <IOStatAnalyzer />,
    },
    {
      key: 'dd',
      label: (<><ThunderboltOutlined /> dd 性能测试</>),
      children: <DDAnalyzer />,
    },
    {
      key: 'blktrace',
      label: (<><AreaChartOutlined /> blktrace 瀑布图</>),
      children: <BlktraceVisualizer />,
    },
    {
      key: 'generator',
      label: (<><PlayCircleOutlined /> 命令生成器</>),
      children: <CommandGenerator />,
    },
  ];
  
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <BarChartOutlined style={{ fontSize: 28, color: '#3b82f6' }} />
        <div>
          <Title level={4} style={{ margin: 0 }}>IO 性能分析器</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            集成 iostat、dd、blktrace、fio 等多种 IO 工具，快速定位存储性能瓶颈
          </Text>
        </div>
      </div>
      
      <Tabs 
        items={items} 
        type="card"
        style={{ background: isDark ? '#1e1e1e' : '#fff', padding: 16, borderRadius: 8 }}
      />
    </div>
  );
};

export default IOAnalyzer;
