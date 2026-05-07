# MVP Roadmap

## Phase 0: Repo + Prototype Base

Goal: make project runnable + inspectable.

Deliver:

- Shared contracts v0.
- Test harness skeleton.
- Command contract / `Makefile`.
- `app/orchestrator` service skeleton.
- `app/macos` menu bar app skeleton.
- `app/browser-extension` Chrome MV3 skeleton.
- Local Postgres dev setup.
- Shared event/review packet schema.
- Basic queue UI with seeded sample packets.

Exit:

- Press hotkey. See queue. Open sample review packet. Mark done/next.

## Phase 1: Manual Capture + Workspace Restore

Goal: prove context restore before automation.

Deliver:

- Browser extension native messaging bridge.
- Capture current tab/window into task context.
- Open/focus captured URL from queue.
- Store scroll position, restore on generic web pages.
- Manual "create review packet" command.

Exit:

- User captures three active work contexts and cycles through them with hotkey/done/next.

## Phase 2: MCP/Poll Event Ingestion

Goal: route live work signals into agent threads before human queue item.

Deliver:

- MCP/poll adapter for Slack/GitHub/local sources.
- Cursor-based polling state.
- Event table with idempotency keys.
- Basic router from Slack thread/GitHub PR to task.
- Review packets only when agent/router needs human judgment.

Exit:

- Real Slack/GitHub/MCP-polled events route into agent threads without manual entry.
- Human queue stays quiet unless blocked.

## Phase 3: Agent Review Loop

Goal: make agent work queue human only when human judgment needed.

Deliver:

- Codex adapter using App Server or `codex exec --json` fallback.
- Agent run table.
- Blocked state detection.
- Structured review packet generation.
- Approve/reject/edit/defer actions.
- Resume agent from human decision.

Exit:

- Agent works until review needed.
- Queue surfaces packet.
- User approves or edits.
- Agent resumes without copy/paste.

## Phase 4: Task Graph

Goal: link events + agent runs to durable task state.

Deliver:

- Task mapping between Markdown/Notion/GitHub issue, Slack thread, GitHub PR, agent run.
- Priority controls from local task metadata, UI, config, and optional voice transcript commands.
- Queue filters by project/task.
- Activity history and basic dogfood metrics.

Exit:

- User sees why each review packet is ranked and what task it unblocks.

## Phase 5: Reliability + Trust

Goal: make single-user daily driver.

Deliver:

- Retry/dead-letter queue.
- Stale run cleanup.
- Rate limit handling.
- Permission onboarding.
- Audit log.
- Local metrics snapshot.
- Local settings.
- Packaged Mac build.

Exit:

- App runs all day, survives restarts, preserves queue/task state.

## Phase 6: Beta Expansion

Goal: add enough breadth for 3-5 trusted users.

Deliver:

- Notion adapter.
- Harden Claude Code adapter beyond the current configured-session MVP.
- Better workspace restore.
- Optional ScreenCaptureKit context snapshot.
- Import/export diagnostics.
- Onboarding flow.

Exit:

- Another power user installs, connects Slack/GitHub/MCP/Chrome, uses event loop on real work.
