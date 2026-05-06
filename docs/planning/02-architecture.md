# MVP Architecture

## System Shape

First product = local-first Mac app + small local service. App owns attention queue. Adapters handle ingestion/control.

```text
Slack/GitHub/MCP/Notion/Codex/Chrome
        |
        v
    adapters
        |
        v
 local orchestrator
        |
        +--> event log
        +--> ambient router
        +--> task graph
        +--> context graph
        +--> agent thread registry
        +--> agent runs
        +--> review packets
        +--> priority queue
        |
        v
 macOS menu bar app + hotkey + queue UI
        |
        v
 workspace restore + human decision + agent resume
```

## Components

### macOS App

Owns:

- Menu bar presence.
- Global hotkey.
- Queue UI.
- Review packet UI.
- Permission onboarding.
- App/window focus.
- Workspace restore handoff.

Build direction:

- Swift/AppKit or SwiftUI with AppKit interop.
- Non-sandboxed Developer ID distribution for early builds.
- Accessibility permission for reliable cross-app control.
- Screen Recording permission only when visual capture enabled.

### Local Orchestrator

Owns:

- Normalize events.
- Route events to tasks/contexts.
- Route new info into existing agent threads when human not needed.
- Start/resume agent runs.
- Generate review packets.
- Score risk/confidence.
- Rank queue.
- Maintain idempotency, retries, leases, audit log.

Build direction:

- TypeScript service or Swift service both viable.
- For fastest agent/integration work, use TypeScript first.
- Postgres as durable source of truth.
- Local dev can run Postgres in Docker.
- Avoid Temporal in v0 unless workflows become multi-day + failure-prone.

### Browser Extension

Owns:

- Capture active tab/window URL/title/favIcon.
- Associate tabs with tasks.
- Open/focus tabs for review packets.
- Capture generic scroll position + DOM anchors.
- Restore scroll/highlight where page permission allows.
- Bridge to local app via native messaging.

Build direction:

- Chrome MV3 extension first.
- Optional host permissions for `github.com`, `linear.app`, `slack.com`, `notion.so`, `docs.google.com`, and work domains.
- Use `activeTab` where possible to lower trust burden.
- Arc support after smoke tests.
- Safari later.

### Integration Adapters

Owns:

- Convert provider events into internal `Event` records.
- Fetch extra context lazily.
- Provide deep links for workspace restore.
- Respect scopes + rate limits.

First adapters:

- MCP/poll adapter for Slack/GitHub/local sources already connected.
- Slack Socket Mode later for messages, mentions, reactions, thread context.
- GitHub App webhooks later for PRs, reviews, checks, workflow runs, comments.
- Codex adapter for agent runs + review handoffs.

Second adapters:

- Notion internal integration.
- Claude Code hooks/Agent SDK.
- Gmail/Drive constrained ingestion.
- Linear/Jira only if user target needs them.
- MCP context/action adapters for Slack/GitHub/Notion/local tools where useful.
- Voice command adapter.

### Agent Layer

Owns:

- Run async work.
- Emit structured status.
- Stop when blocked.
- Produce review packet candidates.
- Resume from human decisions.

Internal abstraction:

- `AgentRun`: provider, thread/session ID, status, prompt, logs, tool calls, outputs, workspace refs, blocked reason.
- `ReviewPacket`: decision needed, evidence, confidence, risk, actions, context refs.
- Provider adapters should not leak into queue logic.

## Data Model

Core tables:

- `events`: raw provider event, normalized type, source, timestamps, idempotency key.
- `tasks`: durable work unit, title, owner, status, priority, linked resources.
- `contexts`: task-owned resource graph: URLs, tabs, windows, files, terminals, agent threads, Slack threads, PRs, docs.
- `agent_runs`: provider, thread ID, run state, logs, tool calls, approvals, outputs.
- `review_packets`: summary, decision, evidence, confidence, risk, actions, context refs.
- `queue_items`: priority score, packet ID, due time, blocked reason, lease, state.
- `decisions`: user action, notes, timestamp, resulting agent resume payload.

## Priority Formula

Start simple + inspectable:

```text
priority =
  business_importance
  + unblock_value
  + urgency
  + confidence_gap
  + context_ready_bonus
  - interruption_cost
```

Risk score dimensions:

- Side effect risk: read-only, local edit, external send, production action.
- Evidence strength: tests, CI, diff, tool success, source links.
- Sensitivity: customer data, money, legal, auth, credentials, production.
- Drift: stale context, failed tools, missing sources, unresolved conflict.
- User cost: estimated review time + required expertise.

## Workspace Restore V0

Restore useful context without promising perfect OS control:

- Open Slack thread deep link.
- Open GitHub PR/check/log URL.
- Open task/issue URL.
- Open Notion/doc URL.
- Open local project folder or file.
- Focus existing Chrome tab if URL matches.
- Create tab if missing.
- Restore scroll/anchor where browser extension has permission.
- Bring terminal/app front when identifiable.

Workspace restore should use pluggable backends:

- URL/file/app open backend.
- Chrome extension backend.
- macOS Accessibility/CGWindow backend.
- AeroSpace backend for power users.
- Computer-use fallback backend later.

After this works, add:

- Window layout presets.
- Monitor-aware placement.
- Task-specific tab groups.
- AeroSpace workspace mapping.
- ScreenCaptureKit visual fallback.
- Rich workspace graphs with overlapping resources.

## Security Rules

Default approval required for:

- External communication sends.
- Deletes.
- Writes outside current repo/project.
- Production or infrastructure changes.
- Billing/money/legal actions.
- Credential or secret access.
- Broad data export.

Every review packet should show:

- What changed.
- What tool/action wants approval.
- Why now.
- Evidence.
- Confidence/risk.
- Exact consequences of approve/reject/defer.
