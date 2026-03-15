# DevUtility Hub MCP Tools

## Tool Order

Use the tools in this order for most investigations:

1. `resolve_node` or `list_nodes`
2. `open_session`
3. `list_prepare_profiles` when a prepare profile is needed
4. `prepare_session`
5. `run_command`
6. `get_session_logs` (optional, use when user asks for command trace)
7. `close_session`

## Tool Summary

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

### `list_prepare_profiles`

Use this to discover prebuilt preparation flows such as root escalation or environment initialization.

### `prepare_session`

Use either `profileId` or explicit `steps`.

Example input:

```json
{
  "sessionId": "agent_xxx",
  "profileId": "linux-root-default"
}
```

Example with explicit steps:

```json
{
  "sessionId": "agent_xxx",
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
  "cmd": "tail -n 200 /var/log/myapp/error.log",
  "timeoutMs": 15000,
  "mode": "pty"
}
```

Use `mode="exec"` only for stateless checks.


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

Close the session when the investigation is complete.

## Interpretation Rules

Treat these fields as primary evidence:

- `stdout`
- `stderr`
- `exitCode`
- `durationMs`

Do not treat an empty `stdout` as success by itself. Always consider `exitCode` and the command semantics.

When a prepare step or command fails, report the exact failed step and the output that supports the conclusion.
