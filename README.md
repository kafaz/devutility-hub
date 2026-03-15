# DevUtility Hub

面向后端工程师和运维人员的模块化开发工具集合，采用微内核架构，支持便捷扩展新工具模块。

## 工具清单

| 工具 | 说明 |
|------|------|
| **日志分析器** | 正则模式 / C格式模式 / C函数调用参数解析 / grep -C 上下文聚合 |
| **命令生成器** | `${变量}` 占位符模板 + 参数历史复用 |
| **SOP 故障排查** | 子步骤变量传递 + Python脚本后处理 + 正则判断 + Markdown报告导出 |
| **SSH Manager** | 多节点命名会话 + Shell PTY 复用 + 分布式 SOP 并行执行 + 会话日志 |
| **诊断工作台** | 诊断 Run 结构化归档 + 相似故障召回 + 多 Agent 编排 + Python 业务测试控制 |
| **命令白名单策略** | 服务层统一拦截非法或高风险命令执行，支持运行期动态调整白名单 |
| **进制转换** | 二/八/十/十六进制实时互转，二进制4位分组 |

## 快速启动

### 前端

```bash
npm install
npm run dev
# 访问 http://localhost:5173
```

### SSH 代理服务（SSH Manager 功能所需）

```bash
cd server
npm install
node index.js
# 代理运行在 http://127.0.0.1:3001
```

## 认证方式

SSH Manager 支持三种认证方式（等同 Python paramiko）：

| 方式 | 说明 |
|------|------|
| 私钥 + Passphrase | `key_filename` + `passphrase`，最常用 |
| 密码 | `username` + `password` |
| SSH Agent | 复用本机 Agent，无需重复输入凭证 |

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React + Vite | 19 / 7 | 前端框架 |
| TypeScript | 5 | 静态类型 |
| Ant Design | 5 | UI 组件库 |
| Zustand | 5 | 状态管理（含 persist 持久化） |
| xterm.js | 5 | 终端渲染 |
| Node.js + ssh2 | — | SSH 代理服务 |

## 架构设计

```
微内核架构
├── 核心框架层  AppLayout + Router + GlobalStore + Theme
├── 工具模块层  每个工具独立目录，按需注册
│   ├── LogAnalyzer/
│   ├── CommandBuilder/
│   ├── SOPBuilder/
│   ├── SSHManager/
│   ├── DiagnosticWorkbench/
│   └── NumberConverter/
└── 共享服务层  hooks/ + utils/ + components/shared/
```

## 新增工具模块

1. 在 `src/config/tools.config.ts` 注册工具元信息
2. 在 `src/modules/` 创建工具目录并实现 `index.tsx`
3. 在 `src/App.tsx` 添加路由
4. 在 `src/components/Layout/Sidebar.tsx` 添加图标

全程约 10-15 分钟，无需修改框架层代码。

## 数据持久化

所有用户数据（解析规则、命令模板、SOP 模板）通过 Zustand `persist` 中间件存储于浏览器 `localStorage`，无需后端服务。

诊断工作台的历史运行记录会额外持久化到 `server/data/diagnostic-kb.json`，用于相似故障召回。
