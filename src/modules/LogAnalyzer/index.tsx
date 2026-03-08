import React, { useState } from 'react';
import {
  Typography,
  Button,
  Space,
  Card,
  message,
  Segmented,
  Divider,
  Upload,
  Tooltip,
  Input,
  Switch,
  Tag,
} from 'antd';
import {
  PlayCircleOutlined,
  ClearOutlined,
  UploadOutlined,
  DownloadOutlined,
  MergeCellsOutlined,
  FunctionOutlined,
} from '@ant-design/icons';
import { useLogStore } from './store/logStore';
import RuleManager from './components/RuleManager';
import RegexRuleModal from './components/RegexRuleModal';
import CFormatRuleModal from './components/CFormatRuleModal';
import ResultTable from './components/ResultTable';
import GrepGroupTable from './components/GrepGroupTable';
import CFunctionAnalyzer from './components/CFunctionAnalyzer';
import type { ParseRule } from '../../types';
import { useGlobalStore } from '../../store/globalStore';
import { downloadJSON, cFormatToRegex } from '../../utils';

const { Title, Text } = Typography;
const { TextArea } = Input;

type NewRuleMode = 'REGEX' | 'C_FORMAT';

const SAMPLE_LOGS = {
  java: `2024-01-15 10:23:45 INFO [main-thread] Application started successfully
2024-01-15 10:23:46 DEBUG [db-pool-1] Database connection established
2024-01-15 10:24:01 WARN [scheduler] Job execution delayed by 15ms
2024-01-15 10:24:05 ERROR [api-handler] Failed to process request: timeout
2024-01-15 10:24:10 INFO [main-thread] Processing 1024 records`,
  nginx: `192.168.1.1 - - [15/Jan/2024:10:23:45 +0800] "GET /api/users HTTP/1.1" 200 1234
10.0.0.5 - - [15/Jan/2024:10:23:46 +0800] "POST /api/login HTTP/1.1" 401 89
172.16.0.3 - - [15/Jan/2024:10:24:01 +0800] "GET /static/app.js HTTP/1.1" 304 0
192.168.1.100 - - [15/Jan/2024:10:24:05 +0800] "DELETE /api/session HTTP/1.1" 200 56`,
};

const LogAnalyzer: React.FC = () => {
  const { theme } = useGlobalStore();
  const isDark = theme === 'dark';

  const {
    rules,
    activeRuleId,
    logText,
    parseResults,
    grepGroups,
    grepCMode,
    isParsing,
    setLogText,
    setActiveRule,
    setGrepCMode,
    addRegexRule,
    addCFormatRule,
    updateRule,
    deleteRule,
    runParse,
    clearResults,
  } = useLogStore();

  const [activeTab, setActiveTab] = useState<'log' | 'cfunc'>('log');
  const [regexModalOpen, setRegexModalOpen] = useState(false);
  const [cFormatModalOpen, setCFormatModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ParseRule | null>(null);
  const [newRuleMode, setNewRuleMode] = useState<NewRuleMode>('REGEX');
  const [messageApi, contextHolder] = message.useMessage();

  const activeRule = rules.find((r) => r.id === activeRuleId) ?? null;

  const handleAddRule = () => {
    setEditingRule(null);
    if (newRuleMode === 'REGEX') {
      setRegexModalOpen(true);
    } else {
      setCFormatModalOpen(true);
    }
  };

  const handleEditRule = (rule: ParseRule) => {
    setEditingRule(rule);
    if (rule.mode === 'REGEX') {
      setRegexModalOpen(true);
    } else {
      setCFormatModalOpen(true);
    }
  };

  const handleRegexOk = (data: Partial<ParseRule>) => {
    if (editingRule) {
      updateRule(editingRule.id, data);
      messageApi.success('规则已更新');
    } else {
      const id = addRegexRule(data as Parameters<typeof addRegexRule>[0]);
      setActiveRule(id);
      messageApi.success('正则规则已创建');
    }
    setRegexModalOpen(false);
  };

  const handleCFormatOk = (
    name: string,
    patternSource: string,
    fields: import('../../types').CFormatField[]
  ) => {
    if (editingRule) {
      const { regex } = cFormatToRegex(patternSource);
      updateRule(editingRule.id, {
        name,
        patternSource,
        patternCompiled: regex,
        fields,
      });
      messageApi.success('规则已更新');
    } else {
      const id = addCFormatRule(name, patternSource, fields);
      setActiveRule(id);
      messageApi.success('C格式规则已创建');
    }
    setCFormatModalOpen(false);
  };

  const handleRun = () => {
    if (!activeRuleId) {
      messageApi.warning('请先选择解析规则');
      return;
    }
    if (!logText.trim()) {
      messageApi.warning('请输入日志内容');
      return;
    }
    runParse();
  };

  const handleClear = () => {
    clearResults();
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setLogText(text);
    };
    reader.readAsText(file);
    return false; // 阻止默认上传行为
  };

  const handleExportRules = () => {
    downloadJSON(rules, 'log-rules.json');
  };

  const cardBg = isDark ? '#252526' : '#ffffff';
  const borderColor = isDark ? '#3e3e42' : '#e4e4e7';

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}

      {/* 标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            日志分析器
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            正则 / C格式 / C函数调用 — 三种模式解析结构化日志
          </Text>
        </div>
        <Tooltip title="导出所有解析规则">
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExportRules}>
            导出规则
          </Button>
        </Tooltip>
      </div>

      {/* 顶层 Tab 切换 */}
      <Segmented
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'log' | 'cfunc')}
        style={{ marginBottom: 16 }}
        options={[
          {
            label: <Space size={4}><PlayCircleOutlined />日志解析</Space>,
            value: 'log',
          },
          {
            label: <Space size={4}><FunctionOutlined />C函数调用分析</Space>,
            value: 'cfunc',
          },
        ]}
      />

      {/* C函数分析面板 */}
      {activeTab === 'cfunc' && <CFunctionAnalyzer />}

      {/* 以下是「日志解析」面板内容 */}
      {activeTab === 'log' && <>

      {/* 规则选择区 */}
      <Card
        size="small"
        style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <RuleManager
            rules={rules}
            activeRuleId={activeRuleId}
            onSelectRule={setActiveRule}
            onAddRule={handleAddRule}
            onEditRule={handleEditRule}
            onDeleteRule={(id) => {
              deleteRule(id);
              messageApi.success('规则已删除');
            }}
          />
          <Space wrap>
            <Space size={6}>
              <Text type="secondary" style={{ fontSize: 12 }}>新建规则：</Text>
              <Segmented
                size="small"
                value={newRuleMode}
                onChange={(val) => setNewRuleMode(val as NewRuleMode)}
                options={[
                  { label: '正则模式', value: 'REGEX' },
                  { label: 'C格式模式', value: 'C_FORMAT' },
                ]}
              />
            </Space>
            <Tooltip title="开启后，将把 grep -C N 的输出按 '--' 分隔符聚合为上下文分组，每组可展开查看前后文">
              <Space size={6}>
                <MergeCellsOutlined style={{ color: grepCMode ? '#3b82f6' : '#a1a1aa' }} />
                <Text style={{ fontSize: 12 }}>grep -C 聚合模式</Text>
                <Switch
                  size="small"
                  checked={grepCMode}
                  onChange={setGrepCMode}
                />
                {grepCMode && (
                  <Tag color="blue" style={{ fontSize: 11 }}>已开启</Tag>
                )}
              </Space>
            </Tooltip>
          </Space>
        </div>
      </Card>

      {/* 主体：上下布局 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 日志输入区 */}
        <Card
          size="small"
          title={
            <Space>
              <Text strong>日志输入</Text>
              {logText && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {logText.split('\n').filter((l) => l.trim()).length} 行
                </Text>
              )}
            </Space>
          }
          extra={
            <Space>
              {/* 示例日志 */}
              <Button
                size="small"
                onClick={() => setLogText(SAMPLE_LOGS.java)}
              >
                Java 示例
              </Button>
              <Button
                size="small"
                onClick={() => setLogText(SAMPLE_LOGS.nginx)}
              >
                Nginx 示例
              </Button>
              <Upload
                accept=".log,.txt"
                showUploadList={false}
                beforeUpload={handleFileUpload}
              >
                <Button size="small" icon={<UploadOutlined />}>
                  上传文件
                </Button>
              </Upload>
            </Space>
          }
          style={{
            background: cardBg,
            border: `1px solid ${borderColor}`,
          }}
        >
          <TextArea
            value={logText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setLogText(e.target.value)}
            rows={10}
            placeholder={
              grepCMode
                ? '粘贴 grep -C N 的输出（各分组之间以 "--" 分隔）...'
                : '粘贴日志内容，或点击右上角上传日志文件...'
            }
            style={{
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              fontSize: 12,
              background: isDark ? '#1e1e1e' : '#f8f8f8',
              border: 'none',
              resize: 'vertical',
            }}
          />
          <Divider style={{ margin: '12px 0 8px' }} />
          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleRun}
              loading={isParsing}
              disabled={!activeRuleId || !logText.trim()}
            >
              开始解析
            </Button>
            <Button
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={!logText && parseResults.length === 0 && grepGroups.length === 0}
            >
              清空
            </Button>
          </Space>
        </Card>

        {/* 结果展示区 */}
        {grepCMode
          ? (grepGroups.length > 0 || isParsing) && (
              <GrepGroupTable
                groups={grepGroups}
                rule={activeRule}
                loading={isParsing}
              />
            )
          : (parseResults.length > 0 || isParsing) && (
              <ResultTable
                results={parseResults}
                rule={activeRule}
                loading={isParsing}
              />
            )}
      </div>

      {/* 正则规则弹窗 */}
      <RegexRuleModal
        open={regexModalOpen}
        initial={
          editingRule?.mode === 'REGEX' ? editingRule : null
        }
        onOk={handleRegexOk}
        onCancel={() => setRegexModalOpen(false)}
      />

      {/* C格式规则弹窗 */}
      <CFormatRuleModal
        open={cFormatModalOpen}
        initial={
          editingRule?.mode === 'C_FORMAT' ? editingRule : null
        }
        onOk={handleCFormatOk}
        onCancel={() => setCFormatModalOpen(false)}
      />
      </>}
    </div>
  );
};

export default LogAnalyzer;
