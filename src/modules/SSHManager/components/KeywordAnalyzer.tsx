import {
    BugOutlined,
    DatabaseOutlined,
    DeleteOutlined,
    InfoCircleOutlined,
    SettingOutlined
} from '@ant-design/icons';
import { Alert, Button, Divider, Drawer, Empty, Input, List, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import { useGlobalStore } from '../../../store/globalStore';
import { useAnalyzerStore } from '../store/analyzerStore';
import {
  BUILTIN_NOISE_MODE_META,
  getBuiltinNoiseRules,
} from '../../../utils/logNoise';

const { Text } = Typography;

const KeywordAnalyzer: React.FC = () => {
  const isDark = useGlobalStore((s) => s.theme === 'dark');
  const {
    logs,
    keywords,
    addKeyword,
    removeKeyword,
    clearLogs,
    highlightRules,
    addHighlightRule,
    removeHighlightRule,
    noiseKeywords,
    addNoiseKeyword,
    removeNoiseKeyword,
    builtinNoiseMode,
    setBuiltinNoiseMode,
    suppressedCount,
    suppressionStats,
    clearSuppressedCount,
  } = useAnalyzerStore();
  
  const [filterSession, setFilterSession] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newRuleKeyword, setNewRuleKeyword] = useState('');
  const [newRuleColor, setNewRuleColor] = useState('#ef4444');
  const [newNoiseKeyword, setNewNoiseKeyword] = useState('');

  const sessions = Array.from(new Set(logs.map((l) => l.sessionName)));
  const activeBuiltinRules = getBuiltinNoiseRules(builtinNoiseMode);

  const filteredLogs = logs.filter((l) => {
    if (filterSession && l.sessionName !== filterSession) return false;
    if (filterType && l.type !== filterType) return false;
    return true;
  });

  const handleAddKeyword = () => {
    if (newKeyword.trim()) {
      addKeyword(newKeyword.trim());
      setNewKeyword('');
    }
  };

  const handleAddHighlightRule = () => {
    if (newRuleKeyword.trim()) {
      addHighlightRule({ keyword: newRuleKeyword.trim(), color: newRuleColor });
      setNewRuleKeyword('');
    }
  };

  const handleAddNoiseKeyword = () => {
    if (newNoiseKeyword.trim()) {
      addNoiseKeyword(newNoiseKeyword.trim());
      setNewNoiseKeyword('');
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'error': return <BugOutlined />;
      case 'data': return <DatabaseOutlined />;
      default: return <InfoCircleOutlined />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'error': return 'error';
      case 'data': return 'success';
      default: return 'processing';
    }
  };

  const cardBg = isDark ? '#1e1e1e' : '#fafafa';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部控制栏 */}
      <div style={{ 
        padding: '12px 16px', borderBottom: `1px solid ${borderColor}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: cardBg
      }}>
        <Space>
          <Text strong style={{ fontSize: 13 }}>智能监控面板</Text>
          <Tag color="blue">{logs.length} 条记录</Tag>
          <Tag color="gold">{suppressedCount} 条已忽略</Tag>
          <Tag color={builtinNoiseMode === 'off' ? 'default' : 'cyan'}>
            {BUILTIN_NOISE_MODE_META[builtinNoiseMode].label}
          </Tag>
          
          <Select
            size="small"
            allowClear
            placeholder="过滤会话"
            style={{ width: 150 }}
            value={filterSession}
            onChange={setFilterSession}
            options={sessions.map(s => ({ label: s, value: s }))}
          />
          
          <Select
            size="small"
            allowClear
            placeholder="过滤类型"
            style={{ width: 100 }}
            value={filterType}
            onChange={setFilterType}
            options={[
              { label: 'Error', value: 'error' },
              { label: 'Data', value: 'data' },
              { label: 'Keyword', value: 'keyword' },
            ]}
          />
        </Space>

        <Space>
          <Button size="small" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            关键词与降噪
          </Button>
          <Popconfirm title="确定清空所有抓取的日志吗？" onConfirm={() => { clearLogs(); clearSuppressedCount(); }}>
            <Button size="small" danger icon={<DeleteOutlined />}>清空记录</Button>
          </Popconfirm>
        </Space>
      </div>

      {/* 列表区域 */}
      <div style={{ flex: 1, overflowY: 'auto', background: cardBg, padding: 12 }}>
        {filteredLogs.length === 0 ? (
          <Empty description="暂无符合条件的日志" style={{ marginTop: 40 }} />
        ) : (
          <List
            size="small"
            dataSource={filteredLogs}
            renderItem={log => (
              <List.Item style={{ 
                border: `1px solid ${borderColor}`, 
                borderRadius: 6, 
                marginBottom: 8,
                background: isDark ? '#252526' : '#ffffff',
                alignItems: 'start'
              }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Space size={4}>
                      <Tag color={getTypeColor(log.type)} icon={getTypeIcon(log.type)} style={{ fontSize: 10, marginRight: 0 }}>
                        {log.type.toUpperCase()}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11, background: isDark ? '#333' : '#f0f0f0', padding: '0 4px', borderRadius: 4 }}>
                        {log.sessionName}
                      </Text>
                      {log.matchedKeywords.map(k => (
                        <Text key={k} mark style={{ fontSize: 10, padding: '0 4px', borderRadius: 4 }}>
                          {k}
                        </Text>
                      ))}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(log.timestamp).format('HH:mm:ss')}
                    </Text>
                  </div>
                  <div style={{ 
                    fontFamily: 'JetBrains Mono, Consolas, monospace', 
                    fontSize: 12, 
                    wordBreak: 'break-all',
                    color: log.type === 'error' ? '#ef4444' : log.type === 'data' ? '#22c55e' : (isDark ? '#d4d4d8' : '#3f3f46')
                  }}>
                    {log.text}
                  </div>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>

      {/* 侧边配置抽屉 */}
      <Drawer
        title="配置智能监控关键词"
        placement="right"
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        width={320}
        styles={{ body: { background: cardBg } }}
      >
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input 
            placeholder="输入新关键词" 
            value={newKeyword} 
            onChange={e => setNewKeyword(e.target.value)}
            onPressEnter={handleAddKeyword}
          />
          <Button type="primary" onClick={handleAddKeyword}>添加</Button>
        </Space.Compact>

        <List
          size="small"
          header={<Text strong>当前拦截关键词 (忽略大小写)</Text>}
          bordered
          dataSource={keywords}
          renderItem={item => (
            <List.Item actions={[
              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeKeyword(item)} />
            ]}>
              <Text code>{item}</Text>
            </List.Item>
          )}
        />

        <Divider style={{ margin: '16px 0' }} />

        <Text strong style={{ display: 'block', marginBottom: 8 }}>日志降噪规则</Text>
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            placeholder="自定义忽略词，例如 heartbeat"
            value={newNoiseKeyword}
            onChange={e => setNewNoiseKeyword(e.target.value)}
            onPressEnter={handleAddNoiseKeyword}
          />
          <Button type="primary" onClick={handleAddNoiseKeyword}>添加</Button>
        </Space.Compact>

        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {BUILTIN_NOISE_MODE_META[builtinNoiseMode].description}
        </Text>

        <Text strong style={{ display: 'block', marginBottom: 8 }}>内建降噪模式</Text>
        <Select
          size="small"
          value={builtinNoiseMode}
          onChange={(value) => setBuiltinNoiseMode(value as typeof builtinNoiseMode)}
          style={{ width: '100%', marginBottom: 12 }}
          options={[
            { label: BUILTIN_NOISE_MODE_META.focus.label, value: 'focus' },
            { label: BUILTIN_NOISE_MODE_META.info.label, value: 'info' },
            { label: BUILTIN_NOISE_MODE_META.off.label, value: 'off' },
          ]}
        />

        <List
          size="small"
          bordered
          header={<Text strong>当前生效的内建规则</Text>}
          locale={{ emptyText: '当前模式未启用内建规则' }}
          dataSource={activeBuiltinRules}
          renderItem={(item) => (
            <List.Item>
              <Space>
                <Tag color="default">默认</Tag>
                <Text>{item.label}</Text>
                <Tag color={item.level === 'info' ? 'blue' : item.level === 'debug' ? 'gold' : 'purple'}>
                  {item.level.toUpperCase()}
                </Tag>
              </Space>
            </List.Item>
          )}
          style={{ marginBottom: 12 }}
        />

        <List
          size="small"
          bordered
          header={<Text strong>近期忽略来源</Text>}
          locale={{ emptyText: '暂无忽略统计' }}
          dataSource={suppressionStats}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space>
                  <Tag color={item.kind === 'builtin' ? 'cyan' : 'default'}>
                    {item.kind === 'builtin' ? '默认' : '自定义'}
                  </Tag>
                  <Text>{item.label}</Text>
                  <Tag color="gold">{item.count}</Tag>
                </Space>
                {item.sampleText && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    例如：{item.sampleText}
                  </Text>
                )}
              </Space>
            </List.Item>
          )}
          style={{ marginBottom: 12 }}
        />

        <List
          size="small"
          bordered
          header={<Text strong>自定义忽略词</Text>}
          locale={{ emptyText: '暂无自定义忽略词' }}
          dataSource={noiseKeywords}
          renderItem={(item) => (
            <List.Item actions={[
              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNoiseKeyword(item)} />
            ]}>
              <Text code>{item}</Text>
            </List.Item>
          )}
        />

        <Divider style={{ margin: '16px 0' }} />
        
        <Text strong style={{ display: 'block', marginBottom: 8 }}>原终端高亮规则 (实时变色)</Text>
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <input 
            type="color" 
            value={newRuleColor} 
            onChange={e => setNewRuleColor(e.target.value)} 
            style={{ width: 32, height: 32, padding: 0, border: 'none', cursor: 'pointer', outline: 'none' }}
          />
          <Input 
            placeholder="需要高亮的关键词" 
            value={newRuleKeyword} 
            onChange={e => setNewRuleKeyword(e.target.value)}
            onPressEnter={handleAddHighlightRule}
          />
          <Button type="primary" onClick={handleAddHighlightRule}>添加</Button>
        </Space.Compact>

        <List
          size="small"
          bordered
          dataSource={highlightRules}
          renderItem={item => (
            <List.Item actions={[
              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeHighlightRule(item.id)} />
            ]}>
              <Space>
               <div style={{ width: 12, height: 12, borderRadius: '50%', background: item.color }} />
               <Text code>{item.keyword}</Text>
              </Space>
            </List.Item>
          )}
        />
        
        <Alert
          message="基于实时输出流的正则/子串匹配"
          description="系统会先按当前内建模式与自定义忽略词做降噪，再把命中关键字的日志抽取到监控面板里。"
          type="info"
          showIcon
          style={{ marginTop: 24, fontSize: 12 }}
        />
      </Drawer>
    </div>
  );
};

export default KeywordAnalyzer;
