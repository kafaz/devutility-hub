import { CloudUploadOutlined, NodeIndexOutlined, SyncOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Collapse, Empty, Form, Input, message, Radio, Space, Tag, Typography, Upload } from 'antd';
import React, { useState } from 'react';
import { useSSHStore } from '../../SSHManager/store/sshStore';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

export const ArtifactDistributor: React.FC = () => {
  const [form] = Form.useForm();
  const { sessions, execCommandOnSession } = useSSHStore();
  
  const connectedSessions = sessions.filter(s => s.status === 'connected');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [uploadType, setUploadType] = useState<'url' | 'local'>('url');
  
  const [localFileB64, setLocalFileB64] = useState<string>('');
  const [localFileName, setLocalFileName] = useState<string>('');
  
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<Record<string, { status: 'running'|'success'|'error', log: string }>>({});

  const handleFileChange = (info: { file: File }) => {
    const file = info.file;
    if (!file) return;
    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) {
      message.error('本地构建投递限制在 10MB 内（更大文件建议使用网络 URL 分发）!');
      return;
    }
    
    setLocalFileName(file.name);
    form.setFieldsValue({ targetPath: `/tmp/${file.name}` });

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // result is something like "data:application/tar+gzip;base64,H4sIC..."
      const b64 = result.split(',')[1] || result;
      setLocalFileB64(b64);
      message.success(`${file.name} 已成功转码缓冲于内存。`);
    };
    reader.readAsDataURL(file);
  };

  const handleExecute = async () => {
    if (selectedNodes.length === 0) {
      message.warning('请至少选择一个目标连网节点进行分发！');
      return;
    }

    const vals = await form.validateFields();
    if (uploadType === 'local' && !localFileB64) {
      message.warning('请先拖拽上传一个本地构件文件！');
      return;
    }

    setIsExecuting(true);
    const initLogs: Record<string, { status: 'running'|'success'|'error', log: string }> = {};
    selectedNodes.forEach(id => {
      initLogs[id] = { status: 'running', log: '初始化分发流...\n' };
    });
    setExecutionLogs(initLogs);

    const updateLog = (id: string, extLog: string, status?: 'running'|'success'|'error') => {
      setExecutionLogs(prev => {
        const cur = prev[id];
        return {
          ...prev,
          [id]: {
            status: status || cur.status,
            log: cur.log + extLog
          }
        };
      });
    };

    // Parallel distribution
    const CHUNK_SIZE = 256 * 1024; // 256KB of base64 text per chunk — safe inside ARG_MAX

    const promises = selectedNodes.map(async (sessionId) => {
      try {
        if (uploadType === 'url') {
          updateLog(sessionId, `[步骤 1] 正在通过网络链路下载 ${vals.sourceUrl} -> ${vals.targetPath} ...\n`);
          const distributeCmd = `curl -sLo "${vals.targetPath}" "${vals.sourceUrl}" || wget -qO "${vals.targetPath}" "${vals.sourceUrl}"`;
          const dlRes = await execCommandOnSession(sessionId, distributeCmd, 60000);
          if (dlRes.exitCode !== 0) {
            updateLog(sessionId, `[错误] 下载失败:\n${dlRes.stderr || dlRes.stdout}\n`, 'error');
            return;
          }
          updateLog(sessionId, `✅ 文件下载成功 (${dlRes.durationMs}ms)！\n`);
        } else {
          // FIX-4: Chunked Base64 write — avoids ARG_MAX overflow
          updateLog(sessionId, `[步骤 1] 开始 Base64 分块传输 ${localFileName} -> ${vals.targetPath} (共 ${Math.ceil(localFileB64.length / CHUNK_SIZE)} 块)...\n`);
          const totalChunks = Math.ceil(localFileB64.length / CHUNK_SIZE);
          for (let i = 0; i < totalChunks; i++) {
            const chunk = localFileB64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            // First chunk overwrites file; subsequent chunks append
            const redirect = i === 0 ? '>' : '>>';
            // Use printf instead of echo to avoid newline injection
            const chunkCmd = `printf '%s' '${chunk}' ${redirect} "${vals.targetPath}.b64"`;
            const res = await execCommandOnSession(sessionId, chunkCmd, 15000);
            if (res.exitCode !== 0) {
              updateLog(sessionId, `[错误] 第 ${i + 1}/${totalChunks} 块传输失败\n`, 'error');
              return;
            }
            updateLog(sessionId, `  块 ${i + 1}/${totalChunks} 写入成功\n`);
          }
          // Decode the accumulated base64 file
          const decodeRes = await execCommandOnSession(sessionId, `base64 -d "${vals.targetPath}.b64" > "${vals.targetPath}" && rm -f "${vals.targetPath}.b64"`, 15000);
          if (decodeRes.exitCode !== 0) {
            updateLog(sessionId, `[错误] Base64 解码失败:\n${decodeRes.stderr}\n`, 'error');
            return;
          }
          updateLog(sessionId, `✅ 文件传输完成，已解码落盘！\n`);
        }

        // 2. Execute Custom Script Context
        if (vals.executionScript?.trim()) {
           updateLog(sessionId, `\n[步骤 2] 执行自定义预设挂载脚本...\n`);
           // Wrap in directory bound execution securely
           const wrapperCmd = `cd $(dirname "${vals.targetPath}") && ${vals.executionScript}`;
           
           const runRes = await execCommandOnSession(sessionId, wrapperCmd, 120000); // 120s script timeout
           const outStr = runRes.stdout + (runRes.stderr ? `\n[STDERR]\n${runRes.stderr}` : '');
           
           if (runRes.exitCode !== 0) {
              updateLog(sessionId, `[脚本错误退回]: \n${outStr}\n`, 'error');
           } else {
              updateLog(sessionId, `✅ 脚本执行完毕 (${runRes.durationMs}ms):\n${outStr}\n`, 'success');
           }
        } else {
           updateLog(sessionId, `\n✅ 未提供自定义脚本，当前流水线结束。\n`, 'success');
        }

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        updateLog(sessionId, `\n❌ 未知异常中断: ${msg}\n`, 'error');
      }
    });

    await Promise.allSettled(promises);
    setIsExecuting(false);
    message.success('多集群管道分发执行全部结束。');
  };

  return (
    <Card size="small" bordered={false}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}><CloudUploadOutlined /> 构件总线分发与跨集群任意执行</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>将构件（如监控 Agent、特殊 Benchmark 包、配置文件等）快速打入指定集群并批量执行预设 SOP。</Text>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* LEFT: Config Panel */}
        <div style={{ flex: '0 0 500px' }}>
          <Card size="small" title="分发链路配置">
            <Form form={form} layout="vertical" initialValues={{ targetPath: '/tmp/payload.sh' }}>
              <Form.Item label="活跃节点接收方 (Receiver Nodes)">
                {connectedSessions.length === 0 ? (
                  <Text type="warning">暂无有效 SSH 连接</Text>
                ) : (
                  <Checkbox.Group 
                    options={connectedSessions.map(s => ({ label: s.name, value: s.id }))} 
                    value={selectedNodes}
                    onChange={(v) => setSelectedNodes(v as string[])}
                  />
                )}
              </Form.Item>

              <Form.Item label="构件来源">
                <Radio.Group value={uploadType} onChange={e => setUploadType(e.target.value)} buttonStyle="solid">
                  <Radio.Button value="url"><NodeIndexOutlined /> 网络下载流 (Curl/Wget)</Radio.Button>
                  <Radio.Button value="local"><UploadOutlined /> SSH 隧道直接透传 (Base64)</Radio.Button>
                </Radio.Group>
              </Form.Item>

              {uploadType === 'url' ? (
                <Form.Item label="公网/内网 URL 链接" name="sourceUrl" rules={[{ required: true, message: '请提供下载地址' }]}>
                  <Input placeholder="http://10.0.x.x:8080/my-custom-agent.tar.gz" />
                </Form.Item>
              ) : (
                <Form.Item label="拖拽本地构件 ( < 10MB )">
                  <Upload.Dragger 
                    accept="*"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      handleFileChange({ file });
                      return false; // restrict browser send
                    }}
                  >
                    <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
                    <p className="ant-upload-text">{localFileName ? `已装载: ${localFileName}` : '点击或拖拽文件到这里透传'}</p>
                    {localFileB64 && <Tag color="success" style={{ marginTop: 8 }}>✅ 内存隧道缓冲就绪 ({Math.round(localFileB64.length / 1024)} KB)</Tag>}
                  </Upload.Dragger>
                </Form.Item>
              )}

              <Form.Item label="全网绝对存放路径 (Target Path)" name="targetPath" rules={[{ required: true }]}>
                <Input placeholder="/tmp/payload.tar.gz" />
              </Form.Item>

              <Form.Item label="落盘后挂载/激活脚本 (Execution Script)" name="executionScript">
                <TextArea rows={4} placeholder="# 系统已默认 cd /tmp (等同落盘处)\ntar -xzf payload.tar.gz\nchmod +x ./install.sh\n./install.sh" />
              </Form.Item>

              <Button type="primary" block icon={<SyncOutlined spin={isExecuting}/>} size="large" onClick={handleExecute} disabled={isExecuting}>
                {isExecuting ? '流转进行中...' : '启动跨集群批量分发'}
              </Button>
            </Form>
          </Card>
        </div>

        {/* RIGHT: Live Monitoring Panel */}
        <div style={{ flex: 1 }}>
           <Card size="small" title="分发节点执行结果大盘" bodyStyle={{ height: '100%', overflowY: 'auto' }}>
              {selectedNodes.length === 0 && <Empty description="暂未选定目标集群节点" style={{ marginTop: 60 }} />}
              <Collapse>
                {selectedNodes.map(id => {
                  const s = sessions.find(ss => ss.id === id);
                  const rt = executionLogs[id];
                  const statusLabel = rt ? (rt.status === 'running' ? <Tag color="blue" icon={<SyncOutlined spin/>}>下发中</Tag> : (rt.status === 'success' ? <Tag color="success">通过</Tag> : <Tag color="error">异常中止</Tag>)) : <Tag>等待指令</Tag>;
                  return (
                    <Panel header={<Space>{s?.name} {statusLabel}</Space>} key={id}>
                       <pre style={{ 
                         background: '#1e1e1e', 
                         color: '#d4d4d4', 
                         padding: 12, 
                         borderRadius: 6, 
                         fontSize: 12,
                         whiteSpace: 'pre-wrap'
                       }}>
                         {rt?.log || 'No Output Data...'}
                       </pre>
                    </Panel>
                  )
                })}
              </Collapse>
           </Card>
        </div>
      </div>
    </Card>
  );
};

export default ArtifactDistributor;
