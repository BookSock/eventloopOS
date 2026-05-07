# Parallel Execution Plan

Goal: move work items 2-9 forward without agents overwriting each other.

## Ground Rules

- Keep ownership narrow. If a worker needs a file outside its lane, it should report that instead of editing broadly.
- Every worker must leave exact tests run and files changed.
- Main thread integrates patches, resolves overlap, runs the proof lane, and publishes when stable.
- Ignored local files stay local: `config/mcp-sources.json`, `config/codex-task-map.json`, `bin/dev-jason-dogfood`, `var/`, build artifacts, and external research clones.

## Workstreams

### A. AeroSpace Workspace Restore

Owned paths:

- `app/orchestrator/src/workspace/**`
- `app/orchestrator/src/routes/workspace.ts`
- workspace scenarios/fixtures/goldens as needed

Deliverable:

- Stronger capture and restore-plan proof for task workspace snapshots.
- Non-destructive live AeroSpace proof where possible.
- Restore execution still disabled by default.

Proof:

- `pnpm --filter @eventloopos/orchestrator test`
- `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1 pnpm run live:aerospace` when AeroSpace is available.

### B. Browser Extension Context Path

Owned paths:

- `app/browser-extension/**`
- `app/native-host/**`
- browser sections of `docs/try-on-mac.md` and README

Deliverable:

- Friend-proof Chrome extension install path.
- Capture active tab title, URL, and selected text.
- Restore/open URL through native host/orchestrator path.

Proof:

- `pnpm --filter @eventloopos/browser-extension test`
- `pnpm run test:e2e:native-browser-real-orchestrator` when Chromium/Chrome setup is available.

### C. Master Command And Task Runtime

Owned paths:

- `app/orchestrator/src/master/**`
- `app/orchestrator/src/task_sessions/**`
- `app/orchestrator/src/routes/task_sessions.ts`

Deliverable:

- `pnpm run master:send -- "..."` works as a jank-but-real master command.
- Start-new-task and route-existing-task paths are tested.
- Task session identity is clear enough before followup.

Proof:

- `pnpm --filter @eventloopos/orchestrator test`
- `pnpm run task:runtime-smoke`

### D. Local Integration Templates

Owned paths:

- `app/orchestrator/src/mcp_sources/**`
- `app/orchestrator/src/integrations/mcp_poll/**`
- `config/**`
- `scripts/**`

Deliverable:

- Read-only script polling remains easy to extend with Codex CLI.
- Todo, Gmail, Slack, and generic script examples are documented and tested.
- Private source configuration remains ignored.

Proof:

- `pnpm --filter @eventloopos/orchestrator test`
- `pnpm run mcp:preview local_events_source`
- `pnpm run mcp:route-once local_events_source` with local fixture config.

### E. Proof Loop Hardening

Owned paths:

- `bin/proof-agent`
- proof smoke scripts when needed
- `package.json` proof scripts
- proof sections of README and `docs/planning/20-agent-proof-loop.md`

Deliverable:

- Proof commands write partial manifests and fail clearly.
- Fixture proof and live proof are documented for future agents.
- Setup misses are machine-readable.

Proof:

- `pnpm run test:proof-agent`
- `pnpm proof:agent`

### F. Mac App UX And Onboarding

Owned paths:

- `app/macos/**`
- `app/orchestrator/src/onboarding/**`
- `app/orchestrator/src/routes/onboarding.ts`

Deliverable:

- First-run scan can group current windows/task sessions into proposed tasks.
- Selected paper shows enough task/session identity to trust send-back.
- Manual mode and one-paper intake behavior remain intact.

Proof:

- `pnpm --filter @eventloopos/macos test`
- `pnpm run test:e2e:macos`
- relevant onboarding CLI/API tests.

## Integration Order

1. Merge non-overlapping backend patches first: workspace, integrations, master/task runtime, proof loop.
2. Merge browser extension next because it may need proof/docs updates.
3. Merge Mac UX last because it depends on task identity and workspace behavior.
4. Run target tests after each merge, then run `pnpm proof:agent`.
5. Run `pnpm proof:live` before public handoff when local Mac/AeroSpace/Chrome prerequisites are available.

## Done Criteria

- Public repo remains clean of private names and local paths.
- `pnpm run dev:dogfood` assumes AeroSpace and fails clearly when missing.
- One real dogfood path exists: queue paper -> restore context -> decide/done -> task/session lineage visible.
- Every shipped slice has an automated proof command future agents can run.
