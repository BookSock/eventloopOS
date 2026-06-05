import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import {
  AutoPaperCodexIdleWatcher,
  type AutoPaperTaskRecord,
} from "../src/agents/auto_paper_codex_idle.js";

// Phase 5 integration proof:
//   1. Boot gateway with a fixture codex home + an in-memory task registry stub.
//   2. Register a task whose primary anchor is a Codex thread whose rollout
//      file's last event is 2 hours old.
//   3. Run one tick of AutoPaperCodexIdleWatcher.
//   4. Assert a paper appears in the queue with the right task_id.

describe("auto-paper codex idle integration", () => {
  let server: Server;
  let baseUrl: string;
  let store: ReturnType<typeof createInMemoryGatewayStore>;
  let codexHome: string;
  let watcher: AutoPaperCodexIdleWatcher;
  const NOW = new Date("2026-05-10T14:00:00.000Z");
  const tasks: AutoPaperTaskRecord[] = [];
  const emitted: Array<{ taskId: string; emittedAt: string }> = [];

  before(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "p5-auto-paper-int-"));
    const dayPath = join(codexHome, "sessions", "2026", "05", "10");
    await mkdir(dayPath, { recursive: true });
    const threadId = "thread_int_idle2h";
    const rolloutPath = join(dayPath, `rollout-2026-05-10T11-50-00-${threadId}.jsonl`);
    const lines = [
      JSON.stringify({ timestamp: "2026-05-10T11:50:00.000Z", type: "session_meta", payload: {} }),
      JSON.stringify({ timestamp: "2026-05-10T11:55:00.000Z", type: "user_input", payload: { text: "kickoff" } }),
      JSON.stringify({ timestamp: "2026-05-10T12:00:00.000Z", type: "event_msg", payload: { type: "agent_message" } }),
    ];
    await writeFile(rolloutPath, lines.join("\n") + "\n");

    store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      now: () => NOW,
      codexHome,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    tasks.push({
      id: "task_p5_integration",
      primary_anchor_kind: "codex_thread",
      primary_anchor_id: threadId,
    });

    watcher = new AutoPaperCodexIdleWatcher({
      registry: {
        async listTasks() {
          return tasks;
        },
        async recordTaskPaperEmitted(taskId, emittedAt) {
          emitted.push({ taskId, emittedAt: emittedAt.toISOString() });
        },
      },
      ingestor: {
        ingestEventAsReviewPacket: (event, n) => store.ingestEventAsReviewPacket(event, n),
      },
      manualMode: {
        getManualModeState: () => store.getManualModeState(),
      },
      codexHome,
      now: () => NOW,
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(codexHome, { recursive: true, force: true });
  });

  it("emits a paper to the queue for an idle codex thread", async () => {
    const before = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as { items: Array<{ id: string; task_id?: string }> };
    const beforeCount = before.items.length;

    const result = await watcher.tick();
    assert.equal(result.paused, false);
    assert.equal(result.considered, 1);
    assert.equal(result.emitted.length, 1, "watcher reports one emit");
    assert.equal(result.emitted[0]!.task_id, "task_p5_integration");
    assert.ok(result.emitted[0]!.idle_seconds && result.emitted[0]!.idle_seconds >= 7000, "idle ~2h");

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]!.taskId, "task_p5_integration");

    const after = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as {
      items: Array<{ id: string; task_id?: string; review_packet: { title: string; summary: string } }>;
    };
    assert.equal(after.items.length, beforeCount + 1, "queue grew by exactly one");
    const newItem = after.items.find((item) => item.task_id === "task_p5_integration");
    assert.ok(newItem, "queue contains item with the auto-paper task_id");
    assert.match(newItem!.review_packet.title, /Codex session idle/);
  });

  it("does not double-emit on a second tick when the rollout is unchanged", async () => {
    const queueBefore = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as { items: unknown[] };
    const result = await watcher.tick();
    assert.equal(result.emitted.length, 0, "throttled within same idle window");
    const queueAfter = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as { items: unknown[] };
    assert.equal(queueAfter.items.length, queueBefore.items.length, "queue unchanged");
  });

  it("skips when manual mode is active", async () => {
    await store.setManualModeActive(true, "test_pause", NOW);
    const result = await watcher.tick();
    assert.equal(result.paused, true);
    assert.equal(result.reason, "manual_mode_active");
    await store.setManualModeActive(false, undefined, NOW);
  });
});
