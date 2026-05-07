import { pathToFileURL } from "node:url";
import type { ActivityEvent, MetricsSnapshot } from "../observability.js";

export type DogfoodReviewFormat = "text" | "json";
export type DogfoodCheckFormat = "text" | "json";

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

export type DogfoodCheckOptions = {
  baseUrl: string;
  limit: number;
  since?: string;
  format: DogfoodCheckFormat;
  thresholds: DogfoodCheckThresholds;
  fetchFn?: typeof fetch;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  now?: () => Date;
};

export type DogfoodCheckThresholds = {
  maxIgnoredRate: number;
  minRestoreSuccessRate: number;
  maxFollowupFailures: number;
  maxStaleLeases: number;
  maxPendingRestoreAgeMs: number;
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
  restore_provider_rollups: RestoreProviderRollupSummary[];
  daily_rollups: DailyActivityRollupSummary[];
  daily_trends: DailyActivityTrendSummary[];
  derived: {
    restore_success_rate: number | null;
    queue_clearance_rate: number | null;
    task_session_route_rate: number | null;
  };
};

type DogfoodCheckReport = {
  generated_at: string;
  since: string;
  passed: boolean;
  checks: DogfoodCheckResult[];
};

type DogfoodCheckResult = {
  name: string;
  passed: boolean;
  value: number | null;
  threshold: number;
  comparator: "<=" | ">=";
  summary: string;
};

type RollupSummary = {
  id: string;
  events: number;
  routed: number;
  queued: number;
  done: number;
  followups_attempted: number;
  followups_sent: number;
  followups_blocked: number;
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

type RestoreProviderRollupSummary = {
  provider: string;
  requested: number;
  done: number;
  failed: number;
  retried: number;
  success_rate: number | null;
  last_activity_at: string;
  confidence_reasons: string[];
};

type DailyActivityRollupSummary = {
  date: string;
  events: number;
  routed: number;
  queued: number;
  done: number;
  followups_sent: number;
  failed: number;
};

type DailyActivityTrendSummary = {
  date: string;
  previous_date: string;
  events_delta: number;
  routed_delta: number;
  queued_delta: number;
  done_delta: number;
  followups_sent_delta: number;
  failed_delta: number;
};

export function dogfoodReviewOptionsFromEnv(env: NodeJS.ProcessEnv): DogfoodReviewOptions {
  return {
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    limit: parsePositiveInteger(env.EVENTLOOPOS_DOGFOOD_REVIEW_LIMIT, 200),
    since: env.EVENTLOOPOS_DOGFOOD_REVIEW_SINCE,
    format: parseFormat(env.EVENTLOOPOS_DOGFOOD_REVIEW_FORMAT),
  };
}

export function dogfoodCheckOptionsFromEnv(env: NodeJS.ProcessEnv): DogfoodCheckOptions {
  return {
    baseUrl: env.EVENTLOOPOS_ORCHESTRATOR_URL ?? "http://127.0.0.1:4377",
    limit: parsePositiveInteger(env.EVENTLOOPOS_DOGFOOD_REVIEW_LIMIT, 200),
    since: env.EVENTLOOPOS_DOGFOOD_REVIEW_SINCE,
    format: parseFormat(env.EVENTLOOPOS_DOGFOOD_CHECK_FORMAT),
    thresholds: {
      maxIgnoredRate: parseNonNegativeNumber(env.EVENTLOOPOS_DOGFOOD_MAX_IGNORED_RATE, 0.1),
      minRestoreSuccessRate: parseNonNegativeNumber(env.EVENTLOOPOS_DOGFOOD_MIN_RESTORE_SUCCESS_RATE, 0.8),
      maxFollowupFailures: parseNonNegativeNumber(env.EVENTLOOPOS_DOGFOOD_MAX_FOLLOWUP_FAILURES, 0),
      maxStaleLeases: parseNonNegativeNumber(env.EVENTLOOPOS_DOGFOOD_MAX_STALE_LEASES, 0),
      maxPendingRestoreAgeMs: parseNonNegativeNumber(env.EVENTLOOPOS_DOGFOOD_MAX_PENDING_RESTORE_AGE_MS, 30 * 60 * 1000),
    },
  };
}

export async function runDogfoodReview(options: DogfoodReviewOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const report = await fetchDogfoodReport(options);
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

export async function runDogfoodCheck(options: DogfoodCheckOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const review = await fetchDogfoodReport(options);
    const report = buildDogfoodCheckReport(review, options.thresholds);
    if (options.format === "json") {
      stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      stdout.write(formatCheckTextReport(report));
    }
    return report.passed ? 0 : 2;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function fetchDogfoodReport(options: Pick<DogfoodReviewOptions, "baseUrl" | "limit" | "since" | "fetchFn" | "now">): Promise<DogfoodReviewReport> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? (() => new Date());

  const [metrics, activity] = await Promise.all([
    fetchJson<MetricsResponse>(fetchFn, new URL("/metrics", options.baseUrl)),
    fetchJson<ActivityResponse>(fetchFn, new URL(`/activity?limit=${options.limit}`, options.baseUrl)),
  ]);
  const generatedAt = metrics.generated_at ?? now().toISOString();
  const since = options.since ?? startOfLocalDay(now()).toISOString();
  const events = activity.events.filter((event) => new Date(event.occurred_at).getTime() >= new Date(since).getTime());
  return buildDogfoodReviewReport({
    generated_at: generatedAt,
    since,
    metrics: metrics.metrics,
    events,
    fetched_activity_count: activity.count,
  });
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
  const dailyRollups = dailyActivityRollups(input.events);
  return {
    ...input,
    task_rollups: rollupBy(input.events, (event) => event.task_id),
    session_rollups: rollupBy(input.events, (event) => event.task_session_id),
    queue_rollups: queueRollups(input.events),
    restore_provider_rollups: restoreProviderRollups(input.events),
    daily_rollups: dailyRollups,
    daily_trends: dailyActivityTrends(dailyRollups),
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

  lines.push("", "Restore Providers:");
  if (report.restore_provider_rollups.length === 0) {
    lines.push("- none");
  } else {
    for (const rollup of report.restore_provider_rollups) {
      const reasons = rollup.confidence_reasons.length > 0 ? ` reasons=${rollup.confidence_reasons.join(",")}` : "";
      lines.push(
        `- ${rollup.provider} requested=${rollup.requested} done=${rollup.done} failed=${rollup.failed} retried=${rollup.retried} success=${formatRatio(rollup.success_rate)}${reasons} last=${rollup.last_activity_at}`,
      );
    }
  }

  lines.push("", "Daily Activity:");
  if (report.daily_rollups.length === 0) {
    lines.push("- none");
  } else {
    for (const rollup of report.daily_rollups) {
      lines.push(
        `- ${rollup.date} events=${rollup.events} routed=${rollup.routed} queued=${rollup.queued} done=${rollup.done} followups_sent=${rollup.followups_sent} failed=${rollup.failed}`,
      );
    }
  }

  lines.push("", "Daily Trends:");
  if (report.daily_trends.length === 0) {
    lines.push("- none");
  } else {
    for (const trend of report.daily_trends) {
      lines.push(
        `- ${trend.date} vs ${trend.previous_date} events_delta=${formatSigned(trend.events_delta)} routed_delta=${formatSigned(trend.routed_delta)} queued_delta=${formatSigned(trend.queued_delta)} done_delta=${formatSigned(trend.done_delta)} followups_sent_delta=${formatSigned(trend.followups_sent_delta)} failed_delta=${formatSigned(trend.failed_delta)}`,
      );
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

function buildDogfoodCheckReport(report: DogfoodReviewReport, thresholds: DogfoodCheckThresholds): DogfoodCheckReport {
  const counters = report.metrics.counters;
  const pendingRestoreAgeMs = maxPendingRestoreAgeMs(report.events, report.generated_at);
  const checks: DogfoodCheckResult[] = [
    maxCheck(
      "ignored_queue_item_rate",
      ratio(counters.queue_items_ignored_total, counters.queue_items_created_total),
      thresholds.maxIgnoredRate,
      "ignored queue items divided by created queue items",
    ),
    minCheck(
      "restore_success_rate",
      report.derived.restore_success_rate,
      thresholds.minRestoreSuccessRate,
      "restore done divided by restore done plus failed",
    ),
    maxCheck(
      "task_followup_failures",
      counters.task_followups_failed_total ?? 0,
      thresholds.maxFollowupFailures,
      "failed task followup count",
    ),
    maxCheck(
      "stale_queue_leases",
      counters.queue_stale_leases_total ?? counters.stale_queue_leases_total ?? 0,
      thresholds.maxStaleLeases,
      "stale queue lease count",
    ),
    maxCheck(
      "pending_restore_age_ms",
      pendingRestoreAgeMs,
      thresholds.maxPendingRestoreAgeMs,
      "oldest pending restore request age",
    ),
  ];
  return {
    generated_at: report.generated_at,
    since: report.since,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function formatCheckTextReport(report: DogfoodCheckReport): string {
  const lines = [
    "EventloopOS Dogfood Check",
    `Generated: ${report.generated_at}`,
    `Since: ${report.since}`,
    `Status: ${report.passed ? "pass" : "fail"}`,
    "",
    "Checks:",
  ];
  for (const check of report.checks) {
    lines.push(
      `- ${check.passed ? "pass" : "fail"} ${check.name}: value=${formatCheckValue(check.value)} threshold=${check.comparator}${formatCheckValue(check.threshold)} ${check.summary}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function maxCheck(name: string, value: number | null, threshold: number, summary: string): DogfoodCheckResult {
  return {
    name,
    passed: value === null || value <= threshold,
    value,
    threshold,
    comparator: "<=",
    summary,
  };
}

function minCheck(name: string, value: number | null, threshold: number, summary: string): DogfoodCheckResult {
  return {
    name,
    passed: value === null || value >= threshold,
    value,
    threshold,
    comparator: ">=",
    summary,
  };
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
      followups_attempted: 0,
      followups_sent: 0,
      followups_blocked: 0,
      failed: 0,
      last_activity_at: event.occurred_at,
    };
    rollup.events += 1;
    if (event.type === "event_routed") rollup.routed += 1;
    if (event.type === "event_routed" && event.queue_item_id) rollup.queued += 1;
    if (event.type === "queue_item_done") rollup.done += 1;
    if (event.type === "task_followup_attempted") rollup.followups_attempted += 1;
    if (event.type === "task_followup_sent") rollup.followups_sent += 1;
    if (event.type === "task_followup_blocked") rollup.followups_blocked += 1;
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

function restoreProviderRollups(events: ActivityEvent[]): RestoreProviderRollupSummary[] {
  const rollups = new Map<string, RestoreProviderRollupSummary>();
  for (const event of events) {
    if (!event.type.startsWith("context_restore_")) continue;
    const provider = stringDetail(event.details, "resource_provider") ?? "unknown";
    const rollup = rollups.get(provider) ?? {
      provider,
      requested: 0,
      done: 0,
      failed: 0,
      retried: 0,
      success_rate: null,
      last_activity_at: event.occurred_at,
      confidence_reasons: [],
    };
    if (event.type === "context_restore_requested") rollup.requested += 1;
    if (event.type === "context_restore_done") rollup.done += 1;
    if (event.type === "context_restore_failed") rollup.failed += 1;
    if (event.type === "context_restore_retried") rollup.retried += 1;
    const confidenceReason = stringDetail(event.details, "confidence_reason");
    if (confidenceReason && !rollup.confidence_reasons.includes(confidenceReason)) {
      rollup.confidence_reasons.push(confidenceReason);
      rollup.confidence_reasons.sort();
    }
    if (event.occurred_at > rollup.last_activity_at) rollup.last_activity_at = event.occurred_at;
    rollup.success_rate = ratio(rollup.done, rollup.done + rollup.failed);
    rollups.set(provider, rollup);
  }
  return [...rollups.values()].sort((left, right) => right.last_activity_at.localeCompare(left.last_activity_at));
}

function dailyActivityRollups(events: ActivityEvent[]): DailyActivityRollupSummary[] {
  const rollups = new Map<string, DailyActivityRollupSummary>();
  for (const event of events) {
    const date = event.occurred_at.slice(0, 10);
    const rollup = rollups.get(date) ?? {
      date,
      events: 0,
      routed: 0,
      queued: 0,
      done: 0,
      followups_sent: 0,
      failed: 0,
    };
    rollup.events += 1;
    if (event.type === "event_routed") rollup.routed += 1;
    if (event.type === "event_routed" && event.queue_item_id) rollup.queued += 1;
    if (event.type === "queue_item_done") rollup.done += 1;
    if (event.type === "task_followup_sent") rollup.followups_sent += 1;
    if (event.status === "failed") rollup.failed += 1;
    rollups.set(date, rollup);
  }
  return [...rollups.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function dailyActivityTrends(dailyRollups: DailyActivityRollupSummary[]): DailyActivityTrendSummary[] {
  const chronological = [...dailyRollups].sort((left, right) => left.date.localeCompare(right.date));
  const trends: DailyActivityTrendSummary[] = [];
  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1];
    const current = chronological[index];
    trends.push({
      date: current.date,
      previous_date: previous.date,
      events_delta: current.events - previous.events,
      routed_delta: current.routed - previous.routed,
      queued_delta: current.queued - previous.queued,
      done_delta: current.done - previous.done,
      followups_sent_delta: current.followups_sent - previous.followups_sent,
      failed_delta: current.failed - previous.failed,
    });
  }
  return trends.sort((left, right) => right.date.localeCompare(left.date));
}

function appendRollupLines(lines: string[], rollups: RollupSummary[]): void {
  if (rollups.length === 0) {
    lines.push("- none");
    return;
  }
  for (const rollup of rollups) {
    lines.push(
      `- ${rollup.id} events=${rollup.events} routed=${rollup.routed} queued=${rollup.queued} done=${rollup.done} followups_attempted=${rollup.followups_attempted} followups_sent=${rollup.followups_sent} followups_blocked=${rollup.followups_blocked} failed=${rollup.failed} last=${rollup.last_activity_at}`,
    );
  }
}

function stringDetail(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function maxPendingRestoreAgeMs(events: ActivityEvent[], generatedAt: string): number | null {
  const pending = new Map<string, string>();
  for (const event of events) {
    if (!event.type.startsWith("context_restore_")) continue;
    const id = stringDetail(event.details, "restore_request_id");
    if (!id) continue;
    if (event.type === "context_restore_requested") {
      const existing = pending.get(id);
      if (!existing || event.occurred_at < existing) pending.set(id, event.occurred_at);
    }
    if (event.type === "context_restore_done" || event.type === "context_restore_failed") {
      pending.delete(id);
    }
  }
  if (pending.size === 0) return null;
  const now = new Date(generatedAt).getTime();
  return Math.max(...[...pending.values()].map((occurredAt) => now - new Date(occurredAt).getTime()));
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

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number(input);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFormat(input: string | undefined): DogfoodReviewFormat {
  return input === "json" ? "json" : "text";
}

function parseNonNegativeNumber(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number(input);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function formatCheckValue(value: number | null): string {
  return value === null ? "n/a" : Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runDogfoodReview(dogfoodReviewOptionsFromEnv(process.env));
  process.exitCode = exitCode;
}
