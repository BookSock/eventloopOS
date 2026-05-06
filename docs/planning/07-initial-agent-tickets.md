# Initial Agent Tickets

Goal: first 10 core tickets parallelizable, test-grounded, low conflict.

One hardening companion ticket can start after Ticket 9. It is listed here because MCP polling becomes important early, but it should not block browser/macOS/adapter work.

## Ticket 1: Shared Contracts V0

Owner: Core Contracts Agent.

Paths:

- `app/shared/`
- `tests/fixtures/contracts/`

Build:

- Zod schemas for core contracts.
- JSON Schema export.
- Fixture validator CLI.
- Sample fixtures for each type.
- `TaskSession`, `TaskMessage`, `RouteDecision`, `OwnershipLock`, `HookDecision`, `EvidenceReceipt`, `ProcedureRun`, `AutonomyGrant` included.

Done:

- `make test:contracts` passes.
- Invalid fixture fails with useful error.
- README explains how other modules import contracts.

## Ticket 2: Dev Infra Skeleton

Owner: Dev Infra Agent.

Paths:

- root config.
- `.github/workflows/`
- `Makefile`.

Build:

- Workspace package config.
- `make test`, `make lint`, `make typecheck`, `make ci`.
- Artifact dirs: `artifacts/logs`, `artifacts/screenshots`, `artifacts/traces`.
- `.env.example`.

Done:

- `make ci` passes on stubs.
- Commands stable and documented.

## Ticket 3: Test Harness Skeleton

Owner: Test Harness Agent.

Paths:

- `app/test-harness/`
- `tests/fixtures/`
- `tests/golden/`

Build:

- Scenario runner CLI.
- Fake clock.
- Fixture loader.
- Artifact writer.
- One scenario: seed fake review packet -> assert queue API shape.

Done:

- `make test:e2e SCENARIO=seeded_queue` passes.
- Failure writes log artifact.

## Ticket 4: Orchestrator Stub API

Owner: Orchestrator Agent.

Paths:

- `app/orchestrator/`

Build:

- HTTP server.
- Gateway process shape.
- `/health`.
- `/queue`.
- `/queue/next`.
- `/review-packets/:id`.
- request id + idempotency middleware stub.
- config schema stub.
- In-memory store first, DB later.

Done:

- API contract test passes.
- Test harness can read seeded queue from orchestrator.
- Malformed request returns schema error.

## Ticket 5: Postgres + Queue Store

Owner: Orchestrator Agent.

Paths:

- `app/orchestrator/`
- `tests/fixtures/db/`

Build:

- Migrations for core tables.
- Postgres adapter.
- Queue lease + idempotency behavior.

Done:

- Migrations apply to empty DB.
- Duplicate event test passes.
- Stale lease cleanup test passes.

## Ticket 6: Browser Extension Capture

Owner: Browser Extension Agent.

Paths:

- `app/browser-extension/`
- `tests/fixtures/browser/`

Build:

- MV3 manifest.
- Capture active tab URL/title.
- Capture scroll position + text quote on fixture page.
- Mock native messaging bridge.

Done:

- `make test:e2e:browser` passes.
- Playwright trace saved on fail.
- Captured `ContextResource` validates against shared schema.

## Ticket 7: Browser Restore

Owner: Browser Extension Agent.

Paths:

- `app/browser-extension/`

Build:

- Restore existing tab by URL match.
- Open missing tab.
- Restore scroll position on fixture page.
- Emit restore result.

Done:

- Playwright confirms tab focused.
- Playwright confirms scroll restored.
- Failed restore returns structured error.

## Ticket 8: macOS Queue Shell

Owner: macOS App Agent.

Paths:

- `app/macos/`

Build:

- Menu bar app.
- Test-mode fake orchestrator config.
- Queue window with seeded packets.
- Done/next action.
- Accessibility identifiers for UI tests.

Done:

- XCUITest opens queue, selects packet, presses done/next.
- Screenshot attached on fail.
- No real permissions required for this ticket.

## Ticket 9: MCP/Poll Fixture Ingestion

Owner: Integrations Agent.

Paths:

- `app/orchestrator/src/integrations/mcp_poll/`
- `tests/fixtures/events/`

Build:

- Poll result fixture parser.
- Cursor state.
- Normalize Slack-like message and GitHub-like update to `Event`.
- No live MCP yet.
- Source config schema.

Done:

- Valid fixture accepted.
- Duplicate cursor event ignored.
- Normalized event matches golden.

## Companion: MCP Runtime Hardening

Owner: Integrations Agent.

Paths:

- `app/orchestrator/src/mcp_sources/runtime/`
- `tests/fixtures/mcp/`

Build:

- Fake MCP process runner.
- Per-source timeout.
- Backoff + circuit breaker state.
- Orphan child cleanup hook.
- MCP stderr log path.

Done:

- `make test:mcp-stability` passes.
- Hung fake MCP source does not block other source.
- Circuit breaker opens, half-opens, then recovers.
- Child process cleanup test passes.

## Ticket 10: Fake Codex Adapter

Owner: Agent Adapter Agent.

Paths:

- `app/orchestrator/src/agents/codex/`
- `tests/fixtures/events/`

Build:

- Parse fake `codex exec --json` stream.
- Emit `AgentRun` states: running, waiting_approval, completed, failed.
- Generate review packet from blocked stream.
- Resume action stub.
- Fake task session record.
- Followup message send stub.

Done:

- Fake stream creates review packet.
- Golden packet matches.
- Resume action changes run state.
- Task message audited.

## After First 10

Next tickets:

- Local Gateway typed WS.
- Ownership lock module.
- Hook policy module.
- Evidence receipt module.
- Procedure runner skeleton.
- Autonomy grant module.
- Codex app-server task session backend.
- Ambient router V0.
- Agent thread registry.
- MCP context adapter for Slack/GitHub/local tools.
- Real Slack MCP poller.
- Real GitHub MCP poller.
- Slack Socket Mode later behind same normalizer.
- GitHub webhook fixture + signature later.
- AeroSpace backend spike.
- Voice command capture spike.
- Full local scenario: Slack fixture -> agent blocked -> queue -> browser restore -> approve -> agent resume.
