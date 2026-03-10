import { CodeSandboxOutlined, ControlOutlined, DatabaseOutlined } from '@ant-design/icons';
import { App, Card, Col, Descriptions, Input, Layout, Row, Tag, Typography } from 'antd';
import React, { useMemo, useState } from 'react';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Content } = Layout;

// Helper to convert hex string to byte array
const hexToBytes = (hex: string): number[] => {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
};

// Helper for fetching 16-bit, 32-bit, 64-bit numbers (Big Endian for SCSI, Little Endian for NVMe)
const readBE16 = (bytes: number[], offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const readBE32 = (bytes: number[], offset: number) => 
    (bytes[offset] * 16777216) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
const readBE64 = (bytes: number[], offset: number) => {
    const high = readBE32(bytes, offset);
    const low = readBE32(bytes, offset + 4);
    return (BigInt(high) << 32n) | BigInt(low);
};

const readLE32 = (bytes: number[], offset: number) =>
    (bytes[offset + 3] * 16777216) + (bytes[offset + 2] << 16) + (bytes[offset + 1] << 8) + bytes[offset];
const readLE64 = (bytes: number[], offset: number) => {
    const low = readLE32(bytes, offset);
    const high = readLE32(bytes, offset + 4);
    return (BigInt(high) << 32n) | BigInt(low);
};

const SCSI_OPCODES: Record<number, string> = {
    0x00: 'TEST UNIT READY',
    0x12: 'INQUIRY',
    0x1A: 'MODE SENSE (6)',
    0x25: 'READ CAPACITY (10)',
    0x28: 'READ (10)',
    0x2A: 'WRITE (10)',
    0x2E: 'WRITE AND VERIFY (10)',
    0x88: 'READ (16)',
    0x8A: 'WRITE (16)',
    0x8E: 'WRITE AND VERIFY (16)',
    0x9E: 'SERVICE ACTION IN (16) / READ CAPACITY (16)',
};

const NVME_ADMIN_OPCODES: Record<number, string> = {
    0x00: 'Delete I/O Submission Queue',
    0x01: 'Create I/O Submission Queue',
    0x02: 'Get Log Page',
    0x04: 'Delete I/O Completion Queue',
    0x05: 'Create I/O Completion Queue',
    0x06: 'Identify',
    0x08: 'Abort',
    0x09: 'Set Features',
    0x0A: 'Get Features',
    0x0C: 'Async Event Request',
    0x10: 'Format NVM',
    0x14: 'Device Self-test',
};

const NVME_NVM_OPCODES: Record<number, string> = {
    0x00: 'Flush',
    0x01: 'Write',
    0x02: 'Read',
    0x04: 'Write Uncorrectable',
    0x05: 'Compare',
    0x08: 'Write Zeroes',
    0x09: 'Dataset Management',
};

interface DecodedResult {
    protocol: string;
    details: Array<{ label: string; value: React.ReactNode; span?: number }>;
    rawBytesFormatted: string;
}

const decodeProtocol = (hexString: string): DecodedResult | null => {
    const cleanHex = hexString.replace(/[^0-9a-fA-F]/g, '');
    if (cleanHex.length % 2 !== 0) return null; // Incomplete bytes
    if (cleanHex.length === 0) return null;

    const bytes = hexToBytes(cleanHex);
    const length = bytes.length;

    const formatBytes = (b: number[]) => b.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    // ── SCSI CDB Parsing (10, 16 bytes) ──────────────────
    if (length === 10 || length === 16) {
        const opcode = bytes[0];
        const opcodeName = SCSI_OPCODES[opcode] || 'UNKNOWN';
        let lba = 0n;
        let transferLen = 0;

        if (length === 10) {
            lba = BigInt(readBE32(bytes, 2));
            transferLen = readBE16(bytes, 7);
        } else if (length === 16) {
            lba = readBE64(bytes, 2);
            transferLen = readBE32(bytes, 10);
        }

        return {
            protocol: `SCSI CDB (${length} Bytes)`,
            rawBytesFormatted: formatBytes(bytes),
            details: [
                { label: 'Opcode', value: <Tag color="blue">0x{opcode.toString(16).padStart(2, '0').toUpperCase()} ({opcodeName})</Tag> },
                { label: 'Length Designation', value: `${length} Bytes command` },
                { label: 'Logical Block Address (LBA)', value: <Text copyable>{lba.toString()}</Text> },
                { label: 'Transfer Length', value: `${transferLen} Blocks` },
                { label: 'Flags Byte', value: `0x${bytes[1].toString(16).padStart(2, '0').toUpperCase()}` }
            ]
        };
    }

    // ── NVMe SQE Parsing (64 bytes) ──────────────────────
    if (length === 64) {
        // Parse basic NVMe SQE Dwords (Little Endian)
        const dw0 = readLE32(bytes, 0);
        const opcode = dw0 & 0xFF;
        const fuse = (dw0 >> 8) & 0x03;
        const psdt = (dw0 >> 14) & 0x03;
        const cid = (dw0 >> 16) & 0xFFFF; // Command ID

        const nsid = readLE32(bytes, 4);  // Dword 1
        
        let opcodeName = 'UNKNOWN';
        if (opcode in NVME_NVM_OPCODES) opcodeName = NVME_NVM_OPCODES[opcode];
        else if (opcode in NVME_ADMIN_OPCODES) opcodeName = NVME_ADMIN_OPCODES[opcode];
        else if (opcode === 0) opcodeName = 'Admin(00)';
        
        // Dword 10 & 11: Starting LBA (SLBA)
        const slba = readLE64(bytes, 40);
        
        // Dword 12: NLB (lower 16 bits) & PRINFO/FUA (upper 16)
        const dw12 = readLE32(bytes, 48);
        const nlb = (dw12 & 0xFFFF) + 1; // 0-based value
        const fua = (dw12 & 0x40000000) !== 0; // Force Unit Access
        const prinfo = (dw12 >> 26) & 0x0F;

        // Metadata Pointer (Dword 4,5) / PRP1 / SGL1
        const dptr1 = readLE64(bytes, 24); // PRP1
        const dptr2 = readLE64(bytes, 32); // PRP2

        return {
            protocol: 'NVMe Submission Queue Entry (SQE 64 Bytes)',
            rawBytesFormatted: formatBytes(bytes),
            details: [
                { label: 'Opcode', value: <Tag color="magenta">0x{opcode.toString(16).padStart(2, '0').toUpperCase()} ({opcodeName})</Tag> },
                { label: 'Command ID (CID)', value: cid },
                { label: 'Namespace ID (NSID)', value: nsid === 0xFFFFFFFF ? 'Broadcast' : nsid },
                { label: 'Starting LBA (SLBA)', value: <Text copyable>{slba.toString()}</Text> },
                { label: 'Number of Logical Blocks (NLB)', value: `${nlb} Blocks` },
                { label: 'FUA (Force Unit Access)', value: fua ? <Tag color="red">TRUE</Tag> : <Tag color="default">FALSE</Tag> },
                { label: 'PRP1 / Data Pointer 1', value: <Text code>0x{dptr1.toString(16).toUpperCase()}</Text> },
                { label: 'PRP2 / Data Pointer 2', value: <Text code>0x{dptr2.toString(16).toUpperCase()}</Text> },
                { label: 'Protection Info (PRINFO)', value: prinfo },
                { label: 'FUSE / PSDT', value: `FUSE: ${fuse}, PSDT: ${psdt}` }
            ]
        };
    }

    return null; // Unrecognized length
};


const ProtocolDecoder: React.FC = () => {
    const [hexInput, setHexInput] = useState('');
    const { theme } = useGlobalStore();
    const isDark = theme === 'dark';

    const decoded = useMemo(() => decodeProtocol(hexInput), [hexInput]);
    const byteCount = hexInput.replace(/[^0-9a-fA-F]/g, '').length / 2;

    return (
        <App>
            <Content style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <ControlOutlined style={{ fontSize: 24, color: '#3b82f6' }} />
                    <div>
                        <Title level={4} style={{ margin: 0 }}>协议裸码解码器 (Protocol Decoder)</Title>
                        <Text type="secondary" style={{ fontSize: 13 }}>支持 SCSI CDB (10/16 bytes) 与 NVMe SQE (64 bytes) 指令报文自动识别与拆解。</Text>
                    </div>
                </div>

                <Row gutter={[16, 16]} style={{ flex: 1, minHeight: 0 }}>
                    <Col span={9} style={{ display: 'flex', flexDirection: 'column' }}>
                        <Card 
                            size="small" 
                            title="十六进制指令码 (Hex Dump)" 
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#252526' : '#fff' }}
                            bodyStyle={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column' }}
                            extra={<Text type="secondary">{byteCount} Bytes</Text>}
                        >
                            <TextArea
                                value={hexInput}
                                onChange={(e) => setHexInput(e.target.value)}
                                placeholder="粘贴日志中的裸十六进制报文（支持带空格或不带空格）。\n\n示例 SCSI Read(10):\n28 00 00 00 12 34 00 00 08 00\n\n示例 NVMe Write (SQE):\n01 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00..."
                                style={{ 
                                    flex: 1, 
                                    resize: 'none', 
                                    border: 'none', 
                                    borderRadius: '0 0 8px 8px',
                                    fontFamily: 'monospace',
                                    fontSize: 14,
                                    padding: '12px',
                                    background: isDark ? '#1e1e1e' : '#fafafa',
                                    color: isDark ? '#d4d4d8' : '#333'
                                }}
                            />
                        </Card>
                    </Col>
                    
                    <Col span={15} style={{ display: 'flex', flexDirection: 'column' }}>
                        <Card 
                            size="small" 
                            title="结构化解析结果 (Decoded Fields)" 
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#252526' : '#fff' }}
                            bodyStyle={{ flex: 1, overflowY: 'auto' }}
                        >
                            {!hexInput ? (
                                <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 40 }}>
                                    <CodeSandboxOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }} />
                                    <p>等待输入报文数据</p>
                                </div>
                            ) : !decoded ? (
                                <div style={{ textAlign: 'center', color: '#ef4444', marginTop: 40 }}>
                                    <p>无法识别该报文格式。请确保输入的是完整的 10、16 或 64 字节的纯十六进制字符。</p>
                                </div>
                            ) : (
                                <div>
                                    <div style={{ marginBottom: 16 }}>
                                        <Text strong>识别协议：</Text>
                                        <Tag color="green" icon={<DatabaseOutlined />} style={{ marginLeft: 8 }}>{decoded.protocol}</Tag>
                                    </div>
                                    <div style={{ marginBottom: 24 }}>
                                        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>规范化字节:</Text>
                                        <div style={{ 
                                            background: isDark ? '#1e1e1e' : '#f4f4f5', 
                                            padding: '8px 12px', 
                                            borderRadius: 4,
                                            fontFamily: 'monospace',
                                            wordBreak: 'break-all'
                                        }}>
                                            {decoded.rawBytesFormatted}
                                        </div>
                                    </div>
                                    
                                    <Descriptions 
                                        bordered 
                                        column={2} 
                                        size="small"
                                        labelStyle={{ background: isDark ? '#2d2d30' : '#fafafa', width: 150 }}
                                    >
                                        {decoded.details.map((d, i) => (
                                            <Descriptions.Item key={i} label={d.label} span={d.span || 1}>
                                                {d.value}
                                            </Descriptions.Item>
                                        ))}
                                    </Descriptions>
                                </div>
                            )}
                        </Card>
                    </Col>
                </Row>
            </Content>
        </App>
    );
};

export default ProtocolDecoder;
