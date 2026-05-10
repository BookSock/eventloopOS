import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";

describe("master fan-out idle_min_seconds filter (fixture I/O)", () => {
  let server: Server;
  let baseUrl: string;
  let codexHome: string;
  const sentMessages: Array<{ task_session_id: string; text: string; idempotency_key: string }> = [];
  const NOW = new Date("2026-05-09T12:00:00.000Z");

  const sessions = [
    { id: "session_alpha", task_id: "task_alpha", provider: "codex", status: "idle", native_thread_id: "thread_alpha_recent" },
    { id: "session_beta", task_id: "task_beta", provider: "codex", status: "idle", native_thread_id: "thread_beta_idle10m" },
    { id: "session_gamma", task_id: "task_gamma", provider: "codex", status: "idle", native_thread_id: "thread_gamma_idle2h" },
  ];

  async function writeRollout(threadId: string, lastEventIso: string): Promise<void> {
    const dayPath = join(codexHome, "sessions", "2026", "05", "09");
    await mkdir(dayPath, { recursive: true });
    const rolloutPath = join(dayPath, `rollout-2026-05-09T08-00-00-${threadId}.jsonl`);
    const lines = [
      JSON.stringify({ timestamp: "2026-05-09T08:00:00.000Z", type: "session_meta", payload: {} }),
      JSON.stringify({ timestamp: "2026-05-09T08:00:30.000Z", type: "user_input", payload: { text: "hi" } }),
      JSON.stringify({ timestamp: lastEventIso, type: "event_msg", payload: { type: "agent_message" } }),
    ];
    await writeFile(rolloutPath, lines.join("\n") + "\n");
  }

  before(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-fanout-idle-"));
    // alpha: very recent (5s idle)
    await writeRollout("thread_alpha_recent", "2026-05-09T11:59:55.000Z");
    // beta: 10 minutes idle (600s)
    await writeRollout("thread_beta_idle10m", "2026-05-09T11:50:00.000Z");
    // gamma: 2 hours idle (7200s)
    await writeRollout("thread_gamma_idle2h", "2026-05-09T10:00:00.000Z");

    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      now: () => NOW,
      codexHome,
      taskSessions: {
        listSessions() { return sessions; },
        sendFollowupMessage(input) {
          sentMessages.push({ task_session_id: input.task_session_id, text: input.text, idempotency_key: input.idempotency_key });
          return {
            id: `msg_${sentMessages.length}`,
            task_session_id: input.task_session_id,
            mode: "followup",
            text: input.text,
            event_ids: input.event_ids,
            idempotency_key: input.idempotency_key,
            status: "sent",
          };
        },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(codexHome, { recursive: true, force: true });
  });

  it("dry-run filters out recent thread, keeps idle 10m and 2h", async () => {
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "ping idle threads",
        selector: { task_id_pattern: "^task_", idle_min_seconds: 600 },
        dry_run: true,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      matched_count: number;
      preview: Array<{ task_id: string; idle_seconds?: number }>;
    };
    assert.equal(body.matched_count, 2);
    const taskIds = body.preview.map((entry) => entry.task_id).sort();
    assert.deepEqual(taskIds, ["task_beta", "task_gamma"]);
    const beta = body.preview.find((entry) => entry.task_id === "task_beta");
    const gamma = body.preview.find((entry) => entry.task_id === "task_gamma");
    assert.equal(beta?.idle_seconds, 600);
    assert.equal(gamma?.idle_seconds, 7200);
  });

  it("delivers fan-out only to idle-passing sessions", async () => {
    sentMessages.length = 0;
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "stop and report",
        selector: { task_id_pattern: "^task_", idle_min_seconds: 600 },
        idempotency_key: "fanout_idle_v1",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      delivered_count: number;
      delivered: Array<{ task_id: string; task_session_id: string }>;
      skipped: Array<unknown>;
    };
    assert.equal(body.delivered_count, 2);
    assert.equal(body.skipped.length, 0);
    const deliveredTaskIds = body.delivered.map((entry) => entry.task_id).sort();
    assert.deepEqual(deliveredTaskIds, ["task_beta", "task_gamma"]);
    assert.equal(sentMessages.length, 2);
  });

  it("filters out everything when threshold exceeds all sessions", async () => {
    const response = await fetch(`${baseUrl}/master/fan-out`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "no one idle enough",
        selector: { task_id_pattern: "^task_", idle_min_seconds: 86400 },
        dry_run: true,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { matched_count: number };
    assert.equal(body.matched_count, 0);
  });
});
