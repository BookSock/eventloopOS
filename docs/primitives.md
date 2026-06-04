# eventloopOS Primitives

eventloopOS is currently a product, but the code already exposes reusable
operating-system control primitives. This document catalogs the primitives that
other tools could build on without taking the whole queue app.

Status labels:

- **Stable enough**: covered by unit/integration tests and used by dogfood.
- **Dogfood**: works in the Mac Studio flow, but API polish or broader host
  coverage is still needed.
- **Experimental**: useful internal surface, but not yet something to promise
  as a library contract.

The codebase is AGPL-3.0-only today. Treat this as an internal API catalog, not
as a published SDK promise.

## Runtime Spine

The orchestrator spine is the flat `Runtime` record in
`app/orchestrator/src/runtime.ts`. Routes and timers depend on fields in this
record instead of importing global singletons.

Primary fields:

- `store`: queue, tasks, contexts, task layouts, current task, manual mode,
  triggers, and observations.
- `workspace`: OS workspace capture/plan/restore backend.
- `taskSessions`: Codex/Claude/fake/terminal session control.
- `observability`: counters and activity events.
- `mcpSources`: polling sources that can become routed events.
- `ghosttyResolver`, `runOsascript`, `listRolloutFiles`: host-specific adapter
  hooks for Mac agent/session detection.

Why it matters: external builders can treat the runtime fields as the minimal
set of replaceable capabilities. For example, a non-Mac workspace backend can
implement `WorkspaceController` without touching queue routing.

Proof:

- `app/orchestrator/src/runtime.ts`
- route tests under `app/orchestrator/src/routes/*.test.ts`
- store conformance tests in `app/orchestrator/test/gateway_store_conformance.ts`

Status: stable enough as internal architecture; not yet packaged as public SDK.

## Workspace Control

Primitive: capture visible OS window state, plan a restore, execute a bounded
restore, and preserve task-specific window geometry.

Contract:

- `WorkspaceController.status()`
- `WorkspaceController.capture()`
- `WorkspaceController.planRestore(snapshot, currentWindows?)`
- `WorkspaceController.executeRestorePlan(plan)`

Current backend: AeroSpace + macOS System Events in
`app/orchestrator/src/workspace/aerospace.ts`.

Captured data:

- window id
- app name and bundle id
- title
- workspace
- monitor id
- process id
- layout
- frame `{ x, y, width, height }`
- active workspace
- focused window id

HTTP surface:

- `GET /workspace/status`
- `POST /workspace/capture`
- `POST /workspace/restore-plan`
- `POST /workspace/restore` with `confirm_execute: true` and
  `Idempotency-Key`

Useful standalone uses:

- "Save my whole desk and restore it later."
- "Move this task's windows to known positions."
- "Implement Rectangle-like hotkeys through a scriptable API."
- "Let an AI plan a desktop cleanup, then execute only validated window
  commands."

Safety boundaries:

- restore execution is gated by `ORCHESTRATOR_WORKSPACE_EXECUTE`
- restore rejects ungenerated/unsafe commands
- stale window ids are skipped
- frame restore requires title plus app or bundle identity
- idempotency prevents duplicate restore execution for repeated requests

Proof:

- `app/orchestrator/src/workspace/aerospace.test.ts`
- `app/orchestrator/src/workspace/controller.test.ts`
- `bin/lab-mac-geometry-proof`
- `bin/task-workspace-memory-proof-smoke`
- latest Mac Studio human demo manifest under `artifacts/lab-runs/*-human-demo/manifest.json`

Status: dogfood on macOS; public API needs versioned schema and stronger
cross-host story.

## Task Workspace Memory

Primitive: each task can own a saved workspace snapshot, and later papers for
that task inherit it.

HTTP surface:

- `POST /tasks`
- `GET /tasks`
- `GET /tasks/:id`
- `GET /tasks/:id/layout`
- `PUT /tasks/:id/layout`
- `POST /tasks/:id/workspace-snapshot`
- `GET /tasks/current`
- `POST /tasks/current`

Important behavior:

- one real window can be saved into more than one task/paper
- the same window can have different positions per task
- current task state drives ambient autosave and follows-window decisions

Proof:

- `app/orchestrator/test/ambient_workspace_saver_integration.test.ts`
- `bin/task-workspace-memory-proof-smoke`
- `bin/lab-mac-human-demo-setup`

Status: stable enough for eventloopOS dogfood; public API needs naming cleanup
between task layout and task workspace snapshots.

## Ambient Autosave

Primitive: while a current task is active, periodically capture the OS
workspace, filter it to intended windows, debounce changes, and persist the task
layout.

Code:

- `app/orchestrator/src/agents/ambient_workspace_saver.ts`

Guarantees today:

- skips while manual mode is active
- skips when no current task is bound
- debounces before writing
- records activity for committed/skipped/error states
- includes active-workspace windows and follows windows
- excludes eventloopOS/AeroSpace/Tailscale system windows
- excludes windows explicitly tagged for a different `[task:...]`
- excludes windows claimed by another task through `POST /task-window-claims`
- infers task-window claims from any captured window tagged `[task:<slug>]`

Why it matters: this is the primitive that makes window layout memory feel
automatic instead of like a manual "save workspace" button.

Known gap: tagged windows are inferred from OS snapshots and routed events can
auto-claim attached window resources, but truly untagged arbitrary
Codex/Claude-spawned windows still need first-class process/window emitters.

Proof:

- `app/orchestrator/src/agents/ambient_workspace_saver.test.ts`
- Mac Studio human demo `proofs.ambient_autosave.ok=true`

Status: dogfood; needs better foreign-window attribution before public API.

## Task Window Claims

Primitive: let an agent or tool declare that a window belongs to a specific
task, even if the window appears on the user's current workspace.

HTTP surface:

- `POST /task-window-claims`
- `GET /task-window-claims`

CLI surface:

- `bin/task-window-spawn --task-id TASK_ID -- COMMAND [ARGS...]`

Claim identity:

- exact `window_id`
- `app_bundle`
- `title_prefix`
- optional `ttl_ms`
- optional `source`

Useful standalone uses:

- background Codex/Claude test opens Chrome, emits a routed `app_window` or
  `spawned_window` resource, and ambient autosave avoids polluting the human's
  active paper
- a test command opens a window titled `[task:checkout] Playwright report`, and
  the ambient saver claims it for `task_checkout` from the OS snapshot even if
  the window appeared on the human's current workspace
- an agent wraps a visible test/browser launch with
  `bin/task-window-spawn --task-id task_checkout -- open -na "Google Chrome"`,
  and the wrapper claims any newly-created windows after the command exits
- browser automation can claim Playwright/Chrome report windows before the
  user sees them
- browser context capture auto-claims Chrome windows when the event attaches to
  a task
- routed agent events auto-claim `browser_tab`, `app_window`,
  `aerospace_window`, `window`, and `spawned_window` resources when they attach
  to a task
- tools can inspect current claims to explain why a window was ignored

Proof:

- `app/orchestrator/src/routes/task_window_claims.test.ts`
- `app/orchestrator/src/routes/events_task_window_claims.test.ts`
- `app/orchestrator/src/agents/ambient_workspace_saver.test.ts`
- `app/orchestrator/test/gateway_store_conformance.test.ts`
- `bin/task-window-spawn --self-test`

Status: dogfood. Browser context capture has an automatic emitter; generic
routed window resources are auto-claimed; tagged windows are inferred from OS
snapshots; command-wrapped untagged launches can be claimed; automatic
Codex/Claude OS process/window emitters are next.

## Follows Windows

Primitive: observe windows across workspaces and treat repeated multi-workspace
presence as "this window follows the user's current task."

Code:

- `app/orchestrator/src/agents/follows_window_orchestrator.ts`
- `app/orchestrator/src/routes/follows_windows.ts`

HTTP surface:

- `POST /follows-windows/exclude`

Important behavior:

- uses window id path and app-bundle/title-prefix slot path
- moves follows windows to the newly focused task workspace
- skips manual mode
- supports exclusions for things that should not follow

Useful standalone uses:

- pin a notes window or browser doc across several task workspaces
- make "shared context" follow focus without manual dragging

Known gap: user-facing controls for follow/unfollow are still thin. Current API
is an exclusion route, not a polished rule editor.

Proof:

- `app/orchestrator/src/agents/follows_window_orchestrator.test.ts`
- store follows-window conformance tests
- Mac Studio human demo shared TextEdit proof

Status: dogfood.

## Queue And Paper Routing

Primitive: turn external events into prioritized human-review papers with
actions, context, and idempotency.

HTTP surface:

- `POST /events`
- `GET /events/:id`
- `GET /review-packets/:id`
- `GET /queue`
- `GET /queue/next`
- `POST /queue/lease-next`
- `POST /queue/:id/lease/renew`
- `POST /queue/:id/done`
- `POST /queue/:id/defer`
- `POST /queue/:id/ignore`
- `POST /queue/:id/actions/recommended`
- `GET /queue/:id/lineage`
- `POST /queue/:id/priority`

Useful standalone uses:

- unified "things needing my attention" queue
- human approval queue for agent actions
- priority reranking layer over Slack/Gmail/GitHub/Codex/Claude events

Proof:

- queue route tests in `app/orchestrator/src/routes/queue*.test.ts`
- seeded scenarios in `app/test-harness`
- `bin/master-priority-proof-smoke`
- `bin/event-loop-proof-smoke`

Status: stable enough internally; public API needs schema docs generated from
types/tests.

## Master Command Router

Primitive: send one command to the system and have it route to one task, many
tasks, a new task, or the queue priority layer.

Code:

- `app/orchestrator/src/routes/master.ts`
- `app/orchestrator/src/master/master_command_cli.ts`
- `app/macos/Sources/EventLoopQueueApp/MasterCommandSheet.swift`

HTTP/CLI surface:

- `POST /master/fan-out`
- `pnpm master:send -- "..."`
- Mac hotkey `Ctrl-Option-K` / legacy `Cmd-Option-Shift-K`

Supported selector shapes:

- explicit task ids
- task id regex
- task hint substring
- idle-min-seconds for task sessions

Useful standalone uses:

- "Tell every idle agent to summarize."
- "Route this instruction to the current task."
- "Start a new task session from a universal command box."

Proof:

- `app/orchestrator/test/master_fan_out.test.ts`
- `app/orchestrator/test/master_fan_out_idle_filter.test.ts`
- `app/orchestrator/src/master/master_command_cli.test.ts`
- `bin/master-priority-proof-smoke`

Status: dogfood; routing UX needs more visible confirmation and lower latency.

## Task Session Control

Primitive: list, bind, start, replace, and send followups to AI/task sessions
through a provider-neutral controller.

Contract:

- `TaskSessionController.listSessions`
- `getSession`
- `startTaskSession`
- `sendFollowupMessage`
- `bindTaskSession`

Providers today:

- Codex app-server/native thread controller
- Claude CLI configured sessions
- fake/development controller
- terminal/Ghostty send adapter
- composite controller

HTTP/CLI surface:

- `GET /task-sessions`
- `POST /task-sessions`
- `GET /task-sessions/:id`
- `POST /task-sessions/:id/followup`
- `POST /task-sessions/:id/replacement`
- `PUT /task-sessions/:id/task-binding`
- `GET /task-messages`
- `POST /task-messages/reconcile-attempted`
- `pnpm task:sessions`
- `pnpm task:bind`
- `pnpm task:messages`
- `pnpm task:replace`

Useful standalone uses:

- route Slack/GitHub/browser events into Codex/Claude sessions
- bind an existing terminal/Codex window to a task
- detect stale/lost task sessions and create human papers

Proof:

- `app/orchestrator/src/task_sessions/*.test.ts`
- `bin/task-runtime-smoke`
- `bin/event-loop-codex-completion-workspace-proof-smoke`

Status: dogfood; provider schemas still need clearer compatibility docs.

## Context Capture And Restore

Primitive: store browser/deeplink/manual context resources and request local
clients to restore them.

HTTP surface:

- `GET /contexts`
- `POST /contexts/restore-plan`
- `POST /contexts/restore-requests`
- `GET /contexts/restore-requests/next`
- `POST /contexts/restore-requests/claim-next`
- `GET /contexts/restore-requests/:id`
- `POST /contexts/restore-requests/:id/done`
- `POST /contexts/restore-requests/:id/failed`
- `POST /contexts/restore-requests/:id/retry`

Useful standalone uses:

- "open this browser tab/doc/source thread when task becomes active"
- native-host restore queue for browser extensions
- deeplink fallback for Slack/GitHub/Notion/Figma/Google Docs

Proof:

- context route tests
- browser-extension/native-host tests
- `docs/planning/17-deeplink-strategies.md`

Status: dogfood for Chrome/native host; public API needs broader client docs.

## Manual Mode

Primitive: pause automation, save the manual desktop, and explicitly decide how
to return.

HTTP surface:

- `GET /modes/manual`
- `POST /modes/manual`

Mac hotkeys:

- `Ctrl-Option-M`: enter/toggle manual mode
- `Ctrl-Option-Shift-M`: return while preserving or restoring the saved desk
  depending on the chosen UI action

Guarantees:

- ambient saver skips during manual mode
- follows-window orchestrator skips during manual mode
- queue lease-next returns a 409 manual-mode response while paused
- manual workspace can be restored on app termination

Proof:

- `app/orchestrator/test/manual_mode_pause_integration.test.ts`
- `app/orchestrator/test/manual_mode_round_trip.test.ts`
- Mac app `QueueViewModelTests` and `QueueAppDelegateTests`

Status: stable enough for dogfood.

## Agent And Source Hooks

Primitive: bridge events from Slack/Gmail/GitHub/local scripts/voice/agent runs
into the same queue and task-session system.

HTTP/CLI surfaces:

- `POST /mcp/poll`
- `GET /mcp-sources`
- `POST /mcp-sources/poll-all-and-route`
- `GET /mcp-sources/:id`
- `POST /mcp-sources/:id/poll`
- `POST /mcp-sources/:id/preview`
- `POST /mcp-sources/:id/poll-and-route`
- `POST /agent-runs`
- `GET /agent-runs/:id`
- `POST /voice/commands`
- `eventloopos.enqueue_paper` MCP skill

Useful standalone uses:

- any local process can become a paper source
- agents can self-report blocked/done/question states
- cheap source polling can feed a human attention queue

Proof:

- MCP source tests
- local integration script tests
- `docs/codex-mcp-skill.md`
- `bin/agent-run-cli-smoke`

Status: mixed. Local events and agent-run routes are stable enough internally;
third-party source templates need setup docs and fixture cleanup.

## Mac App And Hotkey Surface

Primitive: a local macOS control plane for queue state, global hotkeys, window
restore, voice capture, manual mode, and master command.

Code:

- `app/macos/Sources/EventLoopQueueCore`
- `app/macos/Sources/EventLoopQueueApp`

Hotkeys:

- `Ctrl-Option-J`: advance
- `Ctrl-Option-E`: done / next
- `Ctrl-Option-Return`: send to agent
- `Ctrl-Option-H`: defer one hour
- `Ctrl-Option-R`: restore selected paper
- `Ctrl-Option-K`: master command
- `Ctrl-Option-M`: manual mode
- `Ctrl-Option-Shift-M`: return from manual mode

Useful standalone uses:

- build another UI over the same queue/workspace primitives
- use only the global hotkey app as a front-end for a custom orchestrator
- use `EventLoopQueueCore` Swift package in a different Mac app

Proof:

- Swift package tests under `app/macos/Tests`
- `bin/lab-mac-human-demo-setup`
- `docs/human-demo-walkthrough.md`

Status: product dogfood surface; Swift API is not versioned as SDK.

## Observability And Proof Harnesses

Primitive: every important workflow should have a scriptable proof and a
machine-readable manifest.

HTTP surface:

- `GET /health`
- `GET /metrics`
- `GET /activity`

Proof scripts:

- `bin/proof-agent`
- `bin/proof-repeat`
- `bin/product-readiness-proof`
- `bin/lab-mac-dogfood`
- `bin/lab-mac-human-demo-setup`
- `bin/workspace-latency-proof`
- `bin/task-workspace-memory-proof-smoke`
- `bin/workspace-task-switch-proof-smoke`

Useful standalone uses:

- repeat flaky OS proofs until confidence is high
- prove app startup/recovery before handing a Mac to a human
- generate artifacts that another agent can audit

Status: stable enough internally; public users need a smaller "prove my host"
entrypoint.

## Near-Term Library Hardening

Highest-leverage steps before calling this a real primitives library:

1. Generate OpenAPI or JSON Schema docs from route validators and fixtures.
2. Split `@eventloopos/orchestrator` into public contracts and private server
   implementation packages.
3. Extend latency budgets from workspace HTTP proof to queue lease and Mac
   hotkey-to-feedback path.
4. Add a public "workspace backend adapter" guide with a fake backend example.
5. Add automatic claim emitters for unwrapped untagged Codex/Claude-spawned
   foreign windows.
6. Add user-facing follows/unfollows rules and durable rule export/import.
7. Publish example apps: "restore my desk," "agent attention queue," and
   "window hotkey router."
