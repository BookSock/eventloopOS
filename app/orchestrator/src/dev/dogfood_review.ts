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

type DogfoodReviewReport = {
  generated_at: string;
  since: string;
  metrics: MetricsSnapshot;
  events: ActivityEvent[];
  fetched_activity_count: number;
  task_rollups: RollupSummary[];
  session_rollups: RollupSummary[];
  queue_rollups: QueueRollupSummary[];
  derived: {
    restore_success_rate: number | null;
    queue_clearance_rate: number | null;
    task_session_route_rate: number | null;
  };
};

type RollupSummary = {
  id: string;
  events: number;
  routed: number;
  queued: number;
  done: number;
  followups_sent: number;
  failed: number;
  last_activity_at: string;
};

type QueueRollupSummary = {
  id: string;
  created_at?: string;
  done_at?: string;
  task_id?: string;
  task_session_id?: string;
  time_to_done_ms?: number;
  events: number;
  last_activity_at?: string;
  last_summary?: string;
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
    const report = buildDogfoodReviewReport({
      generated_at: generatedAt,
      since,
      metrics: metrics.metrics,
      events,
      fetched_activity_count: activity.count,
    });

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

function buildDogfoodReviewReport(input: {
  generated_at: string;
  since: string;
  metrics: MetricsSnapshot;
  events: ActivityEvent[];
  fetched_activity_count: number;
}): DogfoodReviewReport {
  return {
    ...input,
    task_rollups: rollupBy(input.events, (event) => event.task_id),
    session_rollups: rollupBy(input.events, (event) => event.task_session_id),
    queue_rollups: queueRollups(input.events),
    derived: {
      restore_success_rate: ratio(
        input.metrics.counters.restore_requests_done_total,
        (input.metrics.counters.restore_requests_done_total ?? 0) + (input.metrics.counters.restore_requests_failed_total ?? 0),
      ),
      queue_clearance_rate: ratio(input.metrics.counters.queue_items_done_total, input.metrics.counters.queue_items_created_total),
      task_session_route_rate: ratio(input.metrics.counters.events_routed_to_task_session_total, input.metrics.counters.events_ingested_total),
    },
  };
}

function formatTextReport(report: DogfoodReviewReport): string {
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

  lines.push("", "Derived:");
  lines.push(`- queue_clearance_rate: ${formatRatio(report.derived.queue_clearance_rate)}`);
  lines.push(`- task_session_route_rate: ${formatRatio(report.derived.task_session_route_rate)}`);
  lines.push(`- restore_success_rate: ${formatRatio(report.derived.restore_success_rate)}`);

  lines.push("", "Tasks:");
  appendRollupLines(lines, report.task_rollups);

  lines.push("", "Sessions:");
  appendRollupLines(lines, report.session_rollups);

  lines.push("", "Queues:");
  if (report.queue_rollups.length === 0) {
    lines.push("- none");
  } else {
    for (const queue of report.queue_rollups) {
      const task = queue.task_id ? ` task=${queue.task_id}` : "";
      const session = queue.task_session_id ? ` session=${queue.task_session_id}` : "";
      const done = typeof queue.time_to_done_ms === "number" ? ` done_in=${formatDuration(queue.time_to_done_ms)}` : "";
      const summary = queue.last_summary ? `: ${queue.last_summary}` : "";
      lines.push(`- ${queue.id}${task}${session} events=${queue.events}${done}${summary}`);
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

function rollupBy(events: ActivityEvent[], keyForEvent: (event: ActivityEvent) => string | undefined): RollupSummary[] {
  const rollups = new Map<string, RollupSummary>();
  for (const event of events) {
    const id = keyForEvent(event);
    if (!id) continue;
    const rollup = rollups.get(id) ?? {
      id,
      events: 0,
      routed: 0,
      queued: 0,
      done: 0,
      followups_sent: 0,
      failed: 0,
      last_activity_at: event.occurred_at,
    };
    rollup.events += 1;
    if (event.type === "event_routed") rollup.routed += 1;
    if (event.type === "event_routed" && event.queue_item_id) rollup.queued += 1;
    if (event.type === "queue_item_done") rollup.done += 1;
    if (event.type === "event_routed" && event.task_session_id) rollup.followups_sent += 1;
    if (event.status === "failed") rollup.failed += 1;
    if (event.occurred_at > rollup.last_activity_at) rollup.last_activity_at = event.occurred_at;
    rollups.set(id, rollup);
  }
  return [...rollups.values()].sort((left, right) => right.last_activity_at.localeCompare(left.last_activity_at));
}

function queueRollups(events: ActivityEvent[]): QueueRollupSummary[] {
  const rollups = new Map<string, QueueRollupSummary>();
  for (const event of events) {
    if (!event.queue_item_id) continue;
    const rollup = rollups.get(event.queue_item_id) ?? {
      id: event.queue_item_id,
      events: 0,
    };
    rollup.events += 1;
    rollup.task_id = event.task_id ?? rollup.task_id;
    rollup.task_session_id = event.task_session_id ?? rollup.task_session_id;
    if (!rollup.last_activity_at || event.occurred_at > rollup.last_activity_at) {
      rollup.last_activity_at = event.occurred_at;
      rollup.last_summary = event.summary;
    }
    if (event.type === "event_routed") rollup.created_at = event.occurred_at;
    if (event.type === "queue_item_done") rollup.done_at = event.occurred_at;
    if (rollup.created_at && rollup.done_at) {
      rollup.time_to_done_ms = new Date(rollup.done_at).getTime() - new Date(rollup.created_at).getTime();
    }
    rollups.set(event.queue_item_id, rollup);
  }
  return [...rollups.values()].sort((left, right) => (right.last_activity_at ?? "").localeCompare(left.last_activity_at ?? ""));
}

function appendRollupLines(lines: string[], rollups: RollupSummary[]): void {
  if (rollups.length === 0) {
    lines.push("- none");
    return;
  }
  for (const rollup of rollups) {
    lines.push(
      `- ${rollup.id} events=${rollup.events} routed=${rollup.routed} queued=${rollup.queued} done=${rollup.done} followups=${rollup.followups_sent} failed=${rollup.failed} last=${rollup.last_activity_at}`,
    );
  }
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (!denominator) return null;
  return (numerator ?? 0) / denominator;
}

function formatRatio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
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
