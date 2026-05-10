# eventloopOS

eventloopOS turns your Mac into an attention scheduler for agent-heavy work: a single ranked queue of "papers" that need a human, where pulling a paper restores its full workspace (windows, Codex thread, Chrome tabs, source thread) so the decision takes seconds instead of minutes of context-hunting. It is built for people running many parallel coding/email/research agents who feel review bandwidth — not agent execution — as the bottleneck.

License: AGPL-3.0-only. See [LICENSE](LICENSE).

## 30-second quickstart

```sh
brew install --cask nikitabobko/tap/aerospace   # required workspace backend
pnpm install
pnpm run dev:dogfood                            # builds + runs orchestrator + Mac queue app
```

Once the queue app is up, `Cmd-Option-Shift-J` pulls the next paper, `Cmd-Option-Shift-K` opens the master command sheet (route / start task / rerank / broadcast), and `Cmd-Option-Shift-M` toggles manual mode. For the full path on a fresh clone, see [docs/try-on-mac.md](docs/try-on-mac.md).

## Repo layout

- `app/orchestrator/` — TypeScript HTTP gateway: queue, routing, MCP source polling, agent handoff, restore plans, observability.
- `app/macos/` — Swift/SwiftUI Mac app: queue UI, hotkeys, workspace capture/restore, master command sheet, voice mic.
- `app/browser-extension/` — Chrome extension: tab capture and scroll-anchor restore.
- `app/native-host/` — native messaging bridge between extension and orchestrator.
- `docs/planning/` — product brief, architecture, roadmap, research synthesis.
- `external-resources/` — source links, API docs, competitive references.

## Current Proof

Fixture/default proof for agent handoff:

```sh
pnpm proof:agent
```

This runs lint, typecheck, unit tests, product event-loop smoke, and fixture E2E through `bin/proof-agent`. It writes `artifacts/proof-manifest.json` plus per-command stdout/stderr logs under `artifacts/proof-agent/<run-id>/`. The manifest is machine-readable and is updated at run start, command start, command finish, and interruption.

Focused product loop proof:

```sh
pnpm test:e2e:event-loop
```

This boots a real local orchestrator with fake task runtime, starts a task session, routes Slack and voice inputs into it, queues a Codex-style waiting run for human review, executes the recommended queue action, checks task-message history, checks activity/metrics, and writes `artifacts/event-loop-proof/<run-id>/manifest.json`.

Durability product loop proof:

```sh
pnpm test:e2e:event-loop:postgres
```

This starts a disposable Docker Postgres container, runs the same event-loop proof with Postgres backing, kills and restarts the orchestrator while a human review item is queued, proves queue/history/metrics survive, reconnects the fake task runtime, executes the recommended action, and writes `artifacts/event-loop-postgres-proof/<run-id>/manifest.json`.

Live Codex product loop proof:

```sh
pnpm test:e2e:event-loop:codex
```

This starts a real local `codex app-server` through the orchestrator, creates a real Codex thread in an isolated artifact workdir, binds that thread to the smoke task, routes Slack and voice inputs into it, queues a human review item, executes the recommended action back into the same Codex thread, and writes `artifacts/event-loop-codex-proof/<run-id>/manifest.json`. It is opt-in because it uses the local Codex runtime and may consume model/API resources.

Live Codex completion + workspace proof:

```sh
pnpm test:e2e:event-loop:codex-completion-workspace
```

This starts one shared websocket `codex app-server`, points the orchestrator at it with `ORCHESTRATOR_CODEX_APP_SERVER_URL`, starts a real Codex task, opens a sacrificial Ghostty TUI attached to the same thread, proves an independent manual-style websocket client can add a turn to that thread, routes a Slack-like event into the same thread afterward, detects the completed Codex turn, creates and approves a human review queue item, resumes the same thread, then runs the isolated AeroSpace one-window move/restore proof. It writes `artifacts/event-loop-codex-completion-workspace/<run-id>/manifest.json`.

macOS may ask once whether Ghostty can execute `bin/ghostty-codex-remote`; that stable helper avoids per-run artifact-script prompts.

Deep local proof:

```sh
pnpm proof:deep
```

This combines the Postgres restart product proof with the lower-disturbance isolated AeroSpace proof. It writes `artifacts/proof-deep-manifest.json` and per-command proof logs.

Full local Mac proof:

```sh
pnpm proof:live
```

This is the real-host lane. It requires macOS, AeroSpace (`brew install --cask nikitabobko/tap/aerospace`), Codex CLI, and a runnable Chromium/Playwright browser stack for native browser capture/restore. It writes `artifacts/proof-live-manifest.json`, `artifacts/live-smoke/<run-id>/manifest.json`, `artifacts/onboarding-live/<run-id>/manifest.json`, and per-command logs under `artifacts/proof-agent/<run-id>/`. Use this when claiming the Mac app, live orchestrator, onboarding scan/approval, AeroSpace readiness, and browser/native-host path work on a real machine.

`proof:live` also runs the real Codex completion + workspace proof. That proof starts a Codex task from the master command, opens a visible Ghostty TUI on the same Codex app-server thread, routes a Slack-like event into that existing thread, detects a completed Codex turn, queues human review, approves it back into the same thread, and runs isolated AeroSpace window restore.

If doctor reports `AeroSpace returned 0 managed windows` while native Spaces debug sees windows, regrant Accessibility for `AeroSpace.app` and restart AeroSpace before trusting any workspace proof.

Lower-disturbance AeroSpace proof:

```sh
pnpm proof:live:isolated
```

This launches a unique temporary TextEdit document, captures its AeroSpace window, moves only that newly-created window to `eventloop-smoke`, restores it, closes it, and fails if any pre-existing window ID changes workspace during the proof. It also verifies the sacrificial window disappeared after cleanup and writes a manifest under `artifacts/live-aerospace-isolated/<run-id>/manifest.json`. It is meant for running while the machine is in use, but it may still briefly focus TextEdit while creating the sacrificial window.

Baseline CI proof:

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

Live proof covers seeded queue, MCP source discovery, MCP poll-and-route, Slack-specific and generic MCP source poll -> route -> done, poll-all MCP sweep -> route -> done, Slack/MCP task-hinted events injecting into an existing task session without creating a human queue item, voice transcript -> task-session followup routing, AgentRun `waiting_approval` -> review packet -> queue item intake, live onboarding scan over current Mac windows plus Codex task runtime discovery, onboarding approval that saves selected windows into task workspace memory and queues the first paper for that workbench, browser-tab context inheritance for later papers, passive browser context `store_only`, ranked browser context search, provider deeplink normalization for Slack/GitHub/Notion/Google Docs/Figma/browser URLs, context restore-plan generation, leased browser restore-request claim/done/failure-retry flow, ranked task-attached browser context search, task-session discovery + idempotent followup, task-session binding, bind-gated recommended handoff, native-host forwarding, browser runtime capture/restore messages with quote highlight receipts, workspace status/capture/restore-plan contracts, workspace snapshot context through the queue API, workspace status/restore-disabled smoke in the live harness, and macOS manual-mode queue state with `Cmd-Option-Shift-M` global hotkey wiring. The macOS view model auto-renews queue leases, auto-refreshes context restore-request status, plans selected workspace restores, shows packet decision/risk/context/evidence detail with open links, and skips workspace restore planning while manual mode is active.

Run `pnpm run dev:doctor:preflight` to build the orchestrator and check local tools before the stack is running. Run `pnpm run dev:doctor` after dogfood launch for the strict readiness check. Doctor reports orchestrator health, AeroSpace daemon, Docker daemon, browser Playwright extension E2E readiness, optional MCP source config, optional voice transcript command readiness, and Codex app-server.

Local dogfood inspection:

```sh
curl http://127.0.0.1:4377/metrics
curl http://127.0.0.1:4377/activity?limit=20
pnpm run dogfood:review
```

These endpoints expose counters and recent activity for local debugging. In Postgres mode they persist across orchestrator restarts; in empty in-memory mode they reset with the process.

Personal dogfood stack:

```sh
pnpm run dev:dogfood
```

This requires AeroSpace (`brew install --cask nikitabobko/tap/aerospace`), starts dev Postgres, builds and runs the orchestrator with Codex app-server task sessions, uses AeroSpace in disabled-execute mode, auto-loads `config/mcp-sources.json` when present, and launches the Mac queue app against the local orchestrator. Press `Ctrl-C` in the terminal to stop the app, orchestrator, optional poll loop, and dev Postgres. When the queue app terminates with a saved manual workspace, it asks the workspace backend to restore that layout before quitting. Set `EVENTLOOPOS_DOGFOOD_POSTGRES=0` for empty in-memory mode. Set `EVENTLOOPOS_DOGFOOD_MCP_POLL=1` to run the MCP poll loop while dogfooding. Set `EVENTLOOPOS_DOGFOOD_REQUIRE_AEROSPACE=0` only for queue/router hacking without workspace restore.

The queue app now has two dogfood control surfaces beyond the paper actions:

- **Master** opens a command sheet that can route a note through `/voice/commands` or start a new task session through `/task-sessions`. Use `Cmd-Option-Shift-K` from any app to summon it.
- **Scan Desk** opens onboarding proposals from `/onboarding/scan` and approves selected task groups through `/onboarding/approvals`, saving proposed windows into task workspace memory, binding proposed task sessions, and optionally creating the first queue paper for the approved workbench.

To let Codex or Claude Code onboard a clone, first start dogfood or any orchestrator, then run:

```sh
pnpm run onboarding:agent
```

This prints an agent-readable setup brief: local readiness checks, integration preview commands, current window/task-session grouping proposals, and exact next actions for binding tasks and routing one source event.

Approve a proposed group directly when the brief lists a proposal id:

```sh
pnpm run onboarding:apply -- --proposal onboard_abc123 --queue-paper
```

The approval path saves the proposal's selected windows into task workspace memory and binds any proposed task sessions unless explicit `--window-id` or `--session` overrides are provided. Add `--queue-paper` when onboarding should also place the approved workbench into the intake stack immediately.

Dogfood supports named local profiles so a stable stack and an experimental stack do not fight over the same ports or Postgres container:

```sh
pnpm run dev:dogfood
EVENTLOOPOS_DOGFOOD_PROFILE=experiment pnpm run dev:dogfood
```

Non-default profiles derive separate orchestrator/Postgres defaults, use a profile-specific Docker container, and write Codex thread bindings to `var/codex-task-map.<profile>.json` instead of the default `config/codex-task-map.json`. Set `EVENTLOOPOS_DOGFOOD_QUEUE_APP=0` when running a background experimental daemon without a second queue app or global hotkey registration. You can also pin everything explicitly with `EVENTLOOPOS_ORCHESTRATOR_URL`, `EVENTLOOPOS_POSTGRES_PORT`, `EVENTLOOPOS_POSTGRES_CONTAINER`, and `ORCHESTRATOR_CODEX_TASK_MAP_PATH`.

For Codex dogfood, the launcher starts a shared websocket `codex app-server` by default and prints its `ws://` URL. Use `codex --remote <printed-ws-url> resume <thread-id>` in Ghostty when you want a visible TUI attached to the same thread eventloopOS controls. Set `EVENTLOOPOS_DOGFOOD_SHARED_CODEX_APP_SERVER=0` to use the private stdio app-server path.

Fresh-clone first run without Docker:

```sh
pnpm run dev:dogfood:memory
```

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

To let a running agent put itself back into the human intake stack:

```sh
pnpm run agent:run -- --id run_blog_review_1 --provider codex --task "blog feedback" --thread <thread-id> --status waiting_approval --summary "Approve launch paragraph before send." --risk-tag external_send --evidence-url https://docs.example.test/blog
```

This calls `POST /agent-runs`; `waiting_approval` or `blocked` creates one review paper, while later `running`, `completed`, `failed`, or `cancelled` clears stale ready paper state.

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
Use `config/mcp-sources.agent-slack.example.json` for Jason's local `agent-slack` search wrapper and `config/mcp-sources.gh-notifications.example.json` for the local `gh api` notifications wrapper.
Inspect sources before routing:

```sh
pnpm run mcp:sources
pnpm run mcp:preview local_events_source
```

`mcp:preview` calls `/mcp-sources/:id/preview`, does not route events, and does not commit MCP cursor state. It redacts event title/body/summary fields by default so source-shape checks do not dump private Slack/GitHub content into logs. Set `EVENTLOOPOS_MCP_PREVIEW_INCLUDE_TEXT=1` only when you intentionally want raw preview text.

After preview looks sane, `pnpm run mcp:route-once local_events_source` routes selected sources once through `/mcp-sources/poll-all-and-route`. `pnpm --filter @eventloopos/orchestrator run poll:mcp:loop` repeats the sweep. Set `EVENTLOOPOS_MCP_SOURCE_IDS=slack_dm_source,generic_mcp_source` to limit a sweep, `EVENTLOOPOS_MCP_POLL_INTERVAL_MS=30000` to tune loop cadence, and `EVENTLOOPOS_MCP_POLL_MAX_CYCLES=1` for bounded test runs.

For local dogfood without Slack/GitHub setup, copy `config/local-events.example.json` to a private file and run the file-backed MCP server through the local-events source config:

```sh
cp config/local-events.example.json var/local-events.json
EVENTLOOPOS_LOCAL_EVENTS_PATH=var/local-events.json \
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.local-events.example.json \
pnpm run dev:dogfood
```

Then edit `var/local-events.json` and run `pnpm --filter @eventloopos/orchestrator run poll:mcp:once` to turn those local items into routed events. This is useful for testing the master-agent polling loop before giving real external integrations access.

Optional voice experiment. Voice is not a core MVP lane; these commands exist only because transcripts feed the same event router as Slack/GitHub/MCP/local events.

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
Set `ORCHESTRATOR_TASK_SESSIONS=claude_cli` with `ORCHESTRATOR_CLAUDE_SESSIONS='{"claude-session-id":{"task_id":"task_blog_feedback","name":"Blog feedback","cwd":"/repo"}}'` to expose configured Claude Code sessions through the same `/task-sessions` API. Followups use `claude -p --output-format json --resume <session>` in the configured `cwd`.
With `ORCHESTRATOR_CODEX_TASK_MAP_PATH` configured, `PUT /task-sessions/:id/task-binding` writes the map file atomically so agents can bind existing Codex threads to tasks through the orchestrator API.
The Mac queue app shows task-session binding controls on review packets with `task_id`, auto-loads available sessions for the selected task, lets a human bind an existing Codex thread, then enables the recommended agent handoff from the same queue context. Manual Mode pauses automated workspace restore so the user can use the Mac normally. Returning to Event Loop captures the manual layout before restoring queue context, so `Restore Manual Workspace` can move back to the normal-computer context and keep automation paused.

Chrome native host install:

```sh
pnpm --filter @eventloopos/native-host exec ./bin/install-chrome-host --browser chrome
```

After loading the unpacked extension, open its Options page, set the orchestrator URL, add allowlisted origins, optionally fill **Task hint** / **Project hint**, then click **Capture current tab** or **Capture tabs**. **Capture current tab** binds the active tab to that task and captures page scroll/selected text when available. **Capture tabs** sends read-only tab registry records for all allowed tabs. Blank hints make captured tabs available for onboarding grouping or reading queue proposals. A task hint attaches captured tabs directly to that task. Restore prefers the captured Chrome tab id when it is still alive and falls back to URL match otherwise. It does not read disallowed origins and does not click/type in pages.

The dev extension ID is stable from `app/browser-extension/manifest.json`; pass an explicit extension ID only when using a different signed build. Use `--browser chromium` for local Chromium/Playwright smoke, or `--browser chrome-for-testing` for Google Chrome for Testing. The opt-in real browser native messaging smoke installs a temporary Chromium host manifest, launches the unpacked extension, captures a tab through `chrome.runtime.sendNativeMessage`, forwards it through the native host to the orchestrator fixture, then restores the previous manifest:

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
