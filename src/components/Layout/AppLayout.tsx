import React from 'react';
import { Layout, ConfigProvider, theme as antTheme } from 'antd';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useGlobalStore } from '../../store/globalStore';
import zhCN from 'antd/locale/zh_CN';

const { Content } = Layout;

const darkToken = {
  colorBgBase: '#1e1e1e',
  colorBgContainer: '#252526',
  colorBgElevated: '#2d2d30',
  colorBorder: '#3e3e42',
  colorText: '#d4d4d8',
  colorTextSecondary: '#a1a1aa',
  colorPrimary: '#3b82f6',
  colorSuccess: '#22c55e',
  colorWarning: '#eab308',
  colorError: '#ef4444',
  borderRadius: 6,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const lightToken = {
  colorBgBase: '#ffffff',
  colorBgContainer: '#fafafa',
  colorBgElevated: '#ffffff',
  colorBorder: '#e4e4e7',
  colorText: '#18181b',
  colorTextSecondary: '#71717a',
  colorPrimary: '#3b82f6',
  colorSuccess: '#22c55e',
  colorWarning: '#eab308',
  colorError: '#ef4444',
  borderRadius: 6,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const AppLayout: React.FC = () => {
  const { theme, sidebarCollapsed } = useGlobalStore();
  const isDark = theme === 'dark';
  const sidebarWidth = sidebarCollapsed ? 64 : 220;

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark
          ? antTheme.darkAlgorithm
          : antTheme.defaultAlgorithm,
        token: isDark ? darkToken : lightToken,
        components: {
          Menu: {
            itemBg: 'transparent',
          },
          Table: {
            headerBg: isDark ? '#2d2d30' : '#f4f4f5',
          },
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Sidebar />
        <Layout
          style={{
            marginLeft: sidebarWidth,
            transition: 'margin-left 0.2s',
            background: isDark ? '#1e1e1e' : '#f8f8f8',
          }}
        >
          <Content
            style={{
              minHeight: '100vh',
              overflow: 'auto',
            }}
          >
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
};

export default AppLayout;
