# Final Planning Index

Use this doc as handoff map.

## Current Decision

Build MVP as local-first Mac intake stack for agent-heavy work.

Sharp wedge:

```text
Superhuman for agent review, with Mac workspace restore.
```

Do not build broad OS replacement or interruption manager first. Build one-paper queue + context restore + agent resume loop.

Clarified product stance:

- MVP is quiet intake stack, not notification/interruption product.
- User intentionally enters event-loop mode.
- Background agents keep working and only queue human-blocked work.
- Calendar/Focus-mode gating, voice-out, budget dashboard, and multi-device sync are deferred.

## Read Order

1. `00-mvp-brief.md` - product thesis + scope.
2. `02-architecture.md` - system shape + data model.
3. `05-testing-and-agent-loop.md` - testing architecture + agent feedback loop.
4. `04-parallel-workstreams.md` - agent work split.
5. `06-v0-contracts.md` - module contracts.
6. `07-initial-agent-tickets.md` - first 10 tickets.
7. `08-command-contract.md` - command API for agents.
8. `09-v0-scenarios.md` - deterministic E2E scenarios.
9. `11-ambient-router-workspace-backends.md` - ambient router, MCP/polling, manual mode, optional AeroSpace, optional voice ingress.
10. `12-lessons-hermes-openclaw.md` - gateway/session/hook lessons from cloned repos.
11. `13-broader-agent-ecosystem-lessons.md` - lessons from ZeroClaw, SwarmClaw, Letta, CrewAI, LangGraph, security papers.
12. `16-mvp-plan-corrections.md` - clarified product stance: intake stack, not aggressive interrupt UX.
13. `17-deeplink-strategies.md` - provider IDs + URL + browser fallback restore plan.
14. `18-dogfood-metrics.md` - local history/metrics plan.
15. `19-one-paper-queue-ui.md` - Mac queue UX contract for the current-paper-first loop.
16. `20-agent-proof-loop.md` - proof bundle and stronger agent handoff gate plan.
17. `15-agent-test-matrix.md` - current command matrix mapping subsystem changes to concrete proof.

Supporting:

- `01-research-synthesis.md` - market/technical findings.
- `03-roadmap.md` - phase roadmap.
- `external-resources/README.md` - source links.

## Chosen Architecture

Pieces:

- `app/shared` owns contracts.
- `app/orchestrator` owns event log, task graph, agent runs, review packets, queue.
- `app/orchestrator` also acts as local Gateway daemon with typed protocol.
- `app/orchestrator/src/router` owns ambient route decisions.
- `app/orchestrator/src/mcp_sources` owns generic MCP polling source registry.
- `app/orchestrator/src/task_sessions` owns task agent session control.
- `app/orchestrator/src/ownership` owns external thread/resource locks.
- `app/orchestrator/src/hooks` owns policy hooks.
- `app/browser-extension` owns Chrome tab capture/restore.
- `app/macos` owns queue UI, hotkey, local workspace actions.
- `app/macos` also owns manual-mode escape hatch: hotkey pauses automatic restores, leaves windows alone, and resumes event-loop mode on explicit return.
- `app/test-harness` owns fake world + scenarios + artifacts.

First integrations:

- MCP/poll adapter for Slack/GitHub/local sources.
- Codex adapter.
- MCP context/action adapters where useful.
- generic MCP source registry for user-installed MCP servers.
- Slack Socket Mode / GitHub webhooks later if needed.
- Codex app-server/native thread backend preferred over terminal control.

Later:

- Notion.
- Hardened Claude Code runtime beyond the current configured-session adapter.
- Gmail/Drive.
- Safari.
- Jira.
- ScreenCaptureKit visual fallback.
- Voice transcript capture as an optional experiment, below queue/MCP/task-runtime dogfood.
- AeroSpace workspace backend.
- Linear.
- browser page polling.
- Calendar-aware interrupt policy, only if product later becomes passive all-day assistant.
- Voice readback.
- Budget dashboard.
- Multi-device sync.

## Testing Decision

Testing starts before feature width.

Main loop:

```text
fixture input -> command -> machine pass/fail -> logs/traces/screenshots -> focused retry
```

Use:

- Unit tests for pure logic.
- Integration tests for DB/adapters.
- Playwright for Chrome extension.
- XCTest/XCUITest for macOS.
- Docker/Testcontainers Postgres.
- Fake Slack/GitHub/MCP servers.
- Golden review packets.

Computer-use only for later black-box desktop smoke, not core verifier.

## First 10 Tickets

1. Shared Contracts V0.
2. Dev Infra Skeleton.
3. Test Harness Skeleton.
4. Orchestrator Stub API.
5. Postgres + Queue Store.
6. Browser Extension Capture.
7. Browser Restore.
8. macOS Queue Shell.
9. MCP/Poll Fixture Ingestion.
10. Fake Codex Adapter.

Companion hardening ticket after 9:

- MCP runtime hardening: timeout/backoff/circuit breaker/orphan cleanup.

Order:

```text
1 + 2 + 3 first
4 after contracts stub
5 after 4
6 + 8 + 9 + 10 can run parallel after 1
MCP hardening can start after 9
7 after 6
```

## Merge Rules

- No module reaches into another module internals.
- Shared contract changes happen first.
- Tests prove slice done.
- UI/browser work needs artifacts.
- No live network in CI.
- Sensitive external actions always require human decision.
- Side-effect API calls require idempotency key.
- External thread/resource ownership lock prevents duplicate agents.
- MCP runtime has timeout/backoff/circuit breaker.
- Tool/source/test claims need receipts.
- Repeated review workflows should become procedures with resume pointers.

## Implementation Research Checks

Current implementation choices checked against primary docs:

- Postgres queue lease should use row locks with `FOR UPDATE SKIP LOCKED`; PostgreSQL docs note `SKIP LOCKED` skips locked rows rather than waiting, which fits multi-worker queue leasing.
- Node DB code should use `pg` pooling, not one client per request, matching node-postgres pooling guidance.
- Real MCP client should use official TypeScript SDK. For local MCP servers, stdio transport is expected path, but eventloopOS wraps it with timeout/backoff/circuit breaker because stdio process control is high-trust.
- Postgres integration tests should prefer Testcontainers when Docker is available; otherwise keep deterministic unit/SQL tests so CI can stay green without live services.
- Chrome extension to local app bridge should use Chrome Native Messaging, with an explicit envelope, request ID, idempotency key, capability list, and structured error response. Chrome starts a host process for `sendNativeMessage`, treats the first host message as the response, and uses length-prefixed JSON over stdio.
- AeroSpace should be the first workspace backend for power users. Its workspace model exists because native macOS Spaces lack public APIs for reliable create/delete/reorder/switch/move automation.
- Deeplink restore should start with provider IDs, stable URLs, browser quote/scroll fallback, and restore confidence tiers. Do not build per-app DOM hacks before dogfood proves need.
- Claude Code should be second runtime after Codex, using structured/headless/session APIs before terminal fallback.

## Current Implementation Status

Implemented:

- `app/shared`: V0 contracts and fixture validation.
- `app/orchestrator`: HTTP queue API, event ingestion, voice command transcript ingestion, MCP fixture poll route, async gateway store seam, Postgres queue store, `DATABASE_URL` Postgres mode with migrations, policy hooks, ownership locks, evidence receipts, fake Codex adapter, fake task session store, terminal task-session adapter.
- `app/orchestrator`: `GET /task-sessions`, `GET /task-sessions/:id`, and `POST /task-sessions/:id/followup` support session discovery plus idempotent followup messages; daemon seeds fake `task_session_blog` by default for live local proof, and `ORCHESTRATOR_TASK_SESSIONS=off` disables it.
- `app/orchestrator/src/task_sessions`: Codex native thread controller seam maps Codex app-server-style threads to routable task sessions and starts idempotent followup turns through an injected client. The app-server thread client maps `thread/list`, `thread/read`, and `turn/start` request/response shapes behind a testable `CodexAppServerRequest`; stdio transport talks newline JSON to `codex app-server --listen stdio://`. `ORCHESTRATOR_TASK_SESSIONS=codex_app_server` exposes local Codex threads through `/task-sessions`, with task binding from hot-loaded `ORCHESTRATOR_CODEX_TASK_MAP_PATH`, `PUT /task-sessions/:id/task-binding`, env JSON, or `[task:...]` title markers.
- `app/orchestrator/src/task_sessions`: Claude CLI task-session controller exposes configured Claude Code sessions from `ORCHESTRATOR_CLAUDE_SESSIONS`; followups run `claude -p --output-format json --resume <session>` through injected exec with idempotent message records.
- `app/macos`: selected review packets with `task_id` now show task-session binding controls. The queue app auto-loads `/task-sessions`, displays matching bound sessions, binds an unbound session through `PUT /task-sessions/:id/task-binding`, then enables the recommended-action handoff only when a matching task session is bound.
- `app/orchestrator`: ambient route policy now separates passive context storage, task-session injection, and human queueing. Browser context capture defaults to `store_only`; task-hinted Slack/GitHub/MCP/voice events inject into matching task sessions when available; explicit review requests still create human queue packets.
- `app/orchestrator`: `GET /events/:id` retrieves stored events and route decisions, so store-only context is machine-verifiable without queue pollution.
- `app/orchestrator`: `GET /contexts?source=&task_id=&q=&limit=` lists and ranks stored context resources with event + route metadata, relevance score, and match reasons, giving agents a read path for passive browser captures and task-attached browser context. `POST /contexts/restore-plan` returns side-effect-free local instructions for browser-extension restore, URL open, or file open. Context restore requests now live behind the gateway store abstraction, persist in Postgres mode, support idempotent creation, support read-only peek, and use claim/done/failed/retry state so duplicate browser consumers do not process the same request and failed restores stay visible. `browser_context_ranked_search` proves ranking beats pure recency; `browser_context_store_only` proves passive capture plus context restore-plan, restore-request peek, claim, done, and status.
- `app/orchestrator`: `GET /mcp-sources`, `GET /mcp-sources/:id`, `POST /mcp-sources/:id/poll`, `POST /mcp-sources/:id/poll-and-route`, and `POST /mcp-sources/poll-all-and-route` expose discoverable MCP polling loops; default mode uses seeded fake sources, and `ORCHESTRATOR_MCP_SOURCES_PATH` loads real read-only local MCP source configs through the SDK runtime.
- `app/orchestrator/src/context`: provider deeplink normalizers extract Slack channel/message IDs, GitHub owner/repo/issue/code line data, Notion page/block IDs, Google Docs document anchors, Figma file/node IDs, and generic browser fallback metadata into context resource details.
- `app/orchestrator`: `pnpm --filter @eventloopos/orchestrator run poll:mcp:once` calls poll-all once and prints machine-readable JSON for master-agent/scheduler loops. `poll:mcp:loop` repeats the sweep with bounded `EVENTLOOPOS_MCP_POLL_MAX_CYCLES` for test runs.
- `app/orchestrator`: optional voice transcript ingress exists for experiments. `voice:send` forwards one transcript from env/stdin into `/voice/commands`; `voice:listen` consumes line-delimited local STT streams with optional wake phrase filtering; `voice:listen-command` runs a configured local transcript command with JSON argv and pipes stdout into the same router. This is not a next-lane MVP requirement.
- `app/orchestrator/src/mcp_sources`: fake runtime and real MCP SDK runtime with timeout, stderr capture, env allowlist, circuit breaker.
- `app/orchestrator/bin/dev-postgres`: Docker-backed local Postgres runner for `eventloop_test`, with `up`, `down`, `url`, and `test` commands. External DB tests can also use `EVENTLOOPOS_TEST_DATABASE_URL`.
- `app/orchestrator/src/workspace`: optional AeroSpace-backed workspace proof for power-user dogfood, plus safer URL/app/tab restore paths. HTTP exposes `GET /workspace/status`, `POST /workspace/capture`, `POST /workspace/restore-plan`, and disabled-by-default `POST /workspace/restore` requiring `ORCHESTRATOR_WORKSPACE_EXECUTE=enabled`, `confirm_execute: true`, and `idempotency-key`.
- `app/orchestrator/src/task_sessions`: fake task-session store plus terminal adapter for tmux and Ghostty, using audited visible input and injected command execution in tests.
- `app/browser-extension`: shared-schema `browser_tab` capture/restore, quote highlight on restore with highlight receipts, optional task/project route hints, tested runtime capture/restore message router, legacy resource normalizer, native bridge envelope/capability protocol.
- `app/native-host`: Chrome Native Messaging stdio host, context capture JSONL sink, optional route hints (`task_hint`, `project_hint`), macOS Chrome/Chrome for Testing/Chromium manifest installer, direct live smoke that forwards browser capture into orchestrator as `store_only` context, and opt-in real Chromium native messaging smoke for extension -> native host -> orchestrator. Local opt-in Chromium smoke passed on 2026-05-06.
- `app/macos`: Swift queue shell using real orchestrator API shape, menu bar summary/actions, full-window empty/loading/error placeholders with retry affordance, live Mac client/orchestrator context restore request round-trip in boot smoke, lease-next flow, automatic lease renewal, automatic context restore-request status refresh, packet decision/risk/context/evidence detail with open links for context/evidence resources, workspace status/restore-plan/restore client, selected-packet workspace restore planning, confirmation UI for restore execution, and manual-mode toggle (`Cmd-Option-Shift-M`) that skips workspace restore planning without clearing queue. Carbon global hotkey wiring exists in the app target without third-party dependency.
- `app/test-harness`: `seeded_queue`, `mcp_poll_route_done`, `mcp_source_poll_route_done`, `generic_mcp_source_poll_route_done`, `mcp_poll_all_route_done`, `browser_context_store_only` with restore-plan proof, `browser_context_attach_task`, `task_session_followup`, `task_session_binding`, `voice_task_command`, `workspace_snapshot_context`, `workspace_status_smoke`, and `workspace_restore_disabled` fixture/live scenarios with artifacts.
- `bin/live-smoke`: one-command local smoke that builds and starts the orchestrator, waits for `/health`, runs live harness scenarios plus native-host live smoke, runs browser extension E2E, and stops the server.
- `config`: documented read-only MCP source config example for Slack/GitHub-like and generic event-ish poll sources, validated by orchestrator tests.

Current proof commands:

```text
make ci
pnpm run test:e2e:live
```

Known gaps:

- Persistent Postgres HTTP mode exists behind `DATABASE_URL`; needs full live local proof once Docker/Postgres runtime available.
- Context restore requests now share in-memory/Postgres persistence with claim leases plus failed/retry state; live Postgres proof still depends on Docker/container runtime.
- Docker Postgres runner exists; needs pass on a machine with Docker daemon.
- macOS menu bar summary/actions and full-window empty/loading/error placeholders exist with unit-covered presentation text.
- macOS UI has manual-mode toggle state, global hotkey wiring, automatic lease renewal, packet decision/risk/context/evidence detail, open links for context/evidence resources, browser-extension-backed context restore with quote highlight receipts, restore-plan pause gate, selected restore planning, and confirmation UI for invoking workspace restore execution.
- Native host forwards context/event data to orchestrator when `EVENTLOOPOS_ORCHESTRATOR_URL` is set; ranked context search exists; Mac client live context restore request smoke exists; opt-in installed Chromium smoke exists and passed; next gap is full rendered Mac app + installed browser/native-host combined flow and optional real Google Chrome profile smoke.
- MCP source registry loads local config files and can run real read-only poll tools through the SDK runtime; generic item mapping, provider deeplink normalization, poll-all route, poll-once CLI, and bounded poll-loop CLI now support user-installed MCP servers that can emit stable event-ish `items[]`.
- Aerospace adapter has unit/API coverage, daemon status endpoint, live harness smoke, disabled-by-default execute-confirm flow, macOS confirmation UI, and opt-in live CLI smoke. Local enabled live smoke currently reports `server_unavailable` because AeroSpace.app is not running; next gap is live run with AeroSpace.app installed/running.
- Task session control has fake, daemon-seeded dev controller, discovery/read API, terminal-backed adapter seams, Codex native thread controller seam, app-server method adapter, stdio process transport, Claude CLI resume adapter, hot-loaded Codex thread-to-task map file, HTTP task binding, and automatic task-hinted event injection; next gap is stronger task/thread association UI beyond API/config files or title markers.
- Voice command HTTP ingress, env/stdin client, and local transcript-command runner exist for local STT clients to submit transcripts into the same router; microphone/wake-word UX is deferred.
- Postgres live tests need Docker/container runtime to execute locally.

## Current Build Choices

Implementation is past scaffold. Current defaults:

- Package manager: `pnpm`.
- Orchestrator: TypeScript HTTP service with route modules.
- Persistence: Postgres migrations plus in-memory parity store.
- macOS app: SwiftUI/AppKit interop.
- Product surface: native one-paper Mac queue, with CLI/test harness proof paths.
- Browser restore: Chromium MV3 extension + native host.
- Task runtimes: Codex and Claude Code behind the same task-session controller.

## Next Planning Use

Use this index to keep agents aligned, not to restart early scaffold planning.

Before new work:

1. Read `16-mvp-plan-corrections.md`.
2. Pick narrow proof from `15-agent-test-matrix.md`.
3. Leave machine-checkable proof from `20-agent-proof-loop.md`.
