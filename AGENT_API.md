# DevUtility Agent & MCP API Documentation

The DevUtility Hub server exposes HTTP API endpoints allowing external autonomous AI Agents (such as Claude Desktop via MCP, or remote workflow systems) to discover connected nodes and execute bash commands without user intervention.

Since DevUtility Hub persists active SSH terminal (PTY) contexts, commands executed via these endpoints carry over environmental states (e.g. `sudo su`, `cd /var/log`, `source .env`) perfectly.

## Server Configuration
By default, the proxy server exposes its HTTP routes at `http://127.0.0.1:3001`.
If you are running the Agent remotely, you must tunnel this port using a tool like `ngrok` or `cloudflared`.

---

## 0. Agent 自动登录（MVP）

为了让外部 Agent 可以仅通过 prompt 指定“使用哪个已配置的登录方式”，服务端新增了登录预设与自动建连接口。

登录预设文件位于：

- `server/data/agent-login-presets.json`

可参考示例：

- `server/data/agent-login-presets.example.json`
- `server/examples/agent_connect.request.example.json`

### 0.1 List Login Presets

**Endpoint:** `GET /api/agent/login-presets`

用途：

- 列出当前可用的登录预设
- Agent 可根据 `id` 或 `name` 选择使用哪个密钥/密码配置

### 0.2 Save / Update Login Preset

**Endpoint:** `POST /api/agent/login-presets`

用途：

- 保存或更新一条登录预设
- 支持 `privateKey` / `password` / `agent`

### 0.3 Connect by Preset

**Endpoint:** `POST /api/agent/connect`

**Request Example:**
```json
{
  "presetId": "prod-root-key",
  "sessionId": "agent-prod-001"
}
```

**Response Example:**
```json
{
  "ok": true,
  "sessionId": "agent-prod-001",
  "host": "192.168.1.10",
  "port": 22,
  "username": "root",
  "managedBy": "agent-api",
  "status": "connected"
}
```

当返回 `ok: true` 时，表示 SSH 登录成功且交互式 Shell 已建立，可直接进入后续问题定位。

也可直接使用样例请求文件：

- `server/examples/agent_connect.request.example.json`

---

## 0.4 Command Policy

服务端新增了命令白名单策略，用于在服务层统一拦截非法命令执行。

当前策略特点：

- 仅允许常见诊断类、只读类命令
- 拦截破坏性命令和高风险操作
- 在 `agent/execute`、`agent/troubleshoot`、`diagnostic/orchestrate` 以及 WebSocket `exec/exec_plan` 路径统一生效
- 白名单允许在运行中动态修改，并持久化到 `server/data/command-policy.json`

**Endpoint:** `GET /api/agent/command-policy`

用途：

- 查询当前服务端命令策略快照
- 供前端或外部 Agent 了解当前允许的命令范围

典型会被拦截的场景：

- `rm -rf`
- `dd if=`
- `chmod` / `chown`
- `kill` / `pkill`
- `curl -X POST`
- `sed -i`
- `find -exec`
- 非白名单命令入口

可参考白名单文件示例：

- `server/data/command-policy.example.json`

### 0.4.1 Replace Full Whitelist

**Endpoint:** `PUT /api/agent/command-policy`

**Request Example:**
```json
{
  "allowedBaseCommands": [
    "echo",
    "grep",
    "ps",
    "journalctl",
    "curl"
  ]
}
```

用途：

- 整体替换服务端白名单
- 修改后立即生效，无需重启服务

### 0.4.2 Add One Allowed Command

**Endpoint:** `POST /api/agent/command-policy/allow`

**Request Example:**
```json
{
  "command": "kubectl"
}
```

用途：

- 在当前白名单基础上动态新增一条允许命令

### 0.4.3 Remove One Allowed Command

**Endpoint:** `DELETE /api/agent/command-policy/allow/:command`

示例：

- `DELETE /api/agent/command-policy/allow/curl`

用途：

- 从当前白名单中删除一条允许命令

### 0.4.4 Reset Whitelist

**Endpoint:** `POST /api/agent/command-policy/reset`

用途：

- 将白名单恢复为服务默认值

---


## 0.5 Open Session (Two Modes)

**Endpoint:** `POST /api/agent/sessions/open`

该接口现支持两种建连模式：

1. **node/direct 模式**（原有行为）
   - 传入 `nodeId`（推荐），或 `connection` + 可选 `auth/jumpAuth`
   - 用于节点注册体系内或临时直连
2. **preset 模式**（新增兼容）
   - 传入 `presetId`（可选 `sessionId`）
   - 服务端会复用 `connect` 逻辑自动登录

### 0.5.1 `open` with presetId

```json
{
  "presetId": "prod-root-key"
}
```

成功时返回可用会话信息（含 `sessionId`），后续可直接调用：

- `GET /api/agent/sessions`
- `GET /api/agent/sessions/:sessionId`

### 0.5.2 `open` with direct host + password

现在 `POST /api/agent/sessions/open` 同时支持两种直连写法：

1. 传统写法：`connection` + `auth`
2. 简化写法：直接传顶层 `host` / `username` / `password`

以下两种请求都会生效。

传统写法：

```json
{
  "connection": {
    "host": "192.168.1.10",
    "port": 22,
    "username": "root"
  },
  "auth": {
    "authType": "password",
    "password": "replace-me"
  }
}
```

简化写法：

```json
{
  "host": "192.168.1.10",
  "port": 22,
  "username": "root",
  "password": "replace-me"
}
```

如果没有显式传 `authType`，服务端会自动推断：

- 有 `password` 时按 `password` 模式
- 有 `keyContent` / `keyFilePath` 时按 `privateKey` 模式
- 都没有时优先尝试 `agent`（如果本机有 `SSH_AUTH_SOCK`）

## 1. List Connected Sessions
Allows an agent to dynamically discover which servers the developer is currently connected to.

**Endpoint:** `GET /api/agent/sessions`

**Response Example:**
```json
{
  "ok": true,
  "sessions": [
    {
      "sessionId": "x2y3z4",
      "host": "192.168.1.100",
      "username": "root"
    }
  ]
}
```

---

## 2. Execute Shell Command
Schedules a shell command to be executed inside the node's existing active terminal.
It blocks the HTTP request and awaits the final standard output + exit code to return it as a complete string up to the `timeout` limit.

**Endpoint:** `POST /api/agent/execute`

**Request Body:**
```json
{
  "sessionId": "x2y3z4",   // Obained from /api/agent/sessions
  "cmd": "tail -n 20 /var/log/nginx/error.log",
  "timeout": 15000         // (Optional) Max MS to wait before aborting. Default: 30000
}
```

**Response Example (Success):**
```json
{
  "ok": true,
  "result": {
    "stdout": "2026/03/09 10:12:14 [error] 1459#1459: *2 connect() failed",
    "stderr": "",
    "exitCode": 0,
    "durationMs": 420
  }
}
```

**Response Example (Error / Timeout):**
```json
{
  "ok": false,
  "error": "Session 不存在或已断开连接"
}
```
*or* (If it timed out resolving the marker)
```json
{
  "ok": true,
  "result": {
    "stdout": "...",
    "stderr": "[命令执行超时]",
    "exitCode": -1,
    "durationMs": 15000
  }
}
```

如果命令不在白名单内，服务会返回 `403`，并在错误信息中明确指出拦截原因。

---

## Technical Details for Agent Implementation

1. **Statefulness:** Because commands share the exact same active Shell as the user interface, the Agent should avoid using highly destructive looping operations that cannot be killed. Calling interactive commands like `vim`, `top` or `nano` without a specific limit will lock the session until `timeout` crashes it out.
2. **Standard Practice:** If you need to observe ongoing metrics, use commands like `ps aux` instead of `top`, or `cat filename` instead of `less`.
3. **Execution Queues:** Commands are funneled through an atomic FIFO queue. If the user is currently running a heavy SOP plan, the Agent's command requested will wait patiently until the shell becomes free again.

---

## 3. Single-Agent Troubleshooting (MVP)

当前提供一个 MVP 版本的单 Agent 问题定位入口，它会顺序完成：

1. 自动登录（如果未提供活动 `sessionId`）
2. 可选业务脚本执行
3. 远程命令采集
4. 日志分析与启发式发现
5. 诊断报告归纳
6. 结果归档到诊断知识库

**Endpoint:** `POST /api/agent/troubleshoot`

### Request Example

```json
{
  "presetId": "prod-root-key",
  "title": "订单接口超时诊断",
  "symptom": "订单接口超时，部分节点返回 502",
  "notes": "最近刚发布过新版本",
  "collectionPlan": [
    { "name": "检查进程", "command": "ps aux | grep order-service | grep -v grep" },
    { "name": "最近日志", "command": "journalctl -n 100 --no-pager" }
  ],
  "analysisRules": [
    { "name": "超时特征", "pattern": "timeout|timed out|超时", "source": "all", "severity": "critical", "summary": "日志中出现超时信号" }
  ],
  "businessActions": [
    {
      "name": "业务冒烟",
      "scriptPath": "examples/business_smoke_test.py",
      "args": ["--action", "health-check", "--target", "order-service"],
      "stdinPayload": "{\"scene\":\"order-check\"}",
      "runMode": "before_collection"
    }
  ],
  "autoDisconnect": true
}
```

也可直接使用样例请求文件：

- `server/examples/agent_troubleshoot.request.example.json`

### Response Example

```json
{
  "ok": true,
  "sessionId": "agent-session-abc123",
  "autoConnected": true,
  "keptSession": false,
  "run": {
    "id": "run-xxx",
    "title": "订单接口超时诊断",
    "status": "attention",
    "collectionSteps": [],
    "findings": [],
    "report": {}
  }
}
```

说明：

- 如果传入活动 `sessionId`，则会复用该会话
- 如果未传入 `sessionId`，则会优先使用 `presetId` 自动登录
- 如果未传入 `sessionId`，也可以直接传顶层 `host` / `username` / `password` 做直连登录
- 如果传入了目标连接信息且存在同目标的活跃会话，默认会优先复用已有会话
- `autoDisconnect=true` 时，排障完成后自动断开该 Agent 建立的 SSH 会话
