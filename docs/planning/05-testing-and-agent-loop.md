# Testing + Agent Feedback Loop

Testing is product architecture. Build it before features get wide.

## Main Idea

Agents need reality loop:

```text
fixture input -> command -> machine pass/fail -> logs/traces/screenshots -> focused retry
```

Computer-use not core verifier. Too slow, flaky, hard to debug. Use deterministic tools first:

- Unit tests.
- Integration tests with fake services.
- Playwright for browser extension + web UI.
- XCTest/XCUITest for macOS app.
- Docker/Testcontainers Postgres.
- Scenario runner with golden review packets.

Computer-use only later for nightly black-box smoke: real desktop looked sane, permission onboarding, weird third-party app flows.

## Architecture Tests

Test system shape, not only happy path.

Required early:

- import-boundary tests: UI cannot import DB internals.
- contract tests: adapter output validates shared schema.
- no-live-network tests in CI.
- config schema test.
- last-known-good config test.
- protocol handshake/schema tests.
- idempotency-key retry tests for side effects.
- source ownership-lock collision tests.
- hook block/approval/timeout tests.
- prompt snapshot tests for router/task prompts.
- receipt chain tests.
- procedure pause/resume tests.
- autonomy grant tests by surface.
- prompt-injection source fixture tests.

Reason:

Agents will edit in parallel. Architecture tests catch boundary drift before product turns into blob.

## Test Layers

### Unit

Test pure logic:

- Ranker math.
- Event normalization.
- Task linking.
- Idempotency keys.
- Risk/confidence scoring.
- Review packet schema.
- URL/context resolver.
- Native messaging frame encode/decode.
- Webhook signature verification.

### Integration

Test real boundaries:

- Orchestrator + Postgres.
- Migrations.
- Queue leases/retries/dead-letter.
- Fake Slack event -> `Event`.
- Fake GitHub MCP/webhook event -> `Task`.
- Fake task/source issue -> linked task.
- Fake agent run -> blocked review packet.
- Browser extension native-message contract.
- macOS app local API contract.
- MCP reconnect/backoff/circuit breaker.
- orphan MCP subprocess cleanup.
- task-session steering modes.
- ownership lock conflicts.
- hook policy decisions.

No live network in CI.

### Browser E2E

Use Playwright + bundled Chromium + persistent context.

Tests:

- Load Chrome MV3 extension.
- Open local fixture page.
- Capture tab URL/title/scroll anchor.
- Send native message to mocked host.
- Receive restore action.
- Confirm correct tab focused.
- Confirm scroll/anchor restored.
- Save trace/screenshot on fail.

### macOS E2E

Use XCTest/XCUITest.

Tests:

- Launch app with `--test-mode`.
- Point app at fake orchestrator.
- Open queue.
- Select packet.
- Press done/next.
- Assert API state changed.
- Assert permission-missing UI works.
- Attach screenshot/log on fail.

Window-control tests should use tiny fixture apps first, not real Slack/Chrome.

### Full Local Scenario

Run:

1. Docker/Postgres up.
2. Orchestrator up.
3. Fake Slack/GitHub/MCP up.
4. Browser extension loaded.
5. macOS queue app launched in test mode.
6. Fixture event posted.
7. Queue item appears.
8. Hotkey/next opens context.
9. Approve/reject action sent.
10. Agent run resumes or queue advances.

This scenario is daily-driver proof.

Required evidence:

- source poll receipt.
- event normalization receipt.
- task message receipt.
- test/verification receipt if agent claims tested.
- workspace restore receipt.

## Fixture World

Keep deterministic fixtures:

```text
tests/fixtures/events/slack_blog_feedback.json
tests/fixtures/events/github_pr_ci_failed.json
tests/fixtures/events/linear_blocked_issue.json
tests/fixtures/events/codex_waiting_for_review.json
tests/fixtures/events/notion_doc_changed.json
tests/fixtures/events/mcp_server_flaky.json
tests/fixtures/events/ownership_conflict_slack.json
tests/fixtures/events/prompt_injection_slack_message.json
tests/fixtures/db/seed.sql
tests/fixtures/browser/profile/
tests/fixtures/workspaces/blog_review.json
tests/fixtures/task_sessions/steer_followup_collect.json
tests/fixtures/procedures/external_send_approval.json
tests/golden/review_packets/blog_feedback_packet.json
tests/golden/review_packets/ci_failed_packet.json
tests/golden/review_packets/external_send_approval_packet.json
tests/golden/router_prompts/blog_route_prompt.txt
tests/golden/router_prompts/voice_priority_prompt.txt
```

Fixture rules:

- Fixed clock.
- Fixed user IDs.
- Fixed URLs.
- Fixed task IDs.
- No live network.
- Every raw fixture has expected normalized event.
- Golden packet updates require explicit diff review.

## Golden Review Packets

Golden checks:

- Schema valid.
- Title stable.
- Source links present.
- Evidence present.
- Risk tags correct.
- Recommended action correct.
- Priority within expected range.
- No hallucinated source.

Use golden packets to stop silent behavior drift.

## Commands

Future `Makefile` should expose:

```bash
make test
make test:unit
make test:integration
make test:e2e
make test:e2e:browser
make test:e2e:macos
make test:contracts
make test:architecture
make test:mcp-stability
make fixtures:seed
make packets:golden
make lint
make typecheck
make ci
```

`make ci` required gate:

```text
lint + typecheck + unit + integration + golden packets + E2E smoke
```

## Agent Loop

Every coding agent follows:

1. Pick workstream ticket.
2. Run smallest relevant test first. See red/fail reason.
3. Implement.
4. Run unit tests.
5. Run integration tests for touched boundary.
6. Run E2E smoke if behavior user-visible.
7. Inspect logs/artifacts on fail.
8. Retry max 3 focused attempts before handoff.
9. Stop only with passing commands + proof.

Handoff format:

```text
Changed:
Tests run:
Passing:
Failing:
Artifacts:
Known risk:
Next command:
```

If failing:

- Paste exact failing command.
- Paste shortest useful error.
- Name boundary: code, fixture, test, env.
- Retry one hypothesis at a time.

## CI Gates

PR cannot merge unless:

- Migrations apply clean to empty DB.
- Seeded fake events produce expected queue.
- Golden packets match.
- No external API call in test mode.
- Duplicate event idempotency passes.
- Queue lease/dead-letter tests pass.
- E2E smoke records screenshot/video/log/trace artifact.
- Agent-produced claims that mention tests/sources/actions have receipts.
- Prompt-injection fixtures do not reach tool/action boundary.
- Flaky test rerun still fails before merge accepted.

## Workstream Done Criteria

Orchestrator:

- Duplicate event safe.
- Queue priority deterministic.
- Stale lease cleanup tested.
- `make test:integration ORCHESTRATOR=1` passes.

Integrations:

- Fake MCP poll/webhook verifies expected auth/signature path.
- Payload normalized.
- Rate-limit/retry branch tested.
- No live credentials needed for CI.

Agent adapters:

- Fake Codex/Claude run emits `running`, `blocked`, `completed`, `failed`.
- Resume action tested.
- Timeout/dead-letter tested.
- Review packet has source transcript/log refs.

Browser extension:

- Playwright opens fixture pages.
- Extension captures tab URL/title/anchor.
- Native message round-trip tested.
- Restore scroll/anchor tested.

macOS workspace:

- XCUITest covers queue flow.
- AX/window focus covered against fixture app.
- Fallback opens URL/file when AX fails.
- Permission-missing state tested.

Queue UI:

- Seeded packet visible.
- Hotkey opens next.
- Approve/defer/reject mutate DB correctly.
- Keyboard-only flow tested.

Scoring:

- Fixtures cover low/high risk.
- External send always requires review.
- Test-passed coding task lowers risk but never hides diff.
- Stale/missing context increases priority/risk.
