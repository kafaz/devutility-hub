# DevUtility Hub MCP Tools

## Tool Order

Use the SSH gateway as the single execution path:

1. `health_check`
2. `resolve_node` or `list_nodes`
3. `open_session`
4. `list_prepare_profiles` when a prepare profile is needed
5. `prepare_session` with a `target` assertion
6. `validate_command` for non-trivial commands
7. `run_command` or `run_commands_batch` with the same `target` assertion
8. `get_session_logs`
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
- `run_commands_batch`
- `get_session_logs`

## Core Tools

### `health_check`

Lightweight liveness probe. Use it before opening sessions to make sure the local DevUtility Hub service is reachable. No parameters.

### `list_ssh_agents`

List local SSH agent sockets or agent providers DevUtility Hub can use for agent-based authentication. No parameters.

### `list_login_presets` / `save_login_preset` / `delete_login_preset`

Manage login presets used by preset auto-login.

- `list_login_presets`: no parameters.
- `save_login_preset`: pass the full preset object. It must include `id`, `name`, `host`, `username`, and `authType`.
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

```json
{
  "query": "db-master"
}
```

### `save_node` / `update_node` / `delete_node`

Mutate the registered node set.

- `save_node`: pass a full node object. It must include `nodeId`, `name`, `host`, and `username`.
- `update_node`: pass `nodeId` plus a `patch` object containing only the fields to change.
- `delete_node`: pass `nodeId`.

Treat these as configuration-plane tools. Do not call them during normal remote access unless the user explicitly asked you to change local configuration.

### `open_session`

Prefer opening by `nodeId`.

```json
{
  "nodeId": "node-prod-db-01",
  "reason": "inspect mysql replication lag",
  "reuseIfExists": true,
  "ttlSec": 1800
}
```

Use direct `connection` only when the node is not registered. You can also pass top-level fields such as `host`, `port`, `username`, `password`, `keyContent`, or `keyFilePath`.

### `list_prepare_profiles`

Use this to discover prebuilt preparation flows such as root escalation or environment initialization.

### `save_prepare_profile` / `update_prepare_profile` / `delete_prepare_profile`

Mutate prepare profiles.

- `save_prepare_profile`: pass a full profile object. It must include `profileId` and `name`.
- `update_prepare_profile`: pass `profileId` plus a `patch` object.
- `delete_prepare_profile`: pass `profileId`.

Configuration-plane. Do not invoke during normal remote access unless the user explicitly asked to change local configuration.

### `prepare_session`

Use either `profileId` or explicit `steps`.

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

Run one bounded command in an SSH session.

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

Use `mode="exec"` only for stateless checks. Do not call `run_command` with only `sessionId`; target guard rejects mismatches before the command is written to the SSH PTY.

### `run_commands_batch`

Run multiple bounded commands sequentially in the same SSH session. Use this when several read-only probes are independent and you want fewer tool round trips.

```json
{
  "sessionId": "agent_xxx",
  "target": {
    "nodeId": "node-prod-db-01",
    "host": "10.0.0.11",
    "port": 22,
    "username": "root"
  },
  "commands": [
    { "cmd": "hostname", "mode": "exec", "timeoutMs": 5000 },
    { "cmd": "uptime", "mode": "exec", "timeoutMs": 5000 }
  ],
  "stopOnFailure": false
}
```

### `get_command_policy`

Fetch the current service-side command whitelist and fixed blocking rules. No parameters. Use it once at the start of a session to know which base commands the local whitelist currently allows.

### `validate_command`

Preflight a command against the service-side whitelist without running it.

```json
{
  "cmd": "tail -n 200 /var/log/myapp/error.log",
  "context": "mcp-preflight"
}
```

Use this before `run_command` when the command contains shell operators, user-provided paths, SQL, curl options, or a less common binary. If the result has `allowed=false`, stop and report the reason. Do not call policy mutation tools unless the user explicitly asked to change the local command whitelist.

### `replace_command_policy` / `allow_command` / `remove_allowed_command` / `reset_command_policy`

Mutate the service-side command whitelist.

- `replace_command_policy`: pass the full `allowedBaseCommands` array.
- `allow_command`: pass `{ "command": "<binary>" }`.
- `remove_allowed_command`: pass `{ "command": "<binary>" }`.
- `reset_command_policy`: no payload, restores defaults.

These are configuration-plane tools. Do not widen the whitelist on your own when a command is blocked. Stop and ask the user.

### `list_sessions` / `get_session`

Inspect currently active SSH sessions.

- `list_sessions`: no parameters. Returns live sessions, including target identity (`nodeId`, `host`, `port`, `username`) and `status`.
- `get_session`: pass `sessionId`.

Use these when the Agent needs to confirm active target identity before passing a `target` assertion to `prepare_session`, `run_command`, or `run_commands_batch`.

### `get_session_logs`

Retrieve recent per-session logs captured by the server.

```json
{
  "sessionId": "agent_xxx",
  "limit": 120
}
```

### `close_session`

Close the active SSH session when remote access is complete.

Pass `sessionId` only. After this call the session id is no longer valid; further `prepare_session`, `run_command`, `run_commands_batch`, or `get_session_logs` calls will fail with 404.

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

When `run_command` or `run_commands_batch` returns policy metadata with `allowed=false`, treat it as a controlled block result, not a transport failure.

When a tool returns `targetGuard.ok=false`, treat it as a wrong-target block. Do not retry against a different active session unless you explicitly resolve and open the intended node again.
