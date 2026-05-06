import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvidenceReceipt, claimHasRequiredReceipt, hashReceipt } from "./receipt-chain.js";

describe("EvidenceReceipt hash chain", () => {
  it("chains receipt hashes and artifact refs", () => {
    const sourceReceipt = buildEvidenceReceipt({
      id: "rcpt_source_poll",
      action_type: "source_poll",
      actor_id: "agent_fake",
      input: { source: "slack" },
      output: { event_count: 1 },
      created_at: "2026-05-06T12:00:00.000Z",
      artifact_refs: [
        {
          id: "raw_slack_poll",
          kind: "json",
          uri: "artifact://raw_slack_poll.json",
        },
      ],
    });

    const testReceipt = buildEvidenceReceipt({
      id: "rcpt_test_run",
      action_type: "test_run",
      actor_id: "agent_fake",
      input: { command: "pnpm test" },
      output: { exit_code: 0 },
      previous_receipt: sourceReceipt,
      created_at: "2026-05-06T12:01:00.000Z",
      artifact_refs: [
        {
          id: "raw_test_log",
          kind: "log",
          uri: "artifact://test.log",
        },
      ],
    });

    assert.equal(testReceipt.previous_receipt_hash, hashReceipt(sourceReceipt));
    assert.equal(testReceipt.artifact_refs[0].id, "raw_test_log");
    assert.match(testReceipt.input_hash, /^[a-f0-9]{64}$/);
    assert.match(testReceipt.output_hash ?? "", /^[a-f0-9]{64}$/);
  });

  it("does not treat unreceipted test claim as proof", () => {
    const claim = {
      claim: "tests passed",
      required_action_type: "test_run" as const,
      receipt_ids: [],
    };

    assert.equal(claimHasRequiredReceipt(claim, []), false);

    const testReceipt = buildEvidenceReceipt({
      id: "rcpt_test_run",
      action_type: "test_run",
      actor_id: "agent_fake",
      input: { command: "pnpm test" },
      output: { exit_code: 0 },
      created_at: "2026-05-06T12:01:00.000Z",
      artifact_refs: [
        {
          id: "raw_test_log",
          kind: "log",
          uri: "artifact://test.log",
        },
      ],
    });

    assert.equal(
      claimHasRequiredReceipt(
        {
          ...claim,
          receipt_ids: ["rcpt_test_run"],
        },
        [testReceipt],
      ),
      true,
    );
  });
});
