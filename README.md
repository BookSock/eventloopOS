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

Live proof covers seeded queue, MCP source discovery, MCP poll-and-route, MCP poll -> review -> done, Slack/MCP task-hinted events injecting into an existing task session without creating a human queue item, voice transcript -> task-session followup routing, passive browser context `store_only`, task-attached browser context search, task-session discovery + idempotent followup, native-host forwarding, workspace status/capture/restore-plan contracts, workspace snapshot context through the queue API, workspace status/restore-disabled smoke in the live harness, and macOS manual-mode queue state with `Cmd-Option-Shift-M` global hotkey wiring. The macOS view model auto-renews queue leases, plans selected workspace restores, and skips workspace restore planning while manual mode is active.

Workspace restore execution is disabled by default. Set `ORCHESTRATOR_WORKSPACE_EXECUTE=enabled` and call `POST /workspace/restore` with `confirm_execute: true` plus an `idempotency-key` header to execute an AeroSpace restore plan.

Set `DATABASE_URL` to run the orchestrator with Postgres-backed queue storage.

Set `ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.json` to load read-only MCP poll sources from local config instead of seeded fake sources.
Use `config/mcp-sources.example.json` as the starting shape.

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
- `10-final-planning-index.md`
