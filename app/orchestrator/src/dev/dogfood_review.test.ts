import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dogfoodReviewOptionsFromEnv, runDogfoodReview } from "./dogfood_review.js";

describe("dogfood review CLI", () => {
  it("builds options from environment", () => {
    assert.deepEqual(dogfoodReviewOptionsFromEnv({
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:4999",
      EVENTLOOPOS_DOGFOOD_REVIEW_LIMIT: "25",
      EVENTLOOPOS_DOGFOOD_REVIEW_FORMAT: "json",
      EVENTLOOPOS_DOGFOOD_REVIEW_SINCE: "2026-05-06T00:00:00.000Z",
    }), {
      baseUrl: "http://127.0.0.1:4999",
      limit: 25,
      format: "json",
      since: "2026-05-06T00:00:00.000Z",
    });
  });

  it("prints a text review from metrics and recent activity", async () => {
    let output = "";
    const exitCode = await runDogfoodReview({
      baseUrl: "http://orchestrator.test",
      limit: 10,
      format: "text",
      now: () => new Date("2026-05-06T12:30:00.000Z"),
      stdout: {
        write(chunk: string) {
          output += chunk;
          return true;
        },
      },
      fetchFn: async (url) => responseForUrl(String(url)),
    });

    assert.equal(exitCode, 0);
    assert.match(output, /EventloopOS Dogfood Review/);
    assert.match(output, /events_ingested_total: 2/);
    assert.match(output, /queue_clearance_rate: 0.50/);
    assert.match(output, /Tasks:\n- task_blog_feedback events=4 routed=1 queued=1 done=1 followups_attempted=1 followups_sent=1 followups_blocked=0 failed=0/);
    assert.match(output, /Sessions:\n- task_session_blog events=4 routed=1 queued=1 done=1 followups_attempted=1 followups_sent=1 followups_blocked=0 failed=0/);
    assert.match(output, /Queues:\n- qit_review_1 task=task_blog_feedback session=task_session_blog events=2 done_in=20.0m: Queue item done: Launch review/);
    assert.match(output, /Restore Providers:\n- browser requested=1 done=1 failed=1 retried=0 success=0.50 reasons=browser_quote_fallback/);
    assert.match(output, /Daily Activity:\n- 2026-05-06 events=7 routed=1 queued=1 done=1 followups_sent=1 failed=1/);
    assert.match(output, /Daily Trends:\n- none/);
    assert.match(output, /queue_item_done ok task=task_blog_feedback queue=qit_review_1: Queue item done: Launch review/);
    assert.doesNotMatch(output, /Old event before window/);
  });

  it("prints JSON for agent-readable inspection", async () => {
    let output = "";
    const exitCode = await runDogfoodReview({
      baseUrl: "http://orchestrator.test",
      limit: 10,
      format: "json",
      since: "2026-05-06T00:00:00.000Z",
      stdout: {
        write(chunk: string) {
          output += chunk;
          return true;
        },
      },
      fetchFn: async (url) => responseForUrl(String(url)),
    });

    assert.equal(exitCode, 0);
    const parsed = JSON.parse(output) as {
      metrics: { counters: Record<string, number>; activity_count: number };
      events: Array<{ id: string }>;
      task_rollups: Array<{
        id: string;
        done: number;
        followups_attempted: number;
        followups_sent: number;
        followups_blocked: number;
      }>;
      session_rollups: Array<{ id: string; routed: number }>;
      queue_rollups: Array<{ id: string; time_to_done_ms: number }>;
      restore_provider_rollups: Array<{ provider: string; success_rate: number }>;
      daily_rollups: Array<{ date: string; events: number; followups_sent: number; failed: number }>;
      derived: { queue_clearance_rate: number };
    };
    assert.equal(parsed.metrics.counters.events_ingested_total, 2);
    assert.deepEqual(parsed.events.map((event) => event.id), [
      "actv_restore_failed",
      "actv_restore_done",
      "actv_done",
      "actv_restore_requested",
      "actv_task_followup_sent",
      "actv_task_followup_attempted",
      "actv_routed",
    ]);
    assert.deepEqual(parsed.task_rollups, [
      {
        id: "task_blog_feedback",
        events: 4,
        routed: 1,
        queued: 1,
        done: 1,
        followups_attempted: 1,
        followups_sent: 1,
        followups_blocked: 0,
        failed: 0,
        last_activity_at: "2026-05-06T12:20:00.000Z",
      },
    ]);
    assert.deepEqual(parsed.session_rollups.map((rollup) => ({ id: rollup.id, routed: rollup.routed })), [
      { id: "task_session_blog", routed: 1 },
    ]);
    assert.equal(parsed.queue_rollups[0]?.id, "qit_review_1");
    assert.equal(parsed.queue_rollups[0]?.time_to_done_ms, 1_200_000);
    assert.deepEqual(parsed.restore_provider_rollups.map((rollup) => ({
      provider: rollup.provider,
      success_rate: rollup.success_rate,
    })), [
      { provider: "browser", success_rate: 0.5 },
    ]);
    assert.deepEqual(parsed.daily_rollups, [
      {
        date: "2026-05-06",
        events: 7,
        routed: 1,
        queued: 1,
        done: 1,
        followups_sent: 1,
        failed: 1,
      },
    ]);
    assert.equal(parsed.derived.queue_clearance_rate, 0.5);
  });

  it("prints daily trend deltas when the activity window spans multiple days", async () => {
    let output = "";
    const exitCode = await runDogfoodReview({
      baseUrl: "http://orchestrator.test",
      limit: 10,
      format: "json",
      since: "2026-05-05T00:00:00.000Z",
      stdout: {
        write(chunk: string) {
          output += chunk;
          return true;
        },
      },
      fetchFn: async (url) => responseForUrl(String(url)),
    });

    assert.equal(exitCode, 0);
    const parsed = JSON.parse(output) as {
      daily_rollups: Array<{ date: string; events: number }>;
      daily_trends: Array<{
        date: string;
        previous_date: string;
        events_delta: number;
        routed_delta: number;
        queued_delta: number;
        done_delta: number;
        followups_sent_delta: number;
        failed_delta: number;
      }>;
    };

    assert.deepEqual(parsed.daily_rollups.map((rollup) => ({ date: rollup.date, events: rollup.events })), [
      { date: "2026-05-06", events: 7 },
      { date: "2026-05-05", events: 1 },
    ]);
    assert.deepEqual(parsed.daily_trends, [
      {
        date: "2026-05-06",
        previous_date: "2026-05-05",
        events_delta: 6,
        routed_delta: 0,
        queued_delta: 1,
        done_delta: 1,
        followups_sent_delta: 1,
        failed_delta: 1,
      },
    ]);
  });

  it("returns non-zero when orchestrator is unavailable", async () => {
    let errorOutput = "";
    const exitCode = await runDogfoodReview({
      baseUrl: "http://orchestrator.test",
      limit: 10,
      format: "text",
      stderr: {
        write(chunk: string) {
          errorOutput += chunk;
          return true;
        },
      },
      fetchFn: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    assert.equal(exitCode, 1);
    assert.match(errorOutput, /connect ECONNREFUSED/);
  });
});

function responseForUrl(url: string): Response {
  if (url.endsWith("/metrics")) {
    return jsonResponse({
      metrics: {
        counters: {
          events_ingested_total: 2,
          events_routed_to_task_session_total: 1,
          queue_items_created_total: 2,
          queue_items_done_total: 1,
          task_followups_attempted_total: 1,
          task_followups_sent_total: 1,
          restore_requests_done_total: 3,
          restore_requests_failed_total: 1,
          restore_requests_done_provider_browser: 1,
          restore_requests_failed_provider_browser: 1,
        },
          activity_count: 8,
      },
      generated_at: "2026-05-06T12:30:00.000Z",
    });
  }

  if (url.endsWith("/activity?limit=10")) {
    return jsonResponse({
      count: 8,
      events: [
        {
          id: "actv_restore_failed",
          type: "context_restore_failed",
          occurred_at: "2026-05-06T12:25:00.000Z",
          actor: "system",
          status: "failed",
          summary: "Restore failed for Launch doc",
          details: {
            restore_request_id: "ctx_restore_2",
            resource_provider: "browser",
            confidence_reason: "browser_quote_fallback",
          },
        },
        {
          id: "actv_restore_done",
          type: "context_restore_done",
          occurred_at: "2026-05-06T12:22:00.000Z",
          actor: "system",
          status: "ok",
          summary: "Restore completed for Launch doc",
          details: {
            restore_request_id: "ctx_restore_1",
            resource_provider: "browser",
            confidence_reason: "browser_quote_fallback",
          },
        },
        {
          id: "actv_done",
          type: "queue_item_done",
          occurred_at: "2026-05-06T12:20:00.000Z",
          actor: "human",
          task_id: "task_blog_feedback",
          queue_item_id: "qit_review_1",
          task_session_id: "task_session_blog",
          status: "ok",
          summary: "Queue item done: Launch review",
          details: {},
        },
        {
          id: "actv_restore_requested",
          type: "context_restore_requested",
          occurred_at: "2026-05-06T12:10:00.000Z",
          actor: "system",
          status: "ok",
          summary: "Restore requested for Launch doc",
          details: {
            restore_request_id: "ctx_restore_1",
            resource_provider: "browser",
            confidence_reason: "browser_quote_fallback",
          },
        },
        {
          id: "actv_task_followup_sent",
          type: "task_followup_sent",
          occurred_at: "2026-05-06T12:05:00.000Z",
          actor: "system",
          task_id: "task_blog_feedback",
          event_id: "evt_review_1",
          task_session_id: "task_session_blog",
          status: "ok",
          summary: "Task followup sent: task_session_blog",
          details: {
            origin: "event_route",
          },
        },
        {
          id: "actv_task_followup_attempted",
          type: "task_followup_attempted",
          occurred_at: "2026-05-06T12:04:00.000Z",
          actor: "system",
          task_id: "task_blog_feedback",
          event_id: "evt_review_1",
          task_session_id: "task_session_blog",
          status: "ok",
          summary: "Task followup attempted: task_session_blog",
          details: {
            origin: "event_route",
          },
        },
        {
          id: "actv_routed",
          type: "event_routed",
          occurred_at: "2026-05-06T12:00:00.000Z",
          actor: "system",
          task_id: "task_blog_feedback",
          queue_item_id: "qit_review_1",
          event_id: "evt_review_1",
          task_session_id: "task_session_blog",
          status: "ok",
          summary: "Event routed: Launch review",
          details: {},
        },
        {
          id: "actv_old",
          type: "event_routed",
          occurred_at: "2026-05-05T23:59:59.000Z",
          actor: "system",
          event_id: "evt_old",
          status: "ok",
          summary: "Old event before window",
          details: {},
        },
      ],
    });
  }

  return jsonResponse({ error: "not found" }, 404);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
