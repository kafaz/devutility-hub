/**
 * faultTemplates.ts
 * Re-exports FAULT_TEMPLATES from FaultBuilder so ScenarioRunner and
 * ScenarioBuilder can import them without circular dependencies.
 */
type FormValues = Record<string, string | number>;

interface FaultTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: {
    name: string;
    label: string;
    type: 'text' | 'number' | 'select';
    placeholder?: string;
    defaultValue?: string | number;
    options?: { label: string; value: string }[];
    addonAfter?: string;
  }[];
  generateCmd: (values: FormValues) => string;
}

export const FAULT_TEMPLATES: FaultTemplate[] = [
  {
    id: 'net-delay',
    name: '网络延迟注入',
    description: '利用 tc qdisc 模拟网络抖动。',
    category: 'network',
    fields: [
      { name: 'dev', label: '网卡', type: 'text', defaultValue: 'eth0' },
      { name: 'delay', label: '延迟 (ms)', type: 'number', defaultValue: 200 },
      { name: 'jitter', label: '抖动 (ms)', type: 'number', defaultValue: 50 },
    ],
    generateCmd: (v) => `tc qdisc add dev ${v.dev} root netem delay ${v.delay}ms ${v.jitter}ms distribution normal`,
  },
  {
    id: 'net-loss',
    name: '网络丢包',
    description: '按百分比随机丢弃网络包。',
    category: 'network',
    fields: [
      { name: 'dev', label: '网卡', type: 'text', defaultValue: 'eth0' },
      { name: 'loss', label: '丢包率 (%)', type: 'number', defaultValue: 5 },
    ],
    generateCmd: (v) => `tc qdisc add dev ${v.dev} root netem loss ${v.loss}%`,
  },
  {
    id: 'net-partition',
    name: '网络分区隔离',
    description: 'iptables 屏蔽目标 IP 流量，模拟脑裂。',
    category: 'network',
    fields: [
      { name: 'targetIp', label: '目标 IP', type: 'text', defaultValue: '192.168.1.100' },
      { name: 'port', label: '端口 (可选)', type: 'text', placeholder: '留空则全部' },
    ],
    generateCmd: (v) => {
      const portFlag = v.port ? ` -p tcp --dport ${v.port}` : '';
      return `iptables -A INPUT -s ${v.targetIp}${portFlag} -j DROP && iptables -A OUTPUT -d ${v.targetIp}${portFlag} -j DROP`;
    },
  },
  {
    id: 'blk-timeout',
    name: '块设备 Hang 死',
    description: '挂起块设备 IO，导致进程 D 状态。',
    category: 'block',
    fields: [
      { name: 'disk', label: '磁盘 (不含 /dev/)', type: 'text', defaultValue: 'vdb' },
    ],
    generateCmd: (v) => `echo "offline" > /sys/block/${v.disk}/device/state`,
  },
  {
    id: 'blk-corrupt',
    name: '数据静默损坏',
    description: '向块设备注入随机垃圾数据。',
    category: 'block',
    fields: [
      { name: 'target_file', label: '目标设备/文件', type: 'text', defaultValue: '/dev/vdb1' },
      { name: 'offset', label: 'Seek (MB)', type: 'number', defaultValue: 10 },
      { name: 'count', label: '破坏量 (MB)', type: 'number', defaultValue: 1 },
    ],
    generateCmd: (v) => `dd if=/dev/urandom of=${v.target_file} bs=1M seek=${v.offset} count=${v.count} conv=notrunc`,
  },
  {
    id: 'os-cpu',
    name: 'CPU 压榨',
    description: '死循环打满指定 CPU 核数。',
    category: 'os',
    fields: [
      { name: 'cores', label: '核心数', type: 'number', defaultValue: 2 },
      { name: 'timeout', label: '持续 (秒)', type: 'number', defaultValue: 60 },
    ],
    generateCmd: (v) =>
      `for i in $(seq 1 ${v.cores}); do timeout ${v.timeout} bash -c 'while true; do :; done' &; done; wait`,
  },
  {
    id: 'os-oom',
    name: '急速 OOM 触发',
    description: 'tmpfs + dd 快速耗尽内存。',
    category: 'os',
    fields: [
      { name: 'size', label: '耗尽容量 (GB)', type: 'number', defaultValue: 4 },
    ],
    generateCmd: (v) =>
      `mkdir -p /tmp/oom_test && mount -t tmpfs -o size=${v.size}G tmpfs /tmp/oom_test && dd if=/dev/zero of=/tmp/oom_test/bloat bs=1M`,
  },
];
