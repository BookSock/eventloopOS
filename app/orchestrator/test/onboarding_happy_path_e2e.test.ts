import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import type { WorkspaceController } from "../src/workspace/controller.js";

describe("onboarding happy path end-to-end", () => {
  let server: Server;
  let baseUrl: string;
  const fixedNow = new Date("2026-05-10T12:00:00.000Z");

  const workspace: WorkspaceController = {
    status: () => ({ available: true, backend: "aerospace", monitorCount: 1 }),
    capture: () => ({
      backend: "aerospace",
      activeWorkspace: "main",
      focusedWindowId: 101,
      windows: [
        { id: 101, app: "Ghostty", title: "codex [task:blog]", workspace: "main" },
        { id: 102, app: "Ghostty", title: "codex [task:reports]", workspace: "main" },
        { id: 103, app: "Ghostty", title: "codex [task:tests]", workspace: "main" },
      ],
    }),
    planRestore: () => ({ commands: [], skipped: [] }),
  };

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      workspace,
      now: () => fixedNow,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("scans, approves all, queues 3 papers, leases top, completes via recommended action", async () => {
    const scanResponse = await fetch(`${baseUrl}/onboarding/scan`);
    const scanBody = await scanResponse.json() as {
      ok: boolean;
      proposals: Array<{ id: string; task_id: string; title: string; confidence: string; windows: Array<{ id: number }> }>;
      summary: { proposal_count: number; window_count: number };
    };
    assert.equal(scanResponse.status, 200);
    assert.equal(scanBody.ok, true);
    assert.equal(scanBody.proposals.length, 3, "expected 3 proposals from 3 task-tagged windows");
    assert.equal(scanBody.summary.proposal_count, 3);
    const taskIds = scanBody.proposals.map((proposal) => proposal.task_id).sort();
    assert.deepEqual(taskIds, ["task_blog", "task_reports", "task_tests"]);
    assert.ok(scanBody.proposals.every((proposal) => proposal.confidence === "high"));

    const queueItemIds: string[] = [];
    for (const proposal of scanBody.proposals) {
      const approveResponse = await fetch(`${baseUrl}/onboarding/approvals`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `idem-onboarding-approve-${proposal.task_id}`,
        },
        body: JSON.stringify({
          proposal_id: proposal.id,
          queue_paper: true,
          actor_id: "user_jason",
        }),
      });
      const approveBody = await approveResponse.json() as {
        ok: boolean;
        task_id: string;
        proposal_id: string;
        queue_item?: { id: string };
        workspace_snapshot?: { task_id: string };
      };
      assert.equal(approveResponse.status, 200, `approve failed for ${proposal.task_id}`);
      assert.equal(approveBody.ok, true);
      assert.equal(approveBody.task_id, proposal.task_id);
      assert.equal(approveBody.workspace_snapshot?.task_id, proposal.task_id);
      assert.ok(approveBody.queue_item?.id, `queue_item missing for ${proposal.task_id}`);
      queueItemIds.push(approveBody.queue_item!.id);
    }
    assert.equal(queueItemIds.length, 3);

    const queueResponse = await fetch(`${baseUrl}/queue`);
    const queueBody = await queueResponse.json() as {
      count: number;
      items: Array<{ id: string; priority_score: number; state: string }>;
    };
    assert.equal(queueResponse.status, 200);
    assert.equal(queueBody.count, 3);
    assert.deepEqual(queueBody.items.map((item) => item.id).sort(), [...queueItemIds].sort());
    for (let index = 1; index < queueBody.items.length; index += 1) {
      assert.ok(
        queueBody.items[index - 1].priority_score >= queueBody.items[index].priority_score,
        "queue must be ordered by priority_score descending",
      );
    }

    const leaseResponse = await fetch(`${baseUrl}/queue/lease-next`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-onboarding-lease-1",
      },
      body: JSON.stringify({ lease_owner: "mac_queue_app", lease_ms: 30_000 }),
    });
    const leaseBody = await leaseResponse.json() as {
      item: { id: string; state: string; lease_owner: string };
    };
    assert.equal(leaseResponse.status, 200);
    assert.ok(leaseBody.item, "lease must return a queue item");
    assert.equal(leaseBody.item.state, "leased");
    assert.equal(leaseBody.item.lease_owner, "mac_queue_app");
    assert.ok(queueItemIds.includes(leaseBody.item.id));

    const recommendedResponse = await fetch(`${baseUrl}/queue/${leaseBody.item.id}/actions/recommended`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `idem-onboarding-action-${leaseBody.item.id}`,
      },
      body: JSON.stringify({ actor_id: "mac_queue_app" }),
    });
    const recommendedBody = await recommendedResponse.json() as {
      ok: boolean;
      action_result: { type: string; queue_item_id: string };
      item: { id: string; state: string };
    };
    assert.equal(recommendedResponse.status, 200);
    assert.equal(recommendedBody.ok, true);
    assert.equal(recommendedBody.action_result.type, "mark_done");
    assert.equal(recommendedBody.action_result.queue_item_id, leaseBody.item.id);
    assert.equal(recommendedBody.item.state, "done");
    assert.equal(recommendedBody.item.id, leaseBody.item.id);

    const remainingResponse = await fetch(`${baseUrl}/queue?state=ready`);
    const remainingBody = await remainingResponse.json() as {
      count: number;
      items: Array<{ id: string }>;
    };
    assert.equal(remainingResponse.status, 200);
    assert.equal(remainingBody.count, 2);
    assert.ok(!remainingBody.items.some((item) => item.id === leaseBody.item.id));

    const doneStateResponse = await fetch(`${baseUrl}/queue?state=done`);
    const doneStateBody = await doneStateResponse.json() as { items: Array<{ id: string }> };
    assert.equal(doneStateResponse.status, 200);
    assert.ok(doneStateBody.items.some((item) => item.id === leaseBody.item.id));
  });

  it("persists rejection so subsequent scans omit the rejected proposal", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const isolatedServer = createGatewayServer({
      store,
      workspace,
      now: () => fixedNow,
    });
    await new Promise<void>((resolve) => isolatedServer.listen(0, "127.0.0.1", resolve));
    const address = isolatedServer.address() as AddressInfo;
    const isolatedUrl = `http://127.0.0.1:${address.port}`;

    try {
      const scanResponse = await fetch(`${isolatedUrl}/onboarding/scan`);
      const scanBody = await scanResponse.json() as {
        proposals: Array<{ id: string; task_id: string }>;
      };
      assert.equal(scanBody.proposals.length, 3);

      const rejected = scanBody.proposals.find((proposal) => proposal.task_id === "task_reports");
      assert.ok(rejected, "fixture must have a task_reports proposal to reject");

      const rejectionResponse = await fetch(`${isolatedUrl}/onboarding/rejections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposal_key: "task_reports", reason: "not relevant" }),
      });
      assert.equal(rejectionResponse.status, 200);

      const rescanResponse = await fetch(`${isolatedUrl}/onboarding/scan`);
      const rescanBody = await rescanResponse.json() as {
        proposals: Array<{ task_id: string }>;
        summary: { proposal_count: number };
        rejected_proposal_keys: string[];
      };
      assert.equal(rescanBody.proposals.length, 2);
      assert.equal(rescanBody.summary.proposal_count, 2);
      assert.ok(!rescanBody.proposals.some((proposal) => proposal.task_id === "task_reports"));
      assert.ok(rescanBody.rejected_proposal_keys.includes("task_reports"));
    } finally {
      await new Promise<void>((resolve, reject) => {
        isolatedServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("batch approves all proposals in one call and queues 3 papers", async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    const isolatedServer = createGatewayServer({
      store,
      workspace,
      now: () => fixedNow,
    });
    await new Promise<void>((resolve) => isolatedServer.listen(0, "127.0.0.1", resolve));
    const address = isolatedServer.address() as AddressInfo;
    const isolatedUrl = `http://127.0.0.1:${address.port}`;

    try {
      const scanResponse = await fetch(`${isolatedUrl}/onboarding/scan`);
      const scanBody = await scanResponse.json() as { proposals: Array<{ id: string; task_id: string }> };
      assert.equal(scanBody.proposals.length, 3);

      const batchResponse = await fetch(`${isolatedUrl}/onboarding/approvals/batch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-batch-1",
        },
        body: JSON.stringify({
          approvals: scanBody.proposals.map((proposal) => ({
            proposal_id: proposal.id,
            queue_paper: true,
            actor_id: "user_jason",
          })),
        }),
      });
      const batchBody = await batchResponse.json() as {
        ok: boolean;
        results: Array<{ ok: boolean; proposal_id?: string; task_id?: string; queue_item?: { id: string } }>;
        idempotent_replay?: boolean;
      };
      assert.equal(batchResponse.status, 200);
      assert.equal(batchBody.ok, true);
      assert.equal(batchBody.results.length, 3);
      assert.ok(batchBody.results.every((result) => result.ok === true));
      assert.equal(batchBody.idempotent_replay, undefined);
      const queueIds = batchBody.results.map((result) => result.queue_item?.id);
      assert.ok(queueIds.every((id) => typeof id === "string" && id.length > 0));

      const queueResponse = await fetch(`${isolatedUrl}/queue?state=ready`);
      const queueBody = await queueResponse.json() as { count: number };
      assert.equal(queueBody.count, 3);

      const replayResponse = await fetch(`${isolatedUrl}/onboarding/approvals/batch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-batch-1",
        },
        body: JSON.stringify({
          approvals: scanBody.proposals.map((proposal) => ({
            proposal_id: proposal.id,
            queue_paper: true,
            actor_id: "user_jason",
          })),
        }),
      });
      const replayBody = await replayResponse.json() as {
        ok: boolean;
        results: Array<{ ok: boolean }>;
        idempotent_replay?: boolean;
      };
      assert.equal(replayResponse.status, 200);
      assert.equal(replayBody.ok, true);
      assert.equal(replayBody.idempotent_replay, true);
      assert.deepEqual(replayBody.results, batchBody.results);

      const queueAfterReplay = await fetch(`${isolatedUrl}/queue?state=ready`);
      const queueAfterReplayBody = await queueAfterReplay.json() as { count: number };
      assert.equal(queueAfterReplayBody.count, 3, "replay must not double-queue");
    } finally {
      await new Promise<void>((resolve, reject) => {
        isolatedServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
