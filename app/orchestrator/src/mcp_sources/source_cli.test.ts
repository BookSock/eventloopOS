import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpSourceCliOptionsFromEnvAndArgs, runMcpSourceCli } from "./source_cli.js";

describe("MCP source CLI", () => {
  it("builds list options by default", () => {
    const options = mcpSourceCliOptionsFromEnvAndArgs({
      EVENTLOOPOS_ORCHESTRATOR_URL: "http://127.0.0.1:9999",
      EVENTLOOPOS_MCP_SOURCE_IDS: "slack_dm_source, github_update_source ",
      EVENTLOOPOS_MCP_PREVIEW_INCLUDE_TEXT: "1",
    }, []);

    assert.equal(options.command, "list");
    assert.equal(options.baseUrl, "http://127.0.0.1:9999");
    assert.deepEqual(options.sourceIds, ["slack_dm_source", "github_update_source"]);
    assert.equal(options.includeText, true);
  });

  it("ignores pnpm separator args before source ids", () => {
    const options = mcpSourceCliOptionsFromEnvAndArgs({}, ["preview", "--", "slack_dm_source"]);

    assert.equal(options.command, "preview");
    assert.deepEqual(options.sourceIds, ["slack_dm_source"]);
  });

  it("lists configured sources", async () => {
    const writes: string[] = [];
    const exitCode = await runMcpSourceCli({
      command: "list",
      baseUrl: "http://127.0.0.1:4377",
      includeText: false,
      stdout: writeTo(writes),
      fetchFn: async (url) => {
        assert.equal(String(url), "http://127.0.0.1:4377/mcp-sources");
        return response({ sources: [{ id: "local_events_source" }], count: 1 }, 200);
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(writes[0] ?? "{}"), {
      sources: [{ id: "local_events_source" }],
      count: 1,
    });
  });

  it("previews listed sources without routing", async () => {
    const writes: string[] = [];
    const requested: string[] = [];
    const exitCode = await runMcpSourceCli({
      command: "preview",
      baseUrl: "http://127.0.0.1:4377",
      includeText: false,
      stdout: writeTo(writes),
      fetchFn: async (url, init) => {
        requested.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).endsWith("/mcp-sources")) {
          return response({ sources: [{ id: "local_events_source" }] }, 200);
        }
        assert.equal(String(init?.body), JSON.stringify({ items: [] }));
        return response({
          source_id: "local_events_source",
          events_seen: 1,
          preview: [
            {
              id: "evt_1",
              source_id: "todo:/Users/jason/private/todo.md:12:Sensitive todo text",
              source: "local",
              project_hint: "Sensitive project",
              task_hint: "Sensitive task",
              title: "Sensitive source title",
              summary: "Sensitive source summary",
              url: "https://example.com/private/thread",
            },
          ],
        }, 200);
      },
    });

    const body = JSON.parse(writes[0] ?? "{}") as {
      ok: boolean;
      previews: Array<{
        source_id: string;
        preview: Array<{
          id: string;
          source_id: string;
          project_hint: string;
          task_hint: string;
          title: string;
          summary: string;
          url: string;
        }>;
      }>;
    };
    assert.equal(exitCode, 0);
    assert.deepEqual(requested, [
      "GET http://127.0.0.1:4377/mcp-sources",
      "POST http://127.0.0.1:4377/mcp-sources/local_events_source/preview",
    ]);
    assert.equal(body.ok, true);
    assert.equal(body.previews[0].source_id, "[redacted]");
    assert.equal(body.previews[0].preview[0].id, "[redacted]");
    assert.equal(body.previews[0].preview[0].source_id, "[redacted]");
    assert.equal(body.previews[0].preview[0].project_hint, "[redacted]");
    assert.equal(body.previews[0].preview[0].task_hint, "[redacted]");
    assert.equal(body.previews[0].preview[0].title, "[redacted]");
    assert.equal(body.previews[0].preview[0].summary, "[redacted]");
    assert.equal(body.previews[0].preview[0].url, "[redacted]");
  });

  it("routes selected sources once", async () => {
    const writes: string[] = [];
    let requestedBody = "";
    const exitCode = await runMcpSourceCli({
      command: "route-once",
      baseUrl: "http://127.0.0.1:4377",
      sourceIds: ["github_update_source"],
      includeText: false,
      stdout: writeTo(writes),
      fetchFn: async (url, init) => {
        assert.equal(String(url), "http://127.0.0.1:4377/mcp-sources/poll-all-and-route");
        requestedBody = String(init?.body);
        return response({ ok: true, events_seen: 1 }, 200);
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(requestedBody, JSON.stringify({ source_ids: ["github_update_source"] }));
    assert.deepEqual(JSON.parse(writes[0] ?? "{}"), { ok: true, events_seen: 1 });
  });
});

function writeTo(writes: string[]): Pick<NodeJS.WriteStream, "write"> {
  return {
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  };
}

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
