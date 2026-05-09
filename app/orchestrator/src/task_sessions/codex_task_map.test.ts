import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodexTaskMapResolver, parseCodexTaskMap } from "./codex_task_map.js";

describe("CodexTaskMapResolver", () => {
  it("reads file-backed mapping on every lookup and lets the file override inline env mapping", async () => {
    const snapshots = [
      JSON.stringify({ thread_blog: "task_blog_from_file" }),
      JSON.stringify({ thread_blog: "task_blog_after_agent_update" }),
    ];
    const resolver = new CodexTaskMapResolver({
      inlineMap: { thread_blog: { task_id: "task_blog_from_env" }, thread_infra: { task_id: "task_infra_from_env" } },
      mapPath: "state/codex-task-map.json",
      readTextFile: async () => snapshots.shift() ?? "{}",
    });

    assert.equal(await resolver.taskIdForThreadId("thread_blog"), "task_blog_from_file");
    assert.equal(await resolver.taskIdForThreadId("thread_blog"), "task_blog_after_agent_update");
    assert.equal(await resolver.taskIdForThreadId("thread_infra"), "task_infra_from_env");
  });

  it("falls back to inline mapping and reports file read failures", async () => {
    const errors: Error[] = [];
    const resolver = new CodexTaskMapResolver({
      inlineMap: { thread_blog: { task_id: "task_blog_from_env" } },
      mapPath: "missing.json",
      readTextFile: async () => {
        throw new Error("ENOENT");
      },
      onError: (error) => errors.push(error),
    });

    assert.equal(await resolver.taskIdForThreadId("thread_blog"), "task_blog_from_env");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.message, "ENOENT");
  });

  it("treats missing map file as empty during lookup", async () => {
    const errors: Error[] = [];
    const resolver = new CodexTaskMapResolver({
      inlineMap: { thread_blog: { task_id: "task_blog_from_env" } },
      mapPath: "missing.json",
      readTextFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      onError: (error) => errors.push(error),
    });

    assert.equal(await resolver.taskIdForThreadId("thread_blog"), "task_blog_from_env");
    assert.deepEqual(errors, []);
  });

  it("atomically writes sorted bindings to the configured map path", async () => {
    const writes: Array<{ path: string; text: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];
    const directories: string[] = [];
    const resolver = new CodexTaskMapResolver({
      mapPath: "state/codex-task-map.json",
      readTextFile: async () => JSON.stringify({ thread_zeta: "task_zeta" }),
      writeTextFile: async (path, text) => {
        writes.push({ path, text });
      },
      renameFile: async (from, to) => {
        renames.push({ from, to });
      },
      makeDirectory: async (path) => {
        directories.push(path);
      },
    });

    const map = await resolver.bindThreadToTask("thread_alpha", "task_alpha", "ghostty:front");

    assert.deepEqual(map, {
      thread_alpha: { task_id: "task_alpha", terminal_ref: "ghostty:front" },
      thread_zeta: { task_id: "task_zeta" },
    });
    assert.deepEqual(directories, ["state"]);
    assert.equal(writes.length, 1);
    assert.match(writes[0]?.path ?? "", /^state\/codex-task-map\.json\.\d+\.\d+\.tmp$/);
    assert.match(writes[0]?.text ?? "", /"thread_alpha"/);
    assert.match(writes[0]?.text ?? "", /"terminal_ref": "ghostty:front"/);
    assert.deepEqual(renames, [{ from: writes[0]?.path, to: "state/codex-task-map.json" }]);
  });

  it("creates a new map file when binding path does not exist", async () => {
    const writes: string[] = [];
    const resolver = new CodexTaskMapResolver({
      mapPath: "state/codex-task-map.json",
      readTextFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      writeTextFile: async (_path, text) => {
        writes.push(text);
      },
      renameFile: async () => {},
      makeDirectory: async () => {},
    });

    await resolver.bindThreadToTask("thread_blog", "task_blog");

    assert.equal(writes[0], '{\n  "thread_blog": {\n    "task_id": "task_blog"\n  }\n}\n');
  });

  it("rejects writes when no map path is configured", async () => {
    const resolver = new CodexTaskMapResolver();

    await assert.rejects(() => resolver.bindThreadToTask("thread_blog", "task_blog"), /path is not configured/);
  });
});

describe("parseCodexTaskMap", () => {
  it("parses valid thread-to-task JSON in legacy string form", () => {
    assert.deepEqual(parseCodexTaskMap('{"thread_blog":"task_blog"}'), { thread_blog: { task_id: "task_blog" } });
  });

  it("parses object-form entries with terminal_ref", () => {
    assert.deepEqual(
      parseCodexTaskMap('{"thread_blog":{"task_id":"task_blog","terminal_ref":"ghostty:front"}}'),
      { thread_blog: { task_id: "task_blog", terminal_ref: "ghostty:front" } },
    );
  });

  it("rejects malformed maps with precise messages", () => {
    assert.throws(() => parseCodexTaskMap("{bad json", "ORCHESTRATOR_CODEX_TASK_MAP"), /must be valid JSON/);
    assert.throws(() => parseCodexTaskMap("[]", "file map"), /must be a JSON object/);
    assert.throws(() => parseCodexTaskMap('{"thread_blog":""}', "file map"), /must be a non-empty task id/);
  });
});
