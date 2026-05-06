import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildAgentRunFromFakeCodexStream,
  buildReviewPacketFromFakeCodexStream,
  parseFakeCodexJsonStreamFile,
  resumeFakeCodexRun,
  runFakeCodexFixture,
} from "./fake_codex_adapter.mjs";

const fixedClock = () => new Date("2026-05-06T19:02:00.000Z");
const waitingFixture = "tests/fixtures/events/fake-codex-waiting-approval.jsonl";
const rootFixture = (path) => resolve(process.cwd(), "../..", path);

test("fake codex waiting approval stream creates golden review packet", async () => {
  const { run, reviewPacket } = await runFakeCodexFixture(waitingFixture, { clock: fixedClock });
  const golden = JSON.parse(
    await readFile(rootFixture("tests/fixtures/events/fake-codex-waiting-approval.packet.golden.json"), "utf8"),
  );

  assert.equal(run.status, "waiting_approval");
  assert.equal(run.blocked_reason, golden.decision_needed);
  assert.deepEqual(reviewPacket, golden);
});

test("fake codex stream emits completed and failed run states", async () => {
  const completedEvents = await parseFakeCodexJsonStreamFile(
    "tests/fixtures/events/fake-codex-completed.jsonl",
  );
  const failedEvents = await parseFakeCodexJsonStreamFile(
    "tests/fixtures/events/fake-codex-failed.jsonl",
  );

  const completed = buildAgentRunFromFakeCodexStream(completedEvents, { clock: fixedClock });
  const failed = buildAgentRunFromFakeCodexStream(failedEvents, { clock: fixedClock });

  assert.equal(completed.status, "completed");
  assert.equal(completed.completed_at, "2026-05-06T19:01:00.000Z");
  assert.equal(failed.status, "failed");
  assert.equal(failed.blocked_reason, "fixture failure");
});

test("fake codex blocked stream creates review packet", async () => {
  const { run, reviewPacket } = await runFakeCodexFixture(
    "tests/fixtures/events/fake-codex-blocked.jsonl",
    { clock: fixedClock },
  );

  assert.equal(run.status, "blocked");
  assert.equal(reviewPacket.agent_run_id, "run_fake_blocked");
  assert.equal(reviewPacket.decision_needed, "Provide missing task-session match before sending followup.");
  assert.equal(reviewPacket.recommended_action.requires_approval, true);
});

test("resume action stub changes waiting run back to running", async () => {
  const events = await parseFakeCodexJsonStreamFile(waitingFixture);
  const run = buildAgentRunFromFakeCodexStream(events, { clock: fixedClock });
  const packet = buildReviewPacketFromFakeCodexStream(events, run, { clock: fixedClock });

  const resumed = resumeFakeCodexRun(run, packet.recommended_action, { clock: fixedClock });

  assert.equal(resumed.status, "running");
  assert.equal(resumed.blocked_reason, undefined);
  assert.deepEqual(resumed.resume_actions, []);
  assert.equal(resumed.evidence.at(-1).title, "Fake resume action accepted");
});
