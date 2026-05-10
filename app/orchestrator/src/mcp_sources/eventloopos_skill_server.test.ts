import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSkillEvent,
  enqueuePaperFromArgs,
  SKILL_EVENT_SOURCE,
  SKILL_EVENT_TYPE,
} from "./eventloopos_skill_server.js";

describe("eventloopos skill MCP server", () => {
  it("builds a synthetic skill event with the right shape and stripped task_id", () => {
    const event = buildSkillEvent({
      input: {
        task_id: "task_blog_q3",
        body_markdown: "Need decision on header style.",
        urgency: "high",
        source_kind: "agent_question",
      },
      occurredAt: "2026-05-10T14:00:00.000Z",
      randomId: () => "fixed-random",
    });

    assert.equal(event.source, SKILL_EVENT_SOURCE);
    assert.equal(event.type, SKILL_EVENT_TYPE);
    assert.equal(event.task_hint, "blog_q3");
    assert.equal(event.summary, "Need decision on header style.");
    assert.equal(event.actor.type, "agent");
    assert.equal(event.title, "Agent question for blog_q3");
    assert.match(event.idempotency_key, /^eventloopos_skill:[0-9a-f]{16}$/);
    assert.equal(event.resources.length, 1);
    const resource = event.resources[0]!;
    assert.equal(resource.kind, "skill_self_report");
    assert.deepEqual((resource.details as Record<string, unknown>).urgency, "high");
  });

  it("posts the synthesized event to /events with idempotency header and bearer auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({ ok: true, queue_item: { id: "qit_skill_1" } }),
        { status: 202, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await enqueuePaperFromArgs(
      {
        task_hint: "term_sheet_redlines",
        body_markdown: "Section 4 redline question",
        urgency: "low",
      },
      {
        env: {
          EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:4399/",
          EVENTLOOPOS_SKILL_TOKEN: "tok_secret",
        },
        fetchFn: fakeFetch,
        now: () => new Date("2026-05-10T14:00:00.000Z"),
        randomId: () => "rid",
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.queue_item_id, "qit_skill_1");
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, "http://127.0.0.1:4399/events");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["authorization"], "Bearer tok_secret");
    assert.equal(headers["idempotency-key"], result.idempotency_key);
    const body = JSON.parse(String(call.init.body)) as { event: { task_hint: string; type: string } };
    assert.equal(body.event.task_hint, "term_sheet_redlines");
    assert.equal(body.event.type, SKILL_EVENT_TYPE);
  });

  it("rejects calls that scope to neither task_id nor task_hint", async () => {
    await assert.rejects(
      () =>
        enqueuePaperFromArgs(
          { body_markdown: "no scope" } as never,
          {
            env: {},
            fetchFn: (async () => new Response("", { status: 200 })) as typeof fetch,
            now: () => new Date("2026-05-10T14:00:00.000Z"),
            randomId: () => "rid",
          },
        ),
      /requires task_id or task_hint/,
    );
  });

  it("propagates orchestrator failure responses as errors with status text", async () => {
    const fakeFetch = (async () =>
      new Response("schema error", { status: 400 })) as typeof fetch;

    await assert.rejects(
      () =>
        enqueuePaperFromArgs(
          {
            task_hint: "demo",
            body_markdown: "x",
          },
          {
            env: {},
            fetchFn: fakeFetch,
            now: () => new Date("2026-05-10T14:00:00.000Z"),
            randomId: () => "rid",
          },
        ),
      /orchestrator rejected enqueue_paper: 400 schema error/,
    );
  });

  it("returns the same idempotency key for identical caller-supplied keys", () => {
    const a = buildSkillEvent({
      input: {
        task_hint: "demo",
        body_markdown: "first",
        idempotency_key: "agent-supplied-key",
      },
      occurredAt: "2026-05-10T14:00:00.000Z",
      randomId: () => "r1",
    });
    const b = buildSkillEvent({
      input: {
        task_hint: "demo",
        body_markdown: "second different body",
        idempotency_key: "agent-supplied-key",
      },
      occurredAt: "2026-05-10T15:00:00.000Z",
      randomId: () => "r2",
    });
    assert.equal(a.idempotency_key, "agent-supplied-key");
    assert.equal(b.idempotency_key, "agent-supplied-key");
  });
});
