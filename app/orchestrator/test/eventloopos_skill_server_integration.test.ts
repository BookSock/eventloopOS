import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createInMemoryGatewayStore } from "../src/gateway_store.js";
import { createGatewayServer } from "../src/server.js";
import { createSeededStore } from "../src/store.js";
import {
  enqueuePaperFromArgs,
  SKILL_TOOL_NAME,
  SKILL_EVENT_SOURCE,
} from "../src/mcp_sources/eventloopos_skill_server.js";

// Phase 7a integration proof:
//   1. Boot the gateway HTTP server with an in-memory store.
//   2. Invoke `eventloopos.enqueue_paper` directly via the helper (proves the
//      synthesized event lands in the queue with the correct task_id).
//   3. Boot the MCP stdio server as a child process and verify the SDK can
//      discover the tool and invoke it end-to-end.
//   4. Re-invoke with the same idempotency key and assert the queue does not
//      double-grow.

describe("eventloopos.enqueue_paper integration", () => {
  let server: Server;
  let baseUrl: string;
  const NOW = new Date("2026-05-10T14:00:00.000Z");

  before(async () => {
    const store = createInMemoryGatewayStore(await createSeededStore("fixtures/empty-review-packets.json"));
    server = createGatewayServer({
      store,
      now: () => NOW,
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

  it("posts a paper into the queue scoped to the requested task", async () => {
    const before = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as { items: unknown[] };
    const beforeCount = before.items.length;

    const result = await enqueuePaperFromArgs(
      {
        task_hint: "skill_demo",
        body_markdown: "Agent is waiting on human approval.",
        urgency: "high",
        source_kind: "agent_blocked",
      },
      {
        env: { EVENTLOOPOS_ORCHESTRATOR_URL: baseUrl },
        fetchFn: fetch,
        now: () => NOW,
        randomId: () => "rid_a",
      },
    );

    assert.equal(result.ok, true);
    assert.ok(result.queue_item_id, "skill returns a queue_item_id");

    const after = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as {
      items: Array<{ id: string; task_id?: string; review_packet: { title: string; summary: string } }>;
    };
    assert.equal(after.items.length, beforeCount + 1, "queue grew by one");
    const created = after.items.find((item) => item.task_id === "task_skill_demo");
    assert.ok(created, "queue contains item scoped to task_skill_demo");
    assert.match(created!.review_packet.summary, /waiting on human approval/);
  });

  it("does not double-paper when called twice with the same idempotency key", async () => {
    const queueBefore = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as { items: unknown[] };
    const argsTemplate = {
      task_hint: "skill_idem",
      body_markdown: "First call.",
      idempotency_key: "agent-explicit-key-1",
    } as const;

    await enqueuePaperFromArgs(argsTemplate, {
      env: { EVENTLOOPOS_ORCHESTRATOR_URL: baseUrl },
      fetchFn: fetch,
      now: () => NOW,
      randomId: () => "rid_b1",
    });
    await enqueuePaperFromArgs(
      { ...argsTemplate, body_markdown: "Second call same key." },
      {
        env: { EVENTLOOPOS_ORCHESTRATOR_URL: baseUrl },
        fetchFn: fetch,
        now: () => NOW,
        randomId: () => "rid_b2",
      },
    );

    const queueAfter = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as {
      items: Array<{ task_id?: string }>;
    };
    const matches = queueAfter.items.filter((item) => item.task_id === "task_skill_idem");
    assert.equal(matches.length, 1, "idempotency suppressed the second insertion");
    assert.equal(
      queueAfter.items.length,
      queueBefore.items.length + 1,
      "queue only grew by one across the two calls",
    );
  });

  it("serves enqueue_paper over stdio through the MCP SDK", async () => {
    const queueBefore = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as { items: unknown[] };
    const serverPath = fileURLToPath(
      new URL("../src/mcp_sources/eventloopos_skill_server.js", import.meta.url),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        ...process.env,
        EVENTLOOPOS_ORCHESTRATOR_URL: baseUrl,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "eventloopos-skill-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const tool = tools.tools.find((entry) => entry.name === SKILL_TOOL_NAME);
      assert.ok(tool, "stdio server advertises eventloopos.enqueue_paper");

      const callResult = await client.callTool({
        name: SKILL_TOOL_NAME,
        arguments: {
          task_hint: "skill_stdio",
          body_markdown: "Stdio invocation body.",
          source_kind: "agent_done",
        },
      });
      const structured = callResult.structuredContent as {
        ok: boolean;
        queue_item_id?: string;
      };
      assert.equal(structured.ok, true);
      assert.ok(structured.queue_item_id, "stdio call returns queue_item_id");

      const queueAfter = await fetch(`${baseUrl}/queue`).then((r) => r.json()) as {
        items: Array<{ task_id?: string; review_packet: { title: string } }>;
      };
      assert.equal(queueAfter.items.length, queueBefore.items.length + 1);
      const stdioPaper = queueAfter.items.find((item) => item.task_id === "task_skill_stdio");
      assert.ok(stdioPaper, "queue contains the stdio-invoked paper");
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it("rejects calls that omit both task_id and task_hint at the helper layer", async () => {
    await assert.rejects(
      () =>
        enqueuePaperFromArgs(
          { body_markdown: "no scope" } as never,
          {
            env: { EVENTLOOPOS_ORCHESTRATOR_URL: baseUrl },
            fetchFn: fetch,
            now: () => NOW,
            randomId: () => "rid_c",
          },
        ),
      /requires task_id or task_hint/,
    );
  });

  it("uses SKILL_EVENT_SOURCE for traceability in the synthesized event", async () => {
    const result = await enqueuePaperFromArgs(
      {
        task_hint: "skill_source_check",
        body_markdown: "Trace me.",
      },
      {
        env: { EVENTLOOPOS_ORCHESTRATOR_URL: baseUrl },
        fetchFn: fetch,
        now: () => NOW,
        randomId: () => "rid_d",
      },
    );
    const lookup = await fetch(`${baseUrl}/events/${result.event_id}`).then((r) => r.json()) as {
      event: { source: string };
    };
    assert.equal(lookup.event.source, SKILL_EVENT_SOURCE);
  });
});
