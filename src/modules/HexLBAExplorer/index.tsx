import { BlockOutlined, CalculatorOutlined, DiffOutlined } from '@ant-design/icons';
import { App, Card, Col, Descriptions, Empty, Input, InputNumber, Layout, Row, Select, Space, Tabs, Typography } from 'antd';
import React, { useMemo, useState } from 'react';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Content } = Layout;

// ── LBA 偏移量计算器 ────────────────────────────────────────────────────────

const LBACalculator: React.FC = () => {
  const [offsetBytes, setOffsetBytes] = useState<number | null>(134217728); // 128MB default
  const [sectorSize, setSectorSize] = useState<number>(4096);
  const [chunkSizeKB, setChunkSizeKB] = useState<number>(1024); // 1MB Chunk

  const calculations = useMemo(() => {
    if (offsetBytes == null) return null;
    const sectorCount = Math.floor(offsetBytes / sectorSize);
    const sectorOffset = offsetBytes % sectorSize;
    const chunkSizeBytes = chunkSizeKB * 1024;
    const chunkCount = Math.floor(offsetBytes / chunkSizeBytes);
    const chunkOffset = offsetBytes % chunkSizeBytes;
    
    // Page calculations (Assuming 4KB Page)
    const page4K = Math.floor(offsetBytes / 4096);
    const pageOffset = offsetBytes % 4096;

    return {
      sectorCount, sectorOffset,
      chunkCount, chunkOffset, chunkSizeBytes,
      page4K, pageOffset,
      hex: `0x${offsetBytes.toString(16).toUpperCase()}`
    };
  }, [offsetBytes, sectorSize, chunkSizeKB]);

  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[24, 24]}>
        <Col span={8}>
          <Card size="small" title="参数配置" style={{ background: isDark ? '#252526' : '#fff' }}>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>绝对偏移量 Offset (Bytes)</Text>
              <InputNumber
                style={{ width: '100%' }}
                value={offsetBytes}
                onChange={(v) => setOffsetBytes(v)}
                min={0}
                stringMode={false}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>扇区大小 Sector Size</Text>
              <Select value={sectorSize} onChange={setSectorSize} style={{ width: '100%' }}>
                <Select.Option value={512}>512 Bytes (512n/512e)</Select.Option>
                <Select.Option value={4096}>4096 Bytes (4K Native)</Select.Option>
              </Select>
            </div>
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>数据块大小 Chunk/Extent Size (KB)</Text>
              <InputNumber
                style={{ width: '100%' }}
                value={chunkSizeKB}
                onChange={(v) => setChunkSizeKB(v || 1024)}
                min={4}
              />
            </div>
          </Card>
        </Col>
        
        <Col span={16}>
          <Card size="small" title="计算结果" style={{ background: isDark ? '#252526' : '#fff', height: '100%' }}>
            {calculations ? (
              <Descriptions column={2} bordered size="small" labelStyle={{ background: isDark ? '#2d2d30' : '#fafafa' }}>
                <Descriptions.Item label="十六进制地址" span={2}>
                  <Text code copyable>{calculations.hex}</Text>
                </Descriptions.Item>
                
                <Descriptions.Item label={`LBA (${sectorSize}B)`}>
                  <Text strong>{calculations.sectorCount}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="扇区内偏移 (Sector Offset)">
                  <Text type={calculations.sectorOffset > 0 ? 'warning' : 'secondary'}>
                    {calculations.sectorOffset} Bytes
                  </Text>
                </Descriptions.Item>

                <Descriptions.Item label={`Chunk索引 (${chunkSizeKB}KB)`}>
                  <Text strong>{calculations.chunkCount}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Chunk内偏移 (Chunk Offset)">
                  <Text>{calculations.chunkOffset} Bytes</Text>
                </Descriptions.Item>

                <Descriptions.Item label="4K Page Number">
                  <Text strong>{calculations.page4K}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Page内对齐偏移">
                  <Text type={calculations.pageOffset > 0 ? 'danger' : 'success'}>
                    {calculations.pageOffset} Bytes
                  </Text>
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Empty description="请输入有效的偏移量" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

// ── Hexump 查错沙盒 (Diff) ──────────────────────────────────────────────────

const HexDiffSandbox: React.FC = () => {
  const [primaryText, setPrimaryText] = useState('');
  const [secondaryText, setSecondaryText] = useState('');
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const diffResult = useMemo(() => {
    if (!primaryText || !secondaryText) return null;
    
    const lines1 = primaryText.split('\n');
    const lines2 = secondaryText.split('\n');
    const maxLines = Math.max(lines1.length, lines2.length);
    
    const result = [];
    let mismatchCount = 0;

    for (let i = 0; i < maxLines; i++) {
        const l1 = lines1[i] || '';
        const l2 = lines2[i] || '';
        if (l1 === l2) {
            result.push({ lineNum: i + 1, type: 'equal', text: l1 });
        } else {
            mismatchCount++;
            result.push({ lineNum: i + 1, type: 'diff_primary', text: l1 });
            result.push({ lineNum: i + 1, type: 'diff_secondary', text: l2 });
        }
    }

    return { result, mismatchCount };
  }, [primaryText, secondaryText]);

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col span={12}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>主节点数据 (Primary Node Hexdump)</Text>
                <TextArea
                    rows={10}
                    value={primaryText}
                    onChange={e => setPrimaryText(e.target.value)}
                    placeholder="粘贴主节点的 xxd 或 hexdump 结果..."
                    style={{ fontFamily: 'monospace', background: isDark ? '#1e1e1e' : '#fff' }}
                />
            </Col>
            <Col span={12}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>备节点数据 (Secondary Node Hexdump)</Text>
                <TextArea
                    rows={10}
                    value={secondaryText}
                    onChange={e => setSecondaryText(e.target.value)}
                    placeholder="粘贴备节点的 xxd 或 hexdump 结果..."
                    style={{ fontFamily: 'monospace', background: isDark ? '#1e1e1e' : '#fff' }}
                />
            </Col>
        </Row>

        <Card 
            size="small" 
            title={
                <Space>
                    <DiffOutlined /> 
                    <span>比对结果</span>
                    {diffResult !== null && (
                        <Text type={diffResult.mismatchCount > 0 ? 'danger' : 'success'} style={{ fontSize: 13, marginLeft: 16 }}>
                            {diffResult.mismatchCount === 0 ? '完全一致 (Identical)' : `发现 ${diffResult.mismatchCount} 处不一致 (Data Corruption)`}
                        </Text>
                    )}
                </Space>
            } 
            bodyStyle={{ padding: 0 }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#252526' : '#fff' }}
        >
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, fontFamily: 'monospace', fontSize: 13, lineHeight: '1.5' }}>
                {!diffResult ? (
                    <Empty description="填入两侧 Hex 数据以开始比对" />
                ) : (
                    diffResult.result.map((item, idx) => {
                        let bgColor = 'transparent';
                        if (item.type === 'diff_primary') bgColor = isDark ? '#450a0a' : '#fee2e2'; // Red-ish
                        if (item.type === 'diff_secondary') bgColor = isDark ? '#064e3b' : '#d1fae5'; // Green-ish

                        return (
                            <div key={idx} style={{ background: bgColor, display: 'flex', padding: '0 8px' }}>
                                <div style={{ width: 40, color: '#9ca3af', userSelect: 'none' }}>
                                    {item.type === 'diff_secondary' ? '' : item.lineNum}
                                </div>
                                <div style={{ width: 24, userSelect: 'none', color: item.type === 'diff_primary' ? '#ef4444' : item.type === 'diff_secondary' ? '#10b981' : 'transparent' }}>
                                    {item.type === 'diff_primary' ? '-' : item.type === 'diff_secondary' ? '+' : ''}
                                </div>
                                <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: isDark ? '#d4d4d8' : '#333' }}>
                                    {item.text || '\u200b'}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </Card>
    </div>
  );
};

// ── 主页面 ──────────────────────────────────────────────────────────────────

const HexLBAExplorer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  return (
    <App>
      <Content style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <BlockOutlined style={{ fontSize: 24, color: '#3b82f6' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>LBA / 十六进制探索器 (Hex & LBA Sandbox)</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>专为块存储开发设计的物理扇区偏移量计算器，和静默损坏(Data Corruption) Diff 查错沙盒。</Text>
          </div>
        </div>

        <div style={{ flex: 1, background: isDark ? '#1e1e1e' : '#fff', borderRadius: 8, border: `1px solid ${isDark ? '#3e3e42' : '#e4e4e7'}` }}>
            <Tabs 
                defaultActiveKey="1" 
                style={{ height: '100%' }}
                tabBarStyle={{ padding: '0 16px', margin: 0 }}
                items={[
                    {
                        key: '1',
                        label: <span><CalculatorOutlined /> LBA 偏移量计算器</span>,
                        children: <LBACalculator />
                    },
                    {
                        key: '2',
                        label: <span><DiffOutlined /> 一致性比对沙盒 (Hex Dump Diff)</span>,
                        children: <HexDiffSandbox />
                    }
                ]}
            />
        </div>
      </Content>
    </App>
  );
};

export default HexLBAExplorer;
