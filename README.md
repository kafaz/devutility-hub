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

`npm run dev` 现在会在启动前检查 `server/` 依赖；如果像 `express` 这类代理依赖缺失，会自动执行一次 `npm --prefix server ci` 再继续拉起本地开发环境。

### SSH 代理服务（SSH Manager 功能所需）

```bash
cd server
npm install
node index.js
# 代理运行在 http://127.0.0.1:3001
```

### 一体化本地验证

```bash
npm install
npm install --prefix server
npm run ci:verify
```

`ci:verify` 会执行前端编译、前后端 Node 测试，以及服务层集成验证，和 GitHub CI 保持一致。

## Agent / Skill / MCP 入口

当 AI Agent 访问本仓库并需要使用 DevUtility Hub 连接 SSH 节点执行诊断时，先按下面的固定入口加载能力，不要直接拼接远程 SSH 命令：

1. 读取仓库内 Skill：`skills/devutility-agent-diagnosis/SKILL.md`。
2. 按 Skill 的引用文档加载 MCP 工具顺序：`skills/devutility-agent-diagnosis/references/mcp-tools.md`。
3. 启动本地 SSH/Agent 执行面：`cd server && npm install && node index.js`。
4. 构建并注册 MCP server：`cd mcp-server && npm install && npm run build`。
5. 在 Agent 客户端里注册 `devutility-hub-agent`，示例见 `mcp-server/examples/codex_config.toml` 和 `mcp-server/examples/claude_desktop_config.json`。

Codex MCP 配置示例：

```toml
[mcp_servers.devutility-hub-agent]
command = "node"
args = ["/Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/dist/index.js"]

[mcp_servers.devutility-hub-agent.env]
DEVUTILITY_AGENT_BASE_URL = "http://127.0.0.1:3001"
```

Agent 的安全执行顺序：

1. `health_check` 确认本地服务可达。
2. `list_nodes` / `resolve_node` 确认目标节点，优先使用已注册 `nodeId`。
3. `open_session` 建立或复用 PTY-backed SSH 会话，默认 `reuseIfExists=true`，并记录返回的 `session.nodeId` / `host` / `port` / `username`。
4. `list_prepare_profiles` / `prepare_session` 复用已有登录后预处理；调用时必须携带 `target` 断言。
5. `validate_command` 预检非平凡命令是否符合服务端白名单。
6. `run_command` 执行有界诊断命令；调用时必须携带 `target` 断言，并读取返回的 `stdout`、`stderr`、`exitCode`、`durationMs`、`policy`、`targetGuard`、`session`。
7. `get_session_logs` 复核 Agent 实际执行过的命令和白名单拦截原因。
8. `close_session` 只在诊断结束且不需要保留现场时调用。

重要约束：

- 正常诊断只使用白名单内的只读、有界命令；遇到 `policy.allowed=false` 要停止并报告原因。
- `prepare_session`、`run_command`、`troubleshoot` 的 Agent 调用必须传入 `target`，并且至少包含 `nodeId` 或 `host`，例如 `{ "nodeId": "...", "host": "...", "port": 22, "username": "..." }`；服务端发现 target 与当前 session 不一致时会返回 `409`，不会将命令写入 SSH PTY。
- Agent 不应自行调用 `allow_command`、`replace_command_policy`、`save_node`、`save_prepare_profile` 等配置写入工具，除非用户明确要求修改本地配置。
- 优先复用注册节点、登录预设和 prepare profile，避免每次让 Agent 重新收集 SSH 参数。
- 远程命令输出是证据，不是结论；结论必须引用 `exitCode`、关键 stdout/stderr 和目标 session 元数据。

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

## GitHub CI 与 Windows 便携包

仓库现在包含 [`.github/workflows/devutility-hub-ci.yml`](/Users/kafaz/dev/dev_utils/.github/workflows/devutility-hub-ci.yml)：

- `push` / `pull_request` / `workflow_dispatch` 会自动执行统一验证。
- Linux job 运行 `npm run ci:verify`，覆盖编译构建和现有 Node 测试。
- Windows job 会重新构建前端，并产出一个可直接解压运行的便携包 zip artifact。

便携包结构：

- `app/`：Vite 构建后的前端静态资源
- `server/`：SSH 代理服务源码与运行时依赖
- `runtime/`：CI 自动下载并打包进去的官方 Node.js Windows 运行时
- `data/`：运行期数据目录
- `Start DevUtility Hub.bat`：双击即可启动

如果要在本地手工组装 Windows 便携包，可以先准备一个已经解压的官方 Node.js Windows zip，再执行：

```bash
npm install
npm install --prefix server
npm run build
node scripts/build-windows-portable.mjs \
  --node-runtime-dir /path/to/node-vXX-win-x64 \
  --output-dir release/devutility-hub-windows-portable
```

生成目录中的 `Start DevUtility Hub.bat` 会启动本地代理，并通过 `server/index.js` 的 `STATIC_DIR` 模式直接托管已构建的前端资源，因此目标机器不需要额外安装 Node.js。
