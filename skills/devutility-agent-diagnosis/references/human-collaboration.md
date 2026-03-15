# Human Collaboration Loop

Use this reference when `$devutility-agent-diagnosis` cannot yet converge on a defensible root-cause hypothesis.

## When to Escalate

Escalate to the user when any of these conditions is true:

- The first-pass diagnosis finished but confidence is still low.
- Two successive follow-up commands produced little or conflicting evidence.
- Command policy blocks the next useful probe.
- The remaining uncertainty depends on business semantics, release context, topology, or expected behavior that logs cannot explain by themselves.
- The user explicitly wants to inspect the logs and steer the next step.

Do not keep issuing random commands after these triggers. Pause and ask for help.

## What to Send Back to the User

Use a compact handoff with five parts:

1. `Current symptom`
   What is broken right now.
2. `Checked evidence`
   The commands, findings, or log fragments that already narrow the problem.
3. `Unresolved gap`
   What still does not fit the current evidence.
4. `Need from user`
   The exact missing context, suspicious log clue, business expectation, or approval needed.
5. `Proposed next step`
   The single best hypothesis or the one to three commands you plan to run after the user replies.

Example:

```text
Current symptom:
- order-service returns 502 on part of the traffic

Checked evidence:
- process is running
- 8080 is listening
- recent journalctl shows repeated timeout against payment-gateway

Unresolved gap:
- infra signals look healthy, but the logs do not explain whether this timeout started after a release or after an upstream dependency change

Need from user:
- confirm whether payment-gateway was changed today
- point out any suspicious log line from the business side that should become the next search keyword

Proposed next step:
- verify payment-gateway connectivity and compare current errors with the time of the latest release
```

## How the User Can Help

Accept any of these user inputs as valid steering:

- A business hypothesis
  Example: "This started after the payment SDK upgrade."
- A suspicious log line or keyword
  Example: "Search for tenant mismatch or merchant not found."
- A scope correction
  Example: "Do not stay on this node; check the gateway node instead."
- A next-step approval
  Example: "Add `kubectl` and check pod events."

## How to Resume After User Input

After the user replies:

1. Restate the user's hint as one explicit hypothesis.
2. Reuse the current session if it is still valid.
3. Run the smallest command set that can confirm or reject that hypothesis.
4. Report the delta:
   What new evidence appeared, and whether the user's hint was supported.
5. Either converge on the cause or enter one more collaboration round.

Keep each resumed round narrow. One user hint should usually produce one focused batch of follow-up commands.

## What to Solidify After Resolution

If the incident becomes a repeatable pattern, promote it into reusable assets:

- Add or refine `analysisRules` for the recurring error signatures.
- Add prompt wording or invocation templates when the symptom pattern is common.
- Add `prepare profile` guidance when the same context setup is repeatedly required.
- Add knowledge-base tags or retrieval keywords when the same evidence path is likely to recur.
- Update this skill when the useful sequence depends on non-obvious human checkpoints.

The goal is that the next investigation reaches the same turning point faster, asks the user fewer questions, and asks better ones.
