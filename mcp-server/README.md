# DevUtility Hub MCP Server

This server exposes the local DevUtility Hub diagnosis APIs as MCP tools over `stdio`.

## Agent Entry Contract

Agents should treat this MCP server as the supported access path for DevUtility Hub SSH diagnosis. Before using these tools, load the repository skill at:

```text
skills/devutility-agent-diagnosis/SKILL.md
```

The skill defines the safe operating sequence, command whitelist behavior, and when to stop for user collaboration. Do not bypass this MCP layer with direct `ssh` from the local shell unless the user explicitly asks for manual SSH outside DevUtility Hub.

## Prerequisites

1. Start the DevUtility Hub proxy service:

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub/server
npm install
node index.js
```

2. Build the MCP server:

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub/mcp-server
npm install
npm run build
```

## Start

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub/mcp-server
npm start
```

Optional environment variable:

```bash
export DEVUTILITY_AGENT_BASE_URL=http://127.0.0.1:3001
```

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
- `list_prepare_profiles`
- `save_prepare_profile`
- `delete_prepare_profile`
- `update_prepare_profile`
- `get_command_policy`
- `validate_command`
- `replace_command_policy`
- `allow_command`
- `remove_allowed_command`
- `reset_command_policy`
- `open_session` (supports node/direct mode and preset auto-login mode)
- `troubleshoot`
- `list_diagnostic_runs`
- `get_diagnostic_run`
- `recall_similar_runs`
- `list_sessions`
- `get_session`
- `prepare_session`
- `run_command`
- `get_session_logs`
- `close_session`


### `open_session` Modes

`open_session` now supports two connection modes:

1. **node/direct mode** (default):
   - Provide `nodeId`, `connection` (+ optional `auth` / `jumpAuth`), or direct top-level `host` / `username` / `password`
   - MCP forwards request to `POST /api/agent/sessions/open`
2. **preset mode**:
   - Provide `presetId` (optional `sessionId`)
   - MCP forwards request to `POST /api/agent/connect`
   - Suitable for Agent auto-login with preconfigured credentials only

Example preset mode payload:

```json
{
  "presetId": "prod-root-key"
}
```

Example request file: `examples/open_session_preset.request.json`

Example direct password payload:

```json
{
  "host": "192.168.1.10",
  "username": "root",
  "password": "replace-me"
}
```

### `troubleshoot`

`troubleshoot` wraps `POST /api/agent/troubleshoot` and supports:

- reuse an existing `sessionId`
- auto-connect by `presetId`
- direct top-level `host` / `username` / `password`
- MCP tool default behavior keeps the session alive unless you explicitly set `keepSession=false` or `autoDisconnect=true`

Minimal example:

```json
{
  "presetId": "prod-root-key",
  "title": "order api timeout",
  "symptom": "some requests return 502",
  "collectionPlan": [
    { "name": "process", "cmd": "ps aux | grep order-service | grep -v grep" }
  ]
}
```

Example request file: `examples/troubleshoot_minimal.request.json`

### Knowledge Base Tools

Use these tools when you want the agent to incorporate historical cases into the investigation loop:

- `list_diagnostic_runs`: list recent archived runs
- `get_diagnostic_run`: inspect one archived run in detail
- `recall_similar_runs`: retrieve similar cases before or during troubleshooting

### Configuration Plane Tools

The MCP server also exposes read and write tools for the configuration plane:

- login presets: `list_login_presets`, `save_login_preset`, `delete_login_preset`
- nodes: `list_nodes`, `resolve_node`, `save_node`, `update_node`, `delete_node`
- prepare profiles: `list_prepare_profiles`, `save_prepare_profile`, `update_prepare_profile`, `delete_prepare_profile`
- command policy: `get_command_policy`, `validate_command`, `replace_command_policy`, `allow_command`, `remove_allowed_command`, `reset_command_policy`
- ssh agents: `list_ssh_agents`

This means an agent can now bootstrap its own login preset or node definition before opening a session, instead of depending on manual pre-configuration.

For normal diagnosis, prefer the execution-plane flow and treat configuration-plane tools as explicit administration actions. Use `validate_command` before `run_command` for commands that contain shell operators, user-supplied paths, uncommon binaries, SQL, or curl options. If validation returns `allowed=false`, stop and report the blocked reason instead of widening the whitelist automatically.

### Target Assertion

Agent-facing execution tools require a `target` assertion so a command cannot be queued into the wrong active SSH session.

Use the target identity returned by `open_session` or `get_session`:

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

`prepare_session`, `run_command`, and `troubleshoot` send `requireTarget=true` through the MCP adapter. If the assertion does not match the current session, the service returns `targetGuard.ok=false` with HTTP `409`, and the command is not written to the SSH PTY.
The assertion must include at least `nodeId` or `host`; `username` and `port` alone are not accepted because they do not identify a node.

### `validate_command`

Preflight a command against the service-side whitelist without running it.

```json
{
  "cmd": "tail -n 200 /var/log/myapp/error.log",
  "context": "mcp-preflight"
}
```

The response includes `allowed`, `reason`, `blockedRuleId`, `segments`, and `baseCommands` so an Agent can decide whether to proceed, pick a safer probe, or ask the user to approve a policy change.

## `get_session_logs`

Query recent in-memory logs for a given session.

This is useful when you need to inspect what the Agent executed and what output came back (stdout/stderr snapshots) without parsing full run history.

Example input:

```json
{
  "sessionId": "agent_xxx",
  "limit": 80
}
```


## Generic MCP Client Configuration

Use the built output as a local stdio MCP server.

Example command:

```bash
node /Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/dist/index.js
```

Example environment:

```json
{
  "DEVUTILITY_AGENT_BASE_URL": "http://127.0.0.1:3001"
}
```

Codex example:

```toml
[mcp_servers.devutility-hub-agent]
command = "node"
args = ["/Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/dist/index.js"]

[mcp_servers.devutility-hub-agent.env]
DEVUTILITY_AGENT_BASE_URL = "http://127.0.0.1:3001"
```

Claude Desktop example:

```json
{
  "mcpServers": {
    "devutility-hub-agent": {
      "command": "node",
      "args": [
        "/Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/dist/index.js"
      ],
      "env": {
        "DEVUTILITY_AGENT_BASE_URL": "http://127.0.0.1:3001"
      }
    }
  }
}
```

## Expected Flow

1. `health_check`
2. `list_ssh_agents` / `list_login_presets` / `list_nodes`
3. If needed: `save_login_preset` / `save_node` / `save_prepare_profile`
4. `get_command_policy`
5. `open_session` or `troubleshoot`
6. `recall_similar_runs`
7. `prepare_session` with target assertion
8. `validate_command` when the command is not trivially known-good
9. `run_command` or `troubleshoot` with target assertion
10. `get_session_logs` / `get_diagnostic_run` / `list_diagnostic_runs`
11. `list_sessions` / `get_session` to inspect the live session identity when needed
12. `close_session`

For per-tool parameter details, example payloads, and the two supported tool-orderings (Fast First Pass and Interactive Drill-Down), see `skills/devutility-agent-diagnosis/references/mcp-tools.md`.
