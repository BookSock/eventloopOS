import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { CodexAppServerRequest } from "./codex_app_server_thread_client.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type CodexAppServerStdioOptions = {
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
  clientInfo?: {
    name: string;
    title: string | null;
    version: string;
  };
  spawnFn?: typeof spawn;
  onStderr?: (chunk: string) => void;
};

export class NdjsonRpcClient {
  private readonly lines: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;

  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly requestTimeoutMs = 10_000,
  ) {
    this.lines = createInterface({ input: output });
    this.lines.on("line", (line) => this.handleLine(line));
    this.lines.on("close", () => this.close(new Error("Codex app-server stream closed")));
  }

  request: CodexAppServerRequest = async ({ method, params }) => {
    if (this.closed) {
      throw new Error("Codex app-server stream is closed");
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

    this.input.write(`${JSON.stringify(payload)}\n`);
    return await promise;
  };

  close(reason = new Error("Codex app-server stream closed")): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let message: unknown;
    try {
      message = JSON.parse(line);
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

export type CodexAppServerStdioConnection = {
  request: CodexAppServerRequest;
  close(): void;
  child: ChildProcessWithoutNullStreams;
  initialized: Promise<unknown>;
};

export function createCodexAppServerStdioConnection(options: CodexAppServerStdioOptions = {}): CodexAppServerStdioConnection {
  const command = options.command ?? "codex";
  const args = options.args ?? ["app-server", "--listen", "stdio://"];
  const child = (options.spawnFn ?? spawn)(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  const rpc = new NdjsonRpcClient(child.stdin, child.stdout, options.requestTimeoutMs);
  child.on("close", () => rpc.close(new Error("Codex app-server process closed")));
  child.on("error", (error) => rpc.close(error));
  if (options.onStderr && child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string | Buffer) => {
      options.onStderr?.(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
  }

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
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
    child,
    initialized,
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    return JSON.stringify(record);
  }
  return String(error);
}
