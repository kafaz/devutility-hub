# DevUtility Hub MCP Server

This stdio MCP server exposes the local DevUtility Hub SSH gateway to Agent clients.

## Prerequisites

Start the local SSH gateway:

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub
npm install
npm run dev
```

Or start only the HTTP/WebSocket gateway:

```bash
npm --prefix server install
npm --prefix server start
```

Build the MCP adapter:

```bash
npm --prefix mcp-server install
npm --prefix mcp-server run build
```

## Start

```bash
node /Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/dist/index.js
```

Optional environment variable:

```bash
export DEVUTILITY_AGENT_BASE_URL=http://127.0.0.1:3001
```

If `DEVUTILITY_AGENT_BASE_URL` is not set, the adapter reads `.runtime-port` when present and otherwise falls back to `http://127.0.0.1:3001`.

## Exposed Tools

- `health_check`
- `list_ssh_agents`
- `list_login_presets`
- `save_login_preset`
- `delete_login_preset`
- `list_nodes`
- `save_node`
- `delete_node`
- `update_node`
- `resolve_node`
- `save_prepare_profile`
- `delete_prepare_profile`
- `update_prepare_profile`
- `list_prepare_profiles`
- `get_command_policy`
- `validate_command`
- `replace_command_policy`
- `allow_command`
- `remove_allowed_command`
- `reset_command_policy`
- `open_session`
- `list_sessions`
- `get_session`
- `get_session_logs`
- `prepare_session`
- `run_command`
- `run_commands_batch`
- `close_session`

## Recommended Agent Flow

1. `health_check`
2. `list_nodes` or `resolve_node`
3. `open_session`
4. `list_prepare_profiles` and `prepare_session`
5. `validate_command`
6. `run_command` or `run_commands_batch`
7. `get_session_logs`
8. `close_session`

## Target Assertion

Execution tools require a `target` assertion so a command cannot be queued into the wrong active SSH session.

```json
{
  "sessionId": "agent_xxx",
  "target": {
    "nodeId": "node-prod-db-01",
    "host": "10.0.0.11",
    "port": 22,
    "username": "root"
  },
  "cmd": "tail -n 200 /var/log/myapp/error.log",
  "timeoutMs": 15000,
  "mode": "pty"
}
```

The assertion must include at least `nodeId` or `host`; `username` and `port` alone are not accepted because they do not identify a node.

## Command Policy

Use `validate_command` before `run_command` for commands that contain shell operators, user-supplied paths, uncommon binaries, SQL, or curl options. If validation returns `allowed=false`, stop and report the blocked reason instead of widening the whitelist automatically.

Configuration write tools such as `save_node`, `save_prepare_profile`, and command-policy mutation tools are administration actions. Do not call them during normal remote investigation unless the user explicitly asks to change local configuration.
