import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { pollMcpSourcesOnce, pollOnceOptionsFromEnv, type PollOnceOptions } from "./poll_once.js";

export type PollLoopOptions = PollOnceOptions & {
  intervalMs: number;
  maxCycles?: number;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
};

export type PollLoopSummary = {
  cycles: number;
  failures: number;
  stopped_by: "max_cycles" | "abort";
};

export function pollLoopOptionsFromEnv(env: NodeJS.ProcessEnv): PollLoopOptions {
  return {
    ...pollOnceOptionsFromEnv(env),
    intervalMs: parsePositiveInteger(env.EVENTLOOPOS_MCP_POLL_INTERVAL_MS, 30_000),
    maxCycles: parseOptionalPositiveInteger(env.EVENTLOOPOS_MCP_POLL_MAX_CYCLES),
  };
}

export async function runMcpPollLoop(options: PollLoopOptions): Promise<PollLoopSummary> {
  const sleepFn = options.sleepFn ?? defaultSleep;
  let cycles = 0;
  let failures = 0;

  while (!options.signal?.aborted) {
    const exitCode = await pollMcpSourcesOnce(options);
    cycles += 1;
    if (exitCode !== 0) failures += 1;
    if (options.maxCycles !== undefined && cycles >= options.maxCycles) {
      return { cycles, failures, stopped_by: "max_cycles" };
    }

    try {
      await sleepFn(options.intervalMs, options.signal);
    } catch (error) {
      if (isAbortError(error)) {
        return { cycles, failures, stopped_by: "abort" };
      }
      throw error;
    }
  }

  return { cycles, failures, stopped_by: "abort" };
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number(input);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveInteger(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const parsed = Number(input);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  await sleep(ms, undefined, { signal });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const summary = await runMcpPollLoop(pollLoopOptionsFromEnv(process.env));
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = summary.failures > 0 ? 1 : 0;
}
