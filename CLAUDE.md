# CLAUDE.md

This file provides guidance to Claude Code and other agents when working in this repository.

## Project Overview

DevUtility Hub is a backend-only SSH/MCP gateway. It has no browser UI.

The project exposes a local HTTP/WebSocket SSH gateway and a stdio MCP adapter so agents can open controlled SSH sessions, run bounded commands, reuse prepare profiles, inspect logs, and close sessions.

## Common Commands

Root directory:

```bash
npm install
npm run dev
npm run build
npm run ci:verify
```

Service-specific commands:

```bash
npm --prefix server start
npm --prefix mcp-server run build
npm --prefix mcp-server start
```

## Architecture

- `server/`: Express HTTP API, WebSocket terminal endpoint, SSH session management, command policy, target guard, login presets, registered nodes, and prepare profiles.
- `mcp-server/`: stdio MCP tools wrapping the local SSH gateway.
- `scripts/`: dependency bootstrap helpers for server and MCP dependencies.
- `skills/devutility-agent-diagnosis/`: agent-facing guidance for safe remote access through the MCP tools.

## Safety Rules

Use registered nodes or explicit target assertions for Agent execution. Keep command execution inside the service command policy.

Configuration write tools such as node/profile/policy mutation are administration actions, not default investigation steps. Do not widen command policy automatically when a command is blocked.

## Verification

Use the strongest relevant check for the touched surface:

```bash
npm --prefix mcp-server run build
node --test server/runtimeHelpers.test.cjs server/targetGuard.test.cjs server/proxyServer.test.cjs server/test/commandPolicyRoutes.test.js
npm run ci:verify
```
