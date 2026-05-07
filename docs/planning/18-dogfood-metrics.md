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
- `pnpm run dogfood:review` later
- Mac queue footer: queue count, done today, restore success today

Current implementation:

- `GET /activity?limit=...` exists as in-memory recent activity for current process.
- `GET /metrics` exists as in-memory counters for current process.
- Durable Postgres-backed history is not implemented yet.

## Privacy

Metrics should default to local only. Store counts and IDs. Avoid storing raw Slack/doc content in metrics rows. Raw payloads stay in event/artifact store with existing risk policy.

## Test Loop

Tests needed:

- Unit: metrics counter records expected events.
- API: `/metrics` returns deterministic snapshot.
- E2E: MCP local event poll increments ingested/routed/queue counters.
- E2E: browser restore done increments restore counters.
- E2E: task followup success/fail increments task counters.

## Success Thresholds

Dogfood week targets:

- 20 meaningful events/day ingested.
- 5 human-blocked packets/day created.
- 80% context restore success on common web resources.
- Under 30 seconds median lease-to-done for simple review.
- Under 10% ignored queue item rate after router tuning.
