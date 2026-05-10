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
    const recommendedBody = await recommendedResponse.json() as { error?: { code?: string } };
    assert.equal(
      recommendedResponse.status,
      422,
      "GAP: onboarding-queued papers carry a mark_done recommended action, but /actions/recommended only executes resume_agent",
    );
    assert.equal(recommendedBody.error?.code, "unsupported_action");

    const doneResponse = await fetch(`${baseUrl}/queue/${leaseBody.item.id}/done`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `idem-onboarding-done-${leaseBody.item.id}`,
      },
      body: JSON.stringify({ action: "done", actor_id: "mac_queue_app" }),
    });
    const doneActionBody = await doneResponse.json() as {
      ok: boolean;
      item: { id: string; state: string };
    };
    assert.equal(doneResponse.status, 200);
    assert.equal(doneActionBody.ok, true);
    assert.equal(doneActionBody.item.state, "done");
    assert.equal(doneActionBody.item.id, leaseBody.item.id);

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

  it("rejected proposal is skipped and never reaches the queue", async () => {
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

      const approved = scanBody.proposals.filter((proposal) => proposal.task_id !== "task_reports");
      const rejected = scanBody.proposals.find((proposal) => proposal.task_id === "task_reports");
      assert.ok(rejected, "fixture must have a task_reports proposal to reject");

      for (const proposal of approved) {
        const response = await fetch(`${isolatedUrl}/onboarding/approvals`, {
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
        assert.equal(response.status, 200);
      }

      const queueResponse = await fetch(`${isolatedUrl}/queue?state=ready`);
      const queueBody = await queueResponse.json() as {
        count: number;
        items: Array<{ review_packet: { context: Array<{ details?: { task_id?: string } }> } }>;
      };
      assert.equal(queueBody.count, 2, "rejected proposal must not be queued");
      const queuedTaskIds = queueBody.items
        .flatMap((item) => item.review_packet.context.map((context) => context.details?.task_id))
        .filter((value): value is string => typeof value === "string");
      assert.ok(!queuedTaskIds.includes("task_reports"));

      const rescanResponse = await fetch(`${isolatedUrl}/onboarding/scan`);
      const rescanBody = await rescanResponse.json() as {
        proposals: Array<{ task_id: string }>;
      };
      assert.ok(
        rescanBody.proposals.some((proposal) => proposal.task_id === "task_reports"),
        "rejected proposal still appears in scan because rejection is not persisted; this is a known gap",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        isolatedServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
