# Lessons From Hermes Agent + OpenClaw

Research date: May 6, 2026.

Local clones:

- `external-resources/repos/hermes-agent` at `a345f7b`
- `external-resources/repos/openclaw` at `16922649`

Source links:

- Hermes Agent: https://github.com/NousResearch/hermes-agent
- Hermes tools docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
- OpenClaw Codex harness: https://docs.openclaw.ai/plugins/codex-harness
- OpenClaw gateway architecture: https://docs.openclaw.ai/concepts/architecture
- OpenClaw steering queue: https://docs.openclaw.ai/concepts/queue-steering
- OpenClaw plugin hooks: https://docs.openclaw.ai/plugins/hooks
- OpenClaw sandboxing: https://docs.openclaw.ai/gateway/sandboxing

## Big Lesson

Do not build giant app blob.

Build local gateway + typed protocol + adapters + tests.

EventloopOS should be:

```text
local gateway daemon
typed clients
adapter/plugin seams
session/task registry
human queue
workspace restore backends
test harness from day one
```

## Hermes Lessons

Hermes useful because it already solves many agent-harness survival problems.

Steal these patterns:

- persistent memory + session search for cross-task recall.
- cron/background automations as first-class thing.
- messaging gateway across Slack/Discord/Telegram/Email/etc.
- dynamic MCP toolsets.
- subagents for parallel work.
- terminal backends: local, Docker, SSH, cloud sandbox.
- approval tool and command guardrails.
- browser/CDP tool behind policy.

Most important code lesson: MCP runtime must be hardened.

Need:

- per-server timeout.
- reconnect with backoff.
- circuit breaker with half-open probe.
- subprocess PID tracking.
- orphan MCP child cleanup.
- MCP stderr redirected to log file, not TUI.
- credential stripping in logs.
- env filtering before server spawn.
- dynamic server discovery/reload.
- sampling/tool-call policy gates.

Cron/background prompts also need prompt-injection scan:

- block obvious exfiltration phrases.
- block invisible unicode/control weirdness.
- constrain script paths.
- never let scheduled agent text auto-run sensitive side effects.

## OpenClaw Lessons

OpenClaw more directly relevant. It is gateway + channels + agents + plugins.

Steal these patterns:

- one local Gateway owns external connections.
- clients connect over typed WebSocket.
- first frame is handshake.
- JSON Schema validates frames.
- idempotency keys required for side effects.
- events are not replayed; clients refresh on gaps.
- config has strict schema + last-known-good.
- `doctor` command explains broken setup.
- sessions bind to runtime/thread and stay sticky.
- Codex app-server can own native Codex thread while gateway owns channels/routing/policy.
- slash/control commands can bind, resume, steer, compact, review.

For us:

```text
orchestrator = eventloop Gateway
mac app = control client
browser extension native host = client/node
task agents = sessions/runtimes
MCP pollers = source plugins
workspace backend = node capability
```

## Session Steering

Need modes for sending new info into running task agents.

Modes:

- `steer`: send into active run before next model decision if supported.
- `followup`: queue later turn after active run.
- `collect`: coalesce many compatible messages after debounce.
- `steer_backlog`: send now and also keep followup record.
- `interrupt`: stop active run and start newest message.

Why this matters:

Slack DM arrives while blog agent running. Router should not spawn duplicate agent. It should steer/followup into existing session depending state.

## Ownership Locks

Need external thread/resource ownership.

Problem:

```text
two agents see same Slack thread -> both draft/reply -> bad
```

Add lock table:

```text
OwnershipLock
  resource_key
  owner_task_id
  owner_agent_run_id
  lock_kind
  lease_expires_at
  evidence
```

Use for:

- Slack thread ownership.
- GitHub PR/review ownership.
- email thread ownership.
- browser page poll ownership.
- task agent session ownership.

Rule:

No external send or route into shared thread without lock or human decision.

## Hook Policy

Need typed hooks, but keep v0 tiny.

Hook seams:

- `before_route`
- `after_route`
- `before_task_message`
- `after_task_message`
- `before_action_execute`
- `after_action_execute`
- `before_workspace_restore`
- `message_sending`
- `source_event_received`

Hook decision can:

- allow.
- block.
- rewrite safe fields.
- require approval.
- attach evidence.

Must have timeout + priority + audit log.

## Plugin Shape

No plugin free-for-all in v0.

V0 plugin is adapter package with strict contract:

```text
SourceAdapter -> Event
AgentAdapter -> AgentRun/TaskSession
WorkspaceBackend -> RestoreResult
ContextTool -> Evidence/ContextResource
PolicyHook -> HookDecision
```

Future plugin SDK can expose narrow imports only. Architecture boundary tests enforce this.

## Trust Tiers

Borrow OpenClaw sandbox stance.

Trust tiers:

- `host_trusted`: main local user control.
- `task_sandbox`: non-main agents/tools in Docker/remote sandbox where possible.
- `browser_readonly`: extension can read allowed tabs/dom.
- `browser_debug`: CDP/debugger opt-in only.
- `external_draft`: agent can draft but not send.
- `external_send`: human-approved or explicit high-trust setting.

CDP/host browser control never default.

## Codex Integration Lesson

Prefer app-server/native thread path over terminal typing.

Need task session contract:

```text
TaskSession
  bind_native_thread
  resume_thread
  steer
  followup
  interrupt
  compact
  status
  list_threads
  read_events
```

Terminal injection stays fallback, visible and audited.

## Testing Lessons

Add tests for architecture, not only behavior.

Need:

- MCP reconnect/backoff/circuit breaker tests.
- orphan subprocess cleanup test.
- idempotency side-effect retry test.
- WS/schema protocol test.
- queue steering mode tests.
- ownership lock collision tests.
- hook block/approval/timeout tests.
- config schema + last-known-good tests.
- prompt snapshot tests.
- import-boundary tests.
- plugin/adapter contract test suite.

OpenClaw has many architecture-smell tests. We should copy idea early.

## Planning Change

MVP plan stays same, but foundation gets sharper:

- Orchestrator is local Gateway.
- Protocol is typed/schema-validated from start.
- Idempotency keys mandatory for side effects.
- Task sessions support steering modes.
- MCP source runtime hardened early.
- Ownership locks prevent duplicate agent action.
- Hook policy gates external writes.
- Plugin/adapters are contract-tested.
- Browser/CDP split uses trust tiers.

