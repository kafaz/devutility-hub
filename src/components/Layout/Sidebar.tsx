import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Tooltip, Typography } from 'antd';
import {
  FileSearchOutlined,
  CodeOutlined,
  ApartmentOutlined,
  SettingOutlined,
  BulbOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useGlobalStore } from '../../store/globalStore';

const { Sider } = Layout;
const { Text } = Typography;

const ICON_MAP: Record<string, React.ReactNode> = {
  FileSearch: <FileSearchOutlined />,
  CodeOutlined: <CodeOutlined />,
  ApartmentOutlined: <ApartmentOutlined />,
};

const tools = [
  {
    id: 'log-analyzer',
    name: '日志分析器',
    icon: 'FileSearch',
    path: '/log-analyzer',
  },
  {
    id: 'command-builder',
    name: '命令生成器',
    icon: 'CodeOutlined',
    path: '/command-builder',
  },
  {
    id: 'sop-builder',
    name: 'SOP 排查',
    icon: 'ApartmentOutlined',
    path: '/sop-builder',
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
