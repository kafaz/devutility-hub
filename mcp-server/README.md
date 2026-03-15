# DevUtility Hub MCP Server

This server exposes the local DevUtility Hub diagnosis APIs as MCP tools over `stdio`.

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

- `list_nodes`
- `resolve_node`
- `list_prepare_profiles`
- `open_session` (supports node/direct mode and preset auto-login mode)
- `list_sessions`
- `get_session`
- `prepare_session`
- `run_command`
- `get_session_logs`
- `close_session`


### `open_session` Modes

`open_session` now supports two connection modes:

1. **node/direct mode** (default):
   - Provide `nodeId`, or `connection` (+ optional `auth` / `jumpAuth`)
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

## Expected Flow

1. `resolve_node` or `list_nodes`
2. `open_session`
3. `list_prepare_profiles`
4. `prepare_session`
5. `run_command`
6. `get_session_logs` (optional, for audit/traceability)
7. `close_session`
