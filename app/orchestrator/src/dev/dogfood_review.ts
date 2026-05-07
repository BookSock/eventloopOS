import { pathToFileURL } from "node:url";
import type { ActivityEvent, MetricsSnapshot } from "../observability.js";

export type DogfoodReviewFormat = "text" | "json";

export type DogfoodReviewOptions = {
  baseUrl: string;
  limit: number;
  since?: string;
  format: DogfoodReviewFormat;
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  now?: () => Date;
};

type MetricsResponse = {
  metrics: MetricsSnapshot;
  generated_at: string;
};

type ActivityResponse = {
  events: ActivityEvent[];
  count: number;
};

export function dogfoodReviewOptionsFromEnv(env: NodeJS.ProcessEnv): DogfoodReviewOptions {
  return {
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    limit: parsePositiveInteger(env.EVENTLOOPOS_DOGFOOD_REVIEW_LIMIT, 200),
    since: env.EVENTLOOPOS_DOGFOOD_REVIEW_SINCE,
    format: parseFormat(env.EVENTLOOPOS_DOGFOOD_REVIEW_FORMAT),
  };
}

export async function runDogfoodReview(options: DogfoodReviewOptions): Promise<number> {
  const fetchFn = options.fetchFn ?? fetch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const now = options.now ?? (() => new Date());

  try {
    const [metrics, activity] = await Promise.all([
      fetchJson<MetricsResponse>(fetchFn, new URL("/metrics", options.baseUrl)),
      fetchJson<ActivityResponse>(fetchFn, new URL(`/activity?limit=${options.limit}`, options.baseUrl)),
    ]);
    const generatedAt = metrics.generated_at ?? now().toISOString();
    const since = options.since ?? startOfLocalDay(now()).toISOString();
    const events = activity.events.filter((event) => new Date(event.occurred_at).getTime() >= new Date(since).getTime());
    const report = {
      generated_at: generatedAt,
      since,
      metrics: metrics.metrics,
      events,
      fetched_activity_count: activity.count,
    };

    if (options.format === "json") {
      stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      stdout.write(formatTextReport(report));
    }
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function fetchJson<T>(fetchFn: typeof fetch, url: URL): Promise<T> {
  const response = await fetchFn(url);
  const body = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(`GET ${url.pathname} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

function formatTextReport(report: {
  generated_at: string;
  since: string;
  metrics: MetricsSnapshot;
  events: ActivityEvent[];
  fetched_activity_count: number;
}): string {
  const lines: string[] = [
    "EventloopOS Dogfood Review",
    `Generated: ${report.generated_at}`,
    `Since: ${report.since}`,
    "",
    "Counters:",
  ];

  const counters = Object.entries(report.metrics.counters).sort(([left], [right]) => left.localeCompare(right));
  if (counters.length === 0) {
    lines.push("- none");
  } else {
    for (const [name, value] of counters) {
      lines.push(`- ${name}: ${value}`);
    }
  }

  lines.push("", `Activity: ${report.events.length} in window (${report.fetched_activity_count} fetched)`);
  if (report.events.length === 0) {
    lines.push("- none");
  } else {
    for (const event of report.events) {
      const status = event.status ? ` ${event.status}` : "";
      const task = event.task_id ? ` task=${event.task_id}` : "";
      const queue = event.queue_item_id ? ` queue=${event.queue_item_id}` : "";
      lines.push(`- ${event.occurred_at} ${event.type}${status}${task}${queue}: ${event.summary}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number(input);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFormat(input: string | undefined): DogfoodReviewFormat {
  return input === "json" ? "json" : "text";
}

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runDogfoodReview(dogfoodReviewOptionsFromEnv(process.env));
  process.exitCode = exitCode;
}
