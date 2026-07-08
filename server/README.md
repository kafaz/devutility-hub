# DevUtility Hub SSH Gateway

This directory contains the local HTTP/WebSocket SSH gateway used by the MCP adapter.

## Start

```bash
cd /Users/kafaz/dev/dev_utils/devutility-hub
npm --prefix server install
npm --prefix server start
```

Default endpoints:

- HTTP API: `http://127.0.0.1:3001`
- WebSocket terminal: `ws://127.0.0.1:3001/terminal`

## Health Check

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/agents
```

## Core API Areas

- `/api/agents`: local SSH agent providers.
- `/api/agent/login-presets`: saved login presets.
- `/api/agent/nodes`: registered SSH nodes.
- `/api/agent/prepare-profiles`: reusable session preparation profiles.
- `/api/agent/command-policy`: service-side command policy.
- `/api/agent/sessions`: active SSH sessions.
- `/api/agent/sessions/:sessionId/prepare`: run prepare steps.
- `/api/agent/sessions/:sessionId/commands`: run one command.
- `/api/agent/sessions/:sessionId/commands/batch`: run multiple commands sequentially.

## Safety

Command execution is guarded by command policy and target assertions. A target assertion must include at least `nodeId` or `host`; mismatches return HTTP `409` before a command is written to the SSH PTY.
