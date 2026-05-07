# eventloopOS

Human event loop for computer work.

This repo is structured as a planning-first MVP workspace:

- `external-resources/` - source links, research notes, API docs, competitive references.
- `docs/planning/` - product, architecture, roadmap, and research synthesis.
- `app/` - implementation workspace for the actual product.

Current MVP direction: build a Mac-native attention scheduler for agent-heavy work. The first version should not try to replace the OS. It should create a ranked review queue, capture/restore enough workspace context, and let the user advance through human-blocked work with one hotkey and one done/next action.

## Current Proof

```sh
make ci
```

Live local orchestrator proof:

```sh
pnpm --filter @eventloopos/orchestrator build
pnpm --filter @eventloopos/orchestrator start
pnpm run test:e2e:live
```

Live proof covers seeded queue, MCP source discovery, MCP poll-and-route, Slack-specific and generic MCP source poll -> route -> done, poll-all MCP sweep -> route -> done, Slack/MCP task-hinted events injecting into an existing task session without creating a human queue item, voice transcript -> task-session followup routing, passive browser context `store_only`, ranked browser context search, context restore-plan generation, leased browser restore-request claim/done flow, ranked task-attached browser context search, task-session discovery + idempotent followup, task-session binding, native-host forwarding, browser runtime capture/restore messages, workspace status/capture/restore-plan contracts, workspace snapshot context through the queue API, workspace status/restore-disabled smoke in the live harness, and macOS manual-mode queue state with `Cmd-Option-Shift-M` global hotkey wiring. The macOS view model auto-renews queue leases, auto-refreshes context restore-request status, plans selected workspace restores, shows packet decision/risk/context/evidence detail with open links, and skips workspace restore planning while manual mode is active.

Run `pnpm --filter @eventloopos/orchestrator run dev:doctor` after build to get machine-readable readiness for local live checks: orchestrator health, AeroSpace daemon, Docker daemon, browser Playwright extension E2E readiness, and Codex app-server.

Workspace restore execution is disabled by default. Set `ORCHESTRATOR_WORKSPACE_EXECUTE=enabled` and call `POST /workspace/restore` with `confirm_execute: true` plus an `idempotency-key` header to execute an AeroSpace restore plan.

Set `DATABASE_URL` to run the orchestrator with Postgres-backed queue and context restore request storage.

Set `ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.json` to load read-only MCP poll sources from local config instead of seeded fake sources.
Use `config/mcp-sources.example.json` as the starting shape. `generic_item_to_event` supports user-installed MCP servers that can return stable event-ish `items[]`.
After `pnpm --filter @eventloopos/orchestrator build`, `pnpm --filter @eventloopos/orchestrator run poll:mcp:once` sweeps configured MCP sources once through `/mcp-sources/poll-all-and-route`. `pnpm --filter @eventloopos/orchestrator run poll:mcp:loop` repeats the sweep. Set `EVENTLOOPOS_MCP_SOURCE_IDS=slack_dm_source,generic_mcp_source` to limit a sweep, `EVENTLOOPOS_MCP_POLL_INTERVAL_MS=30000` to tune loop cadence, and `EVENTLOOPOS_MCP_POLL_MAX_CYCLES=1` for bounded test runs.

Local STT tools can pipe transcripts into the router with `pnpm --filter @eventloopos/orchestrator run voice:send`. Use `EVENTLOOPOS_VOICE_TRANSCRIPT`, or pipe text on stdin. Optional hints: `EVENTLOOPOS_VOICE_PROJECT_HINT`, `EVENTLOOPOS_VOICE_TASK_HINT`, and `EVENTLOOPOS_VOICE_IDEMPOTENCY_KEY`.

Codex native thread protocol notes from the installed local CLI live in `external-resources/codex-app-server-protocol.md`.
Set `ORCHESTRATOR_TASK_SESSIONS=codex_app_server` to expose local Codex app-server threads through `/task-sessions`; use `[task:blog feedback]` in thread titles/previews, `ORCHESTRATOR_CODEX_TASK_MAP='{"thread_id":"task_blog_feedback"}'`, or hot-loaded `ORCHESTRATOR_CODEX_TASK_MAP_PATH=config/codex-task-map.json` for task routing.
With `ORCHESTRATOR_CODEX_TASK_MAP_PATH` configured, `PUT /task-sessions/:id/task-binding` writes the map file atomically so agents can bind existing Codex threads to tasks through the orchestrator API.

Chrome native host install:

```sh
pnpm --filter @eventloopos/native-host exec eventloop-install-chrome-host <chrome-extension-id>
```

Planning docs live in `docs/planning/`. Start with:

- `00-mvp-brief.md`
- `02-architecture.md`
- `04-parallel-workstreams.md`
- `05-testing-and-agent-loop.md`
- `06-v0-contracts.md`
- `07-initial-agent-tickets.md`
- `08-command-contract.md`
- `09-v0-scenarios.md`
- `14-current-mvp-state.md`
- `10-final-planning-index.md`
