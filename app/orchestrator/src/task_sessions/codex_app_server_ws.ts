import type { CodexAppServerRequest } from "./codex_app_server_thread_client.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type WebSocketEvent = {
  data?: unknown;
  error?: unknown;
};

type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: WebSocketEvent) => void): void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

export type CodexAppServerWebSocketOptions = {
  url: string;
  requestTimeoutMs?: number;
  clientInfo?: {
    name: string;
    title: string | null;
    version: string;
  };
  WebSocketCtor?: WebSocketConstructor;
};

export type CodexAppServerWebSocketConnection = {
  request: CodexAppServerRequest;
  close(): void;
  initialized: Promise<unknown>;
};

export class WebSocketJsonRpcClient {
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;
  private readonly opened: Promise<void>;

  constructor(
    private readonly socket: WebSocketLike,
    private readonly requestTimeoutMs = 10_000,
  ) {
    this.opened = new Promise((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", (event) => reject(new Error(errorMessage(event.error ?? "Codex app-server websocket error"))));
    });
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.close(new Error("Codex app-server websocket closed")));
    socket.addEventListener("error", (event) => this.close(new Error(errorMessage(event.error ?? "Codex app-server websocket error"))));
  }

  request: CodexAppServerRequest = async ({ method, params }) => {
    if (this.closed) {
      throw new Error("Codex app-server websocket is closed");
    }
    await this.opened;
    if (this.closed) {
      throw new Error("Codex app-server websocket is closed");
    }

    const id = this.nextRequestId++;
    const payload = { id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });

    this.socket.send(JSON.stringify(payload));
    return await promise;
  };

  close(reason = new Error("Codex app-server websocket closed")): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.pending.clear();
    try {
      this.socket.close();
    } catch {
      // Socket may already be closed.
    }
  }

  private handleMessage(data: unknown): void {
    const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : undefined;
    if (!text?.trim()) return;

    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;

    const record = message as Record<string, unknown>;
    if (typeof record.id !== "number") {
      return;
    }

    const pending = this.pending.get(record.id);
    if (!pending) return;

    this.pending.delete(record.id);
    clearTimeout(pending.timeout);
    if (record.error !== undefined) {
      pending.reject(new Error(errorMessage(record.error)));
      return;
    }
    pending.resolve(record.result);
  }
}

export function createCodexAppServerWebSocketConnection(
  options: CodexAppServerWebSocketOptions,
): CodexAppServerWebSocketConnection {
  const WebSocketCtor = options.WebSocketCtor ?? defaultWebSocketConstructor();
  const socket = new WebSocketCtor(options.url);
  const rpc = new WebSocketJsonRpcClient(socket, options.requestTimeoutMs);

  const rawRequest = rpc.request;
  const initialized = Promise.resolve(rawRequest({
    method: "initialize",
    params: {
      clientInfo: options.clientInfo ?? {
        name: "eventloopos",
        title: "eventloopOS",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    },
  }));
  const request: CodexAppServerRequest = async (request) => {
    if (request.method !== "initialize") {
      await initialized;
    }
    return await rawRequest(request);
  };

  return {
    request,
    close() {
      rpc.close();
    },
    initialized,
  };
}

function defaultWebSocketConstructor(): WebSocketConstructor {
  const WebSocketCtor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!WebSocketCtor) {
    throw new Error("global WebSocket is unavailable; use stdio Codex app-server transport");
  }
  return WebSocketCtor;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    return JSON.stringify(record);
  }
  return String(error);
}
