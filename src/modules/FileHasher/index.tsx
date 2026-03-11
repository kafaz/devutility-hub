import { InboxOutlined, InfoCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Card, Checkbox, InputNumber, message, Space, Spin, Tooltip, Typography, Upload } from 'antd';
import CRC32 from 'crc-32';
import React, { useState } from 'react';
import SparkMD5 from 'spark-md5';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const FileHasher: React.FC = () => {
  const [hashing, setHashing] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [md5Hash, setMd5Hash] = useState<string>('');
  const [crc32Hash, setCrc32Hash] = useState<string>('');
  const [progress, setProgress] = useState(0);

  const [padToSize, setPadToSize] = useState<boolean>(false);
  const [targetBlockSize, setTargetBlockSize] = useState<number | null>(null);
  const [warningMsg, setWarningMsg] = useState<string>('');

  const calculateMD5 = (file: File) => {
    if (padToSize && targetBlockSize && targetBlockSize < file.size) {
      message.error('目标设备容量不能小于原文件大小！');
      return false;
    }

    setHashing(true);
    setFileInfo({ name: file.name, size: file.size });
    setMd5Hash('');
    setCrc32Hash('');
    setProgress(0);
    setWarningMsg('');

    const extMatch = file.name.match(/\.(qcow2|zvhd2?)$/i);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      setWarningMsg(`提示: 结构化压缩镜像无法直接计算设备级 MD5。您必须先将其转换为 RAW 格式后再计算目标文件。例如: qemu-img convert -f ${ext} -O raw ${file.name} target.raw`);
    }

    interface FileWithLegacySlice extends File {
      mozSlice?: (start?: number, end?: number, contentType?: string) => Blob;
      webkitSlice?: (start?: number, end?: number, contentType?: string) => Blob;
    }
    const blobSlice = File.prototype.slice || (File.prototype as FileWithLegacySlice).mozSlice || (File.prototype as FileWithLegacySlice).webkitSlice;
    const chunkSize = 2097152; // Read in chunks of 2MB
    const chunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;
    const spark = new SparkMD5.ArrayBuffer();
    let currentCrc = 0;
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      if (!e.target?.result) return;
      
      const buffer = e.target.result as ArrayBuffer;
      spark.append(buffer);
      currentCrc = CRC32.buf(new Uint8Array(buffer), currentCrc);
      
      currentChunk++;
      setProgress(Math.round((currentChunk / chunks) * 100));

      if (currentChunk < chunks) {
        loadNext();
      } else {
        // --- 对齐块设备大小补零填充逻辑 ---
        if (padToSize && targetBlockSize && targetBlockSize > file.size) {
          const remaining = targetBlockSize - file.size;
          const zeroChunk = new Uint8Array(1024 * 1024); // 每次填 1MB
          let left = remaining;
          while (left > 0) {
            const toAppend = left > zeroChunk.length ? zeroChunk.length : left;
            spark.append(zeroChunk.buffer.slice(0, toAppend));
            currentCrc = CRC32.buf(zeroChunk.subarray(0, toAppend), currentCrc);
            left -= toAppend;
          }
        }

        const finalMd5 = spark.end();
        const finalCrc = (currentCrc >>> 0).toString(16).padStart(8, '0').toUpperCase();
        
        setMd5Hash(finalMd5);
        setCrc32Hash(`0x${finalCrc}`);
        setHashing(false);
        message.success('校验计算完成');
      }
    };

    fileReader.onerror = () => {
      message.error('文件读取失败');
      setHashing(false);
    };

    const loadNext = () => {
      const start = currentChunk * chunkSize;
      const end = start + chunkSize >= file.size ? file.size : start + chunkSize;
      fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
    };

    loadNext();
    return false; // Prevent default upload behavior
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Space align="center" style={{ marginBottom: 24 }}>
        <SafetyCertificateOutlined style={{ fontSize: 24, color: '#3b82f6' }} />
        <Title level={4} style={{ margin: 0 }}>文件一致性校验工具 (MD5 / CRC32)</Title>
      </Space>

      <Card>
        <div style={{ marginBottom: 20 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>高级对齐选项</Text>
          <Space direction="vertical" style={{ width: '100%', background: 'var(--ant-color-bg-layout)', padding: 12, borderRadius: 6, border: '1px solid var(--ant-color-border)' }}>
            <Space>
              <Checkbox checked={padToSize} onChange={e => setPadToSize(e.target.checked)}>
                模拟写入块设备 (裸文件对齐补全零字节)
              </Checkbox>
              <Tooltip title="针对 .raw / .img / .iso 等镜像文件。当目标写入分区比镜像本身大时，补充 \x00 零字节以使得算出的 Hash 与在 Linux 挂载点下读取完全一致。">
                <InfoCircleOutlined style={{ color: '#3b82f6', cursor: 'help' }} />
              </Tooltip>
            </Space>
            {padToSize && (
              <Space style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>目标精确大小 (Bytes):</Text>
                <InputNumber<number>
                  style={{ width: 220 }}
                  min={1}
                  value={targetBlockSize}
                  onChange={setTargetBlockSize}
                  placeholder="例如: 1073741824"
                />
              </Space>
            )}
          </Space>
        </div>

        <Dragger
          name="file"
          multiple={false}
          showUploadList={false}
          beforeUpload={calculateMD5}
          disabled={hashing}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ color: '#3b82f6' }} />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域进行 MD5 计算</p>
          <p className="ant-upload-hint">支持任意大小的文件。计算过程完全在本地浏览器中完成，不会上传到服务器，保障数据隐私安全。</p>
        </Dragger>

        {warningMsg && (
          <Alert
            type="warning"
            showIcon
            message="结构化镜像文件分析警告"
            description={
              <div>
                <Text>{warningMsg.split('。')[0] + '。' + warningMsg.split('。')[1] + '。'}</Text>
                <div style={{ marginTop: 8 }}>
                  <Text copyable style={{ fontFamily: 'monospace', background: 'var(--ant-color-bg-base)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--ant-color-border)' }}>
                    {warningMsg.match(/qemu-img.+raw/)?.[0] || 'qemu-img convert'}
                  </Text>
                </div>
              </div>
            }
            style={{ marginTop: 16 }}
          />
        )}

        {(hashing || md5Hash) && (
          <div style={{ marginTop: 24, padding: 16, background: 'var(--ant-color-bg-layout)', borderRadius: 8 }}>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">文件名: </Text>
              <Text strong>{fileInfo?.name}</Text>
              <Text type="secondary" style={{ marginLeft: 16 }}>大小: </Text>
              <Text>{fileInfo ? formatSize(fileInfo.size) : ''}</Text>
            </div>
            
            {hashing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Spin />
                <Text>正在计算 MD5... {progress}%</Text>
              </div>
            ) : (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>MD5 校验值:</Text>
                <Paragraph 
                  copyable={{ text: md5Hash, tooltips: ['复制', '已复制'] }} 
                  style={{ 
                    fontFamily: 'monospace', 
                    fontSize: 16, 
                    fontWeight: 'bold', 
                    color: '#22c55e',
                    margin: 0,
                    marginBottom: 16,
                    padding: '8px 12px',
                    background: 'var(--ant-color-bg-base)',
                    borderRadius: 4,
                    border: '1px solid var(--ant-color-border)'
                  }}
                >
                  {md5Hash}
                </Paragraph>

                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>CRC32 校验值 (IEEE):</Text>
                <Paragraph 
                  copyable={{ text: crc32Hash, tooltips: ['复制', '已复制'] }} 
                  style={{ 
                    fontFamily: 'monospace', 
                    fontSize: 16, 
                    fontWeight: 'bold', 
                    color: '#8b5cf6',
                    margin: 0,
                    padding: '8px 12px',
                    background: 'var(--ant-color-bg-base)',
                    borderRadius: 4,
                    border: '1px solid var(--ant-color-border)'
                  }}
                >
                  {crc32Hash}
                </Paragraph>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default FileHasher;
