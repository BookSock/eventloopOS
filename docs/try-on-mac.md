# Try eventloopOS on a Mac

This is the friend-onboarding path for a fresh clone. It avoids Jason-specific configs and starts with local/fake sources before connecting Slack, Gmail, or other private tools.

## Prerequisites

- macOS with Xcode Command Line Tools: `xcode-select --install`
- Node.js 22 or newer. With `nvm`: `nvm use`
- `pnpm` via Corepack: `corepack enable`
- Swift toolchain from Xcode Command Line Tools
- Docker for Postgres-backed local dogfood
- AeroSpace for workspace capture/restore:
  `brew install --cask nikitabobko/tap/aerospace`
- Optional: Google Chrome for browser context capture/restore

## Install

```sh
git clone <repo-url> eventloopOS
cd eventloopOS
fnm use
corepack enable
pnpm install
pnpm run dev:doctor
```

`dev:doctor` builds the orchestrator and reports readiness. For a real trial, AeroSpace should report healthy before starting the dogfood stack. Launch AeroSpace once after installing it so the CLI can talk to the app server.

## Run the queue app

Start the local dogfood stack:

```sh
pnpm run dev:dogfood
```

This starts dev Postgres through Docker, verifies AeroSpace, builds the orchestrator, and launches the Mac queue app. It does not require Slack, Gmail, GitHub, or Chrome. By default, workspace restore execution is disabled until a restore is explicitly confirmed. Press `Ctrl-C` in the terminal to stop the stack.

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
pnpm run dev:doctor
pnpm run dev:dogfood
pnpm run queue:add -- --title "Test paper" --summary "Confirm local queue works."
```

If the friend wants to connect local integrations, have Codex copy an example config into an ignored private file and edit only that local file:

```sh
cp config/mcp-sources.example.json config/mcp-sources.json
```

## Optional Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose "Load unpacked" and select `app/browser-extension`.
4. Copy the extension ID from Chrome.
5. Install the native messaging host:

```sh
pnpm --filter @eventloopos/native-host exec ./bin/install-chrome-host <chrome-extension-id> --browser chrome
```

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
