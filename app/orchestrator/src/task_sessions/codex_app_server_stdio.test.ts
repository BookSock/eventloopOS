import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { createCodexAppServerStdioConnection, NdjsonRpcClient } from "./codex_app_server_stdio.js";

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

  it("initializes with experimental API capability for metadata-bearing turn starts", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const written: string[] = [];
    stdin.on("data", (chunk) => written.push(String(chunk)));
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin,
      stdout,
      stderr,
      killed: false,
      kill() {
        child.killed = true;
        emitter.emit("close");
      },
    }) as typeof emitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      killed: boolean;
      kill(): void;
    };

    const connection = createCodexAppServerStdioConnection({
      spawnFn: (() => child) as never,
    });
    await waitFor(() => written.join("").includes("\n"));

    assert.deepEqual(JSON.parse(written.join("").trim()), {
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "eventloopos",
          title: "eventloopOS",
          version: "0.0.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
    });

    stdout.write(JSON.stringify({ id: 1, result: { ok: true } }) + "\n");
    assert.deepEqual(await connection.initialized, { ok: true });
    connection.close();
  });

  it("forwards stderr chunks to onStderr callback for friendly translation", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin,
      stdout,
      stderr,
      killed: false,
      kill() {
        child.killed = true;
        emitter.emit("close");
      },
    }) as typeof emitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      killed: boolean;
      kill(): void;
    };

    const received: string[] = [];
    const connection = createCodexAppServerStdioConnection({
      spawnFn: (() => child) as never,
      onStderr: (chunk) => received.push(chunk),
    });
    // Resolve the initialize request so close() does not race against a
    // pending promise that would surface as an unhandled rejection.
    connection.initialized.catch(() => undefined);
    stdout.write(JSON.stringify({ id: 1, result: { ok: true } }) + "\n");
    await connection.initialized;
    stderr.write(
      'worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed("invalid_grant: Invalid refresh token"))\n',
    );
    await waitFor(() => received.join("").includes("TokenRefreshFailed"));
    assert.match(received.join(""), /TokenRefreshFailed/);
    connection.close();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for condition");
}
