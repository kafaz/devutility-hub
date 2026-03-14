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
- `open_session`
- `list_sessions`
- `get_session`
- `prepare_session`
- `run_command`
- `close_session`

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
6. `close_session`
