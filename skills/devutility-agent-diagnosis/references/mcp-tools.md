# DevUtility Hub MCP Tools

## Tool Order

Use one of these two paths.

When a SOP is available, let the SOP structure decide which path should dominate. Use the tools to implement the SOP's intent, variables, checks, and follow-up branches.

### Fast First Pass

1. `recall_similar_runs`
2. `troubleshoot`
3. `get_diagnostic_run`
4. `get_session_logs` or `run_command` for targeted follow-up
5. `close_session`

### Interactive Drill-Down

1. `resolve_node` or `list_nodes`
2. `open_session`
3. `list_prepare_profiles` when a prepare profile is needed
4. `prepare_session` with a `target` assertion
5. `validate_command` for non-trivial commands
6. `run_command` with the same `target` assertion
7. `get_session_logs`
8. `recall_similar_runs` when a historical case may unblock the diagnosis
9. `close_session`

## Tool Summary

### Health & SSH Backbone

- `health_check`
- `list_ssh_agents`

### Login Presets

- `list_login_presets`
- `save_login_preset`
- `delete_login_preset`

### Registered Nodes

- `list_nodes`
- `resolve_node`
- `save_node`
- `update_node`
- `delete_node`

### Prepare Profiles

- `list_prepare_profiles`
- `save_prepare_profile`
- `update_prepare_profile`
- `delete_prepare_profile`

### Command Policy

- `get_command_policy`
- `validate_command`
- `replace_command_policy`
- `allow_command`
- `remove_allowed_command`
- `reset_command_policy`

### Sessions

- `open_session`
- `list_sessions`
- `get_session`
- `close_session`

### Execution

- `prepare_session`
- `run_command`
- `get_session_logs`

### Diagnosis & Knowledge Base

- `troubleshoot`
- `recall_similar_runs`
- `list_diagnostic_runs`
- `get_diagnostic_run`

## SOP Note

This repository already has SOP templates and server-side `exec_plan`, but the current MCP layer does not yet expose first-class SOP tools such as `list_sop_templates` or `run_sop`.

Until those tools exist:

- use SOP as a reasoning scaffold
- translate SOP variables into the inputs you pass to `troubleshoot`, `prepare_session`, and `run_command`
- translate SOP checks into bounded command batches
- record any missing branch as candidate SOP material instead of leaving it implicit

### `health_check`

Lightweight liveness probe. Use it before opening sessions to make sure the local DevUtility Hub service is reachable. No parameters.

### `list_ssh_agents`

List local SSH agent sockets or agent providers DevUtility Hub can use for agent-based authentication. No parameters.

### `list_login_presets` / `save_login_preset` / `delete_login_preset`

Manage login presets used by the preset auto-login flow.

- `list_login_presets`: no parameters.
- `save_login_preset` payload: full preset object (must include `id`, `name`, `host`, `username`, `authType`).
- `delete_login_preset`: pass `presetId`.

### `list_nodes`

List registered nodes and inspect:

- `nodeId`
- `name`
- `aliases`
- `host`
- `role`
- `env`
- `tags`
- `preOpsProfileId`

Use this when the user describes a system but not an exact node identifier.

### `resolve_node`

Resolve a node by alias, node name, IP, role, or tag.

Example input:

```json
{
  "query": "db-master"
}
```

### `save_node` / `update_node` / `delete_node`

Mutate the registered node set.

- `save_node` payload: full node object (must include `nodeId`, `name`, `host`, `username`).
- `update_node`: pass `nodeId` plus a `patch` object containing only the fields to change.
- `delete_node`: pass `nodeId` only.

Treat these as configuration-plane tools. Do not call them during normal diagnosis unless the user explicitly asked you to change local configuration.

### `open_session`

Prefer opening by `nodeId`.

Example input:

```json
{
  "nodeId": "node-prod-db-01",
  "reason": "diagnose mysql replication lag",
  "reuseIfExists": true,
  "ttlSec": 1800
}
```

Use direct `connection` only when the node is not registered.

You can also pass direct top-level fields such as `host`, `port`, `username`, `password`, `keyContent`, or `keyFilePath`.

### `list_prepare_profiles`

Use this to discover prebuilt preparation flows such as root escalation or environment initialization.

### `save_prepare_profile` / `update_prepare_profile` / `delete_prepare_profile`

Mutate prepare profiles.

- `save_prepare_profile` payload: full profile object (must include `profileId` and `name`).
- `update_prepare_profile`: pass `profileId` plus a `patch` object.
- `delete_prepare_profile`: pass `profileId` only.

Configuration-plane. Do not invoke during normal diagnosis unless the user explicitly asked to change local configuration.

### `prepare_session`

Use either `profileId` or explicit `steps`.

Example input:

```json
{
  "sessionId": "agent_xxx",
  "target": {
    "nodeId": "node-prod-db-01",
    "host": "10.0.0.11",
    "port": 22,
    "username": "root"
  },
  "profileId": "linux-root-default"
}
```

Example with explicit steps:

```json
{
  "sessionId": "agent_xxx",
  "target": {
    "nodeId": "node-prod-db-01",
    "host": "10.0.0.11",
    "port": 22,
    "username": "root"
  },
  "steps": [
    { "name": "sudo", "cmd": "sudo su -" },
    { "name": "profile", "cmd": "source /etc/profile >/dev/null 2>&1 || true" },
    { "name": "workdir", "cmd": "cd /var/log/myapp" }
  ]
}
```

### `run_command`

Run bounded diagnosis commands.

Example input:

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

Use `mode="exec"` only for stateless checks.
Do not call `run_command` with only `sessionId`; target guard rejects mismatches before the command is written to the SSH PTY.

### `get_command_policy`

Fetch the current service-side command whitelist and the fixed blocking rules. No parameters. Use it once at the start of a session to know which base commands the local whitelist currently allows.

### `validate_command`

Preflight a command against the service-side whitelist without running it.

Example input:

```json
{
  "cmd": "tail -n 200 /var/log/myapp/error.log",
  "context": "mcp-preflight"
}
```

Use this before `run_command` when the command contains shell operators, user-provided paths, SQL, curl options, or a less common binary.
If the result has `allowed=false`, stop and report the reason. Do not call policy mutation tools unless the user explicitly asked to change the local command whitelist.

### `replace_command_policy` / `allow_command` / `remove_allowed_command` / `reset_command_policy`

Mutate the service-side command whitelist.

- `replace_command_policy` payload: full `allowedBaseCommands` array.
- `allow_command` payload: `{ "command": "<binary>" }`.
- `remove_allowed_command` payload: `{ "command": "<binary>" }`.
- `reset_command_policy`: no payload, restores defaults.

These are configuration-plane tools. Do not widen the whitelist on your own when a command is blocked. Stop and ask the user.

### `list_sessions` / `get_session`

Inspect currently active SSH sessions.

- `list_sessions`: no parameters. Returns the live sessions that the local diagnosis service can target, including their target identity (`nodeId`, `host`, `port`, `username`) and `status`.
- `get_session`: pass `sessionId`. Returns the same identity for one session.

Use these when the Agent needs to confirm the active target identity before passing a `target` assertion to `prepare_session`, `run_command`, or `troubleshoot`. The returned `nodeId` / `host` / `port` / `username` is the authoritative identity that the target guard will compare against.

### `troubleshoot`

Run the single-agent first-pass diagnosis flow.

Use this when the user already has a target, a symptom, and a bounded collection plan, and you want one structured run that combines:

- optional auto-login
- collection
- analysis
- report generation
- knowledge-base archiving

Prefer `keepSession=true` when you expect a second interactive round after the first-pass results.
This is also the preferred first-pass executor when you are reusing a SOP concept but do not yet have a formal MCP `run_sop` tool.

### `recall_similar_runs`

Recall similar historical diagnostic runs before or during an investigation.

Use this when:

- the symptom is broad
- the first pass is stuck
- the user wants known-good next commands

### `get_diagnostic_run`

Fetch the archived output of one diagnosis run.

Use this after `troubleshoot` when you need the structured findings and report before deciding the next manual commands.

Use it as the evidence base for deciding whether a new SOP fragment should be proposed.


### `get_session_logs`

Retrieve recent per-session logs captured by the server.

Use this when users ask:

- which commands the Agent actually executed
- what stdout/stderr was returned
- whether command policy blocked a command

Example input:

```json
{
  "sessionId": "agent_xxx",
  "limit": 120
}
```

### `close_session`

Close the active SSH session when the investigation is complete.

Pass `sessionId` only. After this call the session id is no longer valid; further `prepare_session` / `run_command` / `get_session_logs` calls will fail with 404.

### `list_diagnostic_runs`

List archived diagnostic runs from the local knowledge base. Use it to look up historical context before starting a new investigation.

Example input:

```json
{
  "limit": 20
}
```

## Interpretation Rules

Treat these fields as primary evidence:

- `stdout`
- `stderr`
- `exitCode`
- `durationMs`
- `policy.allowed`
- `targetGuard.ok`
- `session.host` / `session.username` / `session.nodeId`

Do not treat an empty `stdout` as success by itself. Always consider `exitCode` and the command semantics.

When a prepare step or command fails, report the exact failed step and the output that supports the conclusion.

When `run_command` returns policy metadata with `allowed=false`, treat it as a controlled block result, not a transport failure.

When a tool returns `targetGuard.ok=false`, treat it as a wrong-target block. Do not retry against a different active session unless you explicitly resolve and open the intended node again.

When `troubleshoot` and manual commands disagree, trust the raw evidence and explain the discrepancy instead of hiding it.

When an existing SOP and the raw evidence disagree, explain whether the SOP is stale, incomplete, or misapplied.
