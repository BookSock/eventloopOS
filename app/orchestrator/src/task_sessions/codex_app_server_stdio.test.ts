import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PassThrough } from "node:stream";
import { NdjsonRpcClient } from "./codex_app_server_stdio.js";

describe("NdjsonRpcClient", () => {
  it("writes newline JSON requests and resolves matching responses", async () => {
    const toServer = new PassThrough();
    const fromServer = new PassThrough();
    const written: string[] = [];
    toServer.on("data", (chunk) => written.push(String(chunk)));
    const rpc = new NdjsonRpcClient(toServer, fromServer, 1_000);

    const responsePromise = rpc.request({ method: "thread/list", params: { limit: 1 } });
    fromServer.write(JSON.stringify({ method: "remoteControl/status/changed", params: { status: "disabled" } }) + "\n");
    fromServer.write(JSON.stringify({ id: 1, result: { data: [], nextCursor: null } }) + "\n");

    assert.deepEqual(await responsePromise, { data: [], nextCursor: null });
    assert.deepEqual(JSON.parse(written.join("").trim()), {
      id: 1,
      method: "thread/list",
      params: { limit: 1 },
    });
    rpc.close();
  });

  it("rejects JSON-RPC error responses", async () => {
    const toServer = new PassThrough();
    const fromServer = new PassThrough();
    const rpc = new NdjsonRpcClient(toServer, fromServer, 1_000);

    const responsePromise = rpc.request({ method: "thread/read", params: { threadId: "missing" } });
    fromServer.write(JSON.stringify({ id: 1, error: { message: "thread missing" } }) + "\n");

    await assert.rejects(Promise.resolve(responsePromise), /thread missing/);
    rpc.close();
  });

  it("times out pending requests", async () => {
    const toServer = new PassThrough();
    const fromServer = new PassThrough();
    const rpc = new NdjsonRpcClient(toServer, fromServer, 1);

    await assert.rejects(
      Promise.resolve(rpc.request({ method: "turn/start", params: { threadId: "thread_1" } })),
      /Codex app-server request timed out: turn\/start/,
    );
    rpc.close();
  });

  it("rejects pending requests on close", async () => {
    const toServer = new PassThrough();
    const fromServer = new PassThrough();
    const rpc = new NdjsonRpcClient(toServer, fromServer, 1_000);

    const responsePromise = rpc.request({ method: "thread/list", params: {} });
    rpc.close(new Error("closed for test"));

    await assert.rejects(Promise.resolve(responsePromise), /closed for test/);
  });
});
