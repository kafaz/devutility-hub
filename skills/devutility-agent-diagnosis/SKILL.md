---
name: devutility-agent-diagnosis
description: Diagnose remote Linux, middleware, storage, or service faults through the local DevUtility Hub MCP tools. Use when Codex needs to resolve a registered node, open or reuse a PTY-backed session, run prepare steps, execute diagnostic commands, and convert command output into a structured troubleshooting conclusion for the user.
---

# Devutility Agent Diagnosis

## Overview

Use the local DevUtility Hub service as the execution plane and the MCP server as the tool interface. Prefer registered nodes and prepare profiles so connection setup, context preparation, and command execution stay repeatable.

## Workflow

1. Resolve the target node.
   Use `resolve_node` when the user gives a name, alias, role, or IP.
   Use `list_nodes` first when the user is unsure which node to target.
2. Open or reuse a session.
   Use `open_session` with `nodeId` and a short `reason`.
   Set `reuseIfExists=true` unless the user explicitly needs a fresh shell context.
3. Prepare the shell context.
   Use `list_prepare_profiles` to discover reusable prepare flows.
   Use `prepare_session` with `profileId` before issuing diagnosis commands when the target needs `sudo`, environment loading, or a working directory change.
4. Run bounded diagnostic commands.
   Use `run_command` with `mode="pty"` by default so the command inherits the prepared shell state.
   Use `mode="exec"` only for stateless checks that must not inherit `cd`, `sudo`, or exported variables.
5. Analyze evidence, not guesses.
   Base findings on returned `stdout`, `stderr`, `exitCode`, and `durationMs`.
   State when a conclusion is tentative or when more evidence is needed.
6. Close the session when the investigation is complete.
   Use `close_session` unless the user is actively continuing the same diagnosis.

## Command Rules

Use read-only and bounded commands unless the user explicitly requests a mutating action.

Avoid interactive commands such as `vim`, `top`, `less`, `tail -f`, and anything that blocks indefinitely.

Prefer explicit limits:

- Add `head`, `tail`, `timeout`, `-n`, or `LIMIT`.
- Scope log reads to recent lines or a concrete file.
- Prefer one focused command over a wide pipeline when possible.

Treat raw command output as evidence. Summarize the important lines instead of dumping long logs unless the user asks for the full text.

## Failure Handling

If `resolve_node` does not match a node, ask for the exact node name, alias, or connection parameters.

If `open_session` fails, explain whether the failure is network, SSH auth, jump host, or local credential related.

If `prepare_session` fails, stop and surface which step failed unless the user explicitly asks to continue despite partial preparation.

If a command returns ambiguous output, run one or two narrower follow-up commands instead of guessing.

## Output Format

When presenting a diagnosis, include:

1. Current symptom.
2. Key evidence.
3. Most likely cause.
4. Confidence level or uncertainty.
5. Recommended next action.

Read [references/mcp-tools.md](references/mcp-tools.md) when you need the exact tool sequence, parameter names, or sample payloads.

Read [references/invocation-templates.md](references/invocation-templates.md) when you need ready-to-use prompt templates for invoking this skill in different diagnosis scenarios.

Read [references/invocation-templates-zh.md](references/invocation-templates-zh.md) when the invocation prompt should be written in Chinese.
