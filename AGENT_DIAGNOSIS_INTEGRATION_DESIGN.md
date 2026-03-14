# DevUtility Hub Agent 化诊断接入设计

## 1. 目标

把当前项目从“给人用的诊断工具”升级为“给 Agent 调用的本地诊断执行平面”，满足下面几个目标：

1. Agent 能主动发现节点、建立连接、执行预操作、运行 SOP 或单条命令。
2. Agent 能获得结构化执行结果，而不是只拿到一段原始 stdout。
3. 节点名称、别名、角色、IP、跳板机、认证方式之间有稳定映射。
4. 整个排查流程可自动化编排，而不是依赖前端先手工点连。
5. 服务仍部署在本地，Agent 通过 MCP 或本地 HTTP/WS 与之交互。

## 2. 现状与差距

当前仓库已经具备两块关键基础能力：

1. 复用 Shell PTY 的状态化执行能力。
   当前 `server/index.js` 已支持命令进入同一个交互式 Shell，能保留 `sudo`、`cd`、`source env` 等上下文。
2. SOP 计划执行能力。
   当前 `exec_plan` 已支持变量捕获、正则判定、Python 后处理、步骤级状态回传。

但当前 Agent 接入还存在一个关键限制：

1. `/api/agent/sessions` 和 `/api/agent/execute` 只能消费“已经由 UI 建立好的会话”。
2. Agent 无法自己发起 SSH 连接，也没有正式的节点注册中心。
3. 节点名与 IP 的关系主要散落在前端 `profile/session` 概念里，没有抽象成独立的 Agent 资源。

因此，建议把当前服务升级为三层结构：

1. 本地诊断核心服务：负责连接、执行、编排、审计。
2. MCP 适配层：把本地服务暴露成 Agent 可调用的工具。
3. Skill 层：告诉 Agent 何时调用哪些工具、如何阅读结果、如何输出诊断结论。

## 3. 集成方式选择

### 推荐方案

推荐采用：`本地诊断服务 + MCP Server + 可选 Skill`

原因：

1. `MCP` 适合做工具调用协议，天然适合 Agent 发起结构化操作。
2. `Skill` 适合固化诊断方法论和调用顺序，但不适合承担状态化连接与资源管理。
3. 你当前项目已经有本地服务雏形，继续沿用本地 HTTP/WS 最省改造成本。

### 不推荐方案

不建议只做 Skill，不做 MCP。

原因：

1. Skill 只能给 Agent 提示词和流程建议，不能独立维护 SSH 会话。
2. 连接建立、会话复用、流式日志、任务状态查询，这些都需要稳定工具协议承载。
3. 一旦没有 MCP 或本地 API，Agent 每次只能“重新思考怎么操作”，自动化程度不够。

### 角色分工

1. 本地服务：
   管连接、管执行、管编排、管审计。
2. MCP：
   把本地服务的方法暴露成 `tools`。
3. Skill：
   约束 Agent 优先走 SOP、异常时如何回退到细粒度命令、如何组织最终诊断报告。

## 4. 总体架构

```text
Agent
  -> MCP Tools
    -> Local MCP Server
      -> DevUtility Hub Local Service
        -> Session Manager
        -> Node Registry
        -> Workflow Engine
        -> Audit / Artifact Store
        -> SSH / Jump Host / Local Shell
```

### 4.1 分层职责

#### A. Node Registry

负责节点元数据管理，解决“节点名和 IP 的对应关系”问题。

核心字段建议：

```json
{
  "nodeId": "node-prod-db-01",
  "name": "prod-db-01",
  "aliases": ["db-master", "主库1"],
  "host": "10.10.1.23",
  "port": 22,
  "username": "root",
  "role": "mysql-master",
  "env": "prod",
  "tags": ["db", "master", "storage"],
  "jumpHostId": "bastion-prod",
  "authRef": "cred-prod-root",
  "preOpsProfileId": "linux-root-default"
}
```

这里要明确区分：

1. `nodeId`：稳定资源 ID，给 Agent 用。
2. `name/aliases`：方便人和 Agent 用自然语言定位节点。
3. `host`：真实 IP/FQDN。
4. `authRef`：引用本地凭据，不直接把密钥明文返回给 Agent。
5. `preOpsProfileId`：连接后默认执行的预操作模板。

#### B. Session Manager

负责建立、复用、关闭 SSH 会话。

核心原则：

1. 一个 Agent session 对应一个可复用 Shell PTY。
2. session 生命周期不依赖前端页面存在。
3. 所有命令都经过队列串行进入 PTY，保持上下文一致。
4. 会话要支持 TTL、心跳、空闲回收。

#### C. Workflow Engine

负责执行 SOP、预操作和分支逻辑。

建议把当前 `exec_plan` 升级成通用工作流执行器，步骤类型可扩展为：

1. `connect`
2. `prepare`
3. `command`
4. `capture`
5. `assert`
6. `branch`
7. `parallel`
8. `collect`
9. `close`

当前项目已经有可复用的数据结构基础：

1. `SOPSubStep.captureVar`
2. `capturePattern`
3. `normalRegex` / `abnormalRegex`
4. `scriptPath`

这些都适合直接下沉到服务端工作流模型。

## 5. 推荐接口设计

建议把接口拆成三组：

1. 资源接口：节点、会话、SOP 模板。
2. 执行接口：命令、工作流、SOP。
3. 观察接口：状态、流式输出、结果、审计。

统一响应外层建议：

```json
{
  "ok": true,
  "traceId": "trc_xxx",
  "data": {}
}
```

失败时：

```json
{
  "ok": false,
  "traceId": "trc_xxx",
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "session not found"
  }
}
```

### 5.1 节点注册与映射

#### `GET /api/agent/nodes`

列出全部可管理节点。

#### `POST /api/agent/nodes/resolve`

输入自然语言节点名、别名或 IP，解析成标准 node。

请求示例：

```json
{
  "query": "主库1"
}
```

响应示例：

```json
{
  "ok": true,
  "data": {
    "matched": true,
    "node": {
      "nodeId": "node-prod-db-01",
      "name": "prod-db-01",
      "host": "10.10.1.23",
      "role": "mysql-master",
      "env": "prod"
    }
  }
}
```

#### `POST /api/agent/nodes`

新增节点元数据。

#### `PATCH /api/agent/nodes/:nodeId`

更新名称、别名、IP、跳板机、标签等。

### 5.2 连接建立接口

这是当前最缺的一层，必须补上。

#### `POST /api/agent/sessions/open`

根据 `nodeId` 或直接连接参数建立 SSH 会话，并返回 `sessionId`。

请求示例：

```json
{
  "nodeId": "node-prod-db-01",
  "reason": "排查 mysql 主库延迟",
  "reuseIfExists": true,
  "ttlSec": 1800
}
```

响应示例：

```json
{
  "ok": true,
  "data": {
    "sessionId": "sess_abc123",
    "nodeId": "node-prod-db-01",
    "name": "prod-db-01",
    "host": "10.10.1.23",
    "status": "connected",
    "shellReady": true
  }
}
```

#### `GET /api/agent/sessions`

列出当前 agent 可用会话。

#### `GET /api/agent/sessions/:sessionId`

查看会话状态、节点信息、连接时间、最近活动时间。

#### `DELETE /api/agent/sessions/:sessionId`

主动关闭会话。

### 5.3 预操作接口

#### `POST /api/agent/sessions/:sessionId/prepare`

在执行正式诊断前完成预操作，例如：

1. `sudo su -`
2. `source /etc/profile`
3. `cd /var/log/service`
4. 导出环境变量
5. 执行固定的安全检查

请求示例：

```json
{
  "profileId": "linux-root-default",
  "steps": [
    { "name": "become-root", "cmd": "sudo su -" },
    { "name": "load-env", "cmd": "source /etc/profile" },
    { "name": "goto-log-dir", "cmd": "cd /var/log/myapp" }
  ]
}
```

返回应包含每一步执行结果，且保留 PTY 上下文。

### 5.4 单命令执行接口

#### `POST /api/agent/sessions/:sessionId/commands`

适合点查类操作。

请求示例：

```json
{
  "cmd": "tail -n 200 error.log",
  "timeoutMs": 15000,
  "mode": "pty"
}
```

说明：

1. `mode=pty`：进入复用 Shell，继承上下文。
2. `mode=exec`：独立通道，不继承上下文，适合无状态探测。

### 5.5 SOP / 工作流执行接口

#### `POST /api/agent/runs`

统一创建一次诊断运行。

请求示例：

```json
{
  "type": "sop",
  "name": "mysql-replication-lag-diagnosis",
  "targets": [
    { "nodeId": "node-prod-db-01" },
    { "nodeId": "node-prod-db-02" }
  ],
  "prepareProfileId": "linux-root-default",
  "templateId": "sop-mysql-replication-lag",
  "variables": {
    "db_port": "3306",
    "log_file": "/var/log/mysql/error.log"
  },
  "executionMode": "parallel"
}
```

返回：

```json
{
  "ok": true,
  "data": {
    "runId": "run_001",
    "status": "queued"
  }
}
```

#### `GET /api/agent/runs/:runId`

获取本次 run 的聚合状态。

#### `GET /api/agent/runs/:runId/events`

建议使用 `SSE` 或 `WebSocket` 输出流式事件。

事件模型建议：

1. `run.started`
2. `target.connected`
3. `prepare.started`
4. `prepare.finished`
5. `step.started`
6. `step.stdout`
7. `step.finished`
8. `finding.emitted`
9. `run.finished`

#### `POST /api/agent/runs/:runId/cancel`

取消执行。

### 5.6 结果与证据接口

#### `GET /api/agent/runs/:runId/result`

返回结构化结果，而不是只有 stdout。

结果建议：

```json
{
  "ok": true,
  "data": {
    "runId": "run_001",
    "summary": {
      "status": "failed",
      "suspectedRootCause": "主库磁盘延迟抖动导致复制线程阻塞",
      "confidence": 0.82
    },
    "targets": [
      {
        "nodeId": "node-prod-db-01",
        "sessionId": "sess_abc123",
        "status": "failed",
        "findings": [
          {
            "severity": "high",
            "title": "磁盘 await 高于 300ms",
            "evidence": "iostat 显示 sdb await=327.2"
          }
        ],
        "steps": []
      }
    ]
  }
}
```

这里要注意：

1. `suspectedRootCause` 可以先由规则/脚本产出候选。
2. 最终自然语言归因仍可由 Agent 完成。
3. 服务端重点输出“证据结构化”，不要把所有分析都压给规则引擎。

## 6. MCP 工具设计

建议 MCP 层不要直接暴露太底层的所有 HTTP API，而是聚合成少量高价值工具。

推荐工具集合：

1. `list_nodes`
   返回节点清单与标签。
2. `resolve_node`
   把“主库1”、“es-data-2”这类名字解析成 nodeId。
3. `open_session`
   建立或复用连接。
4. `prepare_session`
   执行预操作模板。
5. `run_command`
   执行一次命令。
6. `run_sop`
   按模板或临时步骤集执行完整诊断。
7. `get_run_status`
   获取运行状态。
8. `get_run_result`
   获取结构化结果。
9. `close_session`
   关闭连接。

这样做的好处是：

1. Agent 使用成本低。
2. 连接状态和资源管理仍由本地服务负责。
3. 后续换模型或换 Agent 框架时，底层服务不需要重写。

## 7. Skill 设计

Skill 不负责建连，负责“诊断策略”。

Skill 中应定义：

1. 遇到生产故障，优先调用 `resolve_node -> open_session -> prepare_session -> run_sop`。
2. 如果 SOP 结论不足，再调用 `run_command` 做补充探测。
3. 输出结论必须包含：
   - 故障现象
   - 证据链
   - 怀疑根因
   - 建议下一步
4. 没有足够证据时，不能下确定性结论。

也就是说：

1. MCP 提供“手和脚”。
2. Skill 提供“方法论和判断框架”。

## 8. 自动化流程建议

推荐把一次完整诊断编排成如下状态机：

1. `resolve_target`
   把节点名映射到 nodeId/IP。
2. `open_connection`
   建立 SSH 会话。
3. `prepare_context`
   执行预操作。
4. `run_baseline_checks`
   执行通用诊断项，如 `date`、`hostname`、`uptime`、`df -h`。
5. `run_domain_sop`
   执行对应领域 SOP，如网络、存储、服务不可用、慢查询。
6. `collect_findings`
   聚合证据和异常项。
7. `agent_analysis`
   由 Agent 读取结构化结果并形成诊断结论。
8. `emit_report`
   产出面向人的摘要报告。

## 9. 数据模型建议

建议新增三类持久化对象。

### 9.1 Node

```json
{
  "nodeId": "node-prod-api-01",
  "name": "prod-api-01",
  "aliases": ["api主1", "api-1"],
  "host": "10.20.0.15",
  "port": 22,
  "username": "root",
  "env": "prod",
  "role": "api",
  "tags": ["java", "gateway"],
  "jumpHostId": "bastion-prod",
  "authRef": "cred-root-prod",
  "preOpsProfileId": "linux-java-service"
}
```

### 9.2 Prepare Profile

```json
{
  "profileId": "linux-java-service",
  "name": "Linux Java Service",
  "steps": [
    { "name": "sudo", "cmd": "sudo su -" },
    { "name": "env", "cmd": "source /etc/profile" },
    { "name": "workdir", "cmd": "cd /opt/app/current" }
  ]
}
```

### 9.3 Run

```json
{
  "runId": "run_001",
  "type": "sop",
  "targets": ["node-prod-api-01"],
  "status": "running",
  "startedAt": 1730000000000,
  "steps": [],
  "findings": [],
  "summary": {}
}
```

## 10. 与当前代码的衔接建议

### 已有能力可直接复用

1. 当前 Agent HTTP 执行入口：
   `/api/agent/sessions` 与 `/api/agent/execute`
2. 当前 PTY 队列与 marker 捕获机制：
   适合作为会话执行核心。
3. 当前 `exec_plan`：
   已经很接近服务端工作流执行器。
4. 当前前端中的 `SSHProfile`、`SSHSession`、`PlanStep`、`SOPSubStep`：
   可以演化为服务端统一模型。

### 建议优先改造点

#### 第一优先级

把“连接建立”从 WebSocket UI 消息里抽离成服务端 `SessionManager`，不要再要求先打开前端页面才能让 Agent 用。

#### 第二优先级

新增 `Node Registry`，用 `nodeId` 替代“直接给 sessionId 执行命令”的模式。

#### 第三优先级

把 `exec_plan` 包成正式的 `run_sop/run_workflow` REST API，并补状态查询接口。

#### 第四优先级

新增 MCP adapter，把 REST API 映射为固定工具集。

## 11. 安全与审计

至少要保留下面几项：

1. 命令黑名单。
2. 节点访问白名单。
3. 基于角色的 SOP 白名单。
4. 每次 run 的审计日志。
5. 凭据只保存在本地服务，不返回给 Agent。
6. 高危操作必须显式标记 `dangerous=true`，默认拒绝。

建议进一步增加：

1. 命令分类：
   `read-only`、`diagnostic`、`mutating`
2. 只读优先策略：
   Agent 默认只能调用 `read-only` 和 `diagnostic`
3. 证据脱敏：
   输出前对 token、密码、私钥、手机号等做脱敏

## 12. 实施阶段建议

### Phase 1: 服务内核 Agent 化

目标：

1. 新增 Node Registry
2. 新增 SessionManager
3. 新增 `open_session/prepare_session/run_command`

### Phase 2: 工作流 Agent 化

目标：

1. 新增 `run_sop`
2. 新增 `run_workflow`
3. 新增 `get_run_status/get_run_result`
4. 增加 SSE/WS 流式事件

### Phase 3: MCP 与 Skill

目标：

1. 实现 MCP tools
2. 编写诊断 Skill
3. 沉淀领域 SOP 模板

## 13. 最终推荐结论

对于你的场景，最合适的落地方式不是二选一，而是：

1. **本地服务** 作为真正的执行平面。
2. **MCP** 作为 Agent 调用本地服务的标准入口。
3. **Skill** 作为诊断方法论与工具使用约束。

如果只选一个：

1. 对外接入协议优先选 `MCP`
2. Skill 作为增强项，不作为唯一方案

原因很直接：

1. 你需要状态化连接。
2. 你需要节点映射和会话生命周期管理。
3. 你需要 SOP 自动执行与流式结果。
4. 这些都更适合 MCP + 本地服务，而不是 Skill 单独承担。
