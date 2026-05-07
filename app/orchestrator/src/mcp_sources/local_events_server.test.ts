import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it } from "node:test";
import { parseLocalEventsFile } from "./local_events_server.js";

describe("local events MCP server", () => {
  it("parses array and object local event files", () => {
    assert.deepEqual(parseLocalEventsFile([{ id: "event_1", title: "One" }]), {
      items: [{ id: "event_1", title: "One" }],
      nextCursor: undefined,
    });
    assert.deepEqual(parseLocalEventsFile({ items: [{ id: "event_2" }], nextCursor: "event_2" }), {
      items: [{ id: "event_2" }],
      nextCursor: "event_2",
    });
    assert.throws(() => parseLocalEventsFile({ items: ["bad"] }), /local events file must be an array/);
  });

  it("serves list_events over stdio through the MCP SDK", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eventloopos-local-events-"));
    const eventsPath = join(tempDir, "events.json");
    await writeFile(
      eventsPath,
      JSON.stringify({
        items: [
          {
            id: "office-priority-1",
            source: "local_events",
            type: "voice.priority_hint",
            title: "Blog priority changed",
            summary: "Blog launch detail matters now.",
            occurred_at: "2026-05-06T17:03:00.000Z",
          },
        ],
        nextCursor: "office-priority-1",
      }),
      "utf8",
    );

    const serverPath = fileURLToPath(new URL("./local_events_server.js", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        EVENTLOOPOS_LOCAL_EVENTS_PATH: eventsPath,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "eventloopos-local-events-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const result = await client.callTool({
        name: "list_events",
        arguments: {
          cursor: "0",
        },
      });

      assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_events"]);
      assert.deepEqual(result.structuredContent, {
        items: [
          {
            id: "office-priority-1",
            source: "local_events",
            type: "voice.priority_hint",
            title: "Blog priority changed",
            summary: "Blog launch detail matters now.",
            occurred_at: "2026-05-06T17:03:00.000Z",
          },
        ],
        nextCursor: "office-priority-1",
      });
    } finally {
      await client.close().catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
