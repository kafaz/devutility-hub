# BlockBenchmark Core Overhaul — Design Spec

**Date:** 2026-04-18
**Scope:** Storage Benchmark (BlockBenchmark) 模块重构，使其成为 DevUtility Hub 的核心功能。
**Approach:** 方案 B — 在现有 Tab 架构上逐项增强，新增 3 个 Tab，改动最小，复用率最高。

---

## 1. 目标与约束

### 1.1 核心能力（5 项）

1. **多节点并发业务执行** — 预定义业务模板（命令序列 + 变量替换），多节点并发下发，支持跨节点变量捕获与传递。
2. **多节点故障注入** — 预置故障集合库，动态选择目标节点和参数，支持自动恢复。
3. **后台任务监控与日志抓取** — 监控任务状态，实时抓取不同节点指定日志文件（路径可不同）。
4. **实时 IO 性能监控** — 聚合所有节点所有数据盘的带宽、IOPS、利用率，显示当前 IO 模型类型。
5. **数据不一致检测** — 基于 CRC、LBA 范围比对、元数据一致性，检测并报告数据不一致。

### 1.2 约束

- **无独立 benchmark 后端**：全部复用现有 SSH Proxy (port 3001) 的 `exec` 通道和 WebSocket Shell PTY 能力。
- **前端技术栈**：React 18 + TypeScript + Ant Design + echarts-for-react + Zustand（persist）。
- **部署约束**：目标环境是运维工程师的本地机器，不能引入额外服务端进程。

---

## 2. Tab 规划（8 个）

| # | Key | 名称 | 状态 | 核心职责 |
|---|-----|------|------|----------|
| 1 | `deploy` | 部署与管控 | 保持 | SSH 会话 → Agent 绑定，启动/查看 Agent 状态 |
| 2 | `topology` | 磁盘矩阵调度 | 保持 | 多节点磁盘扫描，指派 IO 模型，矩阵一键并发压测 |
| 3 | `task` | 业务编排与下发 | **增强** | 预定义业务模板 → 变量替换 → 多节点并发执行 |
| 4 | `chaos` | 故障混沌注入 | **新增** | 故障库管理 + 多节点选择 + 注入执行 + 恢复 |
| 5 | `io_monitor` | IO 实时监控 | **增强** | 全集群聚合大盘 + 单盘时序详情 + IO 模型关联 |
| 6 | `tracing` | 任务追踪与日志 | **新增** | 后台任务状态 + 多节点指定日志实时 tail -f |
| 7 | `analysis` | 一致性检测与仲裁 | **增强** | 任务结果列表 + 不一致检测规则 + 报告展示 |
| 8 | `distribution` | 构件分发 | 保持 | 多节点文件分发 + 自定义脚本执行 |

---

## 3. 数据模型

### 3.1 业务模板（新增）

```ts
interface BusinessTemplate {
  id: string;
  name: string;
  description?: string;
  steps: BusinessStep[];
  variables: TemplateVariable[];
  createdAt: number;
  updatedAt?: number;
}

interface BusinessStep {
  id: string;
  name: string;
  cmd: string; // 支持 {{varName}} 插值
  target: 'all' | string[]; // 'all' = 所有选中节点，或指定节点 ID 列表
  timeout: number; // 毫秒，默认 30000
  captureVar?: {
    name: string;
    pattern: string; // 正则，从 stdout 提取
  };
  // 是否阻塞：true = 等所有目标节点此步骤完成后才进入下一步
  // false = 发完即进入下一步（fire-and-forget）
  blocking: boolean;
}

interface TemplateVariable {
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
  // 变量作用域：'global' = 所有节点共享同一个值
  // 'perNode' = 每个节点独立填写
  scope: 'global' | 'perNode';
}

interface BusinessExecution {
  id: string;
  templateId: string;
  templateName: string;
  nodeIds: string[];
  // global 变量值 + perNode 变量值（key 为 nodeId）
  varValues: {
    global: Record<string, string>;
    perNode: Record<string, Record<string, string>>;
  };
  status: 'pending' | 'running' | 'done' | 'partial_fail' | 'fail';
  // 执行上下文：步骤运行中捕获的变量
  sharedVars: Record<string, string>;
  stepResults: Record<string, StepResult[]>; // key = nodeId
  startedAt: number;
  doneAt?: number;
}

interface StepResult {
  stepId: string;
  stepName: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  capturedVar?: { name: string; value: string };
  status: 'pending' | 'running' | 'done' | 'fail';
}
```

**命令变量替换规则：**
- 模板变量：`{{pool}}`、`{{image}}` → 执行前从 `varValues` 替换
- 捕获变量：`$capture.volume_id` → 从 `sharedVars` 中查找之前步骤捕获的值
- 节点元数据：`$node.name`、`$node.ip` → 从 SSH session/profile 中获取

### 3.2 故障混沌（新增）

```ts
interface ChaosFault {
  id: string;
  name: string;
  category: 'network' | 'disk' | 'cpu' | 'memory' | 'process' | 'custom';
  description: string;
  cmdTemplate: string;
  params: FaultParam[];
  recoveryCmdTemplate?: string;
  recoveryParams?: FaultParam[];
  defaultDurationSec: number;
  isBuiltin: boolean; // true = 预置不可删除
}

interface FaultParam {
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
}

interface ChaosInjection {
  id: string;
  faultId: string;
  faultName: string;
  nodeIds: string[];
  paramValues: Record<string, string>;
  durationSec: number;
  status: 'pending' | 'injecting' | 'injected' | 'recovering' | 'recovered' | 'fail';
  injectedAt?: number;
  recoveredAt?: number;
  log: string; // 注入和恢复过程中的日志聚合
}
```

**预置故障库（内置 6 个）：**

| ID | 名称 | 类别 | cmdTemplate | recoveryCmdTemplate | 参数 |
|----|------|------|-------------|---------------------|------|
| `net_delay` | 网络延迟 | network | `tc qdisc add dev {{iface}} root netem delay {{delay}}ms` | `tc qdisc del dev {{iface}} root` | iface, delay |
| `net_loss` | 网络丢包 | network | `tc qdisc add dev {{iface}} root netem loss {{loss}}%` | `tc qdisc del dev {{iface}} root` | iface, loss |
| `io_stuck` | IO 卡顿 | disk | `echo {{major}}:{{minor}} > /sys/block/{{device}}/device/timeout && sync` | `echo 30 > /sys/block/{{device}}/device/timeout` | device, major, minor |
| `cpu_stress` | CPU 满载 | cpu | `stress-ng --cpu {{cores}} --timeout {{duration}}s` | — | cores, duration |
| `proc_kill` | 进程 Kill | process | `kill -9 $(pgrep {{processName}})` | — | processName |
| `disk_ro` | 磁盘只读 | disk | `blockdev --setro {{device}}` | `blockdev --setrw {{device}}` | device |

### 3.3 后台任务追踪（新增）

```ts
interface TracedTask {
  id: string;
  name: string;
  nodeId: string;
  nodeName: string;
  // 任务来源
  source: { type: 'business' | 'chaos' | 'manual' | 'io'; refId: string };
  // 如果是后台进程（nohup 启动），记录 PID 用于状态轮询
  pid?: string;
  // 进程检测命令：如 `ps -p {{pid}}`
  statusCheckCmd?: string;
  status: 'running' | 'completed' | 'failed' | 'unknown';
  // 关联的日志文件路径（每个节点可以不同）
  logPaths: LogPathConfig[];
  startedAt: number;
  lastStatusCheckAt?: number;
}

interface LogPathConfig {
  id: string;
  path: string;
  label: string; // 用户自定义标签，如 "OSD log"
  mode: 'snapshot' | 'stream'; // snapshot = 一次性读取；stream = tail -f
  // stream 模式下，最近 N 行缓存（最大 500 行）
  buffer?: string[];
  // stream 模式下的 unsubscribe 句柄
  unsubscribe?: () => void;
}
```

**后台任务状态检测机制：**
- 如果任务有 `pid`：每 5 秒执行 `ps -p <pid> > /dev/null; echo $?`，exitCode 0 = running，1 = completed/failed
- 如果任务无 `pid`（一次性命令）：以 exec 的 exitCode 为准，命令返回即标记完成
- `unknown` 状态：SSH 断连或检测命令失败时降级

### 3.4 IO 实时监控（增强）

复用现有 `IostatMetrics`，扩展聚合存储结构：

```ts
interface IOMetricsSnapshot {
  key: string; // "{sessionId}::{diskName}"
  sessionId: string;
  sessionName: string;
  diskName: string;
  // 当前关联的 IO 模型/任务
  activeIOModel?: string; // 如 "fio-randwrite-4k"
  activeTaskId?: string;
  // 最新采样点
  latest: IostatMetrics;
  // 时序历史（最多 120 点 ≈ 2 分钟 @ 1s 采样）
  history: IostatMetrics[];
}

// benchmarkStore 中新增
ioSnapshots: Record<string, IOMetricsSnapshot>;
```

**采样机制：**
- 用户在 `io_monitor` 页面点击「开始集群监控」后，系统向所有已扫描到的数据盘对应的 session 发送 `iostat -xd 1 {deviceBase}`
- 通过 `subscribeToSessionLines` 订阅每个 session 的行输出，按 `parseIostatLine` 解析
- 停止监控时发送 `\x03` (Ctrl+C) 终止所有 iostat 进程

### 3.5 数据不一致检测（增强）

```ts
type CheckType = 'crc' | 'lba_range' | 'metadata' | 'custom';

interface ConsistencyCheck {
  id: string;
  name: string;
  checkType: CheckType;
  nodeIds: string[];
  // 检测命令模板（将在各节点执行）
  cmdTemplate: string;
  params: Record<string, string>;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'error';
  result?: ConsistencyResult;
  triggeredAt: number;
  completedAt?: number;
  triggeredBy?: string; // 关联的业务执行 ID
}

interface ConsistencyResult {
  summary: string;
  // 不一致明细
  inconsistencies: InconsistencyItem[];
  // 各节点原始输出
  rawOutputs: Record<string, { stdout: string; stderr: string; exitCode: number }>;
}

interface InconsistencyItem {
  type: 'crc_mismatch' | 'lba_diverge' | 'metadata_diff' | 'custom';
  description: string;
  // 涉及节点
  nodeIds: string[];
  // 具体差异位置
  location?: string; // 如 "LBA 0x1A3F00"
  // 期望 vs 实际
  expected?: string;
  actual?: Record<string, string>; // nodeId -> value
}
```

**预置检测规则（内置 3 个）：**

| ID | 名称 | 类型 | cmdTemplate 示例 | 说明 |
|----|------|------|-----------------|------|
| `crc_check` | CRC 校验 | crc | `md5sum {{device}}` 或自定义校验工具 | 各节点同设备计算校验和，比对 |
| `lba_cmp` | LBA 范围比对 | lba_range | `dd if={{device}} bs={{bs}} skip={{skip}} count={{count}} | md5sum` | 指定 LBA 范围读取并比对 |
| `meta_cmp` | 元数据一致性 | metadata | `rbd info {{pool}}/{{image}} --format json` | Ceph RBD 元数据跨节点比对 |

---

## 4. UI 设计（各 Tab 布局）

### 4.1 `task` — 业务编排与下发

三栏布局（左中右）：

```
┌─────────────────┬──────────────────────────────┬─────────────────┐
│  模板列表       │      模板编辑器               │    执行面板     │
│  ─────────      │  ─────────────────────────    │  ─────────────  │
│  [+] 新建       │  模板名称: [____________]     │  目标节点:      │
│                 │  描述: [________________]     │  [x] node-01    │
│  ▶ 创建RBD卷   │                               │  [x] node-02    │
│  ▶ 挂载测试    │  步骤列表:                    │  [ ] node-03    │
│    步骤1: ...   │  ┌──────────────────────┐    │                 │
│    步骤2: ...   │  │ 1. 创建卷            │    │  变量填写:      │
│  ▶ 数据迁移    │  │    rbd create ...    │    │  pool: [____]   │
│                 │  │    [编辑] [删除] [↑] │    │  image: [___]   │
│                 │  ├──────────────────────┤    │  size: [____]   │
│                 │  │ 2. 映射设备          │    │                 │
│                 │  │    rbd map ...       │    │  [一键下发]     │
│                 │  │    [编辑] [删除] [↓] │    │                 │
│                 │  └──────────────────────┘    │  执行进度:      │
│                 │  [+ 添加步骤]                 │  node-01: ████  │
│                 │                               │  node-02: ███░  │
│                 │  变量定义:                    │                 │
│                 │  [+ 添加变量]                 │  实时输出:      │
│                 │                               │  [节点选择器]   │
│                 │                               │  [stdout 面板]  │
└─────────────────┴──────────────────────────────┴─────────────────┘
```

**交互细节：**
- 步骤编辑器（Modal）：命令输入框（TextArea）、目标节点选择器（Checkbox Group）、timeout 输入、captureVar 正则输入
- 变量编辑器（Inline）：name（英文标识）、label（中文显示）、defaultValue、required toggle、scope 单选（global/perNode）
- 执行面板中，perNode 变量对每个选中的节点显示独立的输入框
- 执行进度以节点为单位显示：每个节点一个进度条，绿色=完成，红色=失败，蓝色=运行中
- 点击节点进度条展开该节点的步骤明细（每个步骤的 exitCode、stdout/stderr、耗时）

### 4.2 `chaos` — 故障混沌注入

左右布局：

```
┌─────────────────────────────┬─────────────────────────────────────┐
│  故障库                      │  注入配置 + 执行历史                 │
│  ─────────────────           │  ─────────────────────────────────  │
│  [网络故障 ▼]                │  已选故障: 网络延迟                  │
│    ○ 网络延迟                 │  参数:                               │
│    ○ 网络丢包                 │    iface: [eth0____]                │
│  [磁盘故障 ▼]                │    delay: [100____] ms              │
│    ○ IO 卡顿                  │    duration: [60___] sec            │
│    ○ 磁盘只读                 │                                      │
│  [CPU/内存 ▼]                │  目标节点:                           │
│    ○ CPU 满载                 │  [x] node-01  [x] node-02           │
│  [进程 ▼]                    │  [ ] node-03                        │
│    ○ 进程 Kill                │                                      │
│                              │  [执行注入]  [立即恢复]               │
│  [+ 自定义故障]              │                                      │
│                              │  ── 注入历史 ──                      │
│                              │  #1 网络延迟 @ node-01,02  [已注入]  │
│                              │  #2 CPU 满载 @ node-03     [已恢复]  │
│                              │  #3 IO 卡顿 @ node-01      [失败]    │
└─────────────────────────────┴─────────────────────────────────────┘
```

**交互细节：**
- 故障卡片：显示名称、描述、类别标签（Tag）、参数列表
- 点击故障卡片自动填充右侧注入配置
- 自定义故障：Modal 编辑（名称、类别、cmdTemplate、参数定义、recoveryCmdTemplate）
- 注入历史列表每项显示：故障名、节点数、状态标签、注入时间
- 「立即恢复」按钮仅对 `injected` 状态的记录可用

### 4.3 `io_monitor` — IO 实时监控

上下布局：

```
┌─────────────────────────────────────────────────────────────────────┐
│  IO 聚合大盘                                        [开始监控] [停止]│
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ node-01  │ │ node-01  │ │ node-02  │ │ node-02  │  ...        │
│  │ /dev/sdb │ │ /dev/sdc │ │ /dev/sdb │ │ /dev/sdc │              │
│  │          │ │          │ │          │ │          │              │
│  │ BW: 120  │ │ BW: 85   │ │ BW: 110  │ │ BW: 0    │              │
│  │ IOPS: 3k │ │ IOPS: 2k │ │ IOPS: 3k │ │ IOPS: 0  │              │
│  │ Util: 78%│ │ Util: 45%│ │ Util: 82%│ │ Util: 0% │              │
│  │ ▓▓▓▓▓▓▓░ │ │ ▓▓▓▓▓░░░ │ │ ▓▓▓▓▓▓▓▓ │ │ ░░░░░░░░ │              │
│  │ fio-rw4k │ │ —        │ │ fio-rw4k │ │ —        │              │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
├─────────────────────────────────────────────────────────────────────┤
│  单盘详情（点击上方卡片进入）                                        │
│  [时序图表: %Util / r_await / w_await / Bandwidth]                  │
└─────────────────────────────────────────────────────────────────────┘
```

**交互细节：**
- 每张卡片是一个 Card 组件，显示节点名、磁盘名、4 个核心指标、利用率进度条（彩色：绿<60、黄60-80、红>80）
- 卡片下方显示当前活跃的 IO 模型（从 `tasks` 或 `businessExecutions` 关联）
- 点击卡片切换到「单盘详情」视图，复用现有的 echarts 时序图表
- 「开始监控」同时向所有已扫描 session 的所有数据盘发送 iostat
- 每张卡片右上角有「单独停止」按钮，可停止该盘的采样以节省带宽

### 4.4 `tracing` — 任务追踪与日志

上下布局：

```
┌─────────────────────────────────────────────────────────────────────┐
│  任务列表                              [刷新状态] [手动添加任务]      │
├─────────────────────────────────────────────────────────────────────┤
│  名称          节点        来源          状态        启动时间        │
│  fio-randwrite node-01    business#123  running     14:32:01       │
│  net-delay-5s  node-02    chaos#456     injected    14:35:22       │
│  OSD-restart   node-03    manual        completed   14:20:10       │
├─────────────────────────────────────────────────────────────────────┤
│  日志查看器 — fio-randwrite @ node-01                               │
│  ─────────────────────────────────────────────────────────────────  │
│  日志路径: [ /var/log/ceph/osd.log ▼ ]  [+ 添加路径]                │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ 2026-04-18 14:32:05  osd.1  starting backfill              │    │
│  │ 2026-04-18 14:32:06  osd.1  backfill 12% complete          │    │
│  │ 2026-04-18 14:32:07  osd.1  backfill 15% complete          │    │
│  │ ...（实时追加，类似终端体验）                               │    │
│  └────────────────────────────────────────────────────────────┘    │
│  [暂停滚动] [清空] [导出]                                           │
└─────────────────────────────────────────────────────────────────────┘
```

**交互细节：**
- 任务列表支持按来源、状态、节点筛选
- 点击任务行展开日志查看器
- 日志路径选择器：下拉显示该任务已配置的所有路径，支持动态添加新路径
- 添加路径时：输入绝对路径 → 选择 snapshot/stream 模式 → 立即开始抓取
- stream 模式下，日志区域实时追加新行，自动滚动到底部
- 暂停滚动按钮：冻结视图以便查看历史，新数据继续缓冲
- 任务状态自动刷新：每 5 秒轮询一次 PID 状态（如果有 PID）

### 4.5 `analysis` — 一致性检测与仲裁

上下布局：

```
┌─────────────────────────────────────────────────────────────────────┐
│  检测规则                          [新建检测] [手动触发全部]          │
├─────────────────────────────────────────────────────────────────────┤
│  规则名称        类型        目标节点       上次结果    操作        │
│  CRC全量校验     crc         node-01~03    pass        [执行] [编辑]│
│  LBA 0x1A3F比对  lba_range   node-01,02    fail        [执行] [编辑]│
├─────────────────────────────────────────────────────────────────────┤
│  检测报告 — CRC全量校验                                              │
│  ─────────────────────────────────────────────────────────────────  │
│  状态: ✅ 通过                                                       │
│  执行时间: 2026-04-18 14:40:00                                       │
│  各节点校验和:                                                       │
│    node-01: a1b2c3d4...                                              │
│    node-02: a1b2c3d4...                                              │
│    node-03: a1b2c3d4...                                              │
│  ─────────────────────────────────────────────────────────────────  │
│  检测报告 — LBA 0x1A3F比对                                           │
│  状态: ❌ 失败 — 发现 3 处不一致                                     │
│  不一致明细:                                                         │
│    LBA 0x1A3F00: 期望 aa, node-01=aa, node-02=bb                    │
│    LBA 0x1A3F04: 期望 cc, node-01=cc, node-02=dd                    │
│    LBA 0x1A3F08: 期望 ee, node-01=ee, node-02=ff                    │
│  关联业务执行: business#123 (2026-04-18 14:32:01)                   │
└─────────────────────────────────────────────────────────────────────┘
```

**交互细节：**
- 检测规则列表：支持增删改查，内置规则不可删除
- 新建/编辑检测：Modal 表单（名称、类型、命令模板、参数、目标节点选择）
- 执行检测：向每个目标节点并发下发检测命令，等待全部返回后比对结果
- 比对逻辑按类型不同：
  - `crc`：比较各节点 stdout 的哈希值，不一致则标记
  - `lba_range`：比较各节点 stdout 的哈希值或逐字节输出
  - `metadata`：解析 JSON 后逐字段比较
  - `custom`：由用户自定义判断逻辑（通过正则从 stdout 提取值后比较）
- 失败报告中的不一致项可点击「定位」跳转到 `tracing` 页面查看关联任务的日志

---

## 5. 状态管理架构

复用 `benchmarkStore`（Zustand + persist），新增以下状态切片：

```ts
interface BenchmarkStore {
  // 现有状态（保持）
  agents: AgentStatus[];
  tasks: BenchmarkTask[];
  savedModels: IOModelConfig[];
  discoveredNodes: Record<string, NodeDisks>;
  isScanning: boolean;
  agentMappings: AgentMapping[];

  // 新增：业务编排
  businessTemplates: BusinessTemplate[];
  businessExecutions: BusinessExecution[];
  addBusinessTemplate: (t: Omit<BusinessTemplate, 'id' | 'createdAt'>) => void;
  removeBusinessTemplate: (id: string) => void;
  updateBusinessTemplate: (id: string, t: Partial<BusinessTemplate>) => void;
  startBusinessExecution: (templateId: string, nodeIds: string[], varValues: BusinessExecution['varValues']) => Promise<string>;
  // 执行器内部方法（不暴露为 action，作为 store 内部逻辑）

  // 新增：故障混沌
  chaosFaults: ChaosFault[];
  chaosInjections: ChaosInjection[];
  addChaosFault: (f: Omit<ChaosFault, 'id'>) => void;
  removeChaosFault: (id: string) => void;
  injectChaos: (faultId: string, nodeIds: string[], params: Record<string, string>, durationSec: number) => Promise<string>;
  recoverChaos: (injectionId: string) => Promise<void>;

  // 新增：任务追踪
  tracedTasks: TracedTask[];
  addTracedTask: (t: Omit<TracedTask, 'id'>) => void;
  updateTaskStatus: (taskId: string, status: TracedTask['status']) => void;
  removeTracedTask: (id: string) => void;
  appendLogBuffer: (taskId: string, pathId: string, lines: string[]) => void;

  // 新增：IO 监控（聚合）
  ioSnapshots: Record<string, IOMetricsSnapshot>;
  updateIOSnapshot: (key: string, metrics: IostatMetrics) => void;
  clearIOSnapshots: () => void;

  // 新增：一致性检测
  consistencyChecks: ConsistencyCheck[];
  addConsistencyCheck: (c: Omit<ConsistencyCheck, 'id' | 'triggeredAt'>) => void;
  runConsistencyCheck: (checkId: string) => Promise<void>;
  removeConsistencyCheck: (id: string) => void;
}
```

**持久化策略（partialize）：**
- `persist` 中持久化：businessTemplates、chaosFaults、consistencyChecks（用户配置）
- 不持久化（运行时状态）：businessExecutions、chaosInjections、tracedTasks、ioSnapshots（这些可从运行时重建或只是临时状态）

---

## 6. 执行引擎设计

### 6.1 业务模板执行引擎

**执行流程：**

```
startBusinessExecution(templateId, nodeIds, varValues)
  ↓
生成 executionId
  ↓
按步骤顺序执行（for step of template.steps）：
  1. 命令替换：
     - {{var}} → varValues.global[var] 或 varValues.perNode[nodeId][var]
     - $capture.x → sharedVars[x]
     - $node.name / $node.ip → 从 SSH session 获取
  2. 确定目标节点：
     - step.target === 'all' → 所有 nodeIds
     - step.target === ['node-01'] → 仅指定节点
  3. 向每个目标节点并发发送 execCommandOnSession
  4. 等待所有节点返回（如果 step.blocking === true）
  5. 处理结果：
     - exitCode !== 0 → 标记该节点步骤失败，继续执行下一步（或根据策略中止）
     - captureVar 存在 → 用正则从 stdout 提取，写入 sharedVars
  6. 更新 execution 状态到 store
  ↓
所有步骤完成 → 标记 execution 状态为 done / partial_fail / fail
```

**关键约束：**
- 步骤间串行（必须等上一步所有目标节点完成才能进入下一步），因为步骤可能依赖上一步的 `captureVar`
- 同一步骤内，各节点并发执行
- 失败策略：默认「继续执行」（记录失败但继续后续步骤），后续可在 UI 中配置为「遇到失败即中止」

### 6.2 故障注入引擎

**注入流程：**

```
injectChaos(faultId, nodeIds, params, durationSec)
  ↓
生成 injectionId
  ↓
替换 recoveryCmdTemplate 中的 {{param}} → params
  ↓
如果 recoveryCmdTemplate 存在：
  - 先将 recovery 命令通过 nohup + sleep 包装为后台延时恢复任务：
    `nohup bash -c 'sleep {{durationSec}} && {{recoveryCmd}}' > /tmp/chaos_recovery_{{injectionId}}.log 2>&1 &`
  - 将延时恢复命令与注入命令一起发送到每个节点
- 向每个目标节点并发发送注入命令（execCommandOnSession）
  ↓
标记状态为 injected，记录 injectedAt
```

**恢复流程：**

```
recoverChaos(injectionId)
  ↓
查找对应的 injection
  ↓
向每个目标节点发送 recoveryCmdTemplate（参数复用注入时的 paramValues）
  ↓
标记状态为 recovered，记录 recoveredAt
```

### 6.3 后台任务状态轮询引擎

**轮询机制（由 `tracing` Tab 组件的 useEffect 驱动）：**

```
useEffect(() => {
  const timer = setInterval(async () => {
    for (const task of runningTasks) {
      if (!task.pid) continue;
      const res = await execCommandOnSession(task.nodeId, `ps -p ${task.pid} > /dev/null; echo $?`, 5000);
      const isRunning = res.stdout.trim() === '0';
      if (!isRunning) {
        updateTaskStatus(task.id, 'completed');
        // 同时停止该任务所有 stream 模式的日志订阅
      }
    }
  }, 5000);
  return () => clearInterval(timer);
}, [runningTasks]);
```

### 6.4 日志实时抓取引擎

**stream 模式：**

```
添加日志路径 /var/log/ceph/osd.log → stream 模式
  ↓
向对应 node 发送命令：`tail -n 100 -F /var/log/ceph/osd.log`
  ↓
通过 sendInputToSession 写入 shell（注意：不能用 exec 通道，因为 tail -f 是持续输出）
  ↓
subscribeToSessionLines(nodeId, lineHandler)
  ↓
lineHandler 中过滤属于该 tail 进程的行，追加到对应 task 的 logBuffer
  ↓
停止时：发送 `\x03` (Ctrl+C) 到该 session，或发送 `pkill -f "tail -n 100 -F /var/log/ceph/osd.log"`
```

**注意：** 由于多个 tail 进程可能在同一个 session 中运行，需要在行输出中通过行内容特征区分（如不同日志文件的前缀不同），或在不同 PTY 中运行。更简洁的方案：每个 session 同时只支持一个 stream 模式的日志订阅，或改用 exec 通道的 `tail -n 500` 做 snapshot 刷新。

**实际实现选择：**
- snapshot 模式：`execCommandOnSession(nodeId, 'tail -n 200 /path/to/log')`，一次读取最近 200 行
- stream 模式：使用独立的 exec 通道（如果后端支持长连接 exec），或在 shell PTY 中运行 tail，通过 unsubscribe 回调中的 `pkill` 终止。考虑到当前架构基于 WebSocket PTY，stream 模式需要在 shell 中运行，停止时发送 Ctrl+C。

---

## 7. 组件拆分

### 7.1 新增组件

| 组件路径 | 职责 |
|----------|------|
| `components/BusinessTemplateEditor.tsx` | 业务模板三栏编辑器（模板列表 + 步骤/变量编辑 + 执行面板） |
| `components/BusinessStepModal.tsx` | 步骤编辑 Modal（命令、目标、timeout、captureVar） |
| `components/BusinessExecutionPanel.tsx` | 执行面板（节点选择、变量填写、进度、输出） |
| `components/ChaosFaultLibrary.tsx` | 故障库分类展示 + 选择 |
| `components/ChaosInjectionPanel.tsx` | 注入配置 + 执行历史 |
| `components/ChaosFaultModal.tsx` | 自定义故障编辑 Modal |
| `components/IOMonitorGrid.tsx` | IO 聚合大盘卡片网格 |
| `components/IOMonitorDetail.tsx` | 单盘时序图表详情 |
| `components/TracingTaskList.tsx` | 任务列表（筛选、状态刷新） |
| `components/TracingLogViewer.tsx` | 日志查看器（路径选择、实时追加、暂停/清空/导出） |
| `components/AnalysisCheckList.tsx` | 检测规则列表 |
| `components/AnalysisReportPanel.tsx` | 检测报告展示（成功/失败详情） |
| `components/AnalysisCheckModal.tsx` | 新建/编辑检测规则 Modal |

### 7.2 改造组件

| 组件 | 改造内容 |
|------|----------|
| `TaskDispatcher.tsx` | 完全替换为 `BusinessTemplateEditor` 的封装 |
| `MetricsDashboard.tsx` | 增强为 `AnalysisCheckList` + `AnalysisReportPanel` 的组合 |
| `DiskMetricsDashboard.tsx` | 提取图表逻辑到 `IOMonitorDetail`，自身改为 `IOMonitorGrid` + `IOMonitorDetail` 的组合 |
| `index.tsx` | Tab 定义中新增 `chaos`、`tracing`，改造 `task`、`dash` → `analysis`、`io_monitor` |

---

## 8. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 后端依赖 | 复用 SSH Proxy (3001)，不新增 benchmark 后端 | 降低部署复杂度，运维场景下工程师本地只需一个 Node 进程 |
| 后台任务保活 | `nohup` + PID 轮询 | 最简单可靠，不依赖远程 agent 持续上报 |
| 日志 stream | shell PTY + `tail -f` + `subscribeToSessionLines` | 复用现有基础设施，每个 session 一个 WebSocket |
| 业务步骤失败策略 | 默认继续，记录失败 | 分布式场景下部分节点失败是常态，不应阻塞其他节点 |
| IO 采样频率 | 1 秒（iostat -xd 1） | 足够实时，120 点缓存 = 2 分钟窗口 |
| 状态持久化 | Zustand persist 只存配置，不存运行时 | 运行时状态在刷新后重建即可 |
| 变量作用域 | global + perNode 两级 | 覆盖大多数场景：全局参数（如 pool）+ 节点差异参数（如 device） |

---

## 9. 边界与异常处理

- **SSH 断连**：任务执行中如果 SSH 断开，该节点步骤标记为 `fail`，其他节点继续。`tracedTasks` 中该任务状态降级为 `unknown`。
- **命令超时**：`execCommandOnSession` 的 timeout 机制已存在，超时时返回 `{ stdout, stderr: '[TIMEOUT]', exitCode: -1 }`。
- **变量未定义**：命令替换时如果变量找不到，保留原 `{{var}}` 文本并在执行前校验，提示用户补全。
- **同一节点多盘 iostat**：同时启动多个 `iostat -xd 1 {device}` 进程，每个设备独立解析，互不干扰。
- **故障注入后节点失联**：注入网络故障后可能无法 SSH 连接。这种情况在 UI 中标记节点为「不可达」，故障恢复需通过带外管理（如 IPMI）或等待自动恢复命令的延时执行（如果配置了 recovery）。

---

## 10. 测试策略

- **单元测试**：命令模板替换逻辑（`replaceTemplateVars`）、iostat 行解析（`parseIostatLine`）、一致性比对逻辑
- **集成测试**：业务模板完整执行流（mock execCommandOnSession）、故障注入/恢复流
- **手动验证**：
  1. 创建业务模板（3 步骤）→ 选择 2 节点 → 下发 → 验证各节点步骤输出
  2. 注入网络延迟 → 验证 tc 规则存在 → 点击恢复 → 验证规则清除
  3. 启动 IO 监控 → 验证所有盘卡片有数据 → 点击单盘 → 验证图表
  4. 添加日志路径 stream 模式 → 验证实时追加 → 暂停 → 验证停止滚动
  5. 执行 CRC 检测 → 手动制造不一致 → 验证报告正确显示差异
