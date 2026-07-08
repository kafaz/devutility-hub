# SOP Understanding And Evolution

Use this reference when `$devutility-agent-diagnosis` should reason with SOP content, not just free-form commands.

## What The Agent Must Understand About A SOP

A SOP is not just a command list. Treat it as a reusable diagnosis model with these layers:

1. `Meta`
   Name, category, description, and diagnosis hints describe when the SOP applies.
2. `Variables`
   Inputs that should be supplied before execution, such as service name, log path, mount path, tenant, or port.
3. `Checks`
   High-level diagnosis goals such as process check, port check, log check, or resource check.
4. `Sub-steps`
   Ordered commands that share context and may capture variables for later steps.
5. `Capture and regex rules`
   `captureVar`, `capturePattern`, `normalRegex`, and `abnormalRegex` encode evidence extraction and decision logic.
6. `Hints`
   Diagnosis hints explain why the SOP exists and what root-cause families it is expected to distinguish.

When reading a SOP, ask:

- What symptom family is it designed for?
- Which variables must be known first?
- Which checks are reusable even if the full SOP is not?
- Which outputs are meant to confirm normality or abnormality?
- Which follow-up branch would still need human judgment?

## SOP-First Decision Rule

Prefer SOP-first diagnosis when one of these is true:

- The symptom matches a known domain pattern and there is an existing SOP in that domain.
- A previous incident already stabilized the first few checks.
- The user explicitly asks to follow a known SOP.
- The target environment is sensitive and should avoid exploratory command drift.

Prefer manual-first diagnosis when:

- No SOP fits the symptom family.
- The issue is novel and the likely first step is hypothesis generation.
- The remaining uncertainty is too narrow for a full SOP and only one or two commands are needed.

Use hybrid mode when:

- Part of the SOP is clearly applicable, but the incident includes a new branch.
- The SOP gives a safe baseline and manual commands can fill the new gap.

## Progressive Solidification Ladder

Do not wait for a perfect full SOP. Solidify useful pieces progressively:

### Level 0: Ad-hoc investigation

One-off commands, hypotheses, and user hints.

### Level 1: Candidate note

A successful mini-path is recorded as:

- symptom pattern
- commands used
- strongest evidence
- next-step logic

### Level 2: SOP fragment

Promote one reusable unit such as:

- one check
- one sub-step chain
- one variable and capture rule
- one normal or abnormal regex pair
- one diagnosis hint

### Level 3: Stable SOP template update

Promote the fragment into an existing SOP or create a new template when:

- the sequence is repeatable
- the commands are safe and bounded
- the variables are understandable
- the outputs have stable interpretation

### Level 4: Domain SOP

Create or revise a domain SOP when multiple incidents share:

- the same symptom family
- the same early decision tree
- the same confirmation or rejection signals

## What To Promote Into SOP

Promote these items first:

- stable entry conditions
- reusable checks
- captured variables that simplify later steps
- normal and abnormal regex rules
- diagnosis hints that reduce blind search
- user questions that repeatedly unblock the diagnosis

Do not promote:

- one-off environment quirks that are too specific
- long raw logs
- commands that are unsafe, brittle, or open-ended
- conclusions that still depend on undocumented human intuition

## How To Extract SOP Material From A Manual Investigation

After a successful investigation:

1. Identify the smallest reusable unit.
2. Separate common steps from incident-specific steps.
3. Convert repeated input values into SOP variables.
4. Convert string matching into `normalRegex` or `abnormalRegex` where possible.
5. Add a short diagnosis hint that explains the intended fault domain.
6. Mark whether this should become:
   - a candidate fragment
   - an update to an existing SOP
   - a new SOP template

## Human Collaboration In SOP Evolution

When the Agent proposes SOP solidification, ask the user to confirm:

- whether the path is actually repeatable
- whether the wording matches the business symptom
- whether a step is too specific to one node, tenant, or release
- whether a human checkpoint should remain explicit

The user does not need to approve every wording change, but should confirm that a new SOP will not encode a misleading shortcut.

## Current Product Boundary

This repository already has:

- server-side `exec_plan` support over the existing shell

The MCP side does not yet expose a first-class `run_sop` or `list_sop_templates` tool. Until that exists:

- use SOP as a reasoning and authoring artifact
- reuse its structure to shape `prepare_session`, `run_command`, and `run_commands_batch`
- record which parts should later become formal MCP-accessible SOP tools

## Recommended Future MCP Additions

When productizing SOP-driven diagnosis for Agents, add tools like:

- `list_sop_templates`
- `get_sop_template`
- `run_sop`
- `save_sop_candidate`
- `promote_sop_candidate`

These are future design targets, not current runtime guarantees.
