# Broader Agent Ecosystem Lessons

Research date: May 6, 2026.

This is not plan to build OpenClaw/Hermes clone. This is lesson capture for eventloopOS.

EventloopOS job:

```text
schedule human attention
restore context
route background agent work
surface only blocked/risky human decisions
```

Agent frameworks teach runtime, safety, memory, and testing patterns.

## Sources Checked

Primary/high-signal:

- Hermes Agent: https://github.com/NousResearch/hermes-agent
- OpenClaw docs: https://docs.openclaw.ai/
- ZeroClaw: https://github.com/zeroclaw-labs/zeroclaw
- SwarmClaw: https://github.com/swarmclawai/swarmclaw
- NemoClaw: https://github.com/NVIDIA/NemoClaw
- Letta stateful agents: https://docs.letta.com/guides/core-concepts/stateful-agents/
- CrewAI human feedback: https://docs.crewai.com/en/learn/human-feedback-in-flows
- CrewAI events: https://docs.crewai.com/en/concepts/event-listener
- LangGraph durable execution: https://docs.langchain.com/oss/python/langgraph/durable-execution
- SemaClaw paper: https://arxiv.org/abs/2604.11548
- Structured Graph Harness paper: https://arxiv.org/abs/2604.11378
- OpenClaw PRISM paper: https://arxiv.org/abs/2603.11853
- ClawGuard paper: https://arxiv.org/abs/2604.11790

Local clones:

- `external-resources/repos/zeroclaw` at `d145a24`
- `external-resources/repos/swarmclaw` at `7a8ee1b`

Note:

Many "best OpenClaw alternatives" pages are SEO sludge. Use primary repos/docs/papers for plan.

## Market Shape

Agent ecosystem has lanes:

- personal gateway assistants: OpenClaw, Hermes, ZeroClaw.
- multi-agent control planes: SwarmClaw.
- stateful agent servers: Letta.
- workflow/graph engines: LangGraph, CrewAI Flows.
- security guardrails: PRISM, ClawGuard, NemoClaw/OpenShell.

eventloopOS sits across lane:

```text
not agent brain
not chat surface
not generic workflow builder

attention scheduler + workspace/context runtime + human review router
```

Use existing agents as workers. Do not compete with them.

## Gateway, But Narrow

OpenClaw/ZeroClaw/Hermes converge on gateway:

- channel adapters.
- agent loop.
- tools.
- memory.
- schedules.
- policy.
- dashboard/CLI.

eventloopOS also needs gateway, but narrower:

- inbound source events.
- task/session registry.
- human queue.
- workspace restore.
- policy/hook checks.
- background task message routing.

Do not own every channel deeply at v0. Use MCP pollers and existing Codex/Hermes/OpenClaw/CLI agents as workers.

## Stateful Memory Is Resource Graph

Letta separates agent, memory blocks, messages, runs/steps, conversations.

For us:

- task.
- context resources.
- events.
- task sessions.
- review packets.
- decisions.

Memory should not be one big transcript. Use typed blocks:

```text
TaskMemoryBlock
  objective
  current blocker
  active resources
  last human decision
  external thread ownership
  agent status
  workspace restore hints
```

Blocks can attach to multiple tasks if resource overlaps.

## Durable Human Pauses

LangGraph durable checkpoints teach:

```text
human interrupt = persisted state + resume pointer
```

For eventloopOS, every queue item needs:

- task session id.
- run/step id.
- pending action id.
- idempotency key.
- context snapshot id.
- expected next state.

No queue item should be prose only. It must be machine-resumable.

## Human Feedback Routes Work

CrewAI human feedback can collapse feedback into outcomes and route flows.

Use same pattern:

```text
approve
reject
revise
defer
needs_more_context
route_elsewhere
change_priority
split_task
```

Human answer should route next state. Review packet UI should support structured choice + short note, not only done.

## Procedures Keep Agents Grounded

ZeroClaw SOP engine has event triggers, approval gates, and resumable run state.

For us, call this `Procedure`.

Use for repeated human-review loops:

- external send approval.
- PR review.
- blog draft review.
- incident triage.
- meeting follow-up.
- deploy/prod action.

Procedure skeleton:

```text
trigger -> gather evidence -> run agent -> risk check -> human packet -> resume/execute
```

Agents fill content. Control flow stays inspectable.

## Receipts Matter

ZeroClaw tool receipts prove tool call happened.

For us, need `EvidenceReceipt` for:

- MCP poll result.
- source event normalization.
- workspace restore attempt.
- task message sent.
- external draft/send.
- test command run.
- browser capture.

Receipt can be simple v0:

```text
receipt_id
action_type
input_hash
output_hash
timestamp
actor/session
previous_receipt_hash
```

Goal:

- agent cannot claim test passed without command artifact.
- queue packet can show proof.
- audit trail can reconstruct what happened.

Do hash chain + logs first. Crypto polish later.

## Autonomy By Surface

ZeroClaw has ReadOnly/Supervised/Full. Good, but eventloopOS needs per-surface grants:

```text
source_read
context_read
workspace_restore
task_message
local_write
external_draft
external_send
prod_action
money_action
credential_action
```

Example:

- Slack MCP can read DMs, draft reply, but cannot send.
- Chrome extension can read allowlisted tab text, but cannot click/type.
- Codex task can edit local branch, but cannot push main.

## Operator Dashboard

SwarmClaw org chart/live activity useful, but not main product.

We need attention dashboard:

- running task sessions.
- blocked tasks.
- stale tasks.
- recent routed events.
- source health.
- queue pressure.
- confidence/risk distribution.
- what agents are polling.

Main UX still one hotkey/queue. Dashboard is debug/ops view.

## Multi-Agent Needs Ownership + Budget

Many agents create risk:

- duplicate work.
- token burn.
- two agents act on same thread.
- lost blockers.

For us:

- task has owner session.
- resource has ownership lock.
- task has budget/timebox.
- task has heartbeat/status.
- master loop can pause low-priority agents.
- background work must justify human queue item with evidence.

## Security Needs Runtime Hooks

PRISM and ClawGuard converge on runtime enforcement:

- tool boundary checks.
- lifecycle hooks.
- session risk accumulation.
- policy over domains/tools/paths/private networks.
- outbound secret detection.
- audit plane.

For us, hook boundaries:

- before route to task.
- before task message.
- before workspace restore.
- before local file write request.
- before external draft/send.
- before browser automation.
- after tool/source result before model sees it.

Treat all source content as untrusted: Slack, web page, MCP result, doc text.

## Structured Control Plane

Structured Graph Harness paper says raw loops have implicit deps, unbounded recovery, mutable history.

For us:

- background task can use free-form agent.
- eventloop control plane should stay structured.

State machine:

```text
new -> routed -> running -> waiting_human -> resumed -> verifying -> done
                         -> failed -> retrying -> escalated
```

Recovery policy:

- max retries.
- then smaller task.
- then human packet.
- never infinite try-again.

## Plan Changes

Add:

- `EvidenceReceipt`.
- `Procedure`.
- `TaskMemoryBlock`.
- `AutonomyGrant`.
- `SourceHealth`.
- `TaskHeartbeat`.

Test:

- receipt chain.
- fake "agent claims test passed but no receipt".
- procedure pause/resume.
- prompt-injection source fixtures.
- budget/timebox.

UX:

- queue packet shows proof chips: tests, source, route, restore, send.
- debug dashboard shows source health + live task activity.

Avoid v0:

- full agent marketplace.
- agent social network.
- broad chat assistant.
- deep multi-agent org chart.
- cloud/remote fleet.

