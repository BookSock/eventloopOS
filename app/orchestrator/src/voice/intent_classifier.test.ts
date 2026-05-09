import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueueItemWithPacket } from "../contracts.js";
import { classifyVoiceIntent, pickRerankCandidate } from "./intent_classifier.js";

describe("classifyVoiceIntent", () => {
  it("classifies a plain note as note", () => {
    const intent = classifyVoiceIntent("can you ask the agent to draft a paragraph");
    assert.equal(intent.kind, "note");
  });

  it("classifies raise priority commands", () => {
    const intent = classifyVoiceIntent("raise priority of blog launch task");
    assert.equal(intent.kind, "rerank");
    if (intent.kind !== "rerank") return;
    assert.equal(intent.direction, "up");
    assert.equal(intent.delta, 250);
    assert.match(intent.target, /blog launch/);
  });

  it("classifies bump higher commands", () => {
    const intent = classifyVoiceIntent("bump the recruiting paper higher priority");
    if (intent.kind !== "rerank") return assert.fail("expected rerank");
    assert.equal(intent.direction, "up");
    assert.match(intent.target, /recruiting/);
  });

  it("classifies lower commands", () => {
    const intent = classifyVoiceIntent("lower priority of slack noise");
    if (intent.kind !== "rerank") return assert.fail("expected rerank");
    assert.equal(intent.direction, "down");
    assert.equal(intent.delta, -250);
    assert.match(intent.target, /slack noise/);
  });

  it("classifies move-to-top commands with high score", () => {
    const intent = classifyVoiceIntent("move the launch email to the top");
    if (intent.kind !== "rerank") return assert.fail("expected rerank");
    assert.equal(intent.direction, "top");
    assert.equal(intent.score, 1_000);
    assert.match(intent.target, /launch email/);
  });
});

describe("classifyVoiceIntent fan-out", () => {
  it("classifies 'all email tasks should use new sign off' as fan_out", () => {
    const intent = classifyVoiceIntent("all email tasks should use the new sign off");
    if (intent.kind !== "fan_out") return assert.fail(`expected fan_out, got ${intent.kind}`);
    assert.equal(intent.selector, "email");
    assert.match(intent.message, /sign off/i);
  });

  it("classifies 'tell every blog launch task to pause for an hour'", () => {
    const intent = classifyVoiceIntent("tell every blog launch task to pause for an hour");
    if (intent.kind !== "fan_out") return assert.fail(`expected fan_out, got ${intent.kind}`);
    assert.equal(intent.selector, "blog launch");
    assert.match(intent.message, /pause for an hour/i);
  });

  it("falls through to note when fan-out pattern is missing message body", () => {
    const intent = classifyVoiceIntent("all the email tasks");
    assert.equal(intent.kind, "note");
  });
});

describe("pickRerankCandidate", () => {
  const buildItem = (id: string, taskId: string, title: string): QueueItemWithPacket => ({
    id,
    review_packet_id: `pkt_${id}`,
    task_id: taskId,
    state: "ready",
    priority_score: 500,
    priority_reasons: [],
    created_at: "2026-05-09T12:00:00.000Z",
    updated_at: "2026-05-09T12:00:00.000Z",
    review_packet: {
      id: `pkt_${id}`,
      task_id: taskId,
      title,
      summary: "",
      decision_needed: "",
      risk_level: "medium",
      confidence: "medium",
      risk_tags: [],
      context: [],
      evidence: [],
      recommended_action: { id: `act_${id}`, label: "Mark done", type: "mark_done", requires_confirmation: false, side_effect: "none", payload: {} },
      alternate_actions: [],
      created_at: "2026-05-09T12:00:00.000Z",
      updated_at: "2026-05-09T12:00:00.000Z",
    },
  });

  it("finds the matching item by token overlap", () => {
    const items = [
      buildItem("qit_1", "task_blog_launch", "Blog launch decision"),
      buildItem("qit_2", "task_recruiting_review", "Recruiting review"),
      buildItem("qit_3", "task_pricing_followup", "Pricing followup"),
    ];
    const match = pickRerankCandidate({ target: "blog launch" }, items);
    assert.ok(match);
    assert.equal(match!.item.id, "qit_1");
  });

  it("returns undefined when no item matches enough tokens", () => {
    const items = [buildItem("qit_1", "task_blog", "Blog launch")];
    const match = pickRerankCandidate({ target: "completely unrelated topic"  }, items);
    assert.equal(match, undefined);
  });
});
