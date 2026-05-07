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

## MVP Priority

Keep building:

- Queue-first review loop.
- MCP polling and local source routing.
- Codex task sessions.
- Claude Code support after Codex path is stable.
- Browser/context restore with confidence tiers.
- Manual mode escape hatch.
- Activity history and dogfood metrics.
- Lightweight failure recovery.
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

## Failure Recovery

MVP needs 90/10 durability, not perfect distributed recovery.

Required now:

- Queue leases expire and can be reclaimed.
- Restore requests have visible failed state.
- MCP poll source timeouts/circuit breakers exist.
- Task followup failure produces visible queue/history entry.
- Dogfood logs make after-the-fact debugging possible.

Later:

- Kill-9 chaos suite.
- Full restart replay model.
- Agent crash/resume policy across all providers.

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

Do behavior-preserving extraction first. Add tests before changing policy.

## Next Best Work

1. Provider deeplink/resource normalizers.
2. `server.ts` route/policy extraction.
3. Claude Code task-session adapter.
4. Task/session grouping in dogfood review.
5. Browser/UI retry affordance for failed context restore requests.
