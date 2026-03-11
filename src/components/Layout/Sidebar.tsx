import {
    AlignLeftOutlined,
    ApartmentOutlined,
    AreaChartOutlined,
    BarChartOutlined,
    BlockOutlined,
    BugOutlined,
    BulbOutlined,
    CodeOutlined,
    ConsoleSqlOutlined,
    ControlOutlined,
    FileSearchOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    NumberOutlined,
    SafetyCertificateOutlined,
    SettingOutlined,
    ThunderboltOutlined,
    ToolOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Tooltip, Typography } from 'antd';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobalStore } from '../../store/globalStore';

const { Sider } = Layout;
const { Text } = Typography;

const ICON_MAP: Record<string, React.ReactNode> = {
  FileSearch:         <FileSearchOutlined />,
  CodeOutlined:       <CodeOutlined />,
  ApartmentOutlined:  <ApartmentOutlined />,
  ConsoleSqlOutlined: <ConsoleSqlOutlined />,
  NumberOutlined:     <NumberOutlined />,
  SafetyCertificateOutlined: <SafetyCertificateOutlined />,
  AlignLeftOutlined:  <AlignLeftOutlined />,
  AreaChartOutlined:  <AreaChartOutlined />,
  BlockOutlined:      <BlockOutlined />,
  BugOutlined:        <BugOutlined />,
  ControlOutlined:    <ControlOutlined />,
  ThunderboltOutlined:<ThunderboltOutlined />,
  BarChartOutlined:   <BarChartOutlined />,
  ToolOutlined:       <ToolOutlined />,
};

const tools = [
  {
    id:   'log-analyzer',
    name: '日志分析器',
    icon: 'FileSearch',
    path: '/log-analyzer',
  },
  {
    id:   'command-builder',
    name: '命令生成器',
    icon: 'CodeOutlined',
    path: '/command-builder',
  },
  {
    id:   'sop-builder',
    name: 'SOP 排查',
    icon: 'ApartmentOutlined',
    path: '/sop-builder',
  },
  {
    id:   'ssh-manager',
    name: 'SSH Manager',
    icon: 'ConsoleSqlOutlined',
    path: '/ssh-manager',
  },
  {
    id:   'number-converter',
    name: '进制转换',
    icon: 'NumberOutlined',
    path: '/number-converter',
  },
  {
    id:   'file-hasher',
    name: '文件校验 (MD5/CRC)',
    icon: 'SafetyCertificateOutlined',
    path: '/file-hasher',
  },
  {
    id:   'fio-visualizer',
    name: 'FIO 解析器',
    icon: 'AreaChartOutlined',
    path: '/fio-visualizer',
  },
  {
    id:   'hex-lba-explorer',
    name: '十六进制沙盒',
    icon: 'BlockOutlined',
    path: '/hex-lba-explorer',
  },
  {
    id:   'crash-analyzer',
    name: 'GDB 重栈分析器',
    icon: 'BugOutlined',
    path: '/crash-analyzer',
  },
  {
    id:   'protocol-decoder',
    name: '协议裸码解码器',
    icon: 'ControlOutlined',
    path: '/protocol-decoder',
  },
  {
    id:   'timeline-correlator',
    name: '日志时序对齐器',
    icon: 'AlignLeftOutlined',
    path: '/timeline-correlator',
  },
  {
    id:   'fault-builder',
    name: '故障注入生成器',
    icon: 'ThunderboltOutlined',
    path: '/fault-builder',
  },
  {
    id:   'io-analyzer',
    name: 'IO 性能分析',
    icon: 'BarChartOutlined',
    path: '/io-analyzer',
  },
  {
    id:   'code-profiler',
    name: '代码路径优化',
    icon: 'ToolOutlined',
    path: '/code-profiler',
  },
];

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, sidebarCollapsed, toggleSidebar, toggleTheme } =
    useGlobalStore();

  const selectedKey =
    tools.find((t) => location.pathname.startsWith(t.path))?.id ?? '';

  const menuItems = tools.map((tool) => ({
    key: tool.id,
    icon: (
      <Tooltip
        title={sidebarCollapsed ? tool.name : undefined}
        placement="right"
      >
        {ICON_MAP[tool.icon] ?? <CodeOutlined />}
      </Tooltip>
    ),
    label: tool.name,
    onClick: () => navigate(tool.path),
  }));

  const isDark = theme === 'dark';

  return (
    <Sider
      collapsible
      collapsed={sidebarCollapsed}
      trigger={null}
      width={220}
      collapsedWidth={64}
      theme={isDark ? 'dark' : 'light'}
      style={{
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        borderRight: isDark ? '1px solid #3e3e42' : '1px solid #e8e8e8',
      }}
    >
      {/* Logo 区域 */}
      <div
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          padding: sidebarCollapsed ? '0' : '0 20px',
          gap: 10,
          borderBottom: isDark ? '1px solid #3e3e42' : '1px solid #e8e8e8',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => navigate('/')}
      >
        <CodeOutlined
          style={{ fontSize: 22, color: '#3b82f6', flexShrink: 0 }}
        />
        {!sidebarCollapsed && (
          <Text
            strong
            style={{
              fontSize: 15,
              color: isDark ? '#e4e4e7' : '#18181b',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            DevUtility Hub
          </Text>
        )}
      </div>

      {/* 工具菜单 */}
      <Menu
        theme={isDark ? 'dark' : 'light'}
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        style={{ flex: 1, borderRight: 'none', paddingTop: 8 }}
      />

      {/* 底部操作区 */}
      <div
        style={{
          borderTop: isDark ? '1px solid #3e3e42' : '1px solid #e8e8e8',
          padding: '8px 0',
        }}
      >
        <Tooltip
          title={isDark ? '切换亮色主题' : '切换暗色主题'}
          placement="right"
        >
          <div
            onClick={toggleTheme}
            style={{
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              padding: sidebarCollapsed ? '0' : '0 24px',
              gap: 10,
              cursor: 'pointer',
              color: isDark ? '#a1a1aa' : '#71717a',
              transition: 'color 0.2s',
            }}
            className="sidebar-action-item"
          >
            <BulbOutlined style={{ fontSize: 16 }} />
            {!sidebarCollapsed && (
              <Text style={{ color: 'inherit', fontSize: 13 }}>
                {isDark ? '切换亮色' : '切换暗色'}
              </Text>
            )}
          </div>
        </Tooltip>

        <Tooltip title="设置" placement="right">
          <div
            style={{
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              padding: sidebarCollapsed ? '0' : '0 24px',
              gap: 10,
              cursor: 'pointer',
              color: isDark ? '#a1a1aa' : '#71717a',
            }}
          >
            <SettingOutlined style={{ fontSize: 16 }} />
            {!sidebarCollapsed && (
              <Text style={{ color: 'inherit', fontSize: 13 }}>
                设置
              </Text>
            )}
          </div>
        </Tooltip>

        {/* 折叠/展开按钮 */}
        <div
          onClick={toggleSidebar}
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            padding: sidebarCollapsed ? '0' : '0 24px',
            gap: 10,
            cursor: 'pointer',
            color: isDark ? '#a1a1aa' : '#71717a',
          }}
        >
          {sidebarCollapsed ? (
            <MenuUnfoldOutlined style={{ fontSize: 16 }} />
          ) : (
            <>
              <MenuFoldOutlined style={{ fontSize: 16 }} />
              <Text style={{ color: 'inherit', fontSize: 13 }}>收起侧边栏</Text>
            </>
          )}
        </div>
      </div>
    </Sider>
  );
};

export default Sidebar;
