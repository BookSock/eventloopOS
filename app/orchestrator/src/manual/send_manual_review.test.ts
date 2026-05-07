import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualReviewEvent,
  manualReviewOptionsFromEnvAndArgv,
  sendManualReview,
} from "./send_manual_review.js";

test("manual review CLI builds a queueable manual.review_requested event", () => {
  const event = buildManualReviewEvent({
    title: "Launch blog final paragraph",
    summary: "Check final paragraph before sending.",
    taskHint: "blog feedback",
    url: "https://docs.example.test/blog",
    receivedAt: "2026-05-06T20:00:00.000Z",
  });

  assert.equal(event.source, "manual");
  assert.equal(event.type, "manual.review_requested");
  assert.equal(event.title, "Launch blog final paragraph");
  assert.equal(event.task_hint, "blog feedback");
  assert.equal(event.links[0]?.url, "https://docs.example.test/blog");
  assert.equal(event.resources[0]?.kind, "manual_note");
  assert.equal(event.resources[0]?.restore_confidence, "medium");
});

test("manual review CLI parses args over env defaults", () => {
  const options = manualReviewOptionsFromEnvAndArgv(
    {
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://env.test",
      EVENTLOOPOS_MANUAL_TITLE: "env title",
    },
    [
      "--",
      "--base-url",
      "http://arg.test",
      "--title",
      "arg title",
      "--summary",
      "body",
      "--task",
      "blog feedback",
      "--url",
      "https://example.test",
    ],
  );

  assert.equal(options.baseUrl, "http://arg.test");
  assert.equal(options.title, "arg title");
  assert.equal(options.summary, "body");
  assert.equal(options.taskHint, "blog feedback");
  assert.equal(options.url, "https://example.test");
});

test("manual review CLI sends event to orchestrator", async () => {
  let requestBody: unknown;
  const writes: string[] = [];
  const exitCode = await sendManualReview({
    baseUrl: "http://127.0.0.1:4377",
    title: "Queue this",
    summary: "Needs human judgment.",
    now: () => new Date("2026-05-06T20:00:00.000Z"),
    stdout: { write: (chunk) => { writes.push(String(chunk)); return true; } },
    fetchFn: (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ ok: true, queue_item: { id: "qit_manual" } }, { status: 202 });
    }) as typeof fetch,
  });

  assert.equal(exitCode, 0);
  assert.equal((requestBody as { event: { type: string } }).event.type, "manual.review_requested");
  assert.deepEqual(writes, [`${JSON.stringify({ ok: true, queue_item: { id: "qit_manual" } })}\n`]);
});

test("manual review CLI requires title and summary", async () => {
  const errors: string[] = [];
  const exitCode = await sendManualReview({
    baseUrl: "http://127.0.0.1:4377",
    stdin: emptyTty(),
    stderr: { write: (chunk) => { errors.push(String(chunk)); return true; } },
  });

  assert.equal(exitCode, 1);
  assert.match(errors.join(""), /title must be provided/);
});

function emptyTty() {
  return {
    isTTY: true,
    setEncoding() {},
    async *[Symbol.asyncIterator]() {},
  };
}
