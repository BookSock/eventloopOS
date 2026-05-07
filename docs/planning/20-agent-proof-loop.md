# Agent Proof Loop

Goal: every agent handoff should include machine-checkable proof, not a prose claim.

## Minimum Proof Bundle

Each meaningful implementation agent should leave:

- command list
- exit codes
- stdout/stderr artifact paths when output is long
- git SHA or working-tree diff summary
- relevant screenshots/traces for UI/browser work
- live backend notes when a test is skipped because capability is unavailable
- dogfood metric snapshot when changing routing, queue, restore, or task sessions

## Proof Commands

Keep `make ci` as baseline correctness.

Current implementation:

- `pnpm proof:agent`
- `pnpm proof:live`
- `make proof-agent`
- `make proof-live`
- default commands: lint, typecheck, test, test:e2e
- manifest: `artifacts/proof-manifest.json`
- live manifest: `artifacts/proof-live-manifest.json`
- per-command logs: `artifacts/proof-agent/<run-id>/`
- override for cheap CI/tool smoke: `EVENTLOOPOS_PROOF_COMMANDS='[...]'`

`proof:agent` is the broad fixture/default lane. `proof:live` is the stronger local lane: it starts a temp orchestrator, runs live E2E, runs dogfood threshold checks before shutdown, then verifies the composite Codex + Claude task-runtime surface.

The handoff lane should cover:

- lint
- typecheck
- unit tests
- fixture E2E
- orchestrator API smoke
- browser restore smoke when Chromium available
- Mac queue render/app smoke when macOS tools available
- Postgres restart/idempotency smoke when Docker or local Postgres available
- proof manifest write to `artifacts/proof-manifest.json`

The proof lane can skip unavailable live capabilities, but skips must be explicit and machine-readable.

## Failure Recovery Scenarios

Near-term chaos tests:

- orchestrator restart after event route but before duplicate retry
- orchestrator restart after failed restore request, then retry/claim
- duplicate workspace restore request with same idempotency key
- MCP subprocess timeout without cursor commit
- task runtime failure creates human queue fallback and no duplicate resend
- stale task-message `attempted` state is visible in history

Later chaos tests:

- kill orchestrator mid-workspace restore
- browser extension worker eviction during restore poll
- real Codex/Claude crash during disposable session
- rich-doc anchor failure for Notion/Google Docs/Figma-like pages

## Dogfood Gates

Dogfood review should eventually fail loudly when:

- ignored queue item rate stays above 10%
- restore success falls below 80% for common browser resources
- task followup failures exceed configured threshold
- pending restore request age exceeds configured threshold
- stale queue leases remain after reap window

This keeps agents grounded in product behavior, not only unit-test pass rate.
