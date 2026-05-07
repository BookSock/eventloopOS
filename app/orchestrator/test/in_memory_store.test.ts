import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { McpEvent } from "../src/integrations/mcp_poll/types.js";
import {
  createSeededStore,
  getStoredEventByIdempotencyKey,
  ingestEventAsReviewPacket,
} from "../src/store.js";

describe("in-memory store", () => {
  it("deduplicates events by source and idempotency key", async () => {
    const store = await createSeededStore();
    const now = new Date("2026-05-06T12:00:00.000Z");
    const slackEvent = makeEvent("evt_slack_same_key", "slack", "shared-key");
    const githubEvent = makeEvent("evt_github_same_key", "github", "shared-key");

    const slackResult = ingestEventAsReviewPacket(store, slackEvent, now);
    const slackDuplicate = ingestEventAsReviewPacket(
      store,
      { ...slackEvent, id: "evt_slack_retry_same_key", title: "Retry should not replace original" },
      now,
    );
    const githubResult = ingestEventAsReviewPacket(store, githubEvent, now);

    assert.equal(slackDuplicate.event.id, slackResult.event.id);
    assert.equal(githubResult.event.id, githubEvent.id);
    assert.equal(getStoredEventByIdempotencyKey(store, "slack", "shared-key")?.event.id, slackEvent.id);
    assert.equal(getStoredEventByIdempotencyKey(store, "github", "shared-key")?.event.id, githubEvent.id);
  });
});

function makeEvent(id: string, source: string, idempotencyKey: string): McpEvent {
  return {
    id,
    source,
    source_id: `${source}:fixture`,
    idempotency_key: idempotencyKey,
    occurred_at: "2026-05-06T11:59:00.000Z",
    received_at: "2026-05-06T12:00:00.000Z",
    actor: {
      id: `actor_${source}`,
      type: "system",
      name: `${source} fixture`,
    },
    type: `${source}.review_requested`,
    title: `${source} fixture event`,
    summary: "Fixture event needs human review.",
    raw_ref: {
      id: `raw_${id}`,
      uri: `artifact://raw/${source}/${id}.json`,
      media_type: "application/json",
    },
    links: [],
    resources: [],
  };
}
