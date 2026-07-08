# SSH/MCP Service Only Design

## Goal

将 DevUtility Hub 从多功能前端工具集合裁剪为纯后端 SSH/MCP 服务。最终项目不再提供 React/Vite Web UI，只作为本地 SSH Agent Gateway 运行，供 Codex、Claude、Cursor 等 Agent 通过 MCP tools 访问远程机器。

## Retained Capabilities

保留 `server/` 作为本地 SSH 执行面：

- SSH 连接、跳板机、密码/私钥/SSH Agent 认证。
- HTTP Agent API：节点、登录预设、prepare profiles、命令策略、会话列表、会话日志。
- 有状态 SSH shell 会话、WebSocket terminal 通道、命令执行和 resize。
- `prepare_session`、`run_command`、`run_commands_batch`、`close_session` 所需的服务端路由。
- 本地运行端口发现和 MCP server 对本地 HTTP API 的访问。

保留 `mcp-server/` 作为 Agent 入口：

- MCP tools 仅覆盖 SSH 远程访问所需能力。
- Agent 可以打开/复用 SSH 会话，执行预处理，运行单条或批量命令，查看会话和日志，关闭会话。
- 配置类 tools 仅保留与 SSH 连接、prepare profile、命令策略直接相关的能力。

## Removed Capabilities

删除前端应用和非 SSH/MCP 功能：

- 删除 React/Vite 前端入口、工具路由、布局、全量 `src/` UI 模块、`public/`、`index.html`、`vite.config.ts`。
- 删除 LogAnalyzer、CommandBuilder、SOPBuilder、SOPScheduler、DiagnosticWorkbench、BlockBenchmark、CodeContextExplorer、NumberConverter、IOAnalyzer 等产品功能。
- 删除诊断知识库、code-context、benchmark、SOP 调度等非 SSH/MCP 服务端 API 和 MCP tools。
- 删除前端依赖和前端测试脚本，根目录 `package.json` 只保留后端/MCP 开发、构建、验证脚本。

## Architecture

运行时由两个进程组成：

1. `server/index.js` 启动本地 HTTP/WebSocket SSH gateway。
2. `mcp-server/dist/index.js` 通过 stdio 暴露 MCP tools，并请求本地 gateway。

根目录开发命令应从任意正确项目目录启动这两个进程：

- `npm run dev`：确保 server 与 mcp-server 依赖存在，构建 MCP server，然后并行启动 SSH gateway 和 MCP server。
- `npm run build`：构建 MCP server，必要时做服务端语法/测试检查。
- `npm run ci:verify`：执行 SSH/MCP 相关测试，不再运行前端 build 或前端测试。

## Data And Safety

保留 `server/data/` 中与 SSH 远程访问直接相关的 JSON 数据：

- `agent-login-presets*.json`
- `agent-nodes*.json`
- `prepare-profiles*.json`
- `command-policy*.json`

不再保留诊断 KB 或代码上下文缓存作为产品能力。命令执行仍必须经过服务端 command policy 和 target guard；MCP tools 不绕过这些保护。

## Testing

验证重点：

- `npm install` 后根目录脚本可运行，不再要求前端依赖。
- `npm --prefix mcp-server run build` 通过。
- 服务端 SSH/MCP 路由相关 Node tests 通过。
- `npm run dev` 不再尝试启动 Vite，也不会因为在父目录误跑而误判为前端问题；README 明确要求在项目根目录执行。

## Migration Notes

本次裁剪会移除所有浏览器 UI。需要 Web terminal 的交互能力时，只保留服务端 WebSocket terminal 协议；用户界面不再由本仓库提供。已有浏览器 localStorage 中的前端工具数据不迁移。
