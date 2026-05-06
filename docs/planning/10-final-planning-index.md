# Final Planning Index

Use this doc as handoff map.

## Current Decision

Build MVP as local-first Mac attention scheduler for agent-heavy work.

Sharp wedge:

```text
Superhuman for agent review, with Mac workspace restore.
```

Do not build broad OS replacement first. Build review queue + context restore + agent resume loop.

## Read Order

1. `00-mvp-brief.md` - product thesis + scope.
2. `02-architecture.md` - system shape + data model.
3. `05-testing-and-agent-loop.md` - testing architecture + agent feedback loop.
4. `04-parallel-workstreams.md` - agent work split.
5. `06-v0-contracts.md` - module contracts.
6. `07-initial-agent-tickets.md` - first 10 tickets.
7. `08-command-contract.md` - command API for agents.
8. `09-v0-scenarios.md` - deterministic E2E scenarios.
9. `11-ambient-router-workspace-backends.md` - ambient router, MCP/polling, voice, AeroSpace.
10. `12-lessons-hermes-openclaw.md` - gateway/session/hook lessons from cloned repos.
11. `13-broader-agent-ecosystem-lessons.md` - lessons from ZeroClaw, SwarmClaw, Letta, CrewAI, LangGraph, security papers.

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
- Claude.
- Gmail/Drive.
- Safari.
- Jira.
- ScreenCaptureKit visual fallback.
- Voice command capture.
- AeroSpace workspace backend.
- Linear.
- browser page polling.

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

## Current Implementation Status

Implemented:

- `app/shared`: V0 contracts and fixture validation.
- `app/orchestrator`: HTTP queue API, event ingestion, voice command transcript ingestion, MCP fixture poll route, async gateway store seam, Postgres queue store, `DATABASE_URL` Postgres mode with migrations, policy hooks, ownership locks, evidence receipts, fake Codex adapter, fake task session store, terminal task-session adapter.
- `app/orchestrator`: `GET /task-sessions`, `GET /task-sessions/:id`, and `POST /task-sessions/:id/followup` support session discovery plus idempotent followup messages; daemon seeds fake `task_session_blog` by default for live local proof, and `ORCHESTRATOR_TASK_SESSIONS=off` disables it.
- `app/orchestrator/src/task_sessions`: Codex native thread controller seam maps Codex app-server-style threads to routable task sessions and starts idempotent followup turns through an injected client. The app-server thread client maps `thread/list`, `thread/read`, and `turn/start` request/response shapes behind a testable `CodexAppServerRequest`; stdio transport talks newline JSON to `codex app-server --listen stdio://`. `ORCHESTRATOR_TASK_SESSIONS=codex_app_server` exposes local Codex threads through `/task-sessions`, with task binding from hot-loaded `ORCHESTRATOR_CODEX_TASK_MAP_PATH`, env JSON, or `[task:...]` title markers.
- `app/orchestrator`: ambient route policy now separates passive context storage, task-session injection, and human interrupts. Browser context capture defaults to `store_only`; task-hinted Slack/GitHub/MCP/voice events inject into matching task sessions when available; explicit review requests still create human queue packets.
- `app/orchestrator`: `GET /events/:id` retrieves stored events and route decisions, so store-only context is machine-verifiable without queue pollution.
- `app/orchestrator`: `GET /contexts?source=&task_id=&q=&limit=` lists and text-filters stored context resources with event + route metadata, giving agents a read path for passive browser captures and task-attached browser context.
- `app/orchestrator`: `GET /mcp-sources`, `GET /mcp-sources/:id`, `POST /mcp-sources/:id/poll`, `POST /mcp-sources/:id/poll-and-route`, and `POST /mcp-sources/poll-all-and-route` expose discoverable MCP polling loops; default mode uses seeded fake sources, and `ORCHESTRATOR_MCP_SOURCES_PATH` loads real read-only local MCP source configs through the SDK runtime.
- `app/orchestrator`: `pnpm --filter @eventloopos/orchestrator run poll:mcp:once` calls poll-all once and prints machine-readable JSON for master-agent/scheduler loops. `poll:mcp:loop` repeats the sweep with bounded `EVENTLOOPOS_MCP_POLL_MAX_CYCLES` for test runs.
- `app/orchestrator`: `pnpm --filter @eventloopos/orchestrator run voice:send` forwards transcripts from env/stdin into `/voice/commands`, so local STT/wake-word tools can plug into the router without product-specific STT code.
- `app/orchestrator/src/mcp_sources`: fake runtime and real MCP SDK runtime with timeout, stderr capture, env allowlist, circuit breaker.
- `app/orchestrator/src/workspace`: deterministic AeroSpace workspace adapter, status/capture/restore-plan controller, safe command planner, and opt-in restore execution. HTTP exposes `GET /workspace/status`, `POST /workspace/capture`, `POST /workspace/restore-plan`, and disabled-by-default `POST /workspace/restore` requiring `ORCHESTRATOR_WORKSPACE_EXECUTE=enabled`, `confirm_execute: true`, and `idempotency-key`.
- `app/orchestrator/src/task_sessions`: fake task-session store plus terminal adapter for tmux and Ghostty, using audited visible input and injected command execution in tests.
- `app/browser-extension`: shared-schema `browser_tab` capture/restore, optional task/project route hints, legacy resource normalizer, native bridge envelope/capability protocol.
- `app/native-host`: Chrome Native Messaging stdio host, context capture JSONL sink, optional route hints (`task_hint`, `project_hint`), macOS Chrome manifest installer, and live smoke that forwards browser capture into orchestrator as `store_only` context.
- `app/macos`: Swift queue shell using real orchestrator API shape, lease-next flow, automatic lease renewal, workspace status/restore-plan/restore client, selected-packet workspace restore planning, confirmation UI for restore execution, and manual-mode toggle (`Cmd-Option-Shift-M`) that skips workspace restore planning without clearing queue. Carbon global hotkey wiring exists in the app target without third-party dependency.
- `app/test-harness`: `seeded_queue`, `mcp_poll_route_done`, `mcp_source_poll_route_done`, `generic_mcp_source_poll_route_done`, `mcp_poll_all_route_done`, `browser_context_store_only`, `browser_context_attach_task`, `task_session_followup`, `voice_task_command`, `workspace_snapshot_context`, `workspace_status_smoke`, and `workspace_restore_disabled` fixture/live scenarios with artifacts.
- `config`: documented read-only MCP source config example for Slack/GitHub-like and generic event-ish poll sources, validated by orchestrator tests.

Current proof commands:

```text
make ci
pnpm run test:e2e:live
```

Known gaps:

- Persistent Postgres HTTP mode exists behind `DATABASE_URL`; needs full live local proof once Docker/Postgres runtime available.
- macOS UI needs menu bar polish and stronger empty/error/loading states.
- macOS UI has manual-mode toggle state, global hotkey wiring, automatic lease renewal, restore-plan pause gate, selected restore planning, and confirmation UI for invoking workspace restore execution; next gap is deeper queue/detail polish around review packet context.
- Native host forwards context/event data to orchestrator when `EVENTLOOPOS_ORCHESTRATOR_URL` is set; next gap is richer context ranking/search and task attachment UI.
- MCP source registry loads local config files and can run real read-only poll tools through the SDK runtime; generic item mapping, poll-all route, poll-once CLI, and bounded poll-loop CLI now support user-installed MCP servers that can emit stable event-ish `items[]`.
- Aerospace adapter has unit/API coverage, daemon status endpoint, live harness smoke, disabled-by-default execute-confirm flow, and macOS confirmation UI; next gap is live run with AeroSpace.app installed.
- Task session control has fake, daemon-seeded dev controller, discovery/read API, terminal-backed adapter seams, Codex native thread controller seam, app-server method adapter, stdio process transport, hot-loaded Codex thread-to-task map file, and automatic task-hinted event injection; next gap is stronger task/thread association UI beyond config files or title markers.
- Voice command HTTP ingress and env/stdin client exist for local STT/wake-word clients to submit transcripts into same router; next gap is actual always-listening local voice capture/wake-word app.
- Postgres live tests need Docker/container runtime to execute locally.

## Open Decisions

Decide before implementation:

- TypeScript package manager: likely `pnpm`.
- Orchestrator framework: likely Fastify or Hono.
- DB migration tool: likely Drizzle, Kysely, or node-pg-migrate.
- macOS app stack: SwiftUI with AppKit interop vs AppKit-first.
- Queue UI first surface: native macOS only vs tiny web UI for fast E2E.
- Local DB for single-user dev: Postgres only vs SQLite for app-local mode.

Recommended defaults:

- `pnpm`.
- Fastify.
- Postgres first for test parity.
- node-pg-migrate or Drizzle migrations.
- SwiftUI + AppKit interop for menu bar/hotkey.
- Tiny web queue shell optional for fast Playwright E2E, but real product native.

## Planning Complete When

Planning is enough to start implementation now.

Next action:

```text
Scaffold Ticket 1 + Ticket 2 + Ticket 3.
```

That means shared contracts, command facade, and test harness skeleton. After that, multiple agents can work without stepping on each other.
