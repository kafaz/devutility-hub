# SSH Agent Proxy — 测试流程

## 前提条件

| 条件 | Windows | Linux / macOS |
|------|---------|---------------|
| SSH 密钥已生成 | `ssh-keygen` | `ssh-keygen` |
| 密钥已添加到 Agent | 见下方说明 | `ssh-add ~/.ssh/id_rsa` |
| Agent 服务运行中 | 见下方说明 | `eval $(ssh-agent)` |
| 目标服务器已授权密钥 | `authorized_keys` 文件包含公钥 | 同左 |

---

## Windows：启用 OpenSSH Authentication Agent

```powershell
# 以管理员身份运行 PowerShell

# 1. 启动 OpenSSH Agent 服务
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent

# 2. 添加私钥
ssh-add C:\Users\你的用户名\.ssh\id_rsa

# 3. 验证密钥已加载
ssh-add -l
# 应输出密钥指纹，例如：2048 SHA256:xxx... /path/to/key (RSA)
```

## Windows：使用 Pageant（XShell 默认使用）

```
1. 启动 Pageant.exe（随 PuTTY / XShell 附带）
2. 右键任务栏 Pageant 图标 → Add Key → 选择 .ppk 密钥文件
3. 若私钥是 OpenSSH 格式（id_rsa），需用 PuTTYgen 转换为 .ppk
```

---

## 启动代理服务

```bash
cd devutility-hub/server
npm install      # 首次运行需安装依赖
node index.js    # 启动代理
```

成功输出：
```
╔══════════════════════════════════════════════╗
║      DevUtility Hub - SSH Agent Proxy        ║
║  HTTP : http://127.0.0.1:3001                ║
║  WS   : ws://127.0.0.1:3001/terminal         ║
╚══════════════════════════════════════════════╝
```

---

## 测试步骤

### Step 1：验证代理服务可用

```bash
curl http://127.0.0.1:3001/api/health
# 期望：{"ok":true,"platform":"win32",...}

curl http://127.0.0.1:3001/api/agents
# 期望：{"agents":[{"id":"openssh-win",...},{"id":"pageant",...}]}
```

### Step 2：打开前端

```bash
cd devutility-hub
npm run dev
```
浏览器访问 `http://localhost:5173`，点击左侧「SSH Manager」

### Step 3：填写连接信息

| 字段 | 示例值 |
|------|--------|
| 主机地址 | 192.168.1.100 |
| 用户名 | root |
| 端口 | 22 |
| SSH Agent | Windows OpenSSH Agent 或 Pageant |

点击「连接」

### Step 4：验证终端可用

终端出现 Shell Prompt（如 `root@server:~#`）后：
1. 直接在终端输入 `whoami` 回车 → 应显示用户名
2. 输入 `ls /tmp` → 应列出文件

### Step 5：验证 exec 通道

点击左侧快速命令按钮（`whoami`、`hostname`、`uptime` 等）：
- 状态栏显示「✅ 命令执行成功（Xms）」
- 切换到「执行历史」Tab 查看输出详情

### Step 6：验证自定义命令

在自定义命令输入框输入：
```bash
ps aux | grep sshd | head -5
```
按 Enter，查看执行历史中的输出。

---

## 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| 代理服务启动失败 | Node.js 未安装 | `node -v` 检查，需 v18+ |
| agents 列表为空（Linux） | SSH_AUTH_SOCK 未设置 | `eval $(ssh-agent) && ssh-add ~/.ssh/id_rsa` |
| 连接超时 | Agent 无密钥 | `ssh-add -l` 确认密钥已加载 |
| Permission denied | 目标服务器无公钥 | `ssh-copy-id user@host` 复制公钥 |
| Pageant not available | Pageant 未运行 | 启动 Pageant 并加载密钥 |
| ENOENT pipe | OpenSSH Agent 服务未启动 | 参考上方 PowerShell 命令启动服务 |
