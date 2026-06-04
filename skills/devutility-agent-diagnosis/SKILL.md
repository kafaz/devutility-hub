---
name: devutility-agent-diagnosis
description: Diagnose remote Linux, middleware, storage, or service faults through the local DevUtility Hub MCP tools. Use when Codex needs to resolve a registered node, open or reuse a PTY-backed session, run prepare steps, execute diagnostic commands, and convert command output into a structured troubleshooting conclusion for the user.
---

# Devutility Agent Diagnosis

## Overview

Use the local DevUtility Hub service as the execution plane and the MCP server as the tool interface. Prefer registered nodes and prepare profiles so connection setup, context preparation, and command execution stay repeatable.

When an Agent enters this repository, load this skill before using any DevUtility Hub SSH or diagnosis tool. Treat `mcp-server/src/index.ts` as the MCP adapter, `server/index.js` as the local execution plane, and `server/commandPolicy.js` as the authoritative command whitelist boundary.

This skill supports two working modes:

- A SOP-first diagnosis path when a reusable SOP exists or can be partially reused
- A fast first pass through `recall_similar_runs` and `troubleshoot`
- An interactive drill-down through `open_session`, `prepare_session`, and `run_command`

When evidence is weak, conflicting, or blocked, stop the blind search and switch into a structured user-collaboration loop.
When a repeatable path emerges, convert the useful parts into SOP material instead of leaving them as one-off commands.

## Repository Bootstrap

1. Confirm the local proxy service is running at `DEVUTILITY_AGENT_BASE_URL` or the default `http://127.0.0.1:3001`.
2. If MCP tools are unavailable, build the adapter with `cd mcp-server && npm install && npm run build`.
3. Register the MCP server as `devutility-hub-agent`; use `mcp-server/examples/codex_config.toml` for Codex-style clients or `mcp-server/examples/claude_desktop_config.json` for Claude Desktop-style clients.
4. Run `health_check` before opening sessions or running commands.
5. Do not bypass MCP by invoking local shell `ssh` directly unless the user explicitly asks for manual SSH outside DevUtility Hub.

## Workflow

1. Frame the target and the symptom.
   Use `resolve_node` when the user gives a name, alias, role, or IP.
   Use `list_nodes` first when the user is unsure which node to target.
   Use `recall_similar_runs` when the symptom is broad or when a historical starting point would reduce guesswork.
2. Check whether a SOP should drive the diagnosis.
   Prefer an existing SOP when the symptom matches a known domain pattern such as service unavailable, slow response, network checks, or storage checks.
   Reuse part of a SOP when the overall incident is new but some checks, variables, or regex rules are clearly reusable.
   Fall back to manual commands only when no suitable SOP exists or the remaining uncertainty is narrower than the SOP.
3. Choose the execution mode.
   Use `troubleshoot` for a bounded first-pass diagnosis when the user already gave the symptom, collection plan, or a preset/direct connection.
   Use the manual session flow when you need fine-grained control, when you are continuing an existing investigation, or when you need to validate a user-supplied hypothesis step by step.
   Treat SOP as a diagnosis scaffold: category, hints, variables, checks, sub-steps, capture rules, and normal or abnormal signals are all part of the reasoning context.
4. Open or reuse a session.
   Use `open_session` with `nodeId`, `presetId`, or direct connection fields and a short `reason`.
   Set `reuseIfExists=true` unless the user explicitly needs a fresh shell context.
   Save the returned `sessionId` together with the returned target identity: `nodeId`, `host`, `port`, and `username`.
5. Prepare the shell context only when needed.
   Use `list_prepare_profiles` to discover reusable prepare flows.
   Use `prepare_session` with `profileId` before issuing diagnosis commands when the target needs environment loading or a known working directory.
   Always pass `target` with the intended `nodeId` or `host`, plus `port` and `username` when known; if the tool returns `targetGuard.ok=false`, stop because the session is not the node you intended.
6. Validate the next command when it is not a trivial known-good read-only probe.
   Use `validate_command` before `run_command` when a command includes shell operators, user-supplied paths, service-specific binaries, SQL, curl options, or any command you have not already confirmed is allowed.
   If validation returns `allowed=false`, do not change the whitelist automatically. Stop, report the blocked reason, and either choose a safer read-only command or ask the user to approve a policy change.
7. Run bounded diagnostic commands.
   Use `run_command` with `mode="pty"` by default so the command inherits the prepared shell state.
   Use `mode="exec"` only for stateless checks that must not inherit `cd`, `sudo`, or exported variables.
   Always include the same `target` assertion used for prepare. Never run a command using only `sessionId`.
8. Analyze evidence, not guesses.
   Base findings on returned `stdout`, `stderr`, `exitCode`, and `durationMs`.
   Also check returned `session`, `command`, `policy`, and `targetGuard` metadata when present so you can confirm the target node and command boundary before drawing a conclusion.
   State when a conclusion is tentative or when more evidence is needed.
9. Escalate to the user when stuck.
   Stop after one or two low-yield follow-up commands instead of continuing a random search.
   Ask for user help when the issue depends on business context, suspicious log interpretation, release knowledge, or a higher-risk next action.
   Report what has already been checked, what remains unexplained, and what exact user input would unblock the next step.
10. Resume with the user's direction.
   Convert the user's hint into one explicit hypothesis.
   Run only the one to three commands needed to confirm or reject that hypothesis.
   Summarize what changed after the user's intervention.
11. Close or keep the session intentionally.
   Use `close_session` unless the user is actively continuing the same diagnosis.
12. Capture what should become reusable.
   If the incident exposed a repeatable decision path, note which commands, evidence patterns, user questions, variables, and branch points should be promoted into the diagnostic knowledge base or a SOP.
   Prefer promoting stable fragments first: one check, one variable, one regex pair, or one diagnosis hint can become SOP material before a full template exists.

## Command Rules

Use read-only and bounded commands unless the user explicitly requests a mutating action.

Avoid interactive commands such as `vim`, `top`, `less`, `tail -f`, and anything that blocks indefinitely.

Prefer explicit limits:

- Add `head`, `tail`, `timeout`, `-n`, or `LIMIT`.
- Scope log reads to recent lines or a concrete file.
- Prefer one focused command over a wide pipeline when possible.

Treat raw command output as evidence. Summarize the important lines instead of dumping long logs unless the user asks for the full text.

Do not use configuration-plane tools such as `save_node`, `save_prepare_profile`, `replace_command_policy`, `allow_command`, `remove_allowed_command`, or `reset_command_policy` during normal diagnosis unless the user explicitly asks you to change local configuration. A command blocked by policy is a stop condition, not permission to widen the policy on your own.

## Failure Handling

If `resolve_node` does not match a node, ask for the exact node name, alias, or connection parameters.

If `open_session` fails, explain whether the failure is network, SSH auth, jump host, or local credential related.

If `prepare_session` fails, stop and surface which step failed unless the user explicitly asks to continue despite partial preparation.

If `troubleshoot` returns partial findings or low confidence, use `get_diagnostic_run`, `get_session_logs`, and one or two narrower follow-up commands instead of restarting from scratch.

If a command returns ambiguous output, run one or two narrower follow-up commands instead of guessing.

If command policy blocks the next useful probe, stop and ask the user whether to adjust the whitelist, pick a different read-only command, or hand over the missing evidence manually.

If target guard blocks a prepare, command, or troubleshoot call, do not retry on another active session. Report the expected target, the actual session target, and the mismatched fields, then reopen or resolve the intended node explicitly.

If the diagnosis depends on business semantics that are not visible from system logs, switch to the user-collaboration loop rather than pretending the infrastructure data is sufficient.

If an existing SOP is close but incomplete, do not discard it. Reuse the matching checks, then describe the missing delta that should become the next SOP refinement.

## Output Format

When presenting a diagnosis, include:

1. Current symptom.
2. Key evidence.
3. Most likely cause.
4. Confidence level or uncertainty.
5. Recommended next action.

When you are stuck, include:

1. What is already confirmed.
2. What is still unexplained.
3. Which commands or runs were already checked.
4. What exact input you need from the user.
5. The recommended next hypothesis after the user responds.

When a SOP should be updated, include:

1. Which SOP or SOP fragment was reused.
2. Which step, variable, regex, or hint was missing.
3. Whether the gap should be stored as a candidate fragment or promoted into a stable SOP update.

Read [references/mcp-tools.md](references/mcp-tools.md) when you need the exact tool sequence, parameter names, or sample payloads.

Read [references/human-collaboration.md](references/human-collaboration.md) when the diagnosis needs user intervention, escalation thresholds, or a resume protocol after the user inspects logs.

Read [references/sop-evolution.md](references/sop-evolution.md) when you need to interpret SOP structure, decide whether SOP should lead the diagnosis, or turn a successful manual path into reusable SOP material.

Read [references/invocation-templates.md](references/invocation-templates.md) when you need ready-to-use prompt templates for invoking this skill in different diagnosis scenarios.

Read [references/invocation-templates-zh.md](references/invocation-templates-zh.md) when the invocation prompt should be written in Chinese.
