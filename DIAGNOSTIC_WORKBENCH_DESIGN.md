# 诊断知识库与多 Agent 工作台设计

## 1. 业务目标

目标是在现有 `SSH Manager`、`LogAnalyzer`、`SOPBuilder` 基础上补齐一条完整闭环：

1. 每次诊断 run 的命令、输出、分析结论、建议动作都结构化归档。
2. 新故障进来时，能够基于现象、错误关键词、命令特征召回相似案例。
3. 将诊断过程拆成可编排的多个 Agent，降低一次性人工排查成本。
4. 支持测试场景下通过 Python 脚本驱动业务动作，用于主动触发、验证和回归。

最终形成一个“诊断工作台”：

- 一边做连接采集
- 一边做日志分析
- 一边做报告归纳
- 同时把过程沉淀为知识库，服务后续召回和复盘

---

## 2. 角色与职责

### 2.1 连接采集 Agent（Collector Agent）

职责：

- 复用当前 SSH 会话 PTY 执行采集命令
- 串行记录命令、实际执行命令、输出、耗时、退出码
- 负责现场数据拉取，不做复杂推理

输入：

- `sessionId`
- 采集步骤列表 `collectionPlan[]`
- 执行超时

输出：

- `collectorSteps[]`
- 采集摘要（成功/失败步数、失败命令）

### 2.2 日志分析 Agent（Log Analyst Agent）

职责：

- 对采集输出应用规则匹配与启发式分析
- 提取错误签名、风险等级、证据片段
- 输出结构化 findings，供报告归纳和相似召回使用

输入：

- `collectorSteps[]`
- `analysisRules[]`
- 当前故障现象描述

输出：

- `findings[]`
- `signals`（错误关键词、命令关键词、症状关键词）

### 2.3 报告归纳 Agent（Report Summarizer Agent）

职责：

- 将采集结果、分析结论、相似案例召回结果统一归纳为诊断报告
- 形成现象、根因假设、建议动作、回归验证结论

输入：

- `collectorSteps[]`
- `findings[]`
- `similarCases[]`
- 业务测试脚本执行结果

输出：

- `report`
- `nextActions[]`

### 2.4 业务测试控制器（Business Test Runner）

职责：

- 通过 Python 脚本执行业务层面的控制与验证动作
- 例如：下单、查询、登录、压测入口调用、回归探测、灰度验证
- 作为编排中的“动作源”和“验证源”，不直接承担诊断总结职责

输入：

- `scriptPath`
- `args[]`
- `stdinPayload`
- 触发阶段 `before_collection | after_collection`

输出：

- `businessActions[]`

---

## 3. 业务场景

### 3.1 被动故障排查

1. 用户描述现象，例如“订单接口超时，部分节点 502”
2. Collector Agent 到目标会话采集服务状态、端口、关键日志、资源状态
3. Log Analyst Agent 提取异常模式
4. Report Agent 输出诊断结论并召回类似案例

### 3.2 主动验证 / 回归

1. 通过 Python 脚本触发业务请求或业务链路
2. 触发后立刻采集节点状态和日志
3. 归纳本次业务动作是否复现问题、是否恢复

### 3.3 经验沉淀

1. 每次 run 自动落库
2. 后续新问题进入时，先根据现象 + 规则 + 命令特征做相似召回
3. 把历史建议动作带回当前问题，减少重复排查

---

## 4. 核心业务对象

### 4.1 DiagnosticPlaybook

表示一套可复用的诊断编排模板。

字段：

- `id`
- `name`
- `description`
- `symptomTemplate`
- `collectionPlan[]`
- `analysisRules[]`
- `businessActions[]`
- `createdAt`
- `updatedAt`

### 4.2 DiagnosticRun

表示一次真实执行。

字段：

- `id`
- `title`
- `symptom`
- `sessionId`
- `sessionLabel`
- `status`
- `startedAt`
- `finishedAt`
- `agentStatus.collector`
- `agentStatus.logAnalyst`
- `agentStatus.summarizer`
- `collectionSteps[]`
- `businessActions[]`
- `findings[]`
- `similarCases[]`
- `report`
- `signals`

### 4.3 CollectionStepResult

字段：

- `id`
- `name`
- `command`
- `resolvedCommand`
- `stdout`
- `stderr`
- `exitCode`
- `durationMs`
- `status`
- `conclusion`
- `agent = collector`

### 4.4 AnalysisFinding

字段：

- `id`
- `title`
- `severity`
- `summary`
- `evidence`
- `matchedPattern`
- `sourceStepId`
- `sourceStepName`

### 4.5 BusinessActionResult

字段：

- `id`
- `name`
- `scriptPath`
- `args[]`
- `stdinPayload`
- `runMode`
- `stdout`
- `stderr`
- `exitCode`
- `durationMs`
- `status`

### 4.6 SimilarCase

字段：

- `runId`
- `title`
- `score`
- `matchedSignals[]`
- `reportSummary`
- `topFindings[]`

---

## 5. 运行流程设计

## 5.1 总流程

1. 用户选择会话与 Playbook，填写现象描述
2. 系统先基于现象和计划命令做一次历史召回
3. 执行 `before_collection` 业务脚本
4. Collector Agent 按顺序执行远程采集命令
5. 执行 `after_collection` 业务脚本
6. Log Analyst Agent 生成 findings 与 signals
7. Report Agent 汇总诊断报告
8. 将整次 run 持久化到知识库

## 5.2 结构化归档要求

每次 run 至少归档以下信息：

- 谁执行的：会话、目标主机、用户名
- 做了什么：命令、脚本、执行阶段
- 看到了什么：stdout、stderr、exitCode、耗时
- 怎么判断的：命中规则、结论、证据片段
- 得出了什么：摘要、根因假设、建议动作

## 5.3 相似案例召回策略

MVP 阶段采用轻量可解释方案：

1. 抽取 `symptom` 关键词
2. 抽取 `findings` 中的错误关键词
3. 抽取命令中的关键对象词，例如 `journalctl`、`grep`、`ss`、`curl`
4. 对历史 run 计算加权重叠得分

加权建议：

- 症状词命中：0.45
- 错误关键词命中：0.35
- 命令关键词命中：0.20

优点：

- 无需引入向量数据库
- 可解释
- 本地离线即可运行

---

## 6. 技术设计

## 6.1 前端

新增模块：`DiagnosticWorkbench`

主要能力：

- Playbook 维护
- 会话选择
- 诊断运行发起
- 运行结果查看
- 相似案例查看
- 历史知识库浏览

状态存储：

- Playbook 使用前端本地持久化
- 运行结果与知识库存于服务端 JSON 仓库

## 6.2 后端

新增 API：

- `GET /api/diagnostic/runs`
- `GET /api/diagnostic/runs/:id`
- `POST /api/diagnostic/recall`
- `POST /api/diagnostic/orchestrate`

后端职责：

- 复用现有 `activeSessions` 进行命令执行
- 本地执行 Python 业务脚本
- 结构化存档到 `server/data/diagnostic-kb.json`
- 基于本地历史记录做相似召回

## 6.3 数据持久化

存储文件：

- `server/data/diagnostic-kb.json`

结构：

```json
{
  "runs": []
}
```

原因：

- 便于本地开发和迁移
- 暂不引入 SQLite / 向量库
- 与当前项目“本地优先”的定位一致

---

## 7. 编排边界

本期只做“可执行 MVP”，不做以下内容：

- 不引入外部大模型依赖
- 不实现真正分布式任务调度器
- 不做复杂 embedding 检索
- 不做细粒度权限系统

本期交付重点是：

- 结构化沉淀
- 可复用编排
- 可解释召回
- 可落地的业务测试控制

---

## 8. 成功标准

### 8.1 业务层

- 新故障排查可在一个页面完成采集、分析、报告归纳
- 历史 run 可回看命令、输出、结论
- 新 run 可召回至少 3 条相似案例
- 测试人员可通过 Python 脚本触发业务动作

### 8.2 技术层

- 现有 SSH 会话复用成功
- 前端可发起完整编排
- 后端可稳定持久化和查询
- 构建通过，不影响现有模块

---

## 9. 开发拆分

### Phase A

- 知识库数据模型
- 结构化持久化
- 相似召回算法

### Phase B

- 多 Agent 编排 API
- Python 业务脚本执行器

### Phase C

- 前端诊断工作台
- Playbook 编辑与历史查看

### Phase D

- 示例脚本
- 文档与验证
