# Dogfood Metrics

Goal: know whether eventloopOS helps Jason move faster.

Do not build analytics SaaS. Build local counters and history first.

## Core Questions

- Did work reach queue only when human needed?
- Did context restore save time?
- Did agent followup work without manual copy/paste?
- Did user clear more work with less hunting?
- What failed and why?

## Metrics V0

Track locally:

- `events_ingested_total`
- `events_routed_to_task_session_total`
- `queue_items_created_total`
- `queue_items_done_total`
- `queue_items_deferred_total`
- `queue_items_ignored_total`
- `task_followups_sent_total`
- `task_followups_attempted_total`
- `task_followups_blocked_total`
- `task_followups_failed_total`
- `restore_requests_created_total`
- `restore_requests_done_total`
- `restore_requests_failed_total`
- `mcp_poll_cycles_total`
- `mcp_poll_errors_total`

Derived:

- Queue clearance rate.
- Human queue noise rate: created items later ignored.
- Restore success rate.
- Task-session injection rate.
- Time from queue item creation to done.
- Time from lease to done.

## Activity History

Every important action should produce one local activity event:

- external event ingested
- route decision made
- queue item created
- queue item leased
- queue item done/deferred/ignored
- context restore requested
- context restore done/failed
- task followup sent/failed/blocked
- task followup attempted before runtime call
- task binding changed
- MCP poll source succeeded/failed

Fields:

```ts
type ActivityEvent = {
  id: string;
  type: string;
  occurred_at: string;
  actor: "system" | "human" | "agent";
  task_id?: string;
  queue_item_id?: string;
  event_id?: string;
  task_session_id?: string;
  source_id?: string;
  status?: "ok" | "failed" | "blocked";
  summary: string;
  details: Record<string, unknown>;
};
```

## Local Surfaces

MVP surfaces:

- `GET /activity?limit=...`
- `GET /metrics`
- `pnpm run dogfood:review`
- Mac queue footer: queue count, done today, restore success today

Current implementation:

- `GET /activity?limit=...` exists as recent local activity and supports filters for `task_id`, `task_session_id`, `status`, and `since` so agents can inspect one task/session history without dumping global history.
- `GET /metrics` exists as local counters.
- Postgres mode persists `activity_events` and `metric_counters` through `0003_observability.sql`.
- In-memory mode remains process-local for fast tests and empty local smoke runs.
- `pnpm run dogfood:review` reads `/metrics` and `/activity`, prints text by default, and supports `EVENTLOOPOS_DOGFOOD_REVIEW_FORMAT=json` for agents.
- `dogfood:review` now derives queue clearance rate, task-session route rate, restore success rate, task rollups, task-session rollups, and per-queue time-to-done from local activity.
- Task and task-session rollups count `task_followup_attempted`, `task_followup_sent`, and `task_followup_blocked` directly instead of treating every routed event as a followup.
- `dogfood:review` includes daily activity rollups for the selected window, so longer `EVENTLOOPOS_DOGFOOD_REVIEW_SINCE` ranges can compare days.
- Restore request activity records resource provider and confidence reason. Metrics include provider-specific created/done/failed/retried counters, and `dogfood:review` groups restore success/failure by provider.
- Queue done activity records task ID, and recommended resume-agent actions also record task-session ID, so after-the-fact session history can connect queue work back to agent runtime.
- Task followup calls now emit attempted plus sent/blocked/failed activity with task session ID, idempotency key, event IDs, payload length, and origin (`event_route`, `queue_action`, or `task_session_api`).

## Privacy

Metrics should default to local only. Store counts and IDs. Avoid storing raw Slack/doc content in metrics rows. Raw payloads stay in event/artifact store with existing risk policy.

## Test Loop

Tests needed:

- Unit: metrics counter records expected events.
- API: `/metrics` returns deterministic snapshot.
- Postgres: activity/counters survive re-creating the observability adapter against the same database.
- E2E: MCP local event poll increments ingested/routed/queue counters.
- E2E: browser restore done increments restore counters.
- E2E: task followup success/fail increments task counters.
- CLI: `dogfood:review` filters current-day activity and fails cleanly when orchestrator is unavailable.
- CLI: `dogfood:review` groups recent activity by task, task session, and queue item.
- CLI/API: restore provider metrics and activity rollups show which restore backends are succeeding or failing.
- API: `/activity` filters return matching in-memory and Postgres events by task session, status, and since timestamp.

## Success Thresholds

Dogfood week targets:

- 20 meaningful events/day ingested.
- 5 human-blocked packets/day created.
- 80% context restore success on common web resources.
- Under 30 seconds median lease-to-done for simple review.
- Under 10% ignored queue item rate after router tuning.
