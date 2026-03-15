# DevUtility Agent Diagnosis Invocation Templates

Use these templates when invoking `$devutility-agent-diagnosis`.

## 1. Diagnose a Registered Node by Name

```text
Use $devutility-agent-diagnosis to diagnose the issue on node "<node name or alias>".
Resolve the node first, open or reuse a session, run the default prepare profile if one exists, then execute bounded read-only diagnostic commands.
Focus on "<symptom>".
Return:
1. symptom summary
2. key evidence
3. likely root cause
4. next recommended command or action
```

Example:

```text
Use $devutility-agent-diagnosis to diagnose the issue on node "主库1".
Resolve the node first, open or reuse a session, run the default prepare profile if one exists, then execute bounded read-only diagnostic commands.
Focus on "mysql replication lag keeps increasing".
Return:
1. symptom summary
2. key evidence
3. likely root cause
4. next recommended command or action
```

## 2. Diagnose by Exact IP or Direct Connection

```text
Use $devutility-agent-diagnosis to diagnose a host that may not be registered.
If the node cannot be resolved, open a session with a direct connection using host "<ip>", port "<port>", username "<username>", and the available local auth method.
Run prepare steps only if required by the target environment.
Investigate "<symptom>" using safe read-only commands and summarize the evidence.
```

## 3. Continue an Existing Investigation

```text
Use $devutility-agent-diagnosis to continue an existing diagnosis session.
List active sessions, pick the session for "<node name or host>", keep the current PTY context, and run only the additional commands needed to confirm or reject "<hypothesis>".
Return the new evidence and whether the hypothesis is supported.
```

## 4. Service Unavailable Diagnosis

```text
Use $devutility-agent-diagnosis to investigate why service "<service name>" is unavailable on node "<node name>".
After preparing the shell, check process state, listening ports, recent error logs, system resources, and any obvious OOM or disk-full signals.
Prefer bounded commands such as ps, ss, tail, grep, df, free, and dmesg with limits.
Return:
1. current outage symptom
2. strongest evidence
3. most likely fault domain
4. immediate next action
```

## 5. Slow Response or Performance Regression

```text
Use $devutility-agent-diagnosis to investigate latency or throughput degradation on node "<node name>".
Check load, CPU, memory, disk latency, thread pressure, and recent application warnings with bounded commands.
Do not use interactive commands.
Explain whether the evidence points to CPU saturation, memory pressure, disk I/O, network issues, or downstream dependency delay.
```

## 6. Storage or Log-Focused Diagnosis

```text
Use $devutility-agent-diagnosis to inspect storage or log anomalies on node "<node name>".
Prepare the shell context, change into the relevant directory if needed, and run focused commands against "<path or device>".
Capture only the most relevant output and explain what it implies.
```

## 7. Strict Safe Mode

```text
Use $devutility-agent-diagnosis in strict safe mode on node "<node name>".
Only use read-only commands.
Avoid package installation, file modification, service restarts, or any potentially mutating action.
If more access would be required to continue, stop and say exactly what additional action is needed.
```

## 8. Template for Agent Frameworks

Use this when another orchestrator or agent runtime needs a stable prompt body:

```text
Use $devutility-agent-diagnosis.
Target: <node name, alias, nodeId, or host>
Goal: <problem statement>
Constraints:
- prefer registered nodes
- reuse session if possible
- run prepare profile before PTY commands when available
- use bounded read-only commands unless explicitly told otherwise
- summarize evidence instead of dumping large logs
Output:
1. symptom
2. evidence
3. likely cause
4. confidence
5. next step
```

## 9. Human-in-the-Loop Diagnosis

```text
Use $devutility-agent-diagnosis for a collaborative investigation.
Target: <node name, alias, nodeId, or host>
Symptom: <problem statement>
Plan:
- start with a bounded first-pass diagnosis
- if confidence stays low or evidence conflicts, do not keep guessing
- instead, summarize what has been checked, what remains unexplained, and ask me for the exact missing context or suspicious log clue
- after I reply, reuse the current session and run only the focused follow-up commands needed to test that hint
Output:
1. symptom
2. confirmed evidence
3. unresolved gap
4. what you need from me
5. next hypothesis after my reply
```

## 10. SOP-First Diagnosis

```text
Use $devutility-agent-diagnosis in SOP-first mode.
Target: <node name, alias, nodeId, or host>
Symptom: <problem statement>
Execution rules:
- first identify whether an existing SOP or SOP fragment applies
- if a SOP fits, follow its intent, variables, checks, and decision points instead of improvising from scratch
- if the SOP only partially fits, use it as the baseline and clearly separate the new delta
- after diagnosis, report which SOP parts were reused and which new steps should be solidified back into SOP
Output:
1. chosen SOP or SOP fragment
2. evidence
3. likely cause
4. SOP gap
5. candidate SOP updates
```

## 11. Minimal Invocation

```text
Use $devutility-agent-diagnosis to diagnose "<problem>" on "<node>" and summarize the evidence and likely cause.
```
