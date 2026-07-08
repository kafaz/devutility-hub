# SSH/MCP Service Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert DevUtility Hub into a pure backend SSH gateway plus stdio MCP server, with no React/Vite frontend and no non-SSH product features.

**Architecture:** Keep `server/index.js` as the HTTP/WebSocket SSH execution plane and keep `mcp-server/src/index.ts` as the MCP adapter. Remove all browser UI code and all diagnostic KB, SOP Git sync, code-context, benchmark, and frontend packaging surfaces. Root scripts become orchestration for `server/` and `mcp-server/` only.

**Tech Stack:** Node.js, Express, ws, ssh2, TypeScript for the MCP adapter, `node:test`, npm workspaces-by-prefix commands.

---

## File Structure

Delete frontend/runtime UI files:

- `src/`
- `public/`
- `index.html`
- `vite.config.ts`
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`
- `eslint.config.js`
- `scripts/build-windows-portable.mjs`

Modify root orchestration:

- `package.json`: remove frontend scripts and dependencies; keep server/MCP scripts.
- `package-lock.json`: regenerate to match the root dependency set.
- `scripts/ensure-mcp-deps.mjs`: always rebuild MCP when source is newer than `dist/index.js`.
- `scripts/ensure-server-deps.mjs`: keep as-is unless tests prove it needs adjustment.
- `scripts/ensure-server-deps.test.mjs`: keep existing coverage.

Modify SSH gateway:

- `server/index.js`: remove static frontend serving, diagnostic KB/orchestration, `/api/agent/troubleshoot`, `/api/diagnostic/*`, `/api/sop/git-sync`, `/api/code-context/*`, and duplicate `/api/agent/sessions/:sessionId/commands/batch`.
- `server/runtimeHelpers.js`: remove static-dir/app-shell behavior.
- `server/runtimeHelpers.test.cjs`: update expectations for HTTP/WS URL helpers only.
- `server/proxyServer.test.cjs`: assert API health works and non-API browser paths return 404.
- `server/package.json` and `server/package-lock.json`: remove `simple-git`.
- Delete `server/diagnosticKb.js`, `server/codeContext.js`, `server/test/diagnosticWorkbenchRoutes.test.js`, and non-SSH server examples.

Modify MCP adapter:

- `mcp-server/src/index.ts`: remove `troubleshoot`, `list_diagnostic_runs`, `get_diagnostic_run`, and `recall_similar_runs`; keep SSH/session/config tools.
- `mcp-server/README.md`: list SSH-only tools and remove diagnostic KB/troubleshoot sections.
- Delete stale MCP examples: `mcp-server/examples/list_diagnostic_runs.request.json` and `mcp-server/examples/troubleshoot_minimal.request.json`.

Modify docs:

- `README.md`: rewrite as SSH/MCP gateway documentation.
- `CLAUDE.md`: rewrite project guidance for the backend-only layout.
- `skills/devutility-agent-diagnosis/references/mcp-tools.md`: remove references to deleted tools if present.
- Leave historical design docs under `docs/superpowers/` untouched.

## Task 1: Root Scripts And Frontend Removal

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/ensure-mcp-deps.mjs`
- Delete: `src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `scripts/build-windows-portable.mjs`

- [ ] **Step 1: Confirm the pre-change root script problem**

Run:

```bash
npm run ci:verify
```

Expected before this task: the command still references frontend build or frontend tests in `package.json`.

- [ ] **Step 2: Replace root `package.json`**

Set `package.json` to:

```json
{
  "name": "devutility-hub",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "predev": "node scripts/ensure-server-deps.mjs && node scripts/ensure-mcp-deps.mjs",
    "dev": "concurrently -k -n proxy,mcp --prefix-colors green,magenta \"node server/index.js\" \"node mcp-server/dist/index.js\"",
    "build": "npm --prefix mcp-server run build",
    "test:server": "node --test scripts/ensure-server-deps.test.mjs server/runtimeHelpers.test.cjs server/targetGuard.test.cjs server/proxyServer.test.cjs server/test/logNoise.test.js server/test/prepareRuntime.test.js server/test/prepareProfiles.test.js server/test/commandPolicyRoutes.test.js",
    "ci:verify": "npm run build && npm run test:server"
  },
  "devDependencies": {
    "concurrently": "^9.2.1"
  }
}
```

- [ ] **Step 3: Update MCP dependency bootstrap**

In `scripts/ensure-mcp-deps.mjs`, replace the dist-only build check with source mtime comparison:

```js
function getMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

const mcpSource = path.join(mcpDir, 'src', 'index.ts');
if (!fs.existsSync(mcpDist) || getMtime(mcpSource) > getMtime(mcpDist)) {
  console.log('[dev bootstrap] building mcp-server...');
  run(npmCommand, ['--prefix', mcpDir, 'run', 'build'], repoDir);
}
```

- [ ] **Step 4: Delete frontend files**

Run:

```bash
git rm -r src public
git rm index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json eslint.config.js scripts/build-windows-portable.mjs
```

Expected: `git status --short` shows these files staged as deleted, and no `src/` references remain in root scripts.

- [ ] **Step 5: Regenerate root lockfile**

Run:

```bash
npm install --package-lock-only
```

Expected: `package-lock.json` contains only the root package and `concurrently` dependency tree, not React/Vite/Ant Design packages.

- [ ] **Step 6: Verify task**

Run:

```bash
npm run build
```

Expected: MCP server TypeScript build passes.

## Task 2: Server SSH-Only Surface

**Files:**
- Modify: `server/index.js`
- Modify: `server/runtimeHelpers.js`
- Modify: `server/runtimeHelpers.test.cjs`
- Modify: `server/proxyServer.test.cjs`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Delete: `server/diagnosticKb.js`, `server/codeContext.js`, `server/test/diagnosticWorkbenchRoutes.test.js`, `server/examples/agent_troubleshoot.request.example.json`, `server/examples/business_smoke_test.py`, `server/examples/ceph_code_context_manual_cases.json`, `server/examples/ceph_code_context_manual_test.md`

- [ ] **Step 1: Write server cleanup expectations**

Update `server/runtimeHelpers.test.cjs` so it no longer imports or tests `shouldServeAppShell`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeServerRuntimeOptions,
  buildRuntimeUrls,
} = require('./runtimeHelpers');

test('normalizeServerRuntimeOptions preserves explicit host and port', () => {
  const normalized = normalizeServerRuntimeOptions({
    host: '127.0.0.1',
    port: 0,
  });

  assert.equal(normalized.host, '127.0.0.1');
  assert.equal(normalized.port, 0);
});

test('buildRuntimeUrls derives ws url from assigned address', () => {
  const urls = buildRuntimeUrls({ address: '127.0.0.1', port: 34567 });

  assert.equal(urls.httpBaseUrl, 'http://127.0.0.1:34567');
  assert.equal(urls.wsBaseUrl, 'ws://127.0.0.1:34567/terminal');
});
```

Update `server/proxyServer.test.cjs` to assert no app shell is served:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { startProxyServer, stopProxyServer } = require('./index');

test('startProxyServer serves api health and does not serve a frontend app shell', async (t) => {
  const runtime = await startProxyServer({ host: '127.0.0.1', port: 0 });
  t.after(async () => {
    await stopProxyServer();
  });

  const healthResponse = await fetch(`${runtime.httpBaseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.ok, true);

  const browserPathResponse = await fetch(`${runtime.httpBaseUrl}/diagnostic-workbench`);
  assert.equal(browserPathResponse.status, 404);
});
```

- [ ] **Step 2: Simplify runtime helpers**

Set `server/runtimeHelpers.js` to:

```js
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;

function normalizeServerRuntimeOptions(options = {}) {
  const host = typeof options.host === 'string' && options.host.trim()
    ? options.host.trim()
    : DEFAULT_HOST;
  const port = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;

  return { host, port };
}

function buildRuntimeUrls({ address, port }) {
  const hostname = typeof address === 'string' && address.trim() ? address.trim() : DEFAULT_HOST;
  const resolvedPort = Number.isInteger(port) ? port : DEFAULT_PORT;
  const httpBaseUrl = `http://${hostname}:${resolvedPort}`;

  return {
    httpBaseUrl,
    wsBaseUrl: `ws://${hostname}:${resolvedPort}/terminal`,
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  normalizeServerRuntimeOptions,
  buildRuntimeUrls,
};
```

- [ ] **Step 3: Remove server imports for deleted features**

In `server/index.js`, remove imports for:

```js
const { spawn } = require('child_process');
const os = require('os');
const { simpleGit } = require('simple-git');
const { shouldServeAppShell } = require('./runtimeHelpers');
const {
  appendRun,
  buildDiagnosticReport,
  buildHeuristicFindings,
  buildSignals,
  getRunById,
  listRuns,
  patchRunWorkbench,
  recallSimilarRuns,
} = require('./diagnosticKb');
const {
  openCodeContext,
  renderLocation,
  renderSymbol,
  searchSymbols,
  getCallers,
  getCallees,
  findCallRelation,
  listContexts,
  closeContext,
} = require('./codeContext');
```

Keep imports for `express`, `ws`, `ssh2`, `cors`, `http`, `fs`, `path`, `crypto`, `runtimeHelpers`, `ManagedAgentSession`, `agentRegistry`, `prepareRuntime`, `agentPresets`, `commandPolicy`, `targetGuard`, and `logNoise`.

- [ ] **Step 4: Remove static frontend handling**

Delete `handleStaticFrontend()` and delete:

```js
app.use(handleStaticFrontend);
```

Also remove `staticDir: process.env.STATIC_DIR` from the `runtimeOptions` initialization and remove `staticDir` from `startProxyServer()` return objects.

- [ ] **Step 5: Remove diagnostic and non-SSH functions/routes**

Delete these function blocks from `server/index.js`:

```text
parseArgsValue
normalizeDiagnosticPayload
runDiagnosticOrchestration
```

Delete these route blocks:

```text
GET /api/diagnostic/runs
GET /api/diagnostic/runs/:id
PATCH /api/diagnostic/runs/:id/workbench
POST /api/diagnostic/recall
POST /api/diagnostic/orchestrate
POST /api/agent/troubleshoot
POST /api/sop/git-sync
POST /api/code-context/open
GET /api/code-context/:contextId/symbols
POST /api/code-context/:contextId/render
POST /api/code-context/:contextId/render-location
GET /api/code-context/contexts
DELETE /api/code-context/contexts/:contextId
GET /api/code-context/:contextId/symbols/:symbolId/callers
GET /api/code-context/:contextId/symbols/:symbolId/callees
POST /api/code-context/:contextId/call-relation
```

- [ ] **Step 6: Keep only one batch command route**

Search:

```bash
rg -n "commands/batch" server/index.js
```

Expected after cleanup: one route registration line and one comment block for `POST /api/agent/sessions/:sessionId/commands/batch`.

- [ ] **Step 7: Remove server feature files and dependency**

Run:

```bash
git rm server/diagnosticKb.js server/codeContext.js server/test/diagnosticWorkbenchRoutes.test.js
git rm server/examples/agent_troubleshoot.request.example.json server/examples/business_smoke_test.py server/examples/ceph_code_context_manual_cases.json server/examples/ceph_code_context_manual_test.md
npm --prefix server uninstall simple-git --package-lock-only
```

Expected: `server/package.json` no longer lists `simple-git`.

- [ ] **Step 8: Verify task**

Run:

```bash
node --test server/runtimeHelpers.test.cjs server/proxyServer.test.cjs server/targetGuard.test.cjs server/test/commandPolicyRoutes.test.js server/test/prepareRuntime.test.js server/test/prepareProfiles.test.js server/test/logNoise.test.js
```

Expected: all listed server tests pass.

## Task 3: MCP SSH-Only Tools

**Files:**
- Modify: `mcp-server/src/index.ts`
- Modify: `mcp-server/README.md`
- Delete: `mcp-server/examples/list_diagnostic_runs.request.json`, `mcp-server/examples/troubleshoot_minimal.request.json`

- [ ] **Step 1: Remove deleted MCP tools**

In `mcp-server/src/index.ts`, delete tool registrations for:

```text
troubleshoot
list_diagnostic_runs
get_diagnostic_run
recall_similar_runs
```

Keep the following tools:

```text
health_check
list_ssh_agents
list_login_presets
save_login_preset
delete_login_preset
list_nodes
save_node
delete_node
update_node
resolve_node
save_prepare_profile
delete_prepare_profile
update_prepare_profile
list_prepare_profiles
get_command_policy
validate_command
replace_command_policy
allow_command
remove_allowed_command
reset_command_policy
open_session
list_sessions
get_session
get_session_logs
prepare_session
run_command
run_commands_batch
close_session
```

- [ ] **Step 2: Make tool language SSH-only**

Update descriptions containing `diagnosis` or `diagnostic` where the tool is generic SSH execution. For example:

```ts
server.tool(
  "run_command",
  "Run a command in an SSH session and return stdout, stderr, exitCode, and duration. Use mode=pty to keep shell context or mode=exec for stateless execution.",
  ...
);
```

- [ ] **Step 3: Delete stale examples**

Run:

```bash
git rm mcp-server/examples/list_diagnostic_runs.request.json mcp-server/examples/troubleshoot_minimal.request.json
```

- [ ] **Step 4: Rewrite MCP README tool list**

In `mcp-server/README.md`, remove sections for `troubleshoot` and Knowledge Base Tools. The exposed tools list must exactly match the kept tool list from Step 1.

- [ ] **Step 5: Verify task**

Run:

```bash
npm --prefix mcp-server run build
```

Expected: TypeScript build passes and `mcp-server/dist/index.js` is regenerated locally.

## Task 4: Documentation And Agent Guidance

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `skills/devutility-agent-diagnosis/references/mcp-tools.md`

- [ ] **Step 1: Rewrite root README**

Replace `README.md` with a backend-only guide containing these sections:

```markdown
# DevUtility Hub SSH/MCP Gateway

DevUtility Hub is now a backend-only SSH gateway plus stdio MCP server. It lets local AI agents open controlled SSH sessions, run bounded commands, reuse prepare profiles, and inspect session logs through a local HTTP/WebSocket service.

## Quick Start

\`\`\`bash
cd /Users/kafaz/dev/dev_utils/devutility-hub
npm install
npm run dev
\`\`\`

Run commands from the project root. Running `npm run dev` from `/Users/kafaz/dev/dev_utils` fails because that parent directory does not contain this project's `package.json`.

## Processes

- `server/index.js`: HTTP/WebSocket SSH gateway on `http://127.0.0.1:3001`.
- `mcp-server/dist/index.js`: stdio MCP adapter for Agent clients.

## Agent Flow

1. `health_check`
2. `list_nodes` or `resolve_node`
3. `open_session`
4. `list_prepare_profiles` and `prepare_session`
5. `validate_command`
6. `run_command` or `run_commands_batch`
7. `get_session_logs`
8. `close_session`

## Safety

Execution tools require target assertions and service-side command policy. Do not widen the command policy automatically during diagnosis.
\`\`\`
```

- [ ] **Step 2: Rewrite CLAUDE.md**

Replace frontend instructions with backend-only commands:

```markdown
# CLAUDE.md

## Project Overview

DevUtility Hub is a backend-only SSH/MCP gateway. It has no React/Vite frontend.

## Common Commands

\`\`\`bash
npm install
npm run dev
npm run build
npm run ci:verify
\`\`\`

\`\`\`bash
npm --prefix server start
npm --prefix mcp-server run build
npm --prefix mcp-server start
\`\`\`

## Architecture

- `server/`: Express HTTP API, WebSocket terminal endpoint, SSH session management, command policy, target guard, prepare profiles.
- `mcp-server/`: stdio MCP tools wrapping the local SSH gateway.
- `scripts/`: dependency bootstrap helpers.

## Safety Rules

Use registered nodes or explicit target assertions for Agent execution. Keep command execution inside the service command policy. Configuration write tools are administration actions, not default diagnosis steps.
```

- [ ] **Step 3: Update skill reference tool names**

Run:

```bash
rg -n "troubleshoot|list_diagnostic_runs|get_diagnostic_run|recall_similar_runs|diagnostic KB|code-context" skills/devutility-agent-diagnosis/references/mcp-tools.md
```

Remove deleted tool names and rewrite the recommended sequence to use `run_command` and `run_commands_batch`.

- [ ] **Step 4: Verify no stale frontend/product references in active docs**

Run:

```bash
rg -n "React|Vite|frontend|LogAnalyzer|SOPBuilder|DiagnosticWorkbench|BlockBenchmark|NumberConverter|troubleshoot|list_diagnostic_runs|recall_similar_runs|code-context" README.md CLAUDE.md mcp-server/README.md skills/devutility-agent-diagnosis/references/mcp-tools.md package.json server/package.json mcp-server/src/index.ts
```

Expected: no stale product references. The word `diagnostic` may remain only where it describes bounded command usage or existing command-policy context; prefer `SSH` or `remote access` in user-facing docs.

## Task 5: Final Verification And Cleanup

**Files:**
- Inspect: whole repository
- Modify only if verification reveals stale references or generated metadata drift.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run ci:verify
```

Expected: MCP build and server tests pass.

- [ ] **Step 2: Run whitespace/conflict checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Status should show intentional deletions and modifications only.

- [ ] **Step 3: Inspect feature-removal references**

Run:

```bash
rg -n "/api/diagnostic|/api/code-context|/api/sop/git-sync|troubleshoot|serve app shell|STATIC_DIR|vite|react" server mcp-server package.json README.md CLAUDE.md scripts skills/devutility-agent-diagnosis/references/mcp-tools.md
```

Expected: no live code or active docs reference removed features.

- [ ] **Step 4: Optional local launch smoke**

Run:

```bash
npm run dev
```

Expected: the SSH gateway starts on `127.0.0.1:3001`, MCP server starts over stdio, and the command does not start Vite. Stop with `Ctrl-C` after confirming startup.

- [ ] **Step 5: Commit**

Run:

```bash
git add -A
git status --short
git commit -m "refactor: reduce project to ssh mcp gateway"
```

Expected: one implementation commit containing the SSH/MCP-only conversion. Existing pre-plan local edits to `.gitignore`, `server/index.js`, and `mcp-server/src/index.ts` are preserved if they still belong to the SSH/MCP surface.
