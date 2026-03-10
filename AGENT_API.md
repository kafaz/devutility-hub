# DevUtility Agent & MCP API Documentation

The DevUtility Hub server exposes HTTP API endpoints allowing external autonomous AI Agents (such as Claude Desktop via MCP, or remote workflow systems) to discover connected nodes and execute bash commands without user intervention.

Since DevUtility Hub persists active SSH terminal (PTY) contexts, commands executed via these endpoints carry over environmental states (e.g. `sudo su`, `cd /var/log`, `source .env`) perfectly.

## Server Configuration
By default, the proxy server exposes its HTTP routes at `http://127.0.0.1:3001`.
If you are running the Agent remotely, you must tunnel this port using a tool like `ngrok` or `cloudflared`.

---

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
  "error": "Session 不存在或已断开连接"   // Session does not exist or disconnected
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

---

## Technical Details for Agent Implementation

1. **Statefulness:** Because commands share the exact same active Shell as the user interface, the Agent should avoid using highly destructive looping operations that cannot be killed. Calling interactive commands like `vim`, `top` or `nano` without a specific limit will lock the session until `timeout` crashes it out.
2. **Standard Practice:** If you need to observe ongoing metrics, use commands like `ps aux` instead of `top`, or `cat filename` instead of `less`.
3. **Execution Queues:** Commands are funneled through an atomic FIFO queue. If the user is currently running a heavy SOP plan, the Agent's command requested will wait patiently until the shell becomes free again.
