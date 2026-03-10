import { BugOutlined, CompressOutlined } from '@ant-design/icons';
import { App, Badge, Card, Col, Collapse, Input, Layout, Row, Space, Tag, Typography } from 'antd';
import React, { useMemo, useState } from 'react';
import { useGlobalStore } from '../../store/globalStore';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Content } = Layout;
const { Panel } = Collapse;

interface GdbThread {
  id: string;
  headerLine: string;
  frames: string[];
  signature: string; // The normalized stack trace used for grouping
}

interface ThreadGroup {
  signature: string;
  threads: GdbThread[];
  sampleThread: GdbThread;
  isDeadlockSuspect: boolean;
}

const parseGdbLog = (log: string): ThreadGroup[] => {
  const lines = log.split('\n');
  const threads: GdbThread[] = [];
  let curT: GdbThread | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('Thread ')) {
      if (curT) threads.push(curT);
      const idMatch = line.match(/^Thread (\d+)/);
      curT = { 
          id: idMatch ? idMatch[1] : '?', 
          headerLine: line, 
          frames: [], 
          signature: '' 
      };
    } else if (line.startsWith('#') && curT) {
      curT.frames.push(line);
    }
  }
  if (curT) threads.push(curT);

  // Grouping logic
  const groups = new Map<string, ThreadGroup>();
  
  for (const t of threads) {
      // Normalize memory addresses to 0x... so identical paths match
      const sig = t.frames.map(f => {
          return f
              .replace(/0x[0-9a-fA-F]+/g, '0x...')
              .replace(/#\d+\s+/, '') // remove frame number like "#0  "
              .replace(/\+0x[0-9a-fA-F]+/g, '') // remove offsets
      }).join('\n');
      
      t.signature = sig;

      if (!groups.has(sig)) {
          groups.set(sig, {
              signature: sig,
              threads: [],
              sampleThread: t,
              isDeadlockSuspect: sig.includes('__lll_lock_wait') || sig.includes('pthread_cond_wait')
          });
      }
      groups.get(sig)!.threads.push(t);
  }
  
  return Array.from(groups.values()).sort((a, b) => b.threads.length - a.threads.length);
};

const CrashAnalyzer: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const groups = useMemo(() => parseGdbLog(inputText), [inputText]);

  return (
    <App>
      <Content style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <BugOutlined style={{ fontSize: 24, color: '#ef4444' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>GDB 堆栈自动合并器 (Crash Analyzer)</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>将 C++ `thread apply all bt` 日志贴入，瞬间折叠成百上千的相同线程栈，揪出死锁与崩溃现场。</Text>
          </div>
        </div>

        <Row gutter={[16, 16]} style={{ flex: 1, minHeight: 0 }}>
          <Col span={10} style={{ display: 'flex', flexDirection: 'column' }}>
            <Card 
              size="small" 
              title="原始 GDB Core Dump (Backtraces)" 
              style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#252526' : '#fff' }}
              bodyStyle={{ flex: 1, padding: 0 }}
            >
              <TextArea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="粘贴 GDB 输出，例如：\n\nThread 2 (Thread 0x7ffff...):\n#0  0x00007ffff... in epoll_wait ()\n#1  0x000055555... in io_thread_loop()\n..."
                style={{ 
                  height: '100%', 
                  resize: 'none', 
                  border: 'none', 
                  borderRadius: '0 0 8px 8px',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  background: isDark ? '#1e1e1e' : '#fafafa',
                  color: isDark ? '#d4d4d8' : '#333'
                }}
              />
            </Card>
          </Col>

          <Col span={14} style={{ display: 'flex', flexDirection: 'column' }}>
             <Card 
                size="small" 
                title={
                    <Space>
                        <CompressOutlined />
                        <span>堆栈折叠结果 (Collapsed Stacks)</span>
                        <Badge count={groups.length} style={{ backgroundColor: '#3b82f6' }} />
                    </Space>
                }
                style={{ flex: 1, display: 'flex', flexDirection: 'column', background: isDark ? '#252526' : '#fff' }}
                bodyStyle={{ flex: 1, overflowY: 'auto', padding: 12 }}
             >
                {groups.length === 0 ? (
                    <div style={{ textAlign: 'center', marginTop: 40, color: '#9ca3af' }}>没有解析到有效的 Thread 输出</div>
                ) : (
                    <Collapse bordered={false} style={{ background: 'transparent' }} defaultActiveKey={['0']}>
                       {groups.map((g, idx) => {
                           // Extract the top function for title
                           const topFrame = g.sampleThread.frames[0] || 'Unknown Frame';
                           const isDeadlock = g.isDeadlockSuspect;
                           
                           const header = (
                               <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                   <Tag color={isDeadlock ? 'red' : 'blue'} style={{ margin: 0 }}>
                                      {g.threads.length} 个线程
                                   </Tag>
                                   <Text strong style={{ fontFamily: 'monospace', fontSize: 13, color: isDeadlock ? '#ef4444' : undefined }}>
                                       卡在: {topFrame.replace(/#\d+\s+0x[0-9a-fA-F]+\s+in\s+/, '').slice(0, 60)}...
                                   </Text>
                               </div>
                           );

                           return (
                               <Panel header={header} key={idx.toString()} style={{ borderBottom: `1px solid ${isDark ? '#3e3e42' : '#e4e4e7'}` }}>
                                   <div style={{ marginBottom: 12 }}>
                                       <Text type="secondary" style={{ fontSize: 12 }}>线程列表: </Text>
                                       <Text style={{ fontFamily: 'monospace', fontSize: 12, color: '#8b5cf6' }}>
                                           {g.threads.map(t => t.id).join(', ')}
                                       </Text>
                                   </div>
                                   <div style={{ 
                                       background: isDark ? '#1e1e1e' : '#f4f4f5', 
                                       padding: 12, 
                                       borderRadius: 4, 
                                       fontFamily: 'monospace', 
                                       fontSize: 12, 
                                       color: isDark ? '#d4d4d8' : '#333',
                                       maxHeight: 300,
                                       overflowY: 'auto',
                                       whiteSpace: 'pre-wrap'
                                   }}>
                                       {g.sampleThread.frames.join('\n')}
                                   </div>
                               </Panel>
                           );
                       })}
                    </Collapse>
                )}
             </Card>
          </Col>
        </Row>
      </Content>
    </App>
  );
};

export default CrashAnalyzer;
