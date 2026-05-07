# MVP Plan Corrections

This doc records the current product steering after critique review.

## Product Shape

MVP is not an aggressive interruption system.

MVP is an intake stack:

- Background agents and MCP sources keep moving work.
- Human queue stays quiet unless work is human-blocked.
- User intentionally enters event-loop mode.
- User sees one paper at a time.
- User handles current item, then presses done/next.
- User can send work back to agents.
- Agents later put work back into intake if human needed.
- Queue can reshuffle in background by priority.

Calendar-aware interruptions, Focus-mode integration, voice-out, and notification-fatigue models are not MVP. They may matter later if product becomes ambient all-day assistant. Current target is focused work sessions.

Mental model:

- User sits at one current paper.
- Background sources and agents keep working on other papers.
- When agent cannot proceed, paper returns to intake stack.
- Queue reshuffles quietly.
- User pulls next paper intentionally.
- Hotkey/manual mode lets user leave event-loop mode and use Mac normally.

Therefore, do not spend v1 time on passive surfacing, notification loudness, meeting-state interrupt gates, or focus-mode integration unless a tiny hook is needed for user control.

## MVP Priority

Keep building:

- Queue-first review loop.
- MCP polling and local source routing.
- Codex task sessions.
- Claude Code support as second runtime, behind same task-session interface.
- Browser/context restore with confidence tiers.
- Manual mode escape hatch.
- Activity history and dogfood metrics.
- Lightweight failure recovery.
- Local config for Jason's real MCP/Slack/GitHub-ish sources.
- After-the-fact session history tying queue item -> task -> task session -> messages -> restore attempts.
- Strong test loop.

Do not overbuild now:

- Calendar gating.
- Voice readback.
- Budget dashboard.
- Multi-device sync.
- Enterprise controls.
- Full per-app DOM automation.
- Broad task-runtime provider ecosystem beyond Codex and Claude Code.

## Agent Control

Preferred order:

1. Structured provider API.
2. Local MCP/native bridge.
3. Terminal/tmux/Ghostty visible draft fallback.

Terminal control is fallback, not primary runtime. It must be:

- Task/session matched.
- Audited.
- Idempotent.
- No auto-submit by default.
- Human-confirmed for risky modes.
- Explicitly granted per session before master agent can paste/submit.
- Logged with event IDs, task session ID, payload hash, and result.

Current product target only needs Codex and Claude Code. Keep TaskSessionController broad enough for these two without designing full provider ecosystem now.

Near-term runtime shape:

- Orchestrator supports Codex and Claude Code in the same daemon through comma-separated `ORCHESTRATOR_TASK_SESSIONS=codex_app_server,claude_cli`.
- `CompositeTaskSessionController` lists sessions from multiple controllers and routes each followup/binding to the controller that owns the session.
- Codex keeps writable task binding through the task-map path.
- Claude Code can start with configured static sessions plus followup send; writable binding can come after dogfood proves need.
- Terminal/tmux/Ghostty adapter stays fallback for visible draft input, not main task runtime.

## Failure Recovery

MVP needs 90/10 durability, not perfect distributed recovery.

Required now:

- Queue leases expire and can be reclaimed.
- Restore requests have visible failed state.
- MCP poll source timeouts/circuit breakers exist.
- Task followup failure produces visible queue/history entry.
- Dogfood logs make after-the-fact debugging possible.
- Duplicate/retried events return stored route before side effects.
- In Postgres mode, activity and metric history survive orchestrator restart.
- Restart-proof proof path now covers event routing and restore retry: use same Postgres DB, ingest event or create failed restore request, restart orchestrator server, assert duplicate route returns stored result and failed restore can be retried/reclaimed.
- Task followup chaos proof: runtime throw should record attempted + failed activity and avoid duplicate followup on retry.
- Workspace restore execution receipt replay proof: duplicate `POST /workspace/restore` calls return the first plan/receipt without executing again, and Postgres mode keeps that receipt across orchestrator restart.
- Task-message safety proof: `before_task_message` blocks prompt-injection-looking untrusted text before task runtime send, and event-route policy blocks fall back into human queue review.

Later:

- Kill-9 chaos suite.
- Full restart replay model.
- Agent crash/resume policy across all providers.

Easy recovery stance: every side effect needs idempotency key + visible failed state + manual retry path. Durable outbox is later unless duplicate side effects show up in dogfood.

## Critique Triage

Do now:

- Keep `server.ts` shrinking before adding much more width.
- Keep metrics/history concrete and local.
- Keep deep-link restore confidence visible by provider.
- Keep MCP sources read-only/draft-first by default. MVP config validation rejects sources that set `readOnly=false`, `allowWriteTools=true`, or `maxRiskLevel` above `low`, and SDK-backed polling now checks `tools/list` before first poll to require the configured poll tool to advertise `annotations.readOnlyHint=true`.
- Keep keystroke/terminal path behind explicit grants.
- Keep tests tied to real feedback loops: fixture E2E, live boot, real Chromium extension, opt-in AeroSpace, opt-in Mac UI smoke.

Defer:

- Passive notification/interruption UX.
- Calendar/meeting awareness.
- Voice readback.
- Budget dashboard beyond model/config knobs.
- Multi-device sync.
- Enterprise privacy controls beyond local-first/read-only defaults and risk policy docs.
- Full per-app DOM/canvas automation before dogfood proves need.

## Architecture Risk

`app/orchestrator/src/server.ts` is too large. It should shrink before more feature width.

Low-risk split:

- `http/json.ts`
- `http/request_context.ts`
- `routes/queue.ts`
- `routes/events.ts`
- `routes/context_restore.ts`
- `routes/task_sessions.ts`
- `routes/mcp_sources.ts`
- `routing/task_injection.ts`
- `queue/execute_action.ts`

Current extraction:

- `app/orchestrator/src/routing/task_session_injection.ts` owns ambient/task-hinted injection policy.
- `app/orchestrator/src/task_sessions/task_followup_audit.ts` owns attempted/sent/blocked/failed task-message activity.
- `app/orchestrator/src/routes/observability.ts` owns metrics/activity route bodies.
- `app/orchestrator/src/routes/task_sessions.ts` owns task-session list/get/followup/binding route matching, body reads, route bodies, and validation.
- `app/orchestrator/src/routes/context_restore.ts` owns context list/search plus restore plan, restore request create/peek/claim/get/done/failed/retry route bodies and validation.
- `app/orchestrator/src/routes/queue.ts` owns queue list/next/lease/done/defer/ignore/recommended-action route bodies and validation.
- `app/orchestrator/src/routes/workspace.ts` owns workspace status/capture/restore-plan/restore route bodies and idempotent restore receipt replay.
- `app/orchestrator/src/routes/mcp_sources.ts` owns legacy `/mcp/poll`, MCP source list/get/poll/poll-and-route/poll-all-and-route route bodies, validation, and poll-cycle observability.
- `app/orchestrator/src/routes/events.ts` owns event ingest/get, voice-command ingest, event routing/idempotency/fallback, and review-packet lookup route bodies.
- `server.ts` now mostly owns route registration order, shared HTTP context, and JSON body parsing.
- `app/orchestrator/src/http/route_observability.ts` owns response serialization plus the shared route observability wrapper.

Keep doing behavior-preserving extraction first. Add tests before changing policy.

Other architecture notes:

- `gateway_store.ts` is useful as an adapter seam, but event idempotency/route semantics must stay parity-tested across in-memory and Postgres stores.
- GatewayStore conformance tests now run shared behavior against in-memory and Postgres adapters for event idempotency/context search, queue lease/defer/ignore, context restore retry/done, and workspace restore receipt replay.
- Route-level observability wrapper now tags responses with route name/duration headers and records low-cardinality counters for request count, status, error code, and duration.
- Extend `/activity` filters later by task/session/status/since so after-the-fact debugging does not require dumping recent global history.

## Fresh Plan Audit - 2026-05-07

Stale critique:

- Interruption UX is not MVP center. Keep quiet user-pull queue.
- Calendar/Focus/notification fatigue remains deferred.
- Voice-out remains deferred.
- Budget dashboard remains deferred beyond model/poll cadence config.
- Server god-file concern is mostly resolved; `server.ts` is now a thin dispatcher with route modules.
- Metrics/observability are no longer missing; `/metrics`, `/activity`, route counters, and `dogfood:review` exist.

Real gaps:

- Browser extension now has app-level allowed-origin gating and no manifest-level all-page content-script injection. Remaining gap: Chrome `host_permissions` is still `<all_urls>` for programmatic injection; optional host permission UX can come later if this permission warning blocks dogfood.
- MCP poll cursor/seen state now persists through the gateway store and commits only after successful routing. Use Postgres mode for real Slack/GitHub dogfood if restart-proof cursor state matters.
- Task followup/session history now has 90/10 durability through `task_messages`: idempotency key, runtime/session/task/event linkage, status, text hash/length, sanitized runtime metadata, native turn IDs, timestamps, and error summary. Remaining gap: stale `attempted` retry policy after crash.
- Task runtime types are too loose. Replace `unknown`-heavy boundaries with shared `TaskSession`, `TaskMessage`, `TaskRuntimeCapabilities`, and `TaskRuntimeError` shapes for Codex and Claude.
- Manual-mode exit snapshot semantics now match product intent: entering Manual Mode pauses automation, and returning to Event Loop captures the manual layout before restoring queue context.
- Operational metrics need useful gauges: queue depth by state, stale leases, restore pending/failed, followup status counts, runtime failure counts.
- Agent proof handoff now has `pnpm proof:agent`: manifest, per-command logs, git metadata, redacted env summary, and CI smoke coverage.
- Dogfood thresholds now have `pnpm dogfood:check`: ignored queue rate, restore success rate, task followup failures, stale leases, and pending restore age.
- Mac queue UI now makes current paper more dominant by narrowing the stack column and enlarging the selected packet header.
- Composite runtime dogfood now has `pnpm task:runtime-smoke`, which starts a temp daemon and proves live Codex app-server sessions plus a configured Claude session appear through the same task-session API.
- Live proof now has `pnpm proof:live`: it writes a separate proof manifest, runs a temp live orchestrator smoke with dogfood threshold checks before shutdown, and runs the composite task-runtime smoke.
- Mac app now has a true Pull Next Paper action and global hotkey (`Cmd+Opt+Shift+J`): it leases/presents the current top packet, returns from Manual Mode if needed, captures the manual workspace on return, loads bound task sessions, and plans queue workspace restore.
- Mac queue load/refresh is read-only: opening the app shows the stack without selecting/leasing active work. `Pull Next Paper` is now the canonical transition into a current paper.
- Live Mac queue mutation proof now exists: `pnpm test:e2e:macos-live-ui` launches the packaged app against a temp live orchestrator, clicks `Pull Next Paper` and `Done / Next`, then asserts queue done state, activity, and metrics. It is included in `pnpm proof:live`.
- Live Mac task handoff proof now exists: `pnpm test:e2e:macos-live-handoff` launches the packaged app against a temp live orchestrator, clicks `Pull Next Paper` and `Route to task agent`, then asserts queue done state, task followup attempted/sent activity, metrics, and `task_session_blog.status=running`. It is included in `pnpm proof:live`.
- Human queue packet copy now distinguishes task-matched approvals from unmatched/ambiguous events, so the current paper says why human judgment is needed instead of asking vaguely whether to route an event.
- Human queue routing now has an explicit `human_queue_reason`: `human_blocked`, `ambiguous`, or `risky`. Queue creation should stay inside those reasons so the product remains an intake stack of blocked papers, not an ambient notification stream.
- Real local Postgres + local-events MCP dogfood proof has been run: MCP poll created one ambiguous intake item, `dogfood:check` passed, and queue/activity/metrics survived orchestrator restart against the same Postgres database.
- The same proof is scripted as `pnpm run test:e2e:postgres-mcp-dogfood`, so future agents can rerun it instead of relying on notes.
- GatewayStore remains broad. Conformance tests reduce risk; split into smaller store ports later, after dogfood-critical safety/history patches.

Latest user steering:

- Product center is the intake stack, not interruption policy.
- User intentionally enters event-loop mode when doing focused throughput work.
- One active packet should dominate the Mac UI. Sidebar/list can exist for orientation, but should feel secondary to the current paper.
- Background agents should route new information into existing task sessions first. Queue gets only human-blocked, ambiguous, or risky work.
- Calendar/meeting awareness, Focus-mode integration, notification fatigue, voice-out, and budget dashboards are not worth MVP time.
- Voice transcript ingress can stay as an optional experiment because it feeds the same event router, but it is not a core MVP lane.
- Useful safety now means read-only/poll-first integrations, draft-first external actions, explicit task-message grants for terminal fallback, and local audit history.

Release guardrails:

- MCP/browser/source events should prove one of three outcomes: `store_only`, routed into a task session, or queued because human judgment is needed.
- Human queue noise should stay visible: high ignore/dismiss rate means router is over-queueing.
- Task followup history must be reconstructable after the fact: queue item -> event -> task -> runtime/session -> message status.
- Manual Mode must be a real escape hatch: user can leave event-loop mode, do normal Mac work, then return without losing the manual layout.
- Browser/context restore should prefer provider deeplinks and show confidence. Full per-app canvas/DOM automation remains later.
- Local installed-tool MCP polling now has Slack (`agent-slack`) and GitHub (`gh api` notifications) wrappers for Jason dogfood.

## Next Best Work

1. Add safe real Claude followup smoke against an explicitly supplied disposable Claude session.
2. Provider deep-link dogfood for Slack/GitHub/browser first; Notion/GDocs/Figma only if they appear in Jason's real loop.
3. Add app bundle/XCUITest smoke for installed Mac UI flow beyond the current AppleScript UI smoke.
4. Decide whether `test:e2e:postgres-mcp-dogfood` should run inside `proof:live` by default when Docker is available.
