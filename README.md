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

One-command local smoke that boots the orchestrator, waits for `/health`, runs live harness scenarios, runs native-host live smoke, runs browser extension E2E, and stops the orchestrator:

```sh
pnpm run test:e2e:live:boot
```

Full local smoke adds installed Chromium extension/native host capture against the same booted orchestrator:

```sh
pnpm run test:e2e:live:full
```

Live proof covers seeded queue, MCP source discovery, MCP poll-and-route, Slack-specific and generic MCP source poll -> route -> done, poll-all MCP sweep -> route -> done, Slack/MCP task-hinted events injecting into an existing task session without creating a human queue item, voice transcript -> task-session followup routing, passive browser context `store_only`, ranked browser context search, context restore-plan generation, leased browser restore-request claim/done flow, ranked task-attached browser context search, task-session discovery + idempotent followup, task-session binding, bind-gated recommended handoff, native-host forwarding, browser runtime capture/restore messages with quote highlight receipts, workspace status/capture/restore-plan contracts, workspace snapshot context through the queue API, workspace status/restore-disabled smoke in the live harness, and macOS manual-mode queue state with `Cmd-Option-Shift-M` global hotkey wiring. The macOS view model auto-renews queue leases, auto-refreshes context restore-request status, plans selected workspace restores, shows packet decision/risk/context/evidence detail with open links, and skips workspace restore planning while manual mode is active.

Run `pnpm run dev:doctor` to build the orchestrator and get machine-readable readiness for local live checks: orchestrator health, AeroSpace daemon, Docker daemon, browser Playwright extension E2E readiness, optional MCP source config, optional voice transcript command readiness, and Codex app-server.

Personal dogfood stack:

```sh
pnpm run dev:dogfood
```

This starts dev Postgres, builds and runs the orchestrator with Codex app-server task sessions, uses AeroSpace in disabled-execute mode, auto-loads `config/mcp-sources.json` when present, and launches the Mac queue app against the local orchestrator. Press `Ctrl-C` in the terminal to stop the app, orchestrator, optional poll loop, and dev Postgres. Set `EVENTLOOPOS_DOGFOOD_POSTGRES=0` for empty in-memory mode. Set `EVENTLOOPOS_DOGFOOD_MCP_POLL=1` to run the MCP poll loop while dogfooding.

Quick dogfood launch smoke:

```sh
pnpm run dev:dogfood:smoke
```

This uses empty in-memory mode and exits the Mac app after a few seconds, which is useful before starting a longer dogfood session.

While dogfooding, manually add a human-review queue item from another terminal:

```sh
pnpm run queue:add -- --title "Launch blog final paragraph" --summary "Check final paragraph before sending." --task "blog feedback" --url "https://docs.example.test/blog"
```

To inspect and bind agent threads during dogfood:

```sh
pnpm run task:sessions
pnpm run task:bind -- --session codex_thread_abc --task "blog feedback"
```

`task:bind` accepts either a full `--task-id task_blog_feedback` or a human hint via `--task "blog feedback"`, then writes through the orchestrator binding API.

Workspace restore execution is disabled by default. Set `ORCHESTRATOR_WORKSPACE_EXECUTE=enabled` and call `POST /workspace/restore` with `confirm_execute: true` plus an `idempotency-key` header to execute an AeroSpace restore plan.

Set `DATABASE_URL` to run the orchestrator with Postgres-backed queue and context restore request storage.
For local Postgres-backed tests with Docker:

```sh
pnpm run dev:postgres:up
pnpm run test:db:docker
pnpm run dev:postgres:down
```

If Docker is unavailable but local Postgres binaries are installed, run a temporary native Postgres cluster instead. This creates a throwaway cluster under the system temp directory, runs DB tests, stops Postgres, and deletes the temp data:

```sh
pnpm run test:db:native
```

Set `ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.json` to load read-only MCP poll sources from local config instead of seeded fake sources.
Use `config/mcp-sources.example.json` as the starting shape. `generic_item_to_event` supports user-installed MCP servers that can return stable event-ish `items[]`.
After `pnpm --filter @eventloopos/orchestrator build`, `pnpm --filter @eventloopos/orchestrator run poll:mcp:once` sweeps configured MCP sources once through `/mcp-sources/poll-all-and-route`. `pnpm --filter @eventloopos/orchestrator run poll:mcp:loop` repeats the sweep. Set `EVENTLOOPOS_MCP_SOURCE_IDS=slack_dm_source,generic_mcp_source` to limit a sweep, `EVENTLOOPOS_MCP_POLL_INTERVAL_MS=30000` to tune loop cadence, and `EVENTLOOPOS_MCP_POLL_MAX_CYCLES=1` for bounded test runs.

Local STT tools can pipe transcripts into the router with `pnpm --filter @eventloopos/orchestrator run voice:send`. Use `EVENTLOOPOS_VOICE_TRANSCRIPT`, or pipe text on stdin. Optional hints: `EVENTLOOPOS_VOICE_PROJECT_HINT`, `EVENTLOOPOS_VOICE_TASK_HINT`, and `EVENTLOOPOS_VOICE_IDEMPOTENCY_KEY`.
For line-delimited local STT streams, use `pnpm --filter @eventloopos/orchestrator run voice:listen`. Optional `EVENTLOOPOS_VOICE_WAKE_PHRASE=computer` filters ambient transcripts and strips the wake phrase before forwarding.
For a local STT command that prints line-delimited transcripts, use `pnpm run voice:listen-command` with `EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND` and optional `EVENTLOOPOS_VOICE_TRANSCRIPT_ARGS_JSON='["--arg","value"]'`. This launches the command with argv, pipes stdout into the wake-phrase router, and is checked by `pnpm run dev:doctor` when configured.
For deterministic local STT proof with real audio, install `whisper-cpp`, download a GGML model outside git, then run:

```sh
EVENTLOOPOS_ENABLE_VOICE_STT_SMOKE=1 \
EVENTLOOPOS_WHISPER_MODEL=external-resources/models/whisper/ggml-tiny.en.bin \
pnpm run voice:stt-smoke
```

This uses macOS `say`, `ffmpeg`, and `whisper-cli` to generate and transcribe fixture audio.

To check live AeroSpace status/capture/restore-plan without moving windows:

```sh
EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1 pnpm run live:aerospace
```

Codex native thread protocol notes from the installed local CLI live in `external-resources/codex-app-server-protocol.md`.
Set `ORCHESTRATOR_TASK_SESSIONS=codex_app_server` to expose local Codex app-server threads through `/task-sessions`; use `[task:blog feedback]` in thread titles/previews, `ORCHESTRATOR_CODEX_TASK_MAP='{"thread_id":"task_blog_feedback"}'`, or hot-loaded `ORCHESTRATOR_CODEX_TASK_MAP_PATH=config/codex-task-map.json` for task routing.
With `ORCHESTRATOR_CODEX_TASK_MAP_PATH` configured, `PUT /task-sessions/:id/task-binding` writes the map file atomically so agents can bind existing Codex threads to tasks through the orchestrator API.
The Mac queue app shows task-session binding controls on review packets with `task_id`, auto-loads available sessions for the selected task, lets a human bind an existing Codex thread, then enables the recommended agent handoff from the same queue context. Entering Manual Mode pauses automated workspace restore and captures the current AeroSpace workspace snapshot so normal-computer context is visible in the UI instead of disappearing silently. `Restore Manual Workspace` moves back to that saved normal-computer snapshot and keeps Event Loop automation paused.

Chrome native host install:

```sh
pnpm --filter @eventloopos/native-host exec eventloop-install-chrome-host <chrome-extension-id> --browser chrome
```

Use `--browser chromium` for local Chromium/Playwright smoke, or `--browser chrome-for-testing` for Google Chrome for Testing. The opt-in real browser native messaging smoke installs a temporary Chromium host manifest, launches the unpacked extension, captures a tab through `chrome.runtime.sendNativeMessage`, forwards it through the native host to the orchestrator fixture, then restores the previous manifest:

```sh
pnpm run test:e2e:native-browser
```

Rendered Mac queue UI smoke:

```sh
pnpm run test:e2e:macos
```

Opt-in Mac app UI interaction smoke requires Accessibility permission for `osascript`/System Events:

```sh
EVENTLOOPOS_ENABLE_MACOS_UI_SMOKE=1 pnpm run test:e2e:macos-ui
```

Real orchestrator + installed Chromium extension/native host smoke:

```sh
pnpm run test:e2e:native-browser-real-orchestrator
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
- `15-agent-test-matrix.md`
- `10-final-planning-index.md`
