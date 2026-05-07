import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseScriptEventsOutput,
  pollScriptEvents,
  scriptOptionsFromEnv,
  type ScriptEventsExecFile,
} from "./script_events_server.js";

describe("script events MCP source", () => {
  it("parses array and object outputs", () => {
    assert.deepEqual(parseScriptEventsOutput(JSON.stringify([{ id: "1", title: "One" }])), {
      items: [{ id: "1", title: "One" }],
    });
    assert.deepEqual(parseScriptEventsOutput(JSON.stringify({ items: [{ id: "2" }], nextCursor: "2" })), {
      items: [{ id: "2" }],
      nextCursor: "2",
    });
  });

  it("runs configured script with cursor arg and env", async () => {
    const calls: unknown[] = [];
    const runner: ScriptEventsExecFile = async (command, args, options) => {
      calls.push({ command, args, cursorEnv: options.env.EVENTLOOPOS_TEST_CURSOR });
      return {
        stdout: JSON.stringify({ items: [{ id: "3" }], nextCursor: "3" }),
        stderr: "",
      };
    };

    const result = await pollScriptEvents(
      {
        command: "node",
        args: ["scripts/poll.js"],
        cursorArg: "--cursor",
        cursorEnv: "EVENTLOOPOS_TEST_CURSOR",
        timeoutMs: 1000,
        maxBufferBytes: 1000,
        env: {},
      },
      "2",
      runner,
    );

    assert.deepEqual(result, { items: [{ id: "3" }], nextCursor: "3" });
    assert.deepEqual(calls, [
      {
        command: "node",
        args: ["scripts/poll.js", "--cursor", "2"],
        cursorEnv: "2",
      },
    ]);
  });

  it("reads options from environment", () => {
    const options = scriptOptionsFromEnv({
      EVENTLOOPOS_SCRIPT_EVENTS_COMMAND: "node",
      EVENTLOOPOS_SCRIPT_EVENTS_ARGS: "[\"scripts/gmail.js\",\"--query\",\"is:unread\"]",
      EVENTLOOPOS_SCRIPT_EVENTS_CURSOR_ARG: "--cursor",
      EVENTLOOPOS_SCRIPT_EVENTS_CURSOR_ENV: "EVENT_CURSOR",
    });

    assert.equal(options.command, "node");
    assert.deepEqual(options.args, ["scripts/gmail.js", "--query", "is:unread"]);
    assert.equal(options.cursorArg, "--cursor");
    assert.equal(options.cursorEnv, "EVENT_CURSOR");
  });
});
