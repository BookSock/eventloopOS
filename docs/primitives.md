# eventloopOS Primitives

eventloopOS is currently a product, but the code already exposes reusable
operating-system control primitives. This document catalogs the primitives that
other tools could build on without taking the whole queue app.

Machine-readable catalog: `docs/primitives.catalog.json`. Builder-facing HTTP
OpenAPI artifact: `docs/primitives.openapi.json`. The catalog now requires a
response schema for every HTTP route and either a request schema or
`no_request_body: true` for every mutating route. Those schemas are exported
from `@eventloopos/shared` and validated against contract fixtures. The shared
package also exports `@eventloopos/shared/primitives` helpers for parsing the
catalog, finding routes, and summarizing primitive coverage without importing
the orchestrator server package.
The shared summary helper now returns both global totals and per-primitive
capability rows with status, category, route count, CLI command count,
self-test count, proof count, latency-budget count, responsiveness-critical
flag, and request/response schema coverage.
`selectPrimitiveCapabilities` filters that matrix by id, status, category,
minimum route count, CLI availability, self-test coverage, and proof coverage
plus latency-budget and responsiveness-critical coverage so builder tools can
choose reusable surfaces without parsing prose docs.
`selectPrimitiveSelfTestCommands` returns the runnable self-test commands for
all primitives or a requested primitive subset, including selected ids, missing
ids, and the primitive ids covered by each de-duplicated command.
`selectPrimitiveLatencyBudgets` returns cataloged p95 budgets and proof hooks by
the same builder-facing filters, so responsiveness guarantees are machine
discoverable instead of prose-only.
`buildPrimitiveProofPlan` combines those selectors into one verification plan:
selected primitive ids, missing requested ids, capability rows, de-duplicated
self-test commands, and latency proof hooks.
Validate both with
`bin/primitives-catalog-audit docs/primitives.catalog.json` and
`bin/primitives-openapi-export --check docs/primitives.catalog.json docs/primitives.openapi.json`.
Generate a builder-facing coverage/readiness summary with
`bin/primitives-readiness-report docs/primitives.catalog.json` or use
`--json` for machine-readable audit output.
Current catalog summary: 18 primitives, 80 HTTP routes, 8 CLI commands, 21
self-tests, 75 proof refs, 11 latency budgets.
Strict readiness is expected to stay green: every cataloged primitive
has a `self_tests` command, and the shared primitive operation-helper test
proves typed helper coverage for every cataloged HTTP route.
The Linux CI lane also runs `@eventloopos/shared`'s package audit: it builds the
shared package, runs `pnpm pack --dry-run --json`, and verifies the future SDK
tarball only contains runtime package files (`dist`, README, package metadata)
with every `main`/`types`/`exports` target present.
Responsiveness-critical primitives must also carry explicit p95 latency budgets
linked to runnable proof commands.
`bin/primitives-self-test-runner` executes the cataloged self-test commands
once per unique command and records a manifest that maps each proof back to the
primitive ids it covers. Root `pnpm typecheck` runs both the list-only manifest
and the full catalog self-test manifest so stale or broken primitive proof
commands fail early. Builders can run a subset with repeated `--primitive <id>`
flags when they only want to verify one reusable surface.
The catalog audit also verifies every catalog schema has a matching
`@eventloopos/shared` Zod schema, TypeScript type, and ContractSchemas registry
entry, and that cataloged HTTP routes cannot silently drift back to freeform
envelopes.
The shared primitive HTTP client validates request and response bodies and
throws typed errors for request-build failures, non-2xx responses, invalid JSON,
response-schema mismatches, and timed-out calls so builders can recover from
malformed inputs, conflicts, dependency failures, server drift, and stalled
local orchestrators without string-matching generic exceptions. Request-build
errors expose a stable `kind` and affected parameter for unknown routes, missing
path/query params, invalid query values, and invalid request bodies. HTTP errors
expose `status`, server `code`, server detail text, route metadata, and exported
guard helpers for branching on recoverable cases like manual-mode pauses or
stale task-session bindings. Timeout errors expose the route and `timeoutMs`.
It also exposes `createPrimitiveOperationsClient`, a small typed convenience
layer for common master-command, manual-mode, task-workspace, queue,
workspace, task-session, Codex/Claude agent, task-window-claim,
follows-window, reading-queue, onboarding, context-restore, and trigger
operations, plus MCP/source-hook, voice-command, agent-run, and observability
routes. Shared tests compare operation-helper route coverage against every
cataloged HTTP route so SDK drift is caught by `pnpm typecheck`.

Runnable examples live in `examples/primitives/`: discover reusable primitive
surfaces, restore a saved desk, inspect and rerank an attention queue, and wire
external hotkeys to task-window/follows rules. The discovery example consumes
the shared `@eventloopos/shared/primitives` SDK instead of duplicating catalog
parsing, can also print self-test commands for a primitive subset, and builds
`app/shared/dist` on demand for clean checkouts. It can also print latency
budgets for responsiveness-critical primitives or a combined proof plan for a
builder-selected primitive subset with
`node examples/primitives/discover-primitives.mjs proof-plan --id workspace_control --json`.
The live queue, workspace, and window-hotkey examples now use the same shared
operation client instead of hand-rolled fetch calls, so example apps exercise
catalog validation, typed response parsing, idempotency headers, and request
timeouts.
Root `pnpm typecheck` runs their self-tests and
`bin/primitives-examples-audit` prevents example drift back to custom HTTP
clients.

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

Adapter guide: `docs/workspace-backend-adapter.md`. Current non-AeroSpace
backends can use custom backend ids, but window records and restore plans still
share the legacy AeroSpace-compatible shape.

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
- `docs/workspace-backend-adapter.md`
- `bin/lab-mac-geometry-proof`
- `bin/lab-mac-geometry-proof --self-test`
- `bin/task-workspace-memory-proof-smoke`
- latest Mac Studio human demo manifest under `artifacts/lab-runs/*-human-demo/manifest.json`

Status: dogfood on macOS. Core status/capture/restore route envelopes now have
shared contract schemas and generated OpenAPI; non-AeroSpace adapter docs still
need a second backend implementation before calling the adapter API stable.

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
- infers task-window claims from process ancestry when bound task sessions
  expose `pid`, `agent_pid`, `terminal_pid`, `root_pid`, or `pids`; macOS
  queue clients decode these fields so demo/debug UI can inspect ancestry too
- expands process-root task-window claims into concrete window claims when a
  background agent launch produces descendant app windows
- treats existing `process_root_pid` claims as ownership for descendant windows
  during ambient save, so externally registered roots protect the active paper
  even when no narrower `window_id` claim can be written
- follows-window redirect also reads bound task-session PIDs directly, so a
  background agent's descendant window can be moved off the user's current
  paper on the fast follows poll before ambient autosave creates a concrete
  claim
- if task B's agent opens a visible Chrome window while the human is reviewing
  task A, the task B claim keeps that Chrome window out of task A's saved
  paper, and the follows-window orchestrator moves it back to task B's
  workspace when task B has a known workspace

Why it matters: this is the primitive that makes window layout memory feel
automatic instead of like a manual "save workspace" button.

Known gap: unclaimed LaunchServices-detached apps can still lose useful
parent-process ancestry, so wrappers should claim `process_root_pid`, tag the
window, or emit routed resources for those launches.

Proof:

- `app/orchestrator/src/agents/ambient_workspace_saver.test.ts`
- Mac Studio human demo `proofs.ambient_autosave.ok=true`

Status: dogfood. Claimed foreign windows are filtered from active-paper saves
and rehomed when their owner task has a known workspace. Unclaimed detached app
launches still need wrappers, tags, or routed resources before public API.

## Task Window Claims

Primitive: let an agent or tool declare that a window belongs to a specific
task, even if the window appears on the user's current workspace.

HTTP surface:

- `POST /task-window-claims`
- `GET /task-window-claims`

Shared contracts:

- `TaskWindowClaimCreateRequest`
- `TaskWindowClaimRecord`
- `TaskWindowClaimResponse`
- `TaskWindowClaimsListResponse`

CLI surface:

- `bin/task-window-spawn --task-id TASK_ID -- COMMAND [ARGS...]`

Claim identity:

- exact `window_id`
- `app_bundle`
- `title_prefix`
- `process_root_pid`
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
  and the wrapper immediately claims the command process root, polls workspace
  capture every 100ms by default, claims matching newly-created windows as they
  appear, moves them back to the owner task workspace when known, and restores
  human focus; `--wait-ms` covers slow LaunchServices/Chrome startup, and
  `--request-timeout-ms` prevents stalled local HTTP calls from wedging the
  agent/demo
- if LaunchServices or Chrome reuses an already-open window, the same wrapper
  can add `--claim-existing-matching --app chrome --title checkout` to claim
  and rehome only existing windows that pass an explicit app/title filter before
  or during the post-launch polling window, including reused windows whose title
  changes after the command starts
- a bound Codex/Claude task session exposes `pid`/`agent_pid`/`terminal_pid`,
  and the follows-window orchestrator redirects descendant app windows before
  they can linger on the human's current paper; ambient autosave also converts
  those descendants into concrete task-window claims
- a launch wrapper claims `process_root_pid` before starting a visible browser
  test, then ambient autosave converts the descendant Chrome window into a
  concrete claim for that background task; if conversion is unavailable, the
  root claim still filters descendants out of other task saves
- browser automation can claim Playwright/Chrome report windows before the
  user sees them
- browser context capture auto-claims Chrome windows when the event attaches to
  a task
- routed agent events auto-claim `browser_tab`, `app_window`,
  `aerospace_window`, `window`, and `spawned_window` resources when they attach
  to a task
- tools can inspect current claims to explain why a window was ignored
- follows-window orchestration moves claimed foreign windows off the user's
  active paper and back to the owning task workspace when possible

Proof:

- `app/orchestrator/src/routes/task_window_claims.test.ts`
- `app/orchestrator/src/routes/events_task_window_claims.test.ts`
- `app/orchestrator/src/agents/ambient_workspace_saver.test.ts`
- `app/orchestrator/src/agents/follows_window_orchestrator.test.ts`
- `app/orchestrator/test/follows_window_orchestrator_integration.test.ts`
- `app/orchestrator/test/gateway_store_conformance.test.ts`
- `app/shared/test/contracts.test.ts`
- `bin/task-window-spawn --self-test`

Status: dogfood. Browser context capture has an automatic emitter; generic
routed window resources are auto-claimed; tagged windows are inferred from OS
snapshots; process-tree launches are claimed when session pid metadata exists;
command-wrapped untagged launches are pre-claimed by process root and then by
window id/title/bundle, including guarded app/title-filtered claims for
already-open windows reused by LaunchServices; claimed windows and bound
task-session descendant
windows that appear on the active paper are redirected to the owning task
workspace when possible.

## Follows Windows

Primitive: observe windows across workspaces and treat repeated multi-workspace
presence as "this window follows the user's current task."

Code:

- `app/orchestrator/src/agents/follows_window_orchestrator.ts`
- `app/orchestrator/src/routes/follows_windows.ts`
- `app/macos/Sources/EventLoopQueueApp/FollowsRulesSheet.swift`
- `bin/follows-window-rules`

Exports current sticky-window candidates over `GET /follows-windows` and
exclusion rules over `GET /follows-windows/exclusions` so a demo, support
script, release proof, or third-party UI can show which windows are considered
shared and why a shared app is no longer following every paper.
Use `bin/follows-window-rules export --file rules.json` and
`bin/follows-window-rules import --file rules.json` for durable rule movement
between dogfood profiles or machines.

HTTP surface:

- `GET /follows-windows`
- `POST /follows-windows/exclude`
- `GET /follows-windows/exclusions`
- `DELETE /follows-windows/exclusions/:id`

`GET /follows-windows` accepts `ttl_ms` and `min_workspace_count` query
parameters for diagnostic and rule-editor threshold tuning.

Shared contracts:

- `FollowsWindowExclusionCreateRequest`
- `FollowsWindowExclusionRecord`
- `FollowsWindowExclusionResponse`
- `FollowsWindowExclusionsListResponse`

Important behavior:

- uses window id path and app-bundle/title-prefix slot path
- moves follows windows to the newly focused task workspace
- redirects claimed foreign-task windows away from the focused task workspace
  instead of treating them as user-following windows
- exposes current follows candidates with known workspaces and stable
  app-bundle/title-prefix slot metadata for UI/debug tooling
- skips manual mode
- supports exclusions for things that should not follow

Useful standalone uses:

- pin a notes window or browser doc across several task workspaces
- make "shared context" follow focus without manual dragging
- build a custom follows-window rule editor or diagnostic dashboard against
  the HTTP primitive without linking the Mac app

macOS UI: Queue toolbar and command menu expose a follows-rules editor for
adding, refreshing, and removing sticky-window exclusions. The sheet lists
current follows candidates from `GET /follows-windows` before generic
active-desktop suggestions, so an accidental shared window has a direct exit
ramp. The checked CLI and export/import format remain available for scripted
movement between machines.

Proof:

- `app/orchestrator/src/agents/follows_window_orchestrator.test.ts`
- `app/orchestrator/test/follows_window_orchestrator_integration.test.ts`
- store follows-window conformance tests
- `app/shared/test/contracts.test.ts`
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

Status: stable enough internally. Queue/paper route envelopes are exported as
shared schemas and generated OpenAPI; the initial shared-package catalog helper
boundary exists, but a polished published SDK is still missing.

## Task Intake Onboarding

Primitive: scan current local work context into proposed tasks, then approve or
reject task workbenches.

HTTP/CLI surface:

- `GET /onboarding/scan`
- `POST /onboarding/approvals`
- `POST /onboarding/approvals/batch`
- `POST /onboarding/rejections`
- `bin/onboarding-live-proof-smoke`

Useful standalone uses:

- turn open browser/workspace context into starter task papers
- approve several task workbenches in one idempotent batch
- keep rejected onboarding proposals out of future scans

Proof:

- `app/orchestrator/test/onboarding_happy_path_e2e.test.ts`
- `app/orchestrator/src/onboarding/task_grouping.test.ts`
- `app/orchestrator/src/onboarding/onboarding_scan_cli.test.ts`
- `bin/onboarding-live-proof-smoke`

Status: dogfood. Onboarding scan, approval, batch approval, and rejection
routes are exported as shared schemas and generated OpenAPI.

## Reading Queue

Primitive: promote idle, unbound browser contexts into `task_reading_queue`
papers either manually or by age threshold.

HTTP surface:

- `GET /reading-queue`
- `POST /reading-queue/promote`
- `POST /reading-queue/auto-promote`

Useful standalone uses:

- collect "read later" browser tabs as review papers
- turn aged tabs into queue work without stealing current focus
- pause auto-promotion while manual mode is active

Proof:

- `app/orchestrator/test/reading_queue.test.ts`
- `app/orchestrator/test/reading_queue_auto_promote_integration.test.ts`
- `app/orchestrator/test/manual_mode_pause_integration.test.ts`

Status: dogfood.

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
- leave a visible queue-level confirmation after a command routes, starts a
  task, previews fan-out, delivers fan-out, reranks, or promotes reading papers

Proof:

- `app/orchestrator/test/master_fan_out.test.ts`
- `app/orchestrator/test/master_fan_out_idle_filter.test.ts`
- `app/orchestrator/src/master/master_command_cli.test.ts`
- `bin/master-priority-proof-smoke`
- `bin/queue-latency-proof` budget `master_fan_out_dry_run`
- Swift `QueueViewModelTests` cover queue-level master-command feedback

Status: dogfood; local orchestrator routing latency is budgeted and covered by
`master_fan_out_dry_run`; broader live-host proof remains part of demo gates.

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
- expose normalized `root_pid`/`pids` for Codex, Claude, and fake sessions so
  process-tree window claims can attribute agent-spawned windows

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

Shared contracts:

- `ManualModeState`
- `ManualModeSetRequest`
- `ManualModeGetResponse`
- `ManualModeSetResponse`

Mac hotkeys:

- `Ctrl-Option-M`: enter Manual Mode; while manual, return and restore the
  selected saved paper/workspace
- `Ctrl-Option-Shift-M`: return while keeping the current manual windows here

Guarantees:

- ambient saver skips during manual mode
- follows-window orchestrator skips during manual mode
- queue lease-next returns a 409 manual-mode response while paused
- manual workspace can be restored on app termination
- `manual_mode_get`, `manual_mode_set`, and `manual_mode_restore` p95 budgets
  are checked by `bin/manual-mode-latency-proof`, which restores the original
  manual-mode state after live write samples

Proof:

- `app/orchestrator/test/manual_mode_pause_integration.test.ts`
- `app/orchestrator/test/manual_mode_round_trip.test.ts`
- `bin/manual-mode-latency-proof`
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
- `pnpm --filter @eventloopos/orchestrator run test:agent-source-hooks`
- `docs/codex-mcp-skill.md`
- `docs/mcp-source-hooks.md`
- `bin/mcp-source-templates-audit`
- `bin/agent-run-cli-smoke`

Status: dogfood. Local events, agent-run routes, third-party setup templates,
and fixture cleanup are covered by tests and template audits. External Slack,
GitHub, and Gmail sources still require their local CLIs/tokens before use.

## Agent Focus Binding

Primitive: resolve foreground Codex windows, inspect Codex/Claude sessions, and
auto-bind visible agent windows back to task sessions.

HTTP surface:

- `POST /agents/codex/auto-bind`
- `POST /agents/codex/resolve-foreground`
- `GET /agents/codex/inspect/:id`
- `GET /agents/claude/inspect/:id`

Useful standalone uses:

- bind an existing agent terminal/window to the current paper
- detect which Codex thread is in the foreground
- inspect agent session state before routing followups or human papers
- create a task from the foreground Codex/Ghostty window and synchronously bind
  its `terminal_ref`, so Send-to-Agent is available immediately instead of
  waiting for the auto-bind polling interval

Proof:

- `app/orchestrator/test/auto_bind_integration.test.ts`
- `app/orchestrator/test/resolve_foreground_route.test.ts`
- `app/orchestrator/test/tasks_route.test.ts`
- Codex/Claude session inspector tests

Status: dogfood.

## Paper Triggers

Primitive: let tasks declare event-matching rules that create routed papers from
future source/agent events.

HTTP surface:

- `GET /triggers`
- `POST /triggers`
- `GET /triggers/:id`
- `PATCH /triggers/:id`
- `DELETE /triggers/:id`

Useful standalone uses:

- route future matching events to a task without a human decision each time
- create lightweight agent/source automation rules
- keep trigger edits auditable through store and activity tests
- reject enabled cross-task trigger overlaps before they can double-paper the
  user for the same future event; disabled trigger drafts are still allowed

Proof:

- `app/orchestrator/test/triggers_route.test.ts`
- `app/orchestrator/src/triggers/evaluator.test.ts`
- migration coverage in `app/orchestrator/test/db_migrations.test.ts`

Status: dogfood.

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
- `Ctrl-Option-M`: manual mode / return and restore
- `Ctrl-Option-Shift-M`: return here from manual mode

Restore hotkey feedback is explicit: start, success, duplicate in-flight,
recent-repeat, skipped-manual-mode, and missing-snapshot cases update the same
toast/harness feedback path used by queue hotkeys.

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

- `bin/primitives-host-doctor`
- `bin/proof-agent`
- `bin/proof-repeat`
- `bin/product-readiness-proof`
- `bin/lab-mac-dogfood`
- `bin/lab-mac-human-demo-setup`
- `bin/workspace-latency-proof`
- `bin/queue-latency-proof`
- `bin/macos-hotkey-feedback-latency`
- `bin/primitives-readiness-report`
- `bin/task-workspace-memory-proof-smoke`
- `bin/workspace-task-switch-proof-smoke`

Useful standalone uses:

- repeat flaky OS proofs until confidence is high
- track queue/master HTTP p95 latency against local budgets
- summarize primitive API readiness by status, category, HTTP route count, CLI
  count, proof refs, self-tests, and missing references
- prove app startup/recovery before handing a Mac to a human
- generate artifacts that another agent can audit

Status: stable enough internally. `bin/primitives-host-doctor` is the small
"prove my host" entrypoint for builders: it validates catalog/OpenAPI drift,
runs strict readiness, executes the cataloged primitive self-tests, verifies
this builder-facing docs index against the catalog, runs primitive example
self-tests, audits MCP/source-hook templates plus present local source config,
and optionally gates live orchestrator `/health`, `/metrics`, `/activity`, and
`/workspace/status` with `--require-live`. Its manifest,
Markdown report, and `--json` output include a compact primitive-readiness
summary with primitive count, HTTP route count, CLI command count, self-test
count, proof count, status/category counts, and strict gap counts so an agent
can decide whether the host exposes a reusable primitive API surface without
opening the full readiness report.

## Near-Term Library Hardening

Highest-leverage steps before calling this a real primitives library:

1. Polish `@eventloopos/shared/primitives` from local request builders and a
   validating HTTP client into a published SDK, including typed convenience
   clients generated from `docs/primitives.openapi.json`.
   Current shared helpers already include request builders, a validating HTTP
   client, typed primitive request/HTTP/response errors, and first-pass
   operation-specific convenience methods over master-command, manual-mode,
   task-workspace,
   queue, workspace, task-session, Codex/Claude agent, task-window-claim,
   follows-window, reading-queue, onboarding, context-restore, and trigger
   primitives, with route-coverage tests across every cataloged HTTP
   primitive.
2. Split `@eventloopos/orchestrator` into public contracts and private server
   implementation packages.
3. Keep `bin/human-demo-ready`'s default macOS hotkey-latency gate green before
   release demos; use `--skip-hotkey-latency` only for Accessibility bootstrap.
4. Grow the generic `WorkspaceCommand` envelope into richer backend-specific
   adapter guides while keeping AeroSpace executor safety green.
5. Grow `examples/primitives/` from tiny CLI examples into richer starter apps
   with screenshots and fixture-backed walkthroughs.
