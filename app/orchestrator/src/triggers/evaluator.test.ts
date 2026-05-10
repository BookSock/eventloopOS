import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { McpEvent } from "../integrations/mcp_poll/types.js";
import type { PaperTriggerRecord } from "../store.js";
import {
  bodyContainsCaseInsensitive,
  buildTriggerFiredEvent,
  findMatchingTriggers,
  globMatch,
  paperTriggerDedupeKey,
  triggerMatchesEvent,
} from "./evaluator.js";

const baseEvent: McpEvent = {
  id: "evt_slack_1",
  source: "slack",
  source_id: "slack:T01:C42",
  idempotency_key: "slack:T01:C42:1700000000.0001",
  occurred_at: "2026-05-10T12:00:00.000Z",
  received_at: "2026-05-10T12:00:01.000Z",
  actor: { id: "U99", type: "human" },
  type: "slack.message_received",
  title: "deploy ready for review",
  summary: "deploy ready: please ship the staging build",
  raw_ref: { id: "raw_1", uri: "slack://T01/C42/1", media_type: "application/json" },
  links: [],
  resources: [],
};

function makeTrigger(overrides: Partial<PaperTriggerRecord> = {}): PaperTriggerRecord {
  return {
    trigger_id: "trg_test",
    task_id: "task_test",
    name: "deploy watcher",
    match_event_type: "slack.message_received",
    match_source_id_pattern: undefined,
    match_body_substring: undefined,
    enabled: true,
    created_at: "2026-05-10T11:00:00.000Z",
    updated_at: "2026-05-10T11:00:00.000Z",
    ...overrides,
  };
}

describe("triggerMatchesEvent", () => {
  it("matches when only event type is set", () => {
    assert.equal(triggerMatchesEvent(makeTrigger(), baseEvent), true);
  });

  it("rejects when event type differs", () => {
    assert.equal(
      triggerMatchesEvent(makeTrigger({ match_event_type: "gmail.message_received" }), baseEvent),
      false,
    );
  });

  it("rejects when trigger is disabled", () => {
    assert.equal(triggerMatchesEvent(makeTrigger({ enabled: false }), baseEvent), false);
  });

  it("matches a glob source_id pattern", () => {
    assert.equal(
      triggerMatchesEvent(makeTrigger({ match_source_id_pattern: "slack:T01:*" }), baseEvent),
      true,
    );
  });

  it("rejects a non-matching glob source_id pattern", () => {
    assert.equal(
      triggerMatchesEvent(makeTrigger({ match_source_id_pattern: "slack:T99:*" }), baseEvent),
      false,
    );
  });

  it("matches body substring case-insensitively", () => {
    assert.equal(
      triggerMatchesEvent(makeTrigger({ match_body_substring: "DEPLOY" }), baseEvent),
      true,
    );
  });

  it("rejects when body substring is missing from title and summary", () => {
    assert.equal(
      triggerMatchesEvent(makeTrigger({ match_body_substring: "vacation" }), baseEvent),
      false,
    );
  });

  it("ANDs all set fields", () => {
    assert.equal(
      triggerMatchesEvent(
        makeTrigger({
          match_source_id_pattern: "slack:T01:*",
          match_body_substring: "deploy",
        }),
        baseEvent,
      ),
      true,
    );
    assert.equal(
      triggerMatchesEvent(
        makeTrigger({
          match_source_id_pattern: "slack:T01:*",
          match_body_substring: "vacation",
        }),
        baseEvent,
      ),
      false,
    );
  });
});

describe("findMatchingTriggers", () => {
  it("returns all matches", () => {
    const t1 = makeTrigger({ trigger_id: "t1" });
    const t2 = makeTrigger({ trigger_id: "t2", match_body_substring: "vacation" });
    const t3 = makeTrigger({ trigger_id: "t3", match_body_substring: "deploy" });
    const matches = findMatchingTriggers(baseEvent, [t1, t2, t3]);
    assert.deepEqual(matches.map((m) => m.trigger_id), ["t1", "t3"]);
  });

  it("returns empty when nothing matches", () => {
    const matches = findMatchingTriggers(baseEvent, [
      makeTrigger({ match_event_type: "gmail.message_received" }),
    ]);
    assert.deepEqual(matches, []);
  });
});

describe("globMatch", () => {
  it("matches * wildcard", () => {
    assert.equal(globMatch("slack:*", "slack:foo"), true);
    assert.equal(globMatch("*", "anything"), true);
  });
  it("requires exact match without wildcard", () => {
    assert.equal(globMatch("slack:foo", "slack:foo"), true);
    assert.equal(globMatch("slack:foo", "slack:bar"), false);
  });
  it("supports multiple wildcards", () => {
    assert.equal(globMatch("slack:*:*", "slack:T01:C42"), true);
  });
});

describe("bodyContainsCaseInsensitive", () => {
  it("checks both title and summary", () => {
    assert.equal(bodyContainsCaseInsensitive(baseEvent, "ready for review"), true);
    assert.equal(bodyContainsCaseInsensitive(baseEvent, "STAGING"), true);
  });
});

describe("paperTriggerDedupeKey", () => {
  it("uses idempotency_key when present", () => {
    assert.equal(paperTriggerDedupeKey(baseEvent), "slack:T01:C42:1700000000.0001");
  });
  it("falls back to source:id when idempotency_key empty", () => {
    const fallback: McpEvent = { ...baseEvent, idempotency_key: "" };
    assert.equal(paperTriggerDedupeKey(fallback), "slack:evt_slack_1");
  });
});

describe("buildTriggerFiredEvent", () => {
  it("produces a synthetic event with task_hint and stable idempotency key", () => {
    const trigger = makeTrigger({ trigger_id: "trg_x", task_id: "task_y", name: "X" });
    const synthetic = buildTriggerFiredEvent({
      trigger,
      sourceEvent: baseEvent,
      now: new Date("2026-05-10T12:00:05.000Z"),
    });
    assert.equal(synthetic.source, "paper_trigger");
    assert.equal(synthetic.type, "paper_trigger.fired");
    // task_hint has the "task_" prefix stripped so taskIdForHint resolves back to the trigger's task_id.
    assert.equal(synthetic.task_hint, "y");
    assert.match(synthetic.idempotency_key, /^paper_trigger:trg_x:/);
    assert.match(synthetic.title, /Trigger fired: X/);
  });

  it("is deterministic for the same (trigger, source event)", () => {
    const trigger = makeTrigger({ trigger_id: "trg_x", task_id: "task_y" });
    const a = buildTriggerFiredEvent({ trigger, sourceEvent: baseEvent, now: new Date("2026-05-10T12:00:05.000Z") });
    const b = buildTriggerFiredEvent({ trigger, sourceEvent: baseEvent, now: new Date("2026-05-10T12:00:30.000Z") });
    assert.equal(a.id, b.id);
    assert.equal(a.idempotency_key, b.idempotency_key);
  });
});
