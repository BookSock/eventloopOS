# MVP Plan Corrections

This doc records the current product steering after critique review.

## Product Shape

MVP is not an aggressive interruption system.

MVP is an intake stack:

- Background agents and MCP sources keep moving work.
- Human queue stays quiet unless work is human-blocked.
- User intentionally enters event-loop mode.
- User sees one paper at a time.
- User handles current item, then presses done/next.
- User can send work back to agents.
- Agents later put work back into intake if human needed.
- Queue can reshuffle in background by priority.

Calendar-aware interruptions, Focus-mode integration, voice-out, and notification-fatigue models are not MVP. They may matter later if product becomes ambient all-day assistant. Current target is focused work sessions.

Mental model:

- User sits at one current paper.
- Background sources and agents keep working on other papers.
- When agent cannot proceed, paper returns to intake stack.
- Queue reshuffles quietly.
- User pulls next paper intentionally.
- Hotkey/manual mode lets user leave event-loop mode and use Mac normally.

Therefore, do not spend v1 time on passive surfacing, notification loudness, meeting-state interrupt gates, or focus-mode integration unless a tiny hook is needed for user control.

## MVP Priority

Keep building:

- Queue-first review loop.
- MCP polling and local source routing.
- Codex task sessions.
- Claude Code support as second runtime, behind same task-session interface.
- Browser/context restore with confidence tiers.
- Manual mode escape hatch.
- Activity history and dogfood metrics.
- Lightweight failure recovery.
- Local config for Jason's real MCP/Slack/GitHub-ish sources.
- After-the-fact session history tying queue item -> task -> task session -> messages -> restore attempts.
- Strong test loop.

Do not overbuild now:

- Calendar gating.
- Voice readback.
- Budget dashboard.
- Multi-device sync.
- Enterprise controls.
- Full per-app DOM automation.
- Broad task-runtime provider ecosystem beyond Codex and Claude Code.

## Agent Control

Preferred order:

1. Structured provider API.
2. Local MCP/native bridge.
3. Terminal/tmux/Ghostty visible draft fallback.

Terminal control is fallback, not primary runtime. It must be:

- Task/session matched.
- Audited.
- Idempotent.
- No auto-submit by default.
- Human-confirmed for risky modes.
- Explicitly granted per session before master agent can paste/submit.
- Logged with event IDs, task session ID, payload hash, and result.

Current product target only needs Codex and Claude Code. Keep TaskSessionController broad enough for these two without designing full provider ecosystem now.

## Failure Recovery

MVP needs 90/10 durability, not perfect distributed recovery.

Required now:

- Queue leases expire and can be reclaimed.
- Restore requests have visible failed state.
- MCP poll source timeouts/circuit breakers exist.
- Task followup failure produces visible queue/history entry.
- Dogfood logs make after-the-fact debugging possible.
- Duplicate/retried events return stored route before side effects.
- In Postgres mode, activity and metric history survive orchestrator restart.

Later:

- Kill-9 chaos suite.
- Full restart replay model.
- Agent crash/resume policy across all providers.

Easy recovery stance: every side effect needs idempotency key + visible failed state + manual retry path. Durable outbox is later unless duplicate side effects show up in dogfood.

## Critique Triage

Do now:

- Keep `server.ts` shrinking before adding much more width.
- Keep metrics/history concrete and local.
- Keep deep-link restore confidence visible by provider.
- Keep MCP sources read-only/draft-first by default.
- Keep keystroke/terminal path behind explicit grants.
- Keep tests tied to real feedback loops: fixture E2E, live boot, real Chromium extension, opt-in AeroSpace, opt-in Mac UI smoke.

Defer:

- Passive notification/interruption UX.
- Calendar/meeting awareness.
- Voice readback.
- Budget dashboard beyond model/config knobs.
- Multi-device sync.
- Enterprise privacy controls beyond local-first/read-only defaults and risk policy docs.
- Full per-app DOM/canvas automation before dogfood proves need.

## Architecture Risk

`app/orchestrator/src/server.ts` is too large. It should shrink before more feature width.

Low-risk split:

- `http/json.ts`
- `http/request_context.ts`
- `routes/queue.ts`
- `routes/events.ts`
- `routes/context_restore.ts`
- `routes/task_sessions.ts`
- `routes/mcp_sources.ts`
- `routing/task_injection.ts`
- `queue/execute_action.ts`

Current extraction:

- `app/orchestrator/src/routing/task_session_injection.ts` owns ambient/task-hinted injection policy.
- `app/orchestrator/src/task_sessions/task_followup_audit.ts` owns attempted/sent/blocked/failed task-message activity.
- `app/orchestrator/src/routes/observability.ts` owns metrics/activity route bodies.
- `app/orchestrator/src/routes/task_sessions.ts` owns task-session list/get/followup/binding route bodies and validation.
- `server.ts` still owns many HTTP routes, context restore route bodies, queue action execution, MCP poll routes, events, voice, manual review, and workspace routes.

Keep doing behavior-preserving extraction first. Add tests before changing policy.

## Next Best Work

1. Add real MCP/Slack source dogfood config around Jason's installed tools.
2. Continue behavior-preserving `server.ts` route extraction.
3. Add task-message history/outbox-lite: local activity row before/after followup, retry-visible failure, no silent side effects.
4. Add trend comparisons to `dogfood:review`.
5. Real Claude followup dogfood against harmless configured session.
6. Provider deep-link dogfood: Slack/GitHub/Notion/GDocs/Figma/browser restore success by confidence reason.
