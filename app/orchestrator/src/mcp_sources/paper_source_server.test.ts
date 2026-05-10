import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it } from "node:test";
import {
  listPaperItems,
  paperInputToPollItem,
  parsePaperInput,
  parsePaperInputs,
} from "./paper_source_server.js";

describe("paper MCP source", () => {
  it("emits a poll item with required fields", () => {
    const result = listPaperItems({
      papers: [
        {
          id: "paper-1",
          title: "Review onboarding doc",
          body_markdown: "Skim section 3 and decide on the rewrite path.",
          task_hint: "decide_onboarding_rewrite",
        },
      ],
    });

    assert.equal(result.items.length, 1);
    const item = result.items[0]!;
    assert.equal(item.id, "paper-1");
    assert.equal(item.title, "Review onboarding doc");
    assert.equal(item.summary, "Skim section 3 and decide on the rewrite path.");
    assert.equal(item.task_hint, "decide_onboarding_rewrite");
    assert.equal(item.resource_kind, "paper");
    assert.equal(item.source_kind, "note");
    assert.equal(item.type, "paper.note");
    assert.equal(item.url, undefined);
    assert.equal(item.file_uri, undefined);
    assert.equal(item.body_markdown, "Skim section 3 and decide on the rewrite path.");
    assert.equal(item.source_id, "paper:paper-1");
    assert.match(String(item.idempotency_key), /^paper:paper-1:[0-9a-f]{16}$/);
  });

  it("preserves file_uri and surfaces source_kind override", () => {
    const result = listPaperItems({
      papers: [
        {
          id: "paper-pdf",
          title: "Term sheet review",
          body_markdown: "Read section 4 about liquidation preferences.",
          task_hint: "term_sheet_redlines",
          file_uri: "file:///Users/jason/Documents/term-sheet.pdf",
          source_kind: "pdf",
        },
      ],
    });

    const item = result.items[0]!;
    assert.equal(item.file_uri, "file:///Users/jason/Documents/term-sheet.pdf");
    assert.equal(item.url, "file:///Users/jason/Documents/term-sheet.pdf");
    assert.equal(item.source_kind, "pdf");
    assert.equal(item.type, "paper.pdf");
    assert.equal(item.resource_kind, "paper");
  });

  it("infers source_kind from file extension when not provided", () => {
    assert.equal(
      paperInputToPollItem({
        id: "p1",
        title: "x",
        body_markdown: "y",
        task_hint: "z",
        file_uri: "file:///tmp/a.pdf",
      }).source_kind,
      "pdf",
    );
    assert.equal(
      paperInputToPollItem({
        id: "p2",
        title: "x",
        body_markdown: "y",
        task_hint: "z",
        file_uri: "file:///tmp/screenshot.png",
      }).source_kind,
      "image",
    );
    assert.equal(
      paperInputToPollItem({
        id: "p3",
        title: "x",
        body_markdown: "y",
        task_hint: "z",
        file_uri: "file:///tmp/notes.md",
      }).source_kind,
      "doc",
    );
    assert.equal(
      paperInputToPollItem({
        id: "p4",
        title: "x",
        body_markdown: "y",
        task_hint: "z",
        file_uri: "https://example.test/page",
      }).source_kind,
      "note",
    );
  });

  it("accepts a single paper object as input shorthand", () => {
    const result = listPaperItems({
      id: "single-paper",
      title: "One",
      body_markdown: "Body",
      task_hint: "hint",
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.id, "single-paper");
  });

  it("accepts an array of papers directly", () => {
    const result = listPaperItems([
      { id: "a", title: "A", body_markdown: "ab", task_hint: "ha" },
      { id: "b", title: "B", body_markdown: "bb", task_hint: "hb" },
    ]);
    assert.deepEqual(result.items.map((item) => item.id), ["a", "b"]);
  });

  it("returns no items when input is omitted", () => {
    assert.deepEqual(listPaperItems(undefined), { items: [] });
    assert.deepEqual(listPaperItems({}), { items: [] });
    assert.deepEqual(listPaperItems({ papers: [] }), { items: [] });
  });

  it("rejects malformed input with a clear error", () => {
    assert.throws(
      () => parsePaperInput({ title: "no id" }, "papers[0]"),
      /papers\[0\]\.id must be a non-empty string/,
    );
    assert.throws(
      () => parsePaperInput({ id: "x", title: "y", body_markdown: "z" }, "papers[0]"),
      /task_hint must be a non-empty string/,
    );
    assert.throws(
      () => parsePaperInput({ id: "x", title: "y", body_markdown: "z", task_hint: "h", source_kind: "video" }, "papers[0]"),
      /source_kind must be one of doc, pdf, image, note/,
    );
    assert.throws(
      () => parsePaperInputs("nope"),
      /paper source input must be an object, array, or omitted/,
    );
    assert.throws(
      () => parsePaperInputs([{ id: 1, title: "n", body_markdown: "b", task_hint: "h" }]),
      /papers\[0\]\.id must be a non-empty string/,
    );
  });

  it("serves list_papers over stdio through MCP SDK", async () => {
    const serverPath = fileURLToPath(new URL("./paper_source_server.js", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      stderr: "pipe",
    });
    const client = new Client({ name: "eventloopos-paper-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_papers"]);
      const tool = tools.tools[0]!;
      assert.equal(tool.annotations?.readOnlyHint, true);

      const callResult = await client.callTool({
        name: "list_papers",
        arguments: {
          papers: [
            {
              id: "paper-stdio",
              title: "Stdio paper",
              body_markdown: "Body via stdio",
              task_hint: "stdio_check",
            },
          ],
        },
      });
      const structured = callResult.structuredContent as { items: Array<Record<string, unknown>> };
      assert.equal(structured.items.length, 1);
      assert.equal(structured.items[0]!.id, "paper-stdio");
      assert.equal(structured.items[0]!.resource_kind, "paper");
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});
