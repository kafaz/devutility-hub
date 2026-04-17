# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevUtility Hub is a modular utility collection for backend engineers and ops. It uses a microkernel architecture with a React frontend and a Node.js proxy server that provides SSH agent capabilities, diagnostic APIs, and MCP tool exposure.

## Common Commands

### Frontend (root directory)

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint     # eslint .
npm run preview  # vite preview
```

### SSH / Agent Proxy Server (`server/`)

```bash
cd server
npm install
node index.js         # Runs on http://127.0.0.1:3001, WS on ws://127.0.0.1:3001/terminal
npm run dev           # node --watch index.js
```

### MCP Server (`mcp-server/`)

```bash
cd mcp-server
npm install
npm run build   # tsc -p tsconfig.json
npm start       # node dist/index.js (stdio MCP server)
```

## High-Level Architecture

### Frontend Architecture

The frontend is organized in three layers:

1. **Core Framework** (`src/App.tsx`, `src/components/Layout/`, `src/store/globalStore.ts`, `src/config/tools.config.ts`)
2. **Tool Modules** (`src/modules/<ToolName>/`)
3. **Shared Services** (`src/hooks/`, `src/utils/`, `src/components/shared/`, `src/types/`)

**Lazy-Loaded Persistent Routes**
- `App.tsx` defines `TOOL_ROUTES` and maps each path to a `React.lazy` component.
- `PersistentToolPages` keeps previously visited tool pages mounted in the DOM but hidden (`display: none`). This preserves component state when switching tools.
- New tools must be added to both `App.tsx` (import + route) and `src/config/tools.config.ts` (registration metadata). The sidebar (`src/components/Layout/Sidebar.tsx`) renders from `toolsConfig`.

**State Persistence**
- Global UI state (theme, sidebar collapsed) is persisted via Zustand `persist` middleware to `localStorage`.
- Most tool-specific data (templates, rules, SOP instances) is also persisted in `localStorage` through module-level Zustand stores.

**Build & Aliases**
- Vite aliases are configured in `vite.config.ts`: `@`, `@hooks`, `@utils`, `@components`, `@store`.
- `vite.config.ts` also proxies `/benchmark-api` to `http://127.0.0.1:8080`.
- TypeScript target is ES2022, strict mode enabled, `noUnusedLocals: true`.

### Server Architecture (`server/`)

The Node.js server is a monolithic Express app (`server/index.js`) that doubles as an HTTP API and WebSocket server.

**Key Subsystems**
- **SSH Terminal & Exec**: Uses `ssh2` + `ws`. Shell PTYs are opened once and reused. Commands are serialized through a per-session queue.
- **Marker-Based Output Capture**: Commands sent over reused PTYs are wrapped in start/end echo markers (`===S:<id>===` / `===E:<id>===:$?`) so stdout/stderr and exit codes can be extracted from the mixed stream.
- **Session State**: Stored in global Maps: `global.activeSessions` and `global.agentSessionLogs`.
- **Command Policy**: `commandPolicy.js` maintains an allow-list of base commands. Enforced before exec/shell writes.
- **Agent Registry**: `lib/agentRegistry.js` manages nodes, prepare profiles, and login presets as JSON-backed stores.
- **Diagnostic KB**: `diagnosticKb.js` persists archived diagnostic runs to `server/data/diagnostic-kb.json` for similarity recall.
- **Code Context**: `codeContext.js` interfaces with Git repos via `simple-git` to provide symbol search and rendering.

**Server Data Directory**
Runtime mutable JSON files live in `server/data/`:
- `agent-login-presets.json`
- `agent-nodes.json`
- `prepare-profiles.json`
- `command-policy.json`
- `diagnostic-kb.json`
- `code-context/` (cloned repo caches)

### MCP Server Architecture (`mcp-server/`)

A thin TypeScript MCP server (`src/index.ts`) that wraps the local HTTP APIs exposed by `server/index.js`. It communicates over stdio and exposes tools such as `health_check`, `open_session`, `troubleshoot`, `run_command`, and configuration plane tools. Default `DEVUTILITY_AGENT_BASE_URL` is `http://127.0.0.1:3001`.

### Skills (`skills/`)

`skills/devutility-agent-diagnosis/` contains human-collaboration skill definitions and reference templates used by the diagnostic agent workflow. See `SKILL.md` inside that directory for details.

## Adding a New Tool Module

Typical steps (no framework changes needed beyond registration):

1. Create `src/modules/<ToolName>/` with `index.tsx` (default export).
2. Add the lazy import and route entry in `src/App.tsx`.
3. Add metadata to `src/config/tools.config.ts`.
4. The sidebar will pick it up automatically from `toolsConfig`.

## Design Documentation

Several markdown files in the repository root provide deep design context for agent and diagnosis features:

- `AGENT_API.md`
- `AGENT_DIAGNOSIS_INTEGRATION_DESIGN.md`
- `AGENT_TROUBLESHOOTING_WORKFLOW.md`
- `DIAGNOSTIC_WORKBENCH_DESIGN.md`
- `DBS_AGENT_ARCHITECTURE.md`
- `AGENT_PROMPT_TEMPLATES.md`
- `AGENT_SKILL_HUMAN_COLLABORATION_DESIGN.md`
- `AGENT_SOP_ACCELERATION_DESIGN.md`
