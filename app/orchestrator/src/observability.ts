import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";

export type ActivityActor = "system" | "human" | "agent";
export type ActivityStatus = "ok" | "failed" | "blocked";

export type ActivityEvent = {
  id: string;
  type: string;
  occurred_at: string;
  actor: ActivityActor;
  task_id?: string;
  queue_item_id?: string;
  event_id?: string;
  task_session_id?: string;
  source_id?: string;
  status?: ActivityStatus;
  summary: string;
  details: Record<string, unknown>;
};

export type MetricsSnapshot = {
  counters: Record<string, number>;
  activity_count: number;
};

export type Observability = {
  incrementCounter(name: string, by?: number): Promise<void>;
  recordActivity(input: Omit<ActivityEvent, "id">): Promise<ActivityEvent>;
  listActivity(limit?: number): Promise<ActivityEvent[]>;
  snapshot(): Promise<MetricsSnapshot>;
};

export class InMemoryObservability implements Observability {
  private readonly counters = new Map<string, number>();
  private readonly activities: ActivityEvent[] = [];

  constructor(private readonly maxActivities = 1_000) {}

  async incrementCounter(name: string, by = 1): Promise<void> {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  async recordActivity(input: Omit<ActivityEvent, "id">): Promise<ActivityEvent> {
    const event: ActivityEvent = {
      id: `actv_${this.activities.length + 1}`,
      ...input,
    };
    this.activities.push(event);
    if (this.activities.length > this.maxActivities) {
      this.activities.splice(0, this.activities.length - this.maxActivities);
    }
    return event;
  }

  async listActivity(limit = 100): Promise<ActivityEvent[]> {
    return this.activities.slice(-limit).reverse();
  }

  async snapshot(): Promise<MetricsSnapshot> {
    return {
      counters: Object.fromEntries([...this.counters.entries()].sort(([left], [right]) => left.localeCompare(right))),
      activity_count: this.activities.length,
    };
  }
}

export function createInMemoryObservability(): Observability {
  return new InMemoryObservability();
}

export class PostgresObservability implements Observability {
  constructor(
    private readonly pool: Pool,
    private readonly idFactory: () => string = () => `actv_${randomUUID()}`,
  ) {}

  async incrementCounter(name: string, by = 1): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO metric_counters (name, value, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (name)
        DO UPDATE SET
          value = metric_counters.value + EXCLUDED.value,
          updated_at = now()
      `,
      [name, by],
    );
  }

  async recordActivity(input: Omit<ActivityEvent, "id">): Promise<ActivityEvent> {
    const event: ActivityEvent = {
      id: this.idFactory(),
      ...input,
    };

    await this.pool.query(
      `
        INSERT INTO activity_events (
          id,
          type,
          occurred_at,
          actor,
          task_id,
          queue_item_id,
          event_id,
          task_session_id,
          source_id,
          status,
          summary,
          details
        )
        VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `,
      [
        event.id,
        event.type,
        event.occurred_at,
        event.actor,
        event.task_id ?? null,
        event.queue_item_id ?? null,
        event.event_id ?? null,
        event.task_session_id ?? null,
        event.source_id ?? null,
        event.status ?? null,
        event.summary,
        JSON.stringify(event.details),
      ],
    );

    return event;
  }

  async listActivity(limit = 100): Promise<ActivityEvent[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM activity_events
        ORDER BY occurred_at DESC, id DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map(rowToActivityEvent);
  }

  async snapshot(): Promise<MetricsSnapshot> {
    const [counters, count] = await Promise.all([
      this.pool.query("SELECT name, value FROM metric_counters ORDER BY name ASC"),
      this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM activity_events"),
    ]);

    return {
      counters: Object.fromEntries(counters.rows.map((row: { name: string; value: string | number }) => [
        row.name,
        Number(row.value),
      ])),
      activity_count: Number(count.rows[0]?.count ?? 0),
    };
  }
}

function rowToActivityEvent(row: QueryResultRow): ActivityEvent {
  return {
    id: String(row.id),
    type: String(row.type),
    occurred_at: toIsoString(row.occurred_at),
    actor: row.actor as ActivityActor,
    task_id: optionalString(row.task_id),
    queue_item_id: optionalString(row.queue_item_id),
    event_id: optionalString(row.event_id),
    task_session_id: optionalString(row.task_session_id),
    source_id: optionalString(row.source_id),
    status: row.status ? row.status as ActivityStatus : undefined,
    summary: String(row.summary),
    details: isRecord(row.details) ? row.details : {},
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
