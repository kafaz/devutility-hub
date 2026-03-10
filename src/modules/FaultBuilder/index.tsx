import { CopyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Form, Input, Layout, Radio, Row, Select, Space, Typography } from 'antd';
import React, { useMemo, useState } from 'react';
import { useClipboard } from '../../hooks/useClipboard';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;
const { Content } = Layout;

type FaultCategory = 'network' | 'block' | 'os';

interface FaultTemplate {
    id: string;
    name: string;
    description: string;
    category: FaultCategory;
    fields: {
        name: string;
        label: string;
        type: 'text' | 'number' | 'select';
        placeholder?: string;
        defaultValue?: string | number;
        options?: { label: string; value: string }[];
        addonAfter?: string;
    }[];
    generateCmd: (values: any) => string;
}

const FAULT_TEMPLATES: FaultTemplate[] = [
    // ── Network Faults ──
    {
        id: 'net-delay',
        name: '网络延迟注入 (Traffic Control Delay)',
        description: '利用 tc qdisc 模拟网络抖动和长尾高延迟。',
        category: 'network',
        fields: [
            { name: 'dev', label: '网卡设备', type: 'text', defaultValue: 'eth0', placeholder: '例如: eth0, lo' },
            { name: 'delay', label: '延迟时间 (ms)', type: 'number', defaultValue: 200, addonAfter: 'ms' },
            { name: 'jitter', label: '抖动范围 (ms)', type: 'number', defaultValue: 50, addonAfter: 'ms' },
        ],
        generateCmd: (v) => `# 添加网络延迟\ntc qdisc add dev ${v.dev} root netem delay ${v.delay}ms ${v.jitter}ms distribution normal\n\n# 恢复命令\n# tc qdisc del dev ${v.dev} root`
    },
    {
        id: 'net-loss',
        name: '网络丢包 (Packet Loss)',
        description: '利用 tc 按照百分比随机丢弃网络包。',
        category: 'network',
        fields: [
            { name: 'dev', label: '网卡设备', type: 'text', defaultValue: 'eth0' },
            { name: 'loss', label: '丢包率 (%)', type: 'number', defaultValue: 5, addonAfter: '%' },
        ],
        generateCmd: (v) => `# 注入丢包\ntc qdisc add dev ${v.dev} root netem loss ${v.loss}%\n\n# 恢复命令\n# tc qdisc del dev ${v.dev} root`
    },
    {
        id: 'net-partition',
        name: '网络分区隔离 (IPtables Partition)',
        description: '通过 iptables 屏蔽来自特定 IP 的流量，模拟脑裂或者链路中断。',
        category: 'network',
        fields: [
            { name: 'targetIp', label: '目标隔离 IP', type: 'text', defaultValue: '192.168.1.100', placeholder: '例如: 10.0.0.5' },
            { name: 'port', label: '特定端口 (可选)', type: 'text', placeholder: '例如: 2379 (留空则屏蔽全部)' },
        ],
        generateCmd: (v) => {
            const portFlag = v.port ? ` -p tcp --dport ${v.port}` : '';
            return `# 屏蔽来自目标 IP 的流量\niptables -A INPUT -s ${v.targetIp}${portFlag} -j DROP\niptables -A OUTPUT -d ${v.targetIp}${portFlag} -j DROP\n\n# 恢复命令\n# iptables -D INPUT -s ${v.targetIp}${portFlag} -j DROP\n# iptables -D OUTPUT -d ${v.targetIp}${portFlag} -j DROP`
        }
    },
    
    // ── Block Device Faults ──
    {
        id: 'blk-timeout',
        name: '存储设备 Hang 死模拟 (Device Timeout)',
        description: '将底层块设备的调度器阻塞，使读写该盘的所有 IO 挂起。',
        category: 'block',
        fields: [
            { name: 'disk', label: '磁盘设备', type: 'text', defaultValue: 'vdb', placeholder: '注意不要加 /dev/ 前缀' },
        ],
        generateCmd: (v) => `# 挂起磁盘 IO (导致进程处于 D 状态)\necho "offline" > /sys/block/${v.disk}/device/state\n\n# 恢复命令\n# echo "running" > /sys/block/${v.disk}/device/state`
    },
    {
        id: 'blk-corrupt',
        name: '文件头部数据静默破坏 (Silent Corruption)',
        description: '直接向块设备或者文件偏移处写入随机垃圾数据。',
        category: 'block',
        fields: [
            { name: 'target_file', label: '目标盘符/文件', type: 'text', defaultValue: '/dev/vdb1' },
            { name: 'offset', label: '跳过大小 Seek (MB)', type: 'number', defaultValue: 10 },
            { name: 'count', label: '破坏量 (MB)', type: 'number', defaultValue: 1 },
        ],
        generateCmd: (v) => `# 向目标注入随机垃圾数据破坏一致性 (警告: 极度危险)\ndd if=/dev/urandom of=${v.target_file} bs=1M seek=${v.offset} count=${v.count} conv=notrunc`
    },

    // ── OS & Resource Faults ──
    {
        id: 'os-cpu',
        name: 'CPU 算力压榨 (CPU Burn)',
        description: '启动数个死循环进程打满 CPU 核，模拟计算资源争抢。',
        category: 'os',
        fields: [
            { name: 'cores', label: '压榨核心数', type: 'number', defaultValue: 2 },
            { name: 'timeout', label: '持续时间 (秒)', type: 'number', defaultValue: 60, addonAfter: 's' }
        ],
        generateCmd: (v) => {
            let cmd = `# 编译并执行 CPU 死循环压榨器\nfor i in $(seq 1 ${v.cores}); do\n  timeout ${v.timeout} bash -c 'while true; do :; done' &\ndone\nwait\necho "CPU Burn Completed."`;
            return cmd;
        }
    },
    {
        id: 'os-oom',
        name: '急速 OOM 触发器 (Memory Leak Simulation)',
        description: '在内存中挂载 tmpfs 并急速吃满内存直到触发 OOM Killer 杀掉数据库进程。',
        category: 'os',
        fields: [
            { name: 'size', label: '消耗容量 (GB)', type: 'number', defaultValue: 4, addonAfter: 'GB' },
        ],
        generateCmd: (v) => `# 快速消耗物理内存\nmkdir -p /tmp/oom_test\nmount -t tmpfs -o size=${v.size}G tmpfs /tmp/oom_test\ndd if=/dev/zero of=/tmp/oom_test/bloat bs=1M\n\n# 恢复命令\n# rm -f /tmp/oom_test/bloat\n# umount /tmp/oom_test`
    }
];

const FaultBuilder: React.FC = () => {
    const { theme } = useGlobalStore();
    const isDark = theme === 'dark';
    const [form] = Form.useForm();
    const { copy } = useClipboard();

    const [category, setCategory] = useState<FaultCategory>('network');
    const [selectedId, setSelectedId] = useState<string>('net-delay');
    const [formValues, setFormValues] = useState<any>({});

    const activeTemplates = useMemo(() => FAULT_TEMPLATES.filter(t => t.category === category), [category]);
    const activeTemplate = useMemo(() => FAULT_TEMPLATES.find(t => t.id === selectedId), [selectedId]);

    const generatedCode = useMemo(() => {
        if (!activeTemplate) return '';
        try {
            // Merge defaults with current form values
            const values = { ...formValues };
            activeTemplate.fields.forEach(f => {
                if (values[f.name] === undefined) values[f.name] = f.defaultValue;
            });
            return activeTemplate.generateCmd(values);
        } catch (e) {
            return '# Error generating command';
        }
    }, [activeTemplate, formValues]);

    const handleCategoryChange = (e: any) => {
        const cat = e.target.value;
        setCategory(cat);
        const first = FAULT_TEMPLATES.find(t => t.category === cat);
        if (first) {
            setSelectedId(first.id);
            form.resetFields();
            setFormValues({});
        }
    };

    return (
        <App>
            <Content style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <ThunderboltOutlined style={{ fontSize: 24, color: '#ef4444' }} />
                    <div style={{ flex: 1 }}>
                        <Title level={4} style={{ margin: 0 }}>故障注入快捷生成器 (Chaos & Fault Builder)</Title>
                        <Text type="secondary" style={{ fontSize: 13 }}>内置块设备静默损坏、流量分区、CPU耗尽等分布式压测灾难预案模板库。杜绝手写命令误操作。</Text>
                    </div>
                </div>

                <Row gutter={[24, 24]} style={{ flex: 1, minHeight: 0 }}>
                    <Col span={10} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
                        <Card size="small" style={{ marginBottom: 16, background: isDark ? '#252526' : '#fff' }}>
                            <div style={{ marginBottom: 16 }}>
                                <Text strong style={{ display: 'block', marginBottom: 8 }}>选择故障域 (Fault Domain)</Text>
                                <Radio.Group value={category} onChange={handleCategoryChange} buttonStyle="solid" style={{ display: 'flex' }}>
                                    <Radio.Button value="network" style={{ flex: 1, textAlign: 'center' }}>网络层面 (Network)</Radio.Button>
                                    <Radio.Button value="block" style={{ flex: 1, textAlign: 'center' }}>存储块层 (Block IOS)</Radio.Button>
                                    <Radio.Button value="os" style={{ flex: 1, textAlign: 'center' }}>操作系统 (OS/Mem)</Radio.Button>
                                </Radio.Group>
                            </div>

                            <Text strong style={{ display: 'block', marginBottom: 8 }}>选择故障模板 (Template)</Text>
                            <Select 
                                value={selectedId}
                                onChange={(val) => {
                                    setSelectedId(val);
                                    form.resetFields();
                                    setFormValues({});
                                }}
                                style={{ width: '100%' }}
                                size="large"
                            >
                                {activeTemplates.map(t => (
                                    <Select.Option key={t.id} value={t.id}>{t.name}</Select.Option>
                                ))}
                            </Select>
                            
                            {activeTemplate && (
                                <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
                                    {activeTemplate.description}
                                </Text>
                            )}
                        </Card>

                        {activeTemplate && activeTemplate.fields.length > 0 && (
                            <Card size="small" title="注入参数配置" style={{ flexShrink: 0, background: isDark ? '#252526' : '#fff' }}>
                                <Form 
                                    form={form} 
                                    layout="vertical"
                                    onValuesChange={(_, allValues) => setFormValues(allValues)}
                                    initialValues={
                                        activeTemplate.fields.reduce((acc, f) => {
                                            acc[f.name] = f.defaultValue;
                                            return acc;
                                        }, {} as Record<string, any>)
                                    }
                                >
                                    {activeTemplate.fields.map(f => (
                                        <Form.Item key={f.name} label={f.label} name={f.name}>
                                            <Input 
                                                type={f.type === 'number' ? 'number' : 'text'} 
                                                placeholder={f.placeholder} 
                                                addonAfter={f.addonAfter} 
                                            />
                                        </Form.Item>
                                    ))}
                                </Form>
                            </Card>
                        )}
                    </Col>

                    <Col span={14} style={{ display: 'flex', flexDirection: 'column' }}>
                        <Card 
                            size="small" 
                            title="生成的 Bash 脚本 (Generated Payload)" 
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#252526' : '#fff' }}
                            bodyStyle={{ flex: 1, padding: 0, position: 'relative' }}
                        >
                            <Input.TextArea
                                value={generatedCode}
                                readOnly
                                style={{ 
                                    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
                                    resize: 'none', 
                                    border: 'none', 
                                    borderRadius: '0 0 8px 8px',
                                    fontFamily: 'monospace',
                                    fontSize: 14,
                                    padding: '16px',
                                    background: isDark ? '#000000' : '#1e1e1e',
                                    color: '#4ade80' // Terminal green 
                                }}
                            />
                            
                            <Space style={{ position: 'absolute', bottom: 16, right: 16 }}>
                                <Button 
                                    icon={<CopyOutlined />} 
                                    onClick={() => copy(generatedCode)}
                                >
                                    复制到剪贴板
                                </Button>
                            </Space>
                        </Card>
                    </Col>
                </Row>
            </Content>
        </App>
    );
};

export default FaultBuilder;
