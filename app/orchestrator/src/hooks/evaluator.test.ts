import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { evaluateAutonomyGrant } from "./autonomy-grants.js";
import { evaluateHook } from "./evaluator.js";

describe("hook evaluator", () => {
  it("requires approval for external send without approval decision", () => {
    const decision = evaluateHook({
      hook: "message_sending",
      surface: "external_send",
      payload: {
        channel: "slack",
        text: "Customer reply",
      },
    });

    assert.equal(decision.decision, "require_approval");
    assert.match(decision.reason ?? "", /requires human approval/);
  });

  it("allows external send with approval decision", () => {
    const decision = evaluateHook({
      hook: "message_sending",
      surface: "external_send",
      approval_decision_id: "dec_approved_send",
      payload: {
        channel: "slack",
        text: "Customer reply",
      },
    });

    assert.equal(decision.decision, "allow");
  });

  it("blocks prompt injection from untrusted source before external send", async () => {
    const fixturePath = resolve(process.cwd(), "../../tests/fixtures/policy/prompt_injection_slack_message.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { text: string };

    const decision = evaluateHook({
      hook: "message_sending",
      surface: "external_send",
      untrusted_source_text: fixture.text,
      approval_decision_id: "dec_attempted_bypass",
      evidence: [
        {
          id: "ev_prompt_injection",
          kind: "source_text",
          title: "Slack source text",
        },
      ],
    });

    assert.equal(decision.decision, "block");
    assert.match(decision.reason ?? "", /prompt injection/);
    assert.equal(decision.evidence[0].id, "ev_prompt_injection");
  });

  it("evaluates autonomy grants by surface", () => {
    assert.equal(evaluateAutonomyGrant({ surface: "source_read" }), "allow");
    assert.equal(evaluateAutonomyGrant({ surface: "external_send" }), "ask");
    assert.equal(evaluateAutonomyGrant({ surface: "prod_action" }), "deny");

    assert.equal(
      evaluateAutonomyGrant({
        surface: "external_send",
        scope_kind: "task",
        scope_id: "task_blog",
        now: new Date("2026-05-06T12:00:00.000Z"),
        grants: [
          {
            id: "grant_task_send",
            scope_kind: "task",
            scope_id: "task_blog",
            surface: "external_send",
            level: "allow",
            expires_at: "2026-05-06T13:00:00.000Z",
            created_at: "2026-05-06T11:00:00.000Z",
          },
        ],
      }),
      "allow",
    );
  });
});
