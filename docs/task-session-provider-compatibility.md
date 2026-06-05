# Task Session Provider Compatibility

This is the builder-facing compatibility contract for the Task Session Control
primitive. Use it when wiring Codex, Claude, terminal, or custom agent sessions
into eventloopOS without depending on provider internals.

## Stable Runtime Shape

`GET /task-sessions` returns `TaskRuntimeSession` records. Builders can rely on:

- `id`: stable session id used by `/task-sessions/:id/*` routes.
- `task_id`: current bound task, when known.
- `provider`: provider label such as `codex`, `claude`, `fake`,
  `terminal`, or `composite`. The field is string-extensible for custom
  providers.
- `status`: `idle`, `running`, `blocked`, `stopped`, `lost`, or a provider
  extension string.
- `native_thread_id`: provider-native thread/session id when available.
- `name`, `preview`, `cwd`: display and routing hints.
- `terminal_ref`: optional terminal send target for followups.
- `pid`, `agent_pid`, `terminal_pid`, `root_pid`, `pids`: process ownership
  hints for task-window claims and agent-spawned window attribution.

Unknown provider fields are allowed and must be preserved by builders that
proxy or cache session records.

## Provider Matrix

| Provider | Current source | Stable controls | Process/window attribution |
| --- | --- | --- | --- |
| `codex` | Codex native thread/app-server adapter plus task map binding | list, get, start, bind, followup, replacement when adapter is configured | `native_thread_id`, normalized `root_pid`, `pids`, optional `terminal_ref` |
| `claude` | Claude CLI session config adapter | list, get, followup where configured | normalized `root_pid`, `pids`, optional `cwd`/display metadata |
| `fake` | Development controller | list, get, start, bind, followup, replacement | deterministic fixture `root_pid`/`pids` for tests |
| `terminal` | Terminal send adapter for bound sessions | followup through `terminal_ref` | `terminal_ref` is the routing key |
| `composite` | Fan-in controller across configured providers | delegates to owning provider | preserves provider-owned ids, pids, and terminal refs |

## Terminal Refs

`terminal_ref` is an execution contract, not just a label. The API accepts only
schemes that the current Send-to-Agent executor can actually drive:

- `ghostty:front`: selected tab of the front Ghostty window.
- `ghostty:win-<id>`: selected tab of a specific Ghostty window id.
- `ghostty:<terminal-id>`: specific Ghostty terminal id.
- `tmux:<target-pane>`: tmux target accepted by `tmux send-keys -t`.

Do not emit `kitty:` or `wezterm:` terminal refs until matching executors are
implemented. Keep those terminals as provider metadata or custom fields instead.

## Process Ownership

Providers should fill the most specific process fields they know:

- `terminal_pid`: terminal process that owns the visible session.
- `agent_pid`: agent process if known separately from the terminal.
- `pid`: legacy single-process hint.
- `root_pid`: process-tree root used for task-window claims.
- `pids`: known process ids in the same task session.

The orchestrator normalizes these fields by choosing `root_pid` from
`root_pid`, `terminal_pid`, `pid`, then `agent_pid`, and by de-duplicating all
positive pids into `pids`. This is what lets background agent-spawned windows be
claimed back to the owning task instead of polluting the active paper.

## Builder Rules

- Use `/task-sessions/:id/task-binding` to bind a session to a task; do not
  edit provider-local maps directly.
- Send followups through `/task-sessions/:id/followup`; the orchestrator will
  use provider-native transport or terminal send based on the bound session.
- Treat `blocked`/`lost` statuses as attention-routing signals, not hard
  failures. They can create queue papers or trigger replacement.
- Preserve unknown fields when forwarding session records so custom providers
  can add metadata without breaking shared clients.
- Use `@eventloopos/shared/primitives` request builders and the operation
  client so request/response schemas catch drift before a live provider call.

## Proofs

- Shared schema and operation coverage:
  `pnpm --filter @eventloopos/shared run test:primitive-ops`
- Provider controller tests:
  `app/orchestrator/src/task_sessions/*test*`
- Terminal send executor tests:
  `app/orchestrator/src/task_sessions/terminal_send.test.ts`
- End-to-end runtime smoke:
  `bin/task-runtime-smoke`
