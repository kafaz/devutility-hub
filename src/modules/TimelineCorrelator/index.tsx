import { AlignLeftOutlined, DeleteOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Input, Layout, Popconfirm, Row, Space, Typography } from 'antd';
import React, { useRef, useState } from 'react';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Content } = Layout;

interface LogNode {
    id: string;
    name: string;
    color: string;
    text: string;
}

interface ParsedLine {
    nodeId: string;
    nodeName: string;
    color: string;
    timestamp: number;
    text: string;
}

const TIMESTAMP_REGEXES = [
    // 2024-03-10 12:00:00.123
    /(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?(?:Z|[+-]\d{2}:\d{2})?)/,
    // 12:00:00.123
    /(\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?)/,
    // 0310 12:00:00.12354 (common in glog/C++ logs)
    /(\d{4}\s\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?)/
];

const parseLogLines = (nodes: LogNode[]): ParsedLine[] => {
    const allLines: ParsedLine[] = [];

    for (const node of nodes) {
        if (!node.text.trim()) continue;
        
        const lines = node.text.split('\n');
        let lastValidTime = 0;

        for (const line of lines) {
            let lineTime = lastValidTime;
            
            // Try to extract timestamp
            for (const rx of TIMESTAMP_REGEXES) {
                const match = line.match(rx);
                if (match && match[1]) {
                    let tsString = match[1];
                    // If it's just time, prepend today's date to make it parseable
                    if (/^\d{2}:\d{2}:\d{2}/.test(tsString)) {
                        tsString = `1970-01-01T${tsString}Z`;
                    } else if (/^\d{4}\s\d{2}:\d{2}:\d{2}/.test(tsString)) {
                        // glog style: MMDD HH:mm:ss
                        const mo = tsString.slice(0, 2);
                        const da = tsString.slice(2, 4);
                        const rest = tsString.slice(5);
                        tsString = `1970-${mo}-${da}T${rest}Z`;
                    }
                    
                    const parsed = Date.parse(tsString);
                    if (!isNaN(parsed)) {
                        lineTime = parsed;
                        lastValidTime = parsed;
                        break;
                    }
                }
            }

            allLines.push({
                nodeId: node.id,
                nodeName: node.name,
                color: node.color,
                timestamp: lineTime,
                text: line
            });
        }
    }

    // Stable sort by timestamp
    return allLines.sort((a, b) => a.timestamp - b.timestamp);
};

const DEFAULT_NODES: LogNode[] = [
    { id: '1', name: 'Node-1 (Leader)', color: '#3b82f6', text: '' },
    { id: '2', name: 'Node-2 (Follower)', color: '#10b981', text: '' },
];
const COLOR_PALETTE = ['#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

const TimelineCorrelator: React.FC = () => {
    const [nodes, setNodes] = useState<LogNode[]>(DEFAULT_NODES);
    const [parsed, setParsed] = useState<ParsedLine[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    
    const { theme } = useGlobalStore();
    const isDark = theme === 'dark';
    const listRef = useRef<HTMLDivElement>(null);

    const handleAddNode = () => {
        const nextId = (nodes.length + 1).toString();
        const nextColor = COLOR_PALETTE[nodes.length % COLOR_PALETTE.length];
        setNodes([...nodes, { id: nextId, name: `Node-${nextId}`, color: nextColor, text: '' }]);
    };

    const handleRemoveNode = (id: string) => {
        setNodes(nodes.filter(n => n.id !== id));
    };

    const updateNode = (id: string, updates: Partial<LogNode>) => {
        setNodes(nodes.map(n => n.id === id ? { ...n, ...updates } : n));
    };

    const handleAnalyze = () => {
        setAnalyzing(true);
        setTimeout(() => {
            const result = parseLogLines(nodes);
            setParsed(result);
            setAnalyzing(false);
            
            if (listRef.current) {
                listRef.current.scrollTop = 0;
            }
        }, 100);
    };

    return (
        <App>
            <Content style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <AlignLeftOutlined style={{ fontSize: 24, color: '#3b82f6' }} />
                    <div style={{ flex: 1 }}>
                        <Title level={4} style={{ margin: 0 }}>多节点分布式日志时序对齐器 (Distributed Timeline Correlator)</Title>
                        <Text type="secondary" style={{ fontSize: 13 }}>将多个漂移的日志流，利用正则探测时间戳并在全局进行归并排序合并展示，洞察脑裂(Split-Brain)因果。</Text>
                    </div>
                    <Button type="primary" icon={<SyncOutlined spin={analyzing} />} onClick={handleAnalyze} loading={analyzing} size="large">
                        合并时序 (Correlate)
                    </Button>
                </div>

                <Row gutter={[16, 16]} style={{ flex: 1, minHeight: 0 }}>
                    <Col span={10} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
                        {nodes.map((node) => (
                            <Card 
                                key={node.id} 
                                size="small" 
                                style={{ marginBottom: 16, background: isDark ? '#252526' : '#fff', flexShrink: 0 }}
                                title={
                                    <Space>
                                        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: node.color }} />
                                        <Input 
                                            variant="borderless" 
                                            value={node.name} 
                                            onChange={e => updateNode(node.id, { name: e.target.value })}
                                            style={{ fontWeight: 'bold', width: 140, padding: 0 }}
                                        />
                                    </Space>
                                }
                                extra={
                                    <Popconfirm title="移除此节点?" onConfirm={() => handleRemoveNode(node.id)}>
                                        <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                                    </Popconfirm>
                                }
                            >
                                <TextArea
                                    value={node.text}
                                    onChange={e => updateNode(node.id, { text: e.target.value })}
                                    placeholder="粘贴该节点的原生文本日志..."
                                    rows={6}
                                    style={{ fontFamily: 'monospace', fontSize: 12, background: isDark ? '#1e1e1e' : '#fafafa', color: isDark ? '#d4d4d8' : '#333' }}
                                />
                            </Card>
                        ))}
                        <Button type="dashed" block icon={<PlusOutlined />} onClick={handleAddNode} style={{ marginBottom: 16 }}>
                            添加新节点日志流 (Add Node Stream)
                        </Button>
                    </Col>

                    <Col span={14} style={{ display: 'flex', flexDirection: 'column' }}>
                        <Card 
                            size="small" 
                            title={`统一归并时序视图 (Unified Timeline) - 共 ${parsed.length} 行`}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#1e1e1e' : '#000' }}
                            bodyStyle={{ flex: 1, padding: 0, overflow: 'hidden', position: 'relative' }}
                        >
                            <div 
                                ref={listRef}
                                style={{ 
                                    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
                                    overflowY: 'auto',
                                    padding: '12px 16px',
                                    fontFamily: 'monospace',
                                    fontSize: 13,
                                    lineHeight: '1.4',
                                    color: '#d4d4d8'
                                }}
                            >
                                {parsed.length === 0 ? (
                                    <div style={{ textAlign: 'center', marginTop: 100, color: '#666' }}>
                                        点击"合并时序"生成交织视图
                                    </div>
                                ) : (
                                    parsed.slice(0, 10000).map((line, idx) => (
                                        <div key={idx} style={{ 
                                            display: 'flex', 
                                            padding: '2px 0',
                                            borderBottom: `1px solid ${isDark ? '#333' : '#222'}`
                                        }}>
                                            <div style={{ width: 160, flexShrink: 0, color: line.color, fontWeight: 'bold' }}>
                                                [{line.nodeName}]
                                            </div>
                                            <div style={{ flex: 1, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                                                {line.text || '\u200b'}
                                            </div>
                                        </div>
                                    ))
                                )}
                                {parsed.length > 10000 && (
                                    <div style={{ textAlign: 'center', padding: 12, color: '#ef4444' }}>
                                        ...由于性能限制，只渲染前 10000 行
                                    </div>
                                )}
                            </div>
                        </Card>
                    </Col>
                </Row>
            </Content>
        </App>
    );
};

export default TimelineCorrelator;
