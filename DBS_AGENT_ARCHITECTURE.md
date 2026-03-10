# DevUtility Hub - DBS & Agent Toolset Documentation

本指南汇集了 DevUtility Hub 针对**分布式块存储 (Distributed Block Storage, DBS)** 及 **AI Agent 远程操控** 所开发的所有高级工具与核心 API 架构实现。

---

## 目录
1. [Phase 6: DBS 核心分析工具](#phase-6-dbs-核心分析工具)
2. [Phase 7: 高级协议与混沌工程工具](#phase-7-高级协议与混沌工程工具)
3. [Phase 8: Agent Remote Execution API (MCP 基础)](#phase-8-agent-remote-execution-api-mcp-基础)

---

## Phase 6: DBS 核心分析工具

我们在左侧全局导航（Sidebar）中集成了多款直击底层存储与 C++ 开发痛点的诊断面板，皆使用 React `Lazy + Suspense` 懒加载架构保证主应用性能。

### 1. 终端正则智能着色 (DBS Highlighter)
*   **功能**：在 SOP 的终端回显页面以及 Journal 日志聚合屏中，针对裸盘设备路径 (`/dev/vdX`)、IOPS、延迟抖动 (`min/max/avg`)、GDB 严重错误 (`SIGSEGV`)、内存指针和网络 IP 进行动态正则染色。
*   **实现细节**:
    *   构建了 `src/utils/dbsHighlighter.tsx`，将纯文本切割并包裹带颜色的 `<span>` 标签。
    *   支持解析格式广泛的内核 `dmesg` 输出与高频度压测输出，提升大段枯燥文本的信噪比。

### 2. Hex / LBA 绝对偏移探测器 (Hex & LBA Explorer)
*   **功能**：输入块设备任意裸偏移量（如 Byte Offset: `134217728`），实时算出它是第几个 4K 扇区 (Sector)、处于哪个 1MB Extent 上，或者 Stripe 对应关系。
*   **沙盒比对 (Diff)**：左右双屏上传主节点与备节点的 `hexdump` 纯文本，自动 Diff 出静默数据损坏 (Silent Corruption / Torn Write) 所在的精确偏移量。

### 3. GDB Core Dump 重栈折叠合并器 (Crash Analyzer)
*   **功能**：对死锁 (Deadlock) 等 C++ 事故产生的庞大 `thread apply all bt` 文本进行指纹提取和拓扑压缩。
*   **实现细节**:
    *   正则表达式 `^Thread (\d+) \(Thread (\w+) .*?\):\s*(.*)` 剥离每行堆栈的栈帧和函数名。
    *   忽略内存地址变化，对调用链函数进行提取并做 `hash(stackTraces)`，将 80 个因锁住 `pthread_cond_wait` 的同质线程合并为一个分组展示（[80 Threads] -> epoll_wait()），让根因函数一览无遗。

### 4. FIO 压测可视化与 P99 抖动提取 (FIO Visualizer)
*   **功能**：上传原生文本日志，自动抽取存储系统的性能墙曲线。
*   **实现细节**:
    *   深度引入 `Echarts`，通过正则提取 `read: IOPS=\d+k, BW=\d+MiB/s`。
    *   采用双轴（普通柱状图展示 IOPS + `log` 对数轴展示 p99, p99.9 尾刺延迟），极大减少分析时间。

### 5. 流式数据一致性双轨校验机 (Integrity Hash Verifier)
*   **功能**：除原有单纯的 MD5 以外，补全了存储底层常用的 **IEEE CRC-32 (CRC32c)** 裸数据校验。
*   **实现细节**: 
    *   前端使用 `FileReader.readAsArrayBuffer`，分块（Chunked）读取大文件。配合 `spark-md5` 与 `crc-32` npm 包实现浏览器端的高效 Hashing，保护数据不上云。

---

## Phase 7: 高级协议与混沌工程工具

针对底层驱动调试、脑裂因果分析以及容灾健壮性测试追加的 3 把“极客尖刀”。

### 6. 协议裸码解码器 (Protocol Decoder: SCSI CDB & NVMe SQE)
*   **功能**：复制 10/16 字节的 SCSI 寄存器纯 HEX 或 64 字节 NVMe SQE 数组，瞬间译码出底层指令字段。
*   **实现细节 (Bitwise Parsing)**:
    *   纯前端组件 `src/modules/ProtocolDecoder`。
    *   根据 HEX 数组长度进行 Switch 判断：
        *   **10/16 Bytes**: 提取首字节 `SCSI_OPCODES` (如 0x2A Write)，按大端序 (`BE16/32/64`) 二进制移位提取 `LBA` 和 `Transfer Length`。
        *   **64 Bytes**: 按照 NVMe 小端序 (`LE32/64`) 读取 Dword 0~15，瞬间提取出 `FUSE/PSDT`、`NSID`、起始扇区 `SLBA` 以及重要的内存页物理指针 `PRP1/PRP2`。

### 7. 多节点分布式日志时序对齐器 (Distributed Timeline Correlator)
*   **功能**：让用户贴入 2-5 台不同物理机/节点（Node-A, Node-B）的长篇幅漂移文本日志。引擎通过全局聚合，洞察分布式脑裂情况下的包序列交织与双写冲突。
*   **实现细节 (Merge Sort & Virtualization)**:
    *   内置 3 种强大 Regex 匹配引擎，兼容标准 RFC3339 及 glog (`MMDD HH:mm:ss`) 时钟。强制将各行提取并转换为 JS Epoch Time (`Date.parse`)。
    *   将 N 个节点的数组进行时间戳比较排序 (`a.timestamp - b.timestamp`) 融合。
    *   使用固定高度+滚轮的 DOM 截断（或 React Slice）防止几万行 DOM 渲染直接假死。行前标明 `[Node-A]` 等不同 Color 着色属性。

### 8. 故障注入快捷生成器 (Chaos / Fault Injection Builder)
*   **功能**：内置了安全、标准的 Linux 高危混沌工程 (Chaos Engineering) 故障预案模版表单，一键产出含“故障注入指令”及“现场恢复指令”的 Bash 脚本。
*   **内置字典涵盖的实现场景**:
    *   **Network (网络层面)**：使用 Linux 内核 `tc qdisc netem` 模拟网络极高长尾的高延迟 (Delay/Jitter) 及百分比随机丢包。使用 `iptables` 规则阻断目标 IP 模拟分块网络脑裂 (Partition)。
    *   **Block (存储块接口)**：修改 `/sys/block/<dev>/device/state` 将设备强行热插拔置于 `offline` 使读写进程进入僵死抢救态 (Disk Hang)。利用 `dd if=/dev/urandom ... conv=notrunc` 直接越过文件系统破坏裸位移扇区进行静默数据损坏 (Silent Corruption)。
    *   **OS/Resource (资源榨取)**：生成无限 `while` 的 CPU 烧机脚本 (Burn CPU) 与通过挂载 `tmpfs` 创建庞大 `dev/zero` 填充物的 OOM Killer 强触发器。

---

## Phase 8: Agent Remote Execution API (MCP 基础)

大语言模型（如 Claude Desktop / Cursor Agent）身处云端没有任何内网执行权限，也无法打破 NAT。我们在已有的本地 Node.js `SSH Proxy` 架构之上，实现了一层让 Agent 介入控制（借刀杀人）的通信网关。

### 接口规范: `POST /api/agent/execute`

*   **执行与响应方式 (`Synchronous Output Capture`)**:
    *   基于 `async/await`。HTTP POST 请求从发起后会一直挂起 (Blocked)。
    *   后端的 `server/index.js` 使用 `session.enqueueShellCmd` 向底层维持着的持久化 SSH PTy (伪终端) 发单。它不仅能保证与前端 UI 的指令无冲突排队执行，还能**维系 sudo、cd 之后的环境变量和路径上下文**。
    *   执行完毕时捕获 `exitCode`，并将控制台成百上千行的纯粹 Standard Output (剥离 ANSI 的结果) 打包进 JSON `{"ok":true, "result": {"stdout": "..."}}` 响应给 AI 模型去分析断言。

### 安全控制与黑名单防御 (Security & Blacklist)

为预防 AI 在进行故障排查 (Troubleshooting) 时“胡言乱语”，直接清空服务器，我们在 API 顶层埋设了正则拦截网 (`AGENT_COMMAND_BLACKLIST`)：
*   **直接阻截执行 (`HTTP 403 Forbidden`)**:
    包含但不仅限于：
    `rm -rf`
    `mkfs`（重做文件系统）
    `dd if=`（复写磁盘或 Master Boot Record）
    `reboot` / `shutdown` / `init 0`
    以及类 `:(){ :|:& };:` (Bash Fork Bomb 逻辑炸弹)。

### 审计日志留痕 (Local Audit File Trail)
*   不论靶机上的命令是成功还是失败（Exit!=0 或是被黑名单打回），本地代理一律会在操作系统临时目录 (Mac: `os.tmpdir()`) 中生成追踪尾迹文件 `agent-execution-audit.log`。
*   文件内格式包裹有精确的指令下发墙上时间、所用用户名与主机信息 (Session)、执行的 RAW 命令参数与耗时，供后续研发同学追溯大模型行为边界。
