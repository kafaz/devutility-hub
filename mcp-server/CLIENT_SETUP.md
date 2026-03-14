# MCP Client Setup Examples

This file shows example local MCP client configuration for common AI clients.

## Common Prerequisite

Build the MCP server first:

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub/mcp-server
npm install
npm run build
```

Start the DevUtility Hub local service:

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub/server
npm install
node index.js
```

## Claude Desktop

Example config file:

- [claude_desktop_config.json](/Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/examples/claude_desktop_config.json)

Typical macOS location:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

## Cursor

Example config file:

- [cursor_mcp.json](/Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/examples/cursor_mcp.json)

Use the example as a project-level or global MCP config depending on your Cursor setup. A common location is:

```text
~/.cursor/mcp.json
```

## Codex

Example config file:

- [codex_config.toml](/Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/examples/codex_config.toml)

Typical location:

```text
~/.codex/config.toml
```

Equivalent CLI command:

```bash
codex mcp add devutility-hub-agent --env DEVUTILITY_AGENT_BASE_URL=http://127.0.0.1:3001 node /Users/kafaz/dev/dev_utils/devutility-hub/mcp-server/dist/index.js
```

## Notes

1. These examples assume the repository is at `/Users/kafaz/dev/dev_utils/devutility-hub`.
2. Replace the absolute path if the repository is moved.
3. The MCP server uses local `stdio`; the actual diagnosis calls still go to `http://127.0.0.1:3001`.
