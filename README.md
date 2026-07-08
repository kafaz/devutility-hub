# DevUtility Hub SSH/MCP Gateway

DevUtility Hub is a backend-only SSH gateway plus stdio MCP server. It lets local AI agents open controlled SSH sessions, run bounded commands, reuse prepare profiles, and inspect session logs through a local HTTP/WebSocket service.

## Quick Start

Run commands from the project root:

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub
npm install
npm run dev
```

Running `npm run dev` from `/Users/kafaz/dev/dev_utils` fails because that parent directory does not contain this project's `package.json`.

## Processes

- `server/index.js`: HTTP/WebSocket SSH gateway on `http://127.0.0.1:3001`.
- `mcp-server/dist/index.js`: stdio MCP adapter for Agent clients.

`npm run dev` checks server and MCP dependencies, rebuilds the MCP adapter when needed, then starts both processes.

## Agent Flow

1. `health_check`
2. `list_nodes` or `resolve_node`
3. `open_session`
4. `list_prepare_profiles` and `prepare_session`
5. `validate_command`
6. `run_command` or `run_commands_batch`
7. `get_session_logs`
8. `close_session`

## MCP Client Configuration

Codex example:

```toml
[mcp_servers.devutility-hub-agent]
command = "node"
args = ["/Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/dist/index.js"]

[mcp_servers.devutility-hub-agent.env]
DEVUTILITY_AGENT_BASE_URL = "http://127.0.0.1:3001"
```

## Safety

Execution tools require target assertions and service-side command policy. Do not widen the command policy automatically during remote investigation.

Use configuration write tools such as `save_node`, `save_prepare_profile`, `allow_command`, or `replace_command_policy` only when explicitly administering local gateway configuration.

## Verification

```bash
npm run build
npm run ci:verify
```
