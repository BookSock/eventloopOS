import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestTaskSessionForTask } from "./session_selection.js";

describe("task session selection", () => {
  it("keeps explicit human actions able to target waiting sessions", () => {
    const selected = bestTaskSessionForTask([
      session({
        id: "task_session_waiting",
        task_id: "task_checkout",
        status: "waiting_approval",
        updated_at: "2026-06-06T10:00:00.000Z",
      }),
    ], "task_checkout");

    assert.equal(sessionId(selected), "task_session_waiting");
  });

  it("keeps automatic source injection out of waiting sessions", () => {
    const selected = bestTaskSessionForTask([
      session({
        id: "task_session_waiting_new",
        task_id: "task_checkout",
        status: "waiting_approval",
        updated_at: "2026-06-06T12:00:00.000Z",
      }),
      session({
        id: "task_session_idle_old",
        task_id: "task_checkout",
        status: "idle",
        updated_at: "2026-06-06T10:00:00.000Z",
      }),
    ], "task_checkout", { mode: "automatic_injection" });

    assert.equal(sessionId(selected), "task_session_idle_old");
  });

  it("returns no automatic target when every matching session needs human attention", () => {
    const selected = bestTaskSessionForTask([
      session({
        id: "task_session_waiting",
        task_id: "task_checkout",
        status: "Needs User Input",
        updated_at: "2026-06-06T12:00:00.000Z",
      }),
      session({
        id: "task_session_blocked",
        task_id: "task_checkout",
        status: "blocked",
        updated_at: "2026-06-06T11:00:00.000Z",
      }),
    ], "task_checkout", { mode: "automatic_injection" });

    assert.equal(selected, undefined);
  });
});

function session(input: {
  id: string;
  task_id: string;
  status: string;
  updated_at: string;
}) {
  return {
    provider: "codex",
    supports: { followup: true },
    last_seen_at: input.updated_at,
    created_at: input.updated_at,
    ...input,
  };
}

function sessionId(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? String((value as Record<string, unknown>).id)
    : undefined;
}
