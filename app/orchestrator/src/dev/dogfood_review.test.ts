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
    assert.match(output, /Tasks:\n- task_blog_feedback events=2 routed=1 queued=1 done=1 followups=1 failed=0/);
    assert.match(output, /Sessions:\n- task_session_blog events=2 routed=1 queued=1 done=1 followups=1 failed=0/);
    assert.match(output, /Queues:\n- qit_review_1 task=task_blog_feedback session=task_session_blog events=2 done_in=20.0m: Queue item done: Launch review/);
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
      task_rollups: Array<{ id: string; done: number; followups_sent: number }>;
      session_rollups: Array<{ id: string; routed: number }>;
      queue_rollups: Array<{ id: string; time_to_done_ms: number }>;
      derived: { queue_clearance_rate: number };
    };
    assert.equal(parsed.metrics.counters.events_ingested_total, 2);
    assert.deepEqual(parsed.events.map((event) => event.id), ["actv_done", "actv_routed"]);
    assert.deepEqual(parsed.task_rollups, [
      {
        id: "task_blog_feedback",
        events: 2,
        routed: 1,
        queued: 1,
        done: 1,
        followups_sent: 1,
        failed: 0,
        last_activity_at: "2026-05-06T12:20:00.000Z",
      },
    ]);
    assert.deepEqual(parsed.session_rollups.map((rollup) => ({ id: rollup.id, routed: rollup.routed })), [
      { id: "task_session_blog", routed: 1 },
    ]);
    assert.equal(parsed.queue_rollups[0]?.id, "qit_review_1");
    assert.equal(parsed.queue_rollups[0]?.time_to_done_ms, 1_200_000);
    assert.equal(parsed.derived.queue_clearance_rate, 0.5);
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
          restore_requests_done_total: 3,
          restore_requests_failed_total: 1,
        },
        activity_count: 3,
      },
      generated_at: "2026-05-06T12:30:00.000Z",
    });
  }

  if (url.endsWith("/activity?limit=10")) {
    return jsonResponse({
      count: 3,
      events: [
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
