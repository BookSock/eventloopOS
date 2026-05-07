# MVP Brief

Date: May 6, 2026.

## Thesis

Agents cheap. Parallel work easy. Bottleneck moves from execution to human attention.

Product = intentional intake stack for computer work. It keeps background work moving, detects human-blocked moments, ranks them, restores exact context, gets fast decision.

Position:

> Superhuman for agent review, with Mac workspace restore.

Not AI assistant. Not generic automation builder. Not window manager. Not notification product. Wedge = quiet review queue for high-output users running many AI/coding/workflow agents.

## Target User

Start with agent-heavy founders + devs using:

- Slack for interrupts + feedback.
- GitHub for code review + CI.
- local Markdown/Notion/GitHub issues for task state.
- Chrome/Arc for docs, issues, dashboards, web apps.
- Codex and Claude Code for parallel coding/work. Cursor and other runtimes are later.
- macOS as daily work OS.

Pain already sharp: agents create more output than user can inspect. Work gets lost across terminals, browser tabs, Slack threads, PRs, docs.

## Core Loop

1. Event enters from MCP/poll, Slack, GitHub, browser, agent log, or manual capture. Voice transcript ingress is an optional experiment, not a core MVP lane.
2. Router links event to task, project, workspace context, agent thread.
3. Agents keep working until judgment/approval needed.
4. System creates review packet: evidence, risk, confidence, next decision.
5. Queue ranks all human-blocked work.
6. User presses one hotkey.
7. System opens/focuses context: Slack thread, PR, doc, terminal, agent thread, browser tab.
8. User approves, rejects, edits, defers, or marks done.
9. System resumes agents, advances to next queue item.

UX model:

- User chooses to enter event-loop mode for focused work.
- Queue is like incoming papers on a desk.
- Only one paper is active at a time.
- Background agents reshuffle intake by priority.
- System does not aggressively interrupt normal computer use in MVP.

Escape hatch:

- User can press a manual-mode hotkey anytime.
- Manual mode stops automatic workspace switching/restores.
- Queue and background agents keep running.
- Current windows stay where user left them unless user explicitly returns to event-loop mode.
- Returning to event-loop mode should snapshot the manual layout, then restore next queued task context. Current implementation captures the prior layout when entering manual mode; exit-time capture is the next fix.
- If restore confidence is low, system shows briefing/links without moving windows.

## MVP Scope

Build:

- Local macOS menu bar app with queue UI + global hotkey.
- Local orchestrator with durable event log, task graph, agent runs, review packets, queue items.
- Chrome MV3 extension with native messaging bridge for browser tab capture/restore + page anchors.
- MCP/poll-first ingestion for Slack/GitHub/local sources.
- Push webhooks/Socket Mode later where setup friction worth it.
- Codex adapter first, Claude adapter second.
- Workspace restore that opens/focuses URLs, apps, files, tabs, terminals.
- Manual-mode escape hatch so user can leave event loop and use computer normally.
- Local activity history and dogfood metrics so user can inspect what happened.

Defer:

- Full OS replacement.
- Full virtual desktop/workspace manager.
- Screen recording as primary state source.
- Gmail full ingestion.
- Jira.
- Linear.
- Safari.
- Calendar auto-scheduling.
- Calendar-aware interrupt gating.
- Always-listening voice UX.
- Voice readback.
- Budget dashboard.
- Multi-device sync.
- Enterprise admin/security surface.

## Success Criteria

MVP works if one user can run real workday loop where:

- 20+ meaningful events ingested automatically.
- 5+ review packets created from agent/workflow state.
- Hotkey opens correct context for 80% of review packets.
- User clears queue items with approve/reject/edit/defer/done.
- Agent runs resume after approval without manual copy/paste.
- Average hotkey-to-informed-decision time under 30 seconds for common cases.
