# Diagnostic Scenario Workbench Design

## Goals

扩展现有 `DiagnosticWorkbench`，让它不仅能跑一次诊断编排，还能同时承担两类任务：

1. 问题定位：通过执行命令、检索日志、锁定证据，尽快拿到首个异常点。
2. 测试执行：围绕混沌业务、IO 业务、故障注入，建立“基线 -> 触发 -> 观测 -> 采集 -> 恢复”闭环。

## Why This Extension

现有仓库已经具备以下基础能力：

- SSH 会话与命令执行
- 会话日志拉取
- 诊断 Run 持久化
- 命令白名单控制
- Python 业务脚本执行
- 源码上下文绑定

缺的不是单点能力，而是把这些能力串成统一工作流：

- 没有把不同测试目标抽象成场景
- 没有首个异常的自动收敛
- 没有把关键日志/输出固定为证据
- 没有把常用命令回灌为可复用模板

## Main Additions

### 1. Scenarioized Playbook

`DiagnosticPlaybook` 新增：

- `scenarioType`
- `objective`
- `successCriteria`
- `tags`

`DiagnosticCollectionStep` 新增：

- `phase`
- `expectedSignal`
- `continueOnFailure`

现在一个 Playbook 不再只是“若干采集命令”，而是带目标、阶段和成功判据的场景化编排。

### 2. Built-in Scenarios

内置四套可直接复用或二次编辑的 Playbook：

- 服务超时诊断编排
- IO 抖动与阻塞定位
- 混沌演练回归闭环
- 故障注入与回滚验证

这些模板不是替用户写死所有环境参数，而是提供可执行的最小闭环和清晰的阶段骨架。

### 3. Scenario Command Library

新增与场景绑定的建议命令库：

- 只读命令：日志窗口、端口健康、进程快照、iostat、dmesg 等
- 变更命令：FIO 压测、netem 注入/恢复、stress-ng、进程 kill 等

每条命令支持：

- 加入当前 Playbook
- 保存到命令生成器

这样诊断工作台和命令生成器之间形成双向回灌，不再是孤岛。

### 4. First Anomaly Locator

新增“首个异常定位”卡片，按以下顺序自动收敛高风险异常：

1. 当前 Run 窗口内的会话 warning/error/非零退出日志
2. 采集步骤失败或命中高风险模式
3. 业务动作失败
4. 分析 Findings

输出包含：

- 异常标题
- 摘要
- 证据片段
- 对应命令
- 关键标签

### 5. Evidence Locker

新增持久化证据锁定面板，可从以下位置一键固定现场：

- 首个异常
- 会话日志
- 分析 Finding
- 采集步骤输出
- 业务动作输出

支持：

- 删除单条证据
- 清空证据
- 导出为 Markdown

### 6. Context Snapshot

Run 级别新增结构化定位上下文：

- 影响范围
- 触发动作 / 时序起点
- 最近变更
- 期望行为
- 观察窗口
- 关键日志词

目的不是多填表，而是减少“上下文都在备注里”的情况，让后续的时序整理和错误日志提纯有明确锚点。

### 7. Execution Timeline

新增统一执行时序卡片，把以下事件按时间排序展示：

- Run 开始 / 结束
- 业务动作执行
- 采集步骤执行
- 关键会话 warning / error / 非零退出日志

这样用户可以直接回答三个定位核心问题：

- 异常是在什么动作之后出现的
- 异常先于哪个采集步骤暴露
- 日志与执行动作是否处在同一时间窗

### 8. Effective Error Logs

新增“有效错误日志”提纯卡片，逻辑不是简单罗列所有错误，而是：

1. 结合用户给的关键日志词
2. 优先采集 Run 窗口内的高风险输出
3. 去重重复噪音
4. 保留命中行附近的上下文

目标是让用户首先看到真正推动定位向前的错误，而不是被重复告警或无关堆栈淹没。

## Execution Semantics

后端 Run 归档现在会保留：

- `scenarioType`
- `objective`
- `successCriteria`
- `tags`
- `contextSnapshot`
- 采集步骤 `phase`
- 采集步骤 `expectedSignal`
- 采集步骤 `continueOnFailure`
- 采集步骤 / 业务动作的 `startedAt` 与 `finishedAt`

同时，`continueOnFailure` 不再只是 UI 字段：

- 若步骤失败且该字段为 `false`，后续步骤会被标记为 `skipped`
- 这样“失败停下”和“失败继续”在行为层真正生效

## Operator Workflow

1. 选择场景模板，例如 IO 验证或故障注入。
2. 根据目标调整 `objective`、`successCriteria` 和标签。
3. 从场景命令库挑选需要的观测/注入/恢复命令，加入当前 Playbook。
4. 执行编排。
5. 在“首个异常定位”卡片确认第一异常信号。
6. 将会话日志、Findings、步骤输出锁定到证据面板。
7. 导出证据 Markdown，继续交给人或 Agent 做后续分析。

## Outcome

这次扩展后，`DiagnosticWorkbench` 从“单次诊断执行器”变成了“场景化定位与验证控制台”：

- 对定位更快：首个异常和证据锁定减少人工翻日志
- 对测试更完整：支持 IO / 混沌 / 故障注入的阶段化闭环
- 对复用更强：命令可回灌到 Playbook 和命令生成器
- 对沉淀更好：历史 Run 不再只有结果，也保留场景意图和阶段语义
