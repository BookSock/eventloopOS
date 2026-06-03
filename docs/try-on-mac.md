# Try eventloopOS on a Mac

This is the friend-onboarding path for a fresh clone. It avoids Jason-specific configs and starts with local/fake sources before connecting Slack, Gmail, or other private tools.

## Prerequisites

- macOS with Xcode Command Line Tools: `xcode-select --install`
- Homebrew, if you want the one-line AeroSpace install
- Node.js 22 or newer. `fnm use` and `nvm use` both read `.nvmrc`; otherwise install Node 22+ by your preferred manager.
- `pnpm` via Corepack: `corepack enable`
- Swift toolchain from Xcode Command Line Tools
- Python 3 for the test harness
- Docker for Postgres-backed local dogfood and Postgres restart proofs
- Codex CLI, signed in locally, for real task sessions and `dev:dogfood`
- AeroSpace for workspace capture/restore:
  `brew install --cask nikitabobko/tap/aerospace`
- Optional but recommended: Google Chrome for browser context capture/restore

Jason's current dogfood path uses a personal AeroSpace fork with `experimental-native-spaces` and `experimental-force-floating-windows`. Stock AeroSpace is enough for basic workspace capture/restore, but the fork gives the closest version of the intended product behavior.

Install the eventloopOS AeroSpace profile before dogfooding workspace restore:

```sh
bin/macos-aerospace-profile install
```

The profile backs up `~/.aerospace.toml`, enables `experimental-force-floating-windows = true`, forces detected windows to floating layout, and adds Rectangle-inspired snap hotkeys. Rectangle's default `Ctrl-Option-Return` maximize chord conflicts with eventloopOS Send to Agent, so the profile uses `Ctrl-Option-Shift-Return` for maximize and leaves eventloopOS paper-loop chords untouched.

If a Mac already uses different Rectangle chords, customize the generated AeroSpace profile during install with environment variables. The installer rejects chords that shadow eventloopOS paper-loop hotkeys such as `Ctrl-Option-Return`, `Ctrl-Option-J`, `Ctrl-Option-K`, `Ctrl-Option-R`, and `Ctrl-Option-M`.

```sh
EVENTLOOPOS_AEROSPACE_HOTKEY_MAXIMIZE=ctrl-alt-cmd-enter \
EVENTLOOPOS_AEROSPACE_HOTKEY_BOTTOM_LEFT=ctrl-alt-cmd-j \
EVENTLOOPOS_AEROSPACE_HOTKEY_BOTTOM_RIGHT=ctrl-alt-cmd-k \
bin/macos-aerospace-profile install
```

Supported override variables:

```text
EVENTLOOPOS_AEROSPACE_HOTKEY_LEFT_HALF
EVENTLOOPOS_AEROSPACE_HOTKEY_RIGHT_HALF
EVENTLOOPOS_AEROSPACE_HOTKEY_TOP_HALF
EVENTLOOPOS_AEROSPACE_HOTKEY_BOTTOM_HALF
EVENTLOOPOS_AEROSPACE_HOTKEY_CENTER
EVENTLOOPOS_AEROSPACE_HOTKEY_MAXIMIZE
EVENTLOOPOS_AEROSPACE_HOTKEY_TOP_LEFT
EVENTLOOPOS_AEROSPACE_HOTKEY_TOP_RIGHT
EVENTLOOPOS_AEROSPACE_HOTKEY_BOTTOM_LEFT
EVENTLOOPOS_AEROSPACE_HOTKEY_BOTTOM_RIGHT
EVENTLOOPOS_AEROSPACE_HOTKEY_PREV_DISPLAY
EVENTLOOPOS_AEROSPACE_HOTKEY_NEXT_DISPLAY
```

## Install

```sh
git clone <repo-url> eventloopOS
cd eventloopOS
fnm use
corepack enable
pnpm install
pnpm setup:status
```

`pnpm setup:status` is the fastest setup gate. It checks Codex status,
unsigned-dev app install, and macOS Screen Recording / Accessibility / AeroSpace
readiness without remote lab work, real Codex dogfood scenarios, screenshots, or
restart faults. If it reports missing permissions, run `pnpm setup:prompt`,
approve the Privacy & Security prompts, and rerun `pnpm setup:status`.

`dev:doctor:preflight` builds the orchestrator and checks local tools before the orchestrator is running. It treats the `http://127.0.0.1:4377/health` check as optional, but still checks Docker, AeroSpace, browser tooling, Swift, MCP config shape, optional voice command config, and Codex app-server readiness. For a stricter check after the stack is running, use `pnpm run dev:doctor`. Launch AeroSpace once after installing it so the CLI can talk to the app server.

If `aerospace_daemon` says AeroSpace returned `0 managed windows` while native Spaces debug sees current-space windows, AeroSpace does not currently have enough Accessibility/window access to manage the desktop. Regrant Accessibility for `AeroSpace.app`, restart AeroSpace, then rerun `pnpm run dev:doctor:preflight` before testing workspace restore.

## Proof commands

Use the fixture proof when you want the broad deterministic lane without requiring real Mac automation:

```sh
pnpm proof:agent
```

It writes `artifacts/proof-manifest.json` and per-command logs under `artifacts/proof-agent/<run-id>/`.

Use the focused product loop proof when you want a quick real-orchestrator check of the core event loop without touching windows:

```sh
pnpm test:e2e:event-loop
```

It starts a task session, routes Slack and voice inputs into that session, queues a Codex-style waiting run, executes the recommended queue action, verifies history/activity/metrics, and writes `artifacts/event-loop-proof/<run-id>/manifest.json`.

Use the Postgres restart product proof when you want to prove the queue survives an orchestrator crash/restart:

```sh
pnpm test:e2e:event-loop:postgres
```

It starts a disposable Docker Postgres container, runs the focused product loop, restarts the orchestrator while a queue item is ready, verifies persisted queue/history/metrics, reconnects the fake runtime, executes the recommended action, then removes the container.

Use the live Codex product loop proof when you want to prove real Codex app-server thread creation and followups work:

```sh
pnpm test:e2e:event-loop:codex
```

It creates a real Codex thread in an isolated artifact workdir, binds it to the smoke task, routes Slack and voice inputs into that thread, queues human review, executes the recommended action back into Codex, and writes `artifacts/event-loop-codex-proof/<run-id>/manifest.json`. It is opt-in because it may consume model/API resources.

Use the stronger Codex completion + workspace proof when you want to prove visible Ghostty and EventLoop can share one Codex app-server thread:

```sh
pnpm test:e2e:event-loop:codex-completion-workspace
```

It starts one shared websocket `codex app-server`, starts a real Codex task through the orchestrator, opens a sacrificial Ghostty TUI attached to the same thread, proves an independent manual-style websocket client can add a turn to that thread, routes a Slack-like event into the same thread afterward, detects the completed turn, queues human review from the agent-run marker, approves it back into the same thread, then runs the isolated AeroSpace one-window move/restore proof. It writes `artifacts/event-loop-codex-completion-workspace/<run-id>/manifest.json` and closes its smoke windows afterward.

macOS may ask once whether Ghostty can execute `bin/ghostty-codex-remote`. Allow that stable helper for this live proof; earlier versions used per-run artifact scripts and could prompt every run.

Use the deep local proof for the strongest non-public-push check:

```sh
pnpm proof:deep
```

It combines the Postgres restart product proof with the isolated AeroSpace move/restore proof.

Use the live proof only on a real Mac with AeroSpace running and the browser stack available:

```sh
pnpm proof:live
```

It fails during preflight when macOS, AeroSpace, Codex, or native browser setup is missing. It writes `artifacts/proof-live-manifest.json`, `artifacts/live-smoke/<run-id>/manifest.json`, `artifacts/onboarding-live/<run-id>/manifest.json`, and per-command logs under `artifacts/proof-agent/<run-id>/`. The onboarding manifest now proves scan -> approve selected Mac windows into a task -> queue the first paper for that workbench -> attach a browser-tab context -> create a later paper that inherits both task desk and tab context.

If Playwright browser dependencies are missing, install them before running browser proof lanes:

```sh
pnpm --filter @eventloopos/browser-extension exec playwright install chromium
```

Use the isolated live proof when you want to keep working while checking the AeroSpace move/restore path:

```sh
pnpm proof:live:isolated
```

It creates one unique temporary TextEdit document, waits for that newly-created window in AeroSpace, moves only that window to `eventloop-smoke`, restores it, closes it, verifies the window disappeared after cleanup, and fails if any pre-existing window ID changes workspace. It writes `artifacts/live-aerospace-isolated/<run-id>/manifest.json`. It can still briefly focus TextEdit while the sacrificial window opens.

## Run the queue app

Start the local dogfood stack:

```sh
pnpm setup:dogfood
```

This starts memory-mode dogfood, verifies AeroSpace, starts a shared Codex
app-server, builds the orchestrator, and launches the Mac queue app. It does not
require Docker, Postgres, Slack, Gmail, GitHub, or Chrome. By default, workspace
restore execution is disabled until a restore is explicitly confirmed. Press
`Ctrl-C` in the terminal to stop the stack. When the queue app quits with a
saved manual workspace, it asks the workspace backend to restore that layout
before terminating.

In the queue app:

- **Pull Next Paper** leases the highest-priority ready paper and prepares its saved workspace.
- **Done / Next**, **Send to Agent**, **Defer**, and **Ignore** save the selected task's current workspace before advancing the stack.
- **Manual Mode** pauses workspace automation so you can use the Mac normally. **Restore Manual Workspace** moves back to the saved manual layout.
- **Master** opens a command sheet for routing a note through `/voice/commands` or starting a new task session through `/task-sessions`. Use `Cmd-Option-Shift-K` from any app to summon it.
- **Scan Desk** calls `/onboarding/scan`, shows proposed task groups from current windows, browser tabs, and task sessions, and lets you approve a proposal through `/onboarding/approvals`.

When `codex_app_server` task sessions are enabled, `dev:dogfood` starts a shared websocket `codex app-server` and points the orchestrator at it. That lets a visible Ghostty/Codex TUI and eventloopOS use the same native thread:

```sh
codex --remote <printed-ws-url> resume <thread-id>
```

Set `EVENTLOOPOS_DOGFOOD_SHARED_CODEX_APP_SERVER=0` to fall back to the orchestrator's private stdio app-server.

Use a named dogfood profile when testing an experimental checkout beside a stable checkout:

```sh
EVENTLOOPOS_DOGFOOD_PROFILE=experiment pnpm run dev:dogfood
```

Non-default profiles use separate default orchestrator/Postgres ports, a separate Docker container name, and `var/codex-task-map.<profile>.json` for Codex thread bindings. If you want a background daemon only, without another menu bar app or global hotkeys, run:

```sh
EVENTLOOPOS_DOGFOOD_PROFILE=experiment EVENTLOOPOS_DOGFOOD_QUEUE_APP=0 pnpm run dev:dogfood
```

You can also set `EVENTLOOPOS_ORCHESTRATOR_URL`, `EVENTLOOPOS_POSTGRES_PORT`, `EVENTLOOPOS_POSTGRES_CONTAINER`, and `ORCHESTRATOR_CODEX_TASK_MAP_PATH` yourself when you need exact paths or ports.

After a dogfood stack is running, ask a local Codex or Claude Code agent to onboard the system with:

```sh
pnpm run onboarding:agent
```

It prints an agent-readable setup brief with readiness commands, current window/task-session grouping proposals, integration preview commands, and suggested next actions.

When a proposed group looks right, approve it without hand-copying every window id:

```sh
pnpm run onboarding:apply -- --proposal onboard_abc123 --queue-paper
```

The Mac app's **Scan Desk** button is the UI path for the same scan and proposal approval flow. Use **Approve + Queue** when the accepted workbench should appear in the intake stack immediately.

For browser tabs, install the Chrome native host and load the unpacked extension first. Then open the extension Options page, set the orchestrator URL, add allowed origins, and optionally fill **Task hint** / **Project hint**. Click **Capture current tab** to bind the active tab to that task, including page scroll/selected text when available. Click **Capture tabs** to register all allowed tabs in bulk. Blank hints let onboarding group tabs or create a reading queue proposal. A task hint attaches captured tabs directly to that task. Browser restore prefers the captured Chrome tab id when it is still alive and falls back to URL match otherwise.

Use in-memory state only for a throwaway run:

```sh
pnpm run dev:dogfood:memory
```

Use queue/router-only mode only when hacking without workspace restore:

```sh
EVENTLOOPOS_DOGFOOD_REQUIRE_AEROSPACE=0 pnpm run dev:dogfood:memory
```

For a short launch smoke:

```sh
pnpm run dev:dogfood:smoke
```

## Add a paper to the intake stack

In another terminal:

```sh
pnpm run queue:add -- --title "Review launch paragraph" --summary "Check the paragraph before sending." --task "blog feedback" --url "https://docs.example.test/blog"
```

The Mac app should show one paper. Pull it, inspect it, then mark it done.

## Try local polling without private accounts

Use the local-events source before connecting real Slack/Gmail/GitHub:

```sh
mkdir -p var
cp config/local-events.example.json var/local-events.json
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.local-events.example.json pnpm run dev:dogfood
```

Edit `var/local-events.json`, then route once:

```sh
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.local-events.example.json pnpm run mcp:route-once local_events_source
```

`var/` is ignored by git, so local test event data stays private.

## Give Codex CLI to a friend

After cloning, a Codex CLI agent should be able to follow this file. Useful first commands:

```sh
pnpm install
pnpm run dev:doctor:preflight
pnpm run dev:dogfood
pnpm run queue:add -- --title "Test paper" --summary "Confirm local queue works."
```

If the friend wants to connect local integrations, have Codex copy an example config into an ignored private file and edit only that local file:

```sh
cp config/mcp-sources.example.json config/mcp-sources.json
```

For the first real dogfood setup, the most useful private config is usually the combined read-only source template:

```sh
cp config/mcp-sources.dogfood.example.json config/mcp-sources.json
```

Then set env vars for only the sources you want enabled: `EVENTLOOPOS_AGENT_SLACK_QUERY` for local `agent-slack`, `EVENTLOOPOS_GMAIL_*` plus `gws` for Gmail metadata polling, and `EVENTLOOPOS_TODO_MD_PATHS` for todo files. Run `pnpm run mcp:preview` before `EVENTLOOPOS_DOGFOOD_MCP_POLL=1 pnpm run dev:dogfood` so the queue does not fill with noisy old messages.

## Optional Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose "Load unpacked" and select `app/browser-extension`.
4. Install the native messaging host:

```sh
pnpm --filter @eventloopos/native-host exec ./bin/install-chrome-host --browser chrome
```

The unpacked extension has a stable development ID, so the installer can derive the matching native host allow-list from `app/browser-extension/manifest.json`. Click the extension icon on an allowed page to capture title, URL, scroll position, and selected text. Local/file pages are allowed by default; add other trusted origins in the extension options only when needed.

Then run:

```sh
pnpm run test:e2e:native-browser-real-orchestrator
```

## Private configs stay local

Do not commit these files:

- `config/mcp-sources.json`
- `config/codex-task-map.json`
- `var/`
- `bin/dev-jason-dogfood`
- `bin/*.local`

Use the checked-in `*.example.json` files as templates, then keep real account IDs, paths, and tokens in ignored local files.
