# Agent Prompt 模板

本文档提供给外部 Agent 的可直接复用 Prompt 模板，目标是让 Agent 能按统一步骤使用 DevUtility Hub 的自动登录和单 Agent 问题定位能力。

默认服务地址：

- `http://127.0.0.1:3001`

相关接口见：

- [AGENT_API.md](/Users/kafaz/dev/dev_utils/devutility-hub/AGENT_API.md)

---

## 1. 使用原则

给 Agent 的 Prompt 应至少明确 4 件事：

1. 用哪个登录预设
2. 要定位什么问题
3. 采集哪些命令
4. 最终结果要按什么格式返回

不要只说“帮我排查”，否则 Agent 不知道：

- 该连哪台机器
- 用哪个账号或密钥
- 优先采哪些证据
- 输出给谁看

---

## 2. 最小自动登录 Prompt

适用场景：

- 只需要 Agent 自动登录
- 先确认服务端预设是否可用

模板：

```text
你现在要调用 DevUtility Hub 的 Agent API。

步骤要求：
1. 先调用 GET /api/agent/login-presets
2. 在返回结果中找到名称或 id 最匹配“{{preset_name_or_id}}”的登录预设
3. 使用该预设调用 POST /api/agent/connect
4. 如果连接成功，只返回：
   - sessionId
   - host
   - username
   - status
5. 如果失败，返回失败原因，不要继续执行任何命令

输出要求：
- 使用简洁 JSON 返回
- 不要省略错误信息
```

示例：

```text
你现在要调用 DevUtility Hub 的 Agent API。

步骤要求：
1. 先调用 GET /api/agent/login-presets
2. 找到最匹配“prod-root-key”的登录预设
3. 使用该预设调用 POST /api/agent/connect
4. 如果连接成功，只返回 sessionId、host、username、status
5. 如果失败，返回失败原因，不要继续执行任何命令

输出要求：
- 使用简洁 JSON 返回
- 不要省略错误信息
```

---

## 3. 单 Agent 问题定位 Prompt

适用场景：

- 让一个 Agent 从登录开始完成一次 MVP 版问题定位

模板：

```text
你现在要使用 DevUtility Hub 的单 Agent 问题定位接口。

目标：
- 使用登录预设“{{preset_name_or_id}}”
- 对“{{problem_title}}”做一次问题定位
- 故障现象是：“{{symptom}}”
- 补充备注：“{{notes}}”

执行要求：
1. 如果需要，先确认登录预设存在
2. 调用 POST /api/agent/troubleshoot
3. 使用单 Agent MVP 模式完成：
   - 自动登录
   - 业务验证（如果有）
   - 远程采集
   - 规则分析
   - 报告归纳
4. 完成后返回以下内容：
   - sessionId
   - run.id
   - run.status
   - top 3 findings
   - report.summary
   - report.rootCauseHypothesis
   - report.nextActions

采集命令：
{{collection_plan_block}}

分析规则：
{{analysis_rules_block}}

业务动作：
{{business_actions_block}}

约束：
- 不要执行黑名单中的破坏性命令
- 如果登录失败，立即停止
- 如果某个采集命令失败，继续剩余步骤并在结果里标出失败步骤
- 输出必须引用实际 findings 和 report，不要自行编造
```

示例：

```text
你现在要使用 DevUtility Hub 的单 Agent 问题定位接口。

目标：
- 使用登录预设“prod-root-key”
- 对“订单接口超时诊断”做一次问题定位
- 故障现象是：“订单接口超时，部分节点返回 502”
- 补充备注：“最近刚发布过新版本”

执行要求：
1. 如果需要，先确认登录预设存在
2. 调用 POST /api/agent/troubleshoot
3. 使用单 Agent MVP 模式完成：
   - 自动登录
   - 业务验证
   - 远程采集
   - 规则分析
   - 报告归纳
4. 完成后返回以下内容：
   - sessionId
   - run.id
   - run.status
   - top 3 findings
   - report.summary
   - report.rootCauseHypothesis
   - report.nextActions

采集命令：
1. 检查进程：ps aux | grep order-service | grep -v grep
2. 检查端口：ss -tlnp | grep 8080
3. 最近日志：journalctl -n 100 --no-pager

分析规则：
1. 超时特征：timeout|timed out|超时
2. 连接拒绝：connection refused|refused|连接被拒绝
3. 通用异常：exception|panic|fatal|error

业务动作：
1. 业务冒烟脚本：examples/business_smoke_test.py
   args: ["--action","health-check","--target","order-service"]
   stdinPayload: {"scene":"order-check"}
   runMode: before_collection

约束：
- 不要执行黑名单中的破坏性命令
- 如果登录失败，立即停止
- 如果某个采集命令失败，继续剩余步骤并在结果里标出失败步骤
- 输出必须引用实际 findings 和 report，不要自行编造
```

---

## 4. 复用已有会话 Prompt

适用场景：

- 前面已经自动登录过
- 想让 Agent 复用现有 `sessionId`

模板：

```text
你现在要复用 DevUtility Hub 中已有的 SSH 会话继续排障。

步骤要求：
1. 调用 GET /api/agent/sessions
2. 确认 sessionId={{session_id}} 仍然存在
3. 如果存在，调用 POST /api/agent/troubleshoot，并显式传入该 sessionId
4. 如果不存在，停止并返回“session 不存在，需要重新连接”

输出要求：
- 返回 run.id
- 返回 run.status
- 返回 top findings
- 返回下一步建议
```

---

## 5. 让 Agent 先发现预设再选择

适用场景：

- 你不想把 `presetId` 写死
- 想让 Agent 根据名称语义自己选择最合适的预设

模板：

```text
你现在要自动选择最合适的登录预设并执行排障。

选择规则：
1. 先调用 GET /api/agent/login-presets
2. 优先选择名称最匹配“{{target_env}} {{target_role}}”的预设
3. 如果有多个候选，优先 privateKey，其次 agent，最后 password
4. 如果没有任何合适候选，停止并返回“无可用登录预设”

后续步骤：
1. 用选中的 presetId 执行 POST /api/agent/troubleshoot
2. 输出选中了哪个 preset
3. 输出 run.summary 和 nextActions
```

---

## 6. 推荐输出格式

建议要求 Agent 最终按下面结构返回：

```json
{
  "preset": {
    "id": "prod-root-key",
    "name": "生产 root 密钥登录"
  },
  "session": {
    "sessionId": "agent-session-xxx",
    "status": "connected"
  },
  "run": {
    "id": "run-xxx",
    "status": "attention",
    "summary": "本次诊断执行了 3 个采集步骤...",
    "rootCauseHypothesis": "疑似超时或阻塞...",
    "topFindings": [
      "疑似超时或阻塞",
      "命令执行失败: 最近日志"
    ],
    "nextActions": [
      "围绕最近日志补充上下游依赖检查"
    ]
  }
}
```

---

## 7. 协作式卡住反馈 Prompt

适用场景：

- 希望 Agent 先自动做首轮排查
- 当 Agent 证据不足时，不要继续盲查
- 而是先向用户反馈，再根据用户提示继续定位

模板：

```text
你现在要使用 DevUtility Hub 做一次协作式问题定位。

目标：
- 登录方式：{{preset_name_or_id_or_direct_connection}}
- 目标问题：{{problem_title}}
- 故障现象：{{symptom}}

执行要求：
1. 先完成一轮自动排查，可以使用 POST /api/agent/troubleshoot，或建立 session 后手工执行首轮采集
2. 如果首轮后已经能形成高置信度结论，直接返回结论
3. 如果首轮后仍然没有头绪，或证据互相冲突，不要继续无边界尝试命令
4. 改为向用户输出：
   - 当前现象
   - 已确认的关键证据
   - 仍未解释的缺口
   - 已执行过的关键命令或 run
   - 需要用户补充的业务背景、可疑日志关键词或下一步授权
   - 收到用户回复后的下一步验证计划
5. 用户回复后，优先复用已有 session，只执行最小必要的后续命令
6. 最终输出时，说明这次协作中哪些规则值得沉淀进 Skill 或知识库

约束：
- 不要在没有新假设的情况下连续追加很多命令
- 每轮用户反馈后，只围绕一个明确假设继续验证
- 输出必须基于真实 findings、report、session logs 或命令返回
```

---

## 8. SOP 优先 + 渐进式固化 Prompt

适用场景：

- 希望 Agent 优先复用已有 SOP 思路排障
- 当前可能有 SOP，也可能只有部分 SOP 片段可用
- 希望本次有效的新路径能被总结成后续 SOP 增量

模板：

```text
你现在要使用 DevUtility Hub 做一次 SOP 优先的问题定位。

目标：
- 登录方式：{{preset_name_or_id_or_direct_connection}}
- 目标问题：{{problem_title}}
- 故障现象：{{symptom}}

执行要求：
1. 先判断当前问题是否适合复用已有 SOP 或 SOP 片段
2. 如果适合，优先按 SOP 的意图推进：
   - 明确需要哪些变量
   - 明确要先跑哪些检查
   - 明确哪些输出是正常/异常判定信号
3. 如果 SOP 只能覆盖一部分，先执行公共部分，再单独补充新的差异路径
4. 如果没有合适 SOP，再做手工探索，但不要忘记总结哪些内容值得渐进式固化
5. 最终输出除诊断结果外，还要增加：
   - reusedSop
   - sopGap
   - candidateSolidification
   - requiresHumanReview

约束：
- 不要把 SOP 当作纯命令清单，要解释它解决的症状类型和判定逻辑
- 不要因为存在 SOP 就忽略现场证据
- 如果 SOP 和现场证据冲突，要指出是 SOP 过期、覆盖不足，还是适用范围不对
```

---

## 9. 不建议的 Prompt 写法

下面这些写法不够好：

```text
帮我看看服务器为什么不行
```

问题：

- 没有目标主机
- 没有登录方式
- 没有现象
- 没有采集边界

```text
随便采一些日志帮我分析
```

问题：

- 没有输出要求
- 没有限定命令范围
- 可能导致采集不稳定、结果不可复用

---

## 10. 最佳实践

建议你的上层系统给 Agent 的 Prompt 至少动态注入：

- `presetId` 或预设名称
- `title`
- `symptom`
- `notes`
- `collectionPlan[]`
- `analysisRules[]`
- `businessActions[]`

如果你已经有告警平台，最适合直接把告警字段映射成：

- 告警标题 -> `title`
- 告警摘要 -> `symptom`
- 业务标签 -> `notes`
- 服务模板 -> `collectionPlan[]`

这样 Agent 就不是从零推理，而是在一个受控模板里执行。
