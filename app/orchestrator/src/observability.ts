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
  incrementCounter(name: string, by?: number): void;
  recordActivity(input: Omit<ActivityEvent, "id">): ActivityEvent;
  listActivity(limit?: number): ActivityEvent[];
  snapshot(): MetricsSnapshot;
};

export class InMemoryObservability implements Observability {
  private readonly counters = new Map<string, number>();
  private readonly activities: ActivityEvent[] = [];

  constructor(private readonly maxActivities = 1_000) {}

  incrementCounter(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  recordActivity(input: Omit<ActivityEvent, "id">): ActivityEvent {
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

  listActivity(limit = 100): ActivityEvent[] {
    return this.activities.slice(-limit).reverse();
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries([...this.counters.entries()].sort(([left], [right]) => left.localeCompare(right))),
      activity_count: this.activities.length,
    };
  }
}

export function createInMemoryObservability(): Observability {
  return new InMemoryObservability();
}
