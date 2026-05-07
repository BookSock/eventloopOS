# Parallel Workstreams

Goal: many agents work independently, low merge conflict, clear proof per slice.

## Rule

Each agent owns folder. Shared contracts change through `app/shared` first. No module reaches around public API.

## Workstreams

### 1. Core Contracts Agent

Owns:

- `app/shared/`

Build:

- TypeScript schemas / JSON Schema for `Event`, `Task`, `ContextResource`, `AgentRun`, `TaskSession`, `TaskMessage`, `ReviewPacket`, `QueueItem`, `RouteDecision`, `OwnershipLock`, `HookDecision`, `EvidenceReceipt`, `Procedure`, `ProcedureRun`, `AutonomyGrant`, `Action`.
- Versioned fixtures.
- OpenAPI or typed API contract for orchestrator.

Tests:

- Schema validation.
- Fixture compatibility.
- Golden packet validation.

Merge first. Everyone depends on this.

### 2. Dev Infra Agent

Owns:

- Root config: `package.json`, workspace config, `Makefile`, CI, lint, format, env templates.

Build:

- Stable commands: `make test`, `make lint`, `make typecheck`, `make ci`.
- Docker/Postgres dev setup.
- Artifact folders for traces, screenshots, logs.

Tests:

- CI green on empty/stub modules.
- `make ci` runs full stub gate.

Merge early. Low churn after setup.

### 3. Test Harness Agent

Owns:

- `app/test-harness/`
- `tests/fixtures/`
- `tests/golden/`

Build:

- Fake Slack/GitHub/MCP servers.
- Fake agent CLI.
- Local fixture web pages.
- Scenario runner.
- Seed DB helper.

Tests:

- Scenario runner self-test.
- Fixture replay test.
- Artifact generation test.

Merge early. Every feature agent adds scenario coverage here.

### 4. Orchestrator Agent

Owns:

- `app/orchestrator/`

Build:

- Local Gateway daemon.
- HTTP first, typed WebSocket later.
- Protocol handshake/schema validation.
- Event ingestion.
- Task linking.
- Queue ranking.
- Review packet lifecycle.
- Postgres adapter.
- Retry/lease/dead-letter behavior.
- Idempotency keys for side effects.
- Config schema + last-known-good.
- `doctor` command stub.

Interfaces:

- Consumes shared contracts.
- Exposes HTTP/WebSocket API.
- No UI imports.

Tests:

- Ranker/router unit tests.
- API contract tests.
- DB migration tests.
- Fake event replay E2E.
- Protocol schema tests.
- Idempotency retry tests.

### 5. Browser Extension Agent

Owns:

- `app/browser-extension/`

Build:

- Chrome MV3 extension.
- Tab URL/title/window capture.
- Scroll anchor capture/restore.
- Native messaging bridge.
- Restore/focus tab action.

Interfaces:

- Sends `ContextResource` + browser events.
- Receives restore actions.
- No direct DB writes.

Tests:

- Playwright extension E2E in bundled Chromium.
- Fixture pages for scroll restore.
- Mocked native host.

### 6. macOS App Agent

Owns:

- `app/macos/`

Build:

- Menu bar app.
- Global hotkey.
- Queue UI.
- Review packet UI.
- Permission onboarding.
- Open/focus URL/file/app.

Interfaces:

- Calls orchestrator API.
- No direct DB writes.

Tests:

- Swift unit tests.
- XCUITest UI smoke.
- Fake orchestrator server.
- Permission-missing states.

### 7. Integrations Agent

Owns:

- `app/orchestrator/src/integrations/`
- `app/orchestrator/src/mcp_sources/`

Build:

- MCP/poll adapter for Slack/GitHub/local sources.
- MCP source registry.
- MCP runtime timeouts/backoff/circuit breaker.
- MCP subprocess cleanup.
- Slack Socket Mode later.
- GitHub webhooks later.
- Notion later.

Interfaces:

- Each adapter outputs normalized `Event`.
- No queue/ranking logic inside adapter.

Tests:

- MCP fixture replay.
- MCP stability tests.
- Circuit breaker tests.
- Orphan process cleanup test.
- Webhook fixture replay later.
- Signature validation.
- Rate-limit simulation.
- No live network in CI.

### 8. Agent Adapter Agent

Owns:

- `app/orchestrator/src/agents/`
- `app/orchestrator/src/task_sessions/`

Build:

- Codex adapter first.
- Claude Code adapter second, through same task-session API.
- Normalize run state, logs, approvals, outputs.
- Resume from user decision.
- Task session bind/resume/status.
- Steering modes: `followup` and `steer` first. `collect` and `interrupt` are later and require explicit runtime support plus policy approval.
- Terminal/tmux/Ghostty fallback behind audited adapter.

Interfaces:

- Emits `AgentRun` + `ReviewPacket`.
- Receives `Action`.

Tests:

- Mocked `codex exec --json` streams.
- Fake passing/failing/blocked runs.
- Resume tests.
- Task message mode tests.
- Approval-block tests.

### 9. Policy + Ownership Agent

Owns:

- `app/orchestrator/src/ownership/`
- `app/orchestrator/src/hooks/`
- `tests/fixtures/policy/`

Build:

- Ownership locks for Slack/GitHub/browser/task sessions.
- Hook evaluation engine.
- Hook timeout/priority/audit.
- External-send policy gate for draft/approval safety.
- Surface-level autonomy grants only where needed for task-message or terminal fallback safety.
- Evidence receipts for risky/proof-bearing actions.
- Procedure pause/resume helpers later, after dogfood shows repeated workflows worth formalizing.

Interfaces:

- Consumes shared contracts.
- Runs before route/task-message/action execution.
- No provider-specific UI logic.

Tests:

- Ownership conflict scenario.
- Hook block/approval/timeout tests.
- External send idempotency test.
- Receipt chain test.
- Procedure resume test later.

## Sequence

Phase 0:

- Core Contracts.
- Dev Infra.
- Test Harness skeleton.

Phase 1:

- Orchestrator stub API.
- Fake scenario runner.

Phase 2:

- macOS fake queue UI.
- Browser fake tab restore.
- Integration fixture replay.
- Agent adapter fake Codex stream.
- Ownership/hook policy gate.

Phase 3:

- Wire real MCP/Codex one by one behind same fixtures.
- Add Slack/GitHub push only if setup worth it.

Phase 4:

- Full E2E: incoming Slack event -> task linked -> existing agent session gets followup when safe -> human queue only if blocked/ambiguous/risky -> hotkey opens context -> user action -> agent resumes or queue advances.

## Conflict Rules

- Cross-folder edits need explicit contract issue first.
- `app/shared` changed only by Core Contracts Agent.
- Integrations never import UI code.
- macOS/browser never write DB.
- Orchestrator never depends on browser/mac internals directly; only events/actions.
- Policy/ownership never imports provider UI internals.
- Test Harness can call public APIs of every module, but should not reach into private internals.

## Done Means

No slice done by prose. Slice done when:

- Owned tests pass.
- Boundary contract tests pass.
- At least one relevant scenario passes.
- Artifacts exist for E2E if UI/browser touched.
- Handoff lists commands run + paths changed.
