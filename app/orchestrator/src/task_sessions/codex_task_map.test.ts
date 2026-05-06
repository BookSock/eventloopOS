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
      inlineMap: { thread_blog: "task_blog_from_env", thread_infra: "task_infra_from_env" },
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
      inlineMap: { thread_blog: "task_blog_from_env" },
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
});

describe("parseCodexTaskMap", () => {
  it("parses valid thread-to-task JSON", () => {
    assert.deepEqual(parseCodexTaskMap('{"thread_blog":"task_blog"}'), { thread_blog: "task_blog" });
  });

  it("rejects malformed maps with precise messages", () => {
    assert.throws(() => parseCodexTaskMap("{bad json", "ORCHESTRATOR_CODEX_TASK_MAP"), /must be valid JSON/);
    assert.throws(() => parseCodexTaskMap("[]", "file map"), /must be a JSON object/);
    assert.throws(() => parseCodexTaskMap('{"thread_blog":""}', "file map"), /entries must be non-empty string task ids/);
  });
});
