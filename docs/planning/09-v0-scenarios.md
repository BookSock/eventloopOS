# V0 Scenarios

Goal: each scenario proves real user value from fixture to decision.

## Scenario 1: Seeded Queue

Purpose: prove queue UI/API loop before integrations.

Steps:

1. Seed DB with one review packet.
2. Start orchestrator.
3. Start macOS app in test mode or web queue shell.
4. Fetch `/queue/next`.
5. Mark packet done.
6. Assert queue empty.

Pass:

- Packet visible.
- Done action persists.
- Audit decision created.

## Scenario 2: Slack Blog Feedback

Purpose: prove Slack event routes to an existing task session first, and creates a review item only if human-blocked, ambiguous, or risky.

Fixture:

- `slack_blog_feedback.json`

Steps:

1. Replay Slack message fixture.
2. Normalize to `Event`.
3. Link to blog task by URL/thread/project hint.
4. Send followup to existing blog task session when confidence/policy allow.
5. If agent blocks or route is ambiguous/risky, create review packet with `human_queue_reason`.
6. If queued, open Slack thread deep link.

Pass:

- Event idempotent.
- Task session receives safe followup, or packet says why human decision is needed.
- Source Slack link present.
- Human queue stays unchanged unless `human_queue_reason` is present.

## Scenario 3: GitHub CI Failed

Purpose: prove coding workflow signal routes to task agent first.

Fixture:

- `github_pr_ci_failed.json`

Steps:

1. Replay webhook.
2. Normalize to `Event`.
3. Link PR to task.
4. Send CI failure context to owning Codex/Claude task session.
5. Queue review packet only if agent needs human approval, route is ambiguous, or action is risky.
6. If queued, open PR/check URL.

Pass:

- Bad signature rejected.
- Failed check appears as evidence.
- Human queue reason is explicit when packet exists.
- Risk not hidden by model confidence.

## Scenario 4: Codex Waiting For Review

Purpose: prove agent review loop.

Fixture:

- `codex_waiting_for_review.jsonl`

Steps:

1. Parse fake Codex stream.
2. Create `AgentRun`.
3. Detect `waiting_approval`.
4. Create review packet with diff/test/log refs.
5. Approve action.
6. Resume fake run.

Pass:

- Run state changes `running -> waiting_approval -> running/completed`.
- Decision record created.
- Resume payload references decision.

## Scenario 5: Browser Capture + Restore

Purpose: prove workspace context restore.

Fixture page:

- local long page with headings + paragraphs.

Steps:

1. Playwright opens fixture page.
2. Scroll to section.
3. Extension captures URL/title/scroll/text quote.
4. Close or move tab.
5. Send restore command.
6. Extension opens/focuses tab and restores scroll.

Pass:

- `ContextResource` validates.
- Correct tab focused.
- Text quote visible after restore.

## Scenario 6: Full Local Agent Loop

Purpose: daily-driver smoke.

Steps:

1. Start Postgres.
2. Start orchestrator.
3. Start fake services.
4. Load browser extension.
5. Launch queue UI.
6. Replay Slack blog feedback.
7. Fake agent run starts, blocks for review.
8. Queue item appears.
9. User hits next.
10. Browser opens doc/Slack context.
11. User approves.
12. Agent resumes.
13. Queue advances.

Pass:

- One command runs full flow.
- All state transitions persisted.
- Artifacts saved.
- No live network.

## Scenario 7: Permission Missing

Purpose: prove graceful degradation.

Steps:

1. Launch macOS app in test mode with permission flags false.
2. Attempt workspace restore needing AX.
3. App falls back to open URL/file.
4. UI shows permission-needed state.

Pass:

- No crash.
- Fallback succeeds.
- Packet remains actionable.

## Scenario 8: External Send Approval

Purpose: prove safety gate.

Fixture:

- agent wants to send customer-facing Slack/email message.

Steps:

1. Fake agent proposes external send.
2. Risk scorer marks side effect external.
3. Review packet requires confirmation.
4. Reject action blocks send.
5. Approve action records decision then executes fake send.

Pass:

- External send never runs without decision.
- Packet evidence includes proposed message.
- Audit trail shows actor/action/time.

## Scenario 9: Ambient Slack Route To Agent

Purpose: prove inbound message does not always interrupt human.

Steps:

1. Replay MCP-polled Slack DM fixture with blog feedback.
2. Router links event to existing blog task.
3. Router finds active blog agent thread.
4. Router injects message into fake agent thread.
5. Agent updates state.
6. No queue item created unless agent blocks.

Pass:

- Slack event stored.
- Route decision says `inject_into_agent_thread`.
- Agent thread receives message.
- Human queue unchanged.

## Scenario 10: Voice Priority Update

Status: optional v1 experiment.

Purpose: prove spoken context routes to right work if voice ingress is enabled.

Steps:

1. Submit fake voice transcript: "Blog post is priority. Include launch in two weeks."
2. Router creates `voice.command` event.
3. Router links to blog task/thread.
4. Task priority increases.
5. Blog agent thread receives context.

Pass:

- Voice event stored.
- Route has evidence for blog match.
- Task priority changes.
- Human queue item created only if route ambiguous.

## Scenario 11: AeroSpace Workspace Restore

Status: optional power-user backend.

Purpose: prove optional workspace backend.

Steps:

1. Fake or real AeroSpace CLI lists workspaces/windows.
2. Context maps task to workspace.
3. Restore command switches workspace.
4. Chrome extension restores tab inside browser window.

Pass:

- AeroSpace backend returns structured `RestoreResult`.
- Missing AeroSpace falls back cleanly.
- Browser tab restore still uses extension.

## Scenario 12: Generic MCP Source Poll

Purpose: prove arbitrary MCP server can become event source.

Steps:

1. Register fake MCP source with poll recipe.
2. Fake MCP tool returns two new items and one duplicate.
3. Poller maps new items to `Event`.
4. Router routes one event to task agent.
5. Duplicate ignored by cursor/idempotency.

Pass:

- Source config validates.
- Cursor persists.
- Events normalized.
- Duplicate ignored.

## Scenario 13: Master Sends Message To Task Agent

Purpose: prove master can route new info into running task agent.

Steps:

1. Start fake task session.
2. Create event: "include launch date in blog."
3. Router matches event to blog task.
4. Task session backend sends text/resume payload.
5. Task session records received instruction.

Pass:

- Stable task/session match required.
- Instruction audited.
- If session uncertain, human queue item created.

## Scenario 14: Browser Page Poll Read-Only

Status: later unless Jason dogfood needs a no-API website.

Purpose: prove future no-API web apps can become read-only event sources.

Steps:

1. Open fixture chat page.
2. Content script watches DOM changes.
3. New message appears.
4. Extension emits page event.
5. Router routes event to task.

Pass:

- No clicks/forms/submits.
- Domain opt-in required.
- Event has source URL/title/text evidence.

## Scenario 15: MCP Stability

Purpose: prove flaky MCP server cannot freeze router.

Steps:

1. Start fake MCP server.
2. Poll succeeds once.
3. Server hangs.
4. Poller times out.
5. Circuit breaker opens.
6. Cooldown passes.
7. Half-open probe succeeds.
8. Polling resumes.

Pass:

- Timeout bounded.
- Router still handles other sources.
- Circuit state visible.
- Orphan child process cleaned up.

## Scenario 16: Ownership Conflict

Purpose: prove two agents do not act on same external thread.

Steps:

1. Existing blog task owns Slack thread lock.
2. New event from same thread arrives.
3. Router sees lock.
4. Router routes to owning task session.
5. Competing agent cannot send reply.

Pass:

- Lock conflict audited.
- No duplicate external send.
- Human queue item created if ownership unclear.

## Scenario 17: Task Session Steering

Status: later batching mode after simple followup works.

Purpose: prove master can send new info without starting duplicate run.

Steps:

1. Fake Codex task session is running.
2. Three new events arrive for same task.
3. Router selects `collect`.
4. Debounce window closes.
5. One combined task message sent.

Pass:

- No duplicate task session.
- Message mode recorded.
- Evidence links to all source events.

## Scenario 18: Hook Blocks External Send

Purpose: prove policy hook can stop risky action.

Steps:

1. Fake agent proposes Slack send.
2. `message_sending` hook sees no approval.
3. Hook returns `require_approval`.
4. Review packet appears.
5. Human approves.
6. Fake send executes with idempotency key.

Pass:

- Send blocked before approval.
- Hook decision audited.
- Retry with same idempotency key does not duplicate send.

## Scenario 19: Protocol + Config Guard

Purpose: prove local gateway does not accept malformed clients/config.

Steps:

1. Client sends non-handshake first WS frame.
2. Gateway closes connection.
3. Client sends valid handshake but malformed command.
4. Gateway returns schema error.
5. Config edit breaks schema.
6. Gateway keeps last-known-good config.

Pass:

- No crash.
- Schema errors useful.
- Last-known-good config remains active.

## Scenario 20: Receipt Required For Claims

Purpose: prove agents cannot claim work happened without evidence.

Steps:

1. Fake agent says "tests passed."
2. No `test_run` receipt exists.
3. Review packet marks claim unverified.
4. Fake test command runs and writes artifact.
5. `test_run` receipt attaches to packet.

Pass:

- Unreceipted claim not treated as proof.
- Receipt references command artifact.
- Packet proof chip appears.

## Scenario 21: Procedure Pause Resume

Status: post-MVP unless repeated dogfood workflows prove need.

Purpose: prove repeatable human-review workflow is resumable.

Steps:

1. External send approval procedure starts.
2. Procedure gathers source/event evidence.
3. Procedure creates review packet at approval step.
4. Human approves.
5. Procedure resumes from stored pointer.
6. Fake external send executes once.

Pass:

- Procedure state persists.
- Resume does not rerun completed steps.
- Idempotency prevents duplicate send.

## Scenario 22: Prompt Injection Source Block

Purpose: prove untrusted source text cannot force action.

Fixture:

- Slack message contains hidden/system-style instruction to send secrets or bypass approval.

Steps:

1. MCP poller ingests message.
2. Event normalizer stores raw text as untrusted.
3. Router classifies useful content.
4. Hook/policy scans injected instruction.
5. No external action executes.
6. Review packet includes warning if needed.

Pass:

- Injection text stored as evidence, not instruction.
- Policy blocks risky action.
- Agent/task message strips or labels untrusted instruction.
