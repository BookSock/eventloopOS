import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCodexAppServerWebSocketConnection, WebSocketJsonRpcClient } from "./codex_app_server_ws.js";

type Listener = (event: { data?: unknown; error?: unknown }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: "open" | "message" | "close" | "error", listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: "open" | "message" | "close" | "error", event: { data?: unknown; error?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("WebSocketJsonRpcClient", () => {
  it("waits for open, writes JSON-RPC requests, and resolves matching responses", async () => {
    const socket = new FakeWebSocket("ws://127.0.0.1:4567");
    const rpc = new WebSocketJsonRpcClient(socket, 1_000);

    const responsePromise = rpc.request({ method: "thread/list", params: { limit: 1 } });
    assert.deepEqual(socket.sent, []);

    socket.emit("open");
    await waitFor(() => socket.sent.length === 1);
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      id: 1,
      method: "thread/list",
      params: { limit: 1 },
    });

    socket.emit("message", { data: JSON.stringify({ method: "notification/ignored", params: {} }) });
    socket.emit("message", { data: JSON.stringify({ id: 1, result: { data: [], nextCursor: null } }) });

    assert.deepEqual(await responsePromise, { data: [], nextCursor: null });
    rpc.close();
  });

  it("rejects JSON-RPC error responses", async () => {
    const socket = new FakeWebSocket("ws://127.0.0.1:4567");
    const rpc = new WebSocketJsonRpcClient(socket, 1_000);
    socket.emit("open");

    const responsePromise = rpc.request({ method: "thread/read", params: { threadId: "missing" } });
    await waitFor(() => socket.sent.length === 1);
    socket.emit("message", { data: JSON.stringify({ id: 1, error: { message: "thread missing" } }) });

    await assert.rejects(Promise.resolve(responsePromise), /thread missing/);
    rpc.close();
  });

  it("times out pending requests", async () => {
    const socket = new FakeWebSocket("ws://127.0.0.1:4567");
    const rpc = new WebSocketJsonRpcClient(socket, 1);
    socket.emit("open");

    await assert.rejects(
      Promise.resolve(rpc.request({ method: "turn/start", params: { threadId: "thread_1" } })),
      /Codex app-server request timed out: turn\/start/,
    );
    rpc.close();
  });

  it("rejects pending requests on close", async () => {
    const socket = new FakeWebSocket("ws://127.0.0.1:4567");
    const rpc = new WebSocketJsonRpcClient(socket, 1_000);
    socket.emit("open");

    const responsePromise = rpc.request({ method: "thread/list", params: {} });
    await waitFor(() => socket.sent.length === 1);
    socket.emit("close");

    await assert.rejects(Promise.resolve(responsePromise), /websocket closed/);
  });
});

describe("createCodexAppServerWebSocketConnection", () => {
  it("initializes with experimental API capability over shared websocket app-server", async () => {
    FakeWebSocket.instances = [];

    const connection = createCodexAppServerWebSocketConnection({
      url: "ws://127.0.0.1:4567",
      WebSocketCtor: FakeWebSocket,
    });
    const socket = FakeWebSocket.instances[0];
    assert.equal(socket.url, "ws://127.0.0.1:4567");

    socket.emit("open");
    await waitFor(() => socket.sent.length === 1);
    assert.deepEqual(JSON.parse(socket.sent[0]), {
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

    socket.emit("message", { data: JSON.stringify({ id: 1, result: { ok: true } }) });
    assert.deepEqual(await connection.initialized, { ok: true });
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
