import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueueItemWithPacket } from "../contracts.js";
import {
  classifyVoiceIntent,
  parseDurationToSeconds,
  pickDeferCandidates,
  pickRerankCandidate,
} from "./intent_classifier.js";

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

describe("classifyVoiceIntent defer", () => {
  it("classifies 'defer all blog tasks for one hour' as defer", () => {
    const intent = classifyVoiceIntent("defer all blog tasks for one hour");
    if (intent.kind !== "defer") return assert.fail(`expected defer, got ${intent.kind}`);
    assert.equal(intent.selector, "blog");
    assert.equal(intent.defer_seconds, 3600);
  });

  it("classifies 'defer all non-critical for an hour' as defer", () => {
    const intent = classifyVoiceIntent("defer all non-critical for an hour");
    if (intent.kind !== "defer") return assert.fail(`expected defer, got ${intent.kind}`);
    assert.match(intent.selector, /critical/);
    assert.equal(intent.defer_seconds, 3600);
  });

  it("snooze synonym with 30 minute spoken duration parses correctly", () => {
    const intent = classifyVoiceIntent("snooze every recruiting paper for 30 minutes");
    if (intent.kind !== "defer") return assert.fail(`expected defer, got ${intent.kind}`);
    assert.equal(intent.selector, "recruiting");
    assert.equal(intent.defer_seconds, 1800);
  });

  it("defaults to one hour when no duration is given", () => {
    const intent = classifyVoiceIntent("defer all marketing tasks");
    if (intent.kind !== "defer") return assert.fail(`expected defer, got ${intent.kind}`);
    assert.equal(intent.defer_seconds, 3600);
  });

  it("does not fire defer when 'defer' appears mid-sentence in a note", () => {
    const intent = classifyVoiceIntent("we should defer talking to legal until later");
    assert.equal(intent.kind, "note");
  });

  it("does not fire defer without a quantifier", () => {
    const intent = classifyVoiceIntent("defer the blog launch task");
    // No "all/every/each" so this is ambiguous and should not auto-fire defer.
    assert.equal(intent.kind, "note");
  });
});

describe("classifyVoiceIntent pause", () => {
  it("classifies 'pause everything for 30 minutes' as pause with no selector", () => {
    const intent = classifyVoiceIntent("pause everything for 30 minutes");
    if (intent.kind !== "pause") return assert.fail(`expected pause, got ${intent.kind}`);
    assert.equal(intent.selector, undefined);
    assert.equal(intent.defer_seconds, 1800);
  });

  it("classifies 'pause all tasks for 1h' as pause with no selector", () => {
    const intent = classifyVoiceIntent("pause all tasks for 1h");
    if (intent.kind !== "pause") return assert.fail(`expected pause, got ${intent.kind}`);
    assert.equal(intent.selector, undefined);
    assert.equal(intent.defer_seconds, 3600);
  });

  it("classifies bare 'pause for 15 minutes' as pause with no selector", () => {
    const intent = classifyVoiceIntent("pause for 15 minutes");
    if (intent.kind !== "pause") return assert.fail(`expected pause, got ${intent.kind}`);
    assert.equal(intent.selector, undefined);
    assert.equal(intent.defer_seconds, 900);
  });

  it("classifies 'wrap up for an hour' as pause", () => {
    const intent = classifyVoiceIntent("wrap up for an hour");
    if (intent.kind !== "pause") return assert.fail(`expected pause, got ${intent.kind}`);
    assert.equal(intent.defer_seconds, 3600);
  });

  it("does not fire pause when 'pause' appears mid-sentence", () => {
    const intent = classifyVoiceIntent("let's pause and think before sending");
    assert.equal(intent.kind, "note");
  });

  it("does not fire pause when only 'stop' is followed by other prose", () => {
    const intent = classifyVoiceIntent("stop the spam from the slack channel");
    assert.equal(intent.kind, "note");
  });
});

describe("parseDurationToSeconds", () => {
  it("parses common spoken durations", () => {
    assert.equal(parseDurationToSeconds("an hour"), 3600);
    assert.equal(parseDurationToSeconds("one hour"), 3600);
    assert.equal(parseDurationToSeconds("half an hour"), 1800);
    assert.equal(parseDurationToSeconds("30 minutes"), 1800);
    assert.equal(parseDurationToSeconds("1h"), 3600);
    assert.equal(parseDurationToSeconds("2h30m"), 9000);
    assert.equal(parseDurationToSeconds("tomorrow"), 86400);
  });

  it("returns undefined for unrecognized tokens", () => {
    assert.equal(parseDurationToSeconds("a while"), undefined);
    assert.equal(parseDurationToSeconds(""), undefined);
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

  it("pickDeferCandidates returns every item that exceeds the score threshold", () => {
    const items = [
      buildItem("qit_1", "task_blog_email_draft", "Blog email draft"),
      buildItem("qit_2", "task_blog_launch", "Blog launch"),
      buildItem("qit_3", "task_recruiting_review", "Recruiting review"),
    ];
    const matches = pickDeferCandidates("blog", items);
    assert.equal(matches.length, 2);
    const ids = matches.map((entry) => entry.item.id).sort();
    assert.deepEqual(ids, ["qit_1", "qit_2"]);
  });

  it("pickDeferCandidates returns nothing when selector is empty", () => {
    const items = [buildItem("qit_1", "task_blog", "Blog launch")];
    assert.deepEqual(pickDeferCandidates("", items), []);
  });
});
