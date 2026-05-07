import type { InMemoryStore } from "../store.js";

export type ContextRestoreRequestStatus = "pending" | "leased" | "done" | "failed";

export type ContextRestoreRequestRecord = {
  id: string;
  status: ContextRestoreRequestStatus;
  created_at: string;
  updated_at: string;
  idempotency_key?: string;
  resource: Record<string, unknown>;
  restore_plan: Record<string, unknown>;
  result?: unknown;
  lease_owner?: string;
  lease_expires_at?: string;
};

export function createContextRestoreRequest(
  store: InMemoryStore,
  request: Omit<ContextRestoreRequestRecord, "status" | "created_at" | "updated_at">,
  now: Date,
): { record: ContextRestoreRequestRecord; inserted: boolean } {
  if (request.idempotency_key) {
    const existingId = store.contextRestoreRequestIdsByIdempotencyKey.get(request.idempotency_key);
    const existing = existingId ? store.contextRestoreRequests.get(existingId) : undefined;
    if (existing) {
      return { record: existing, inserted: false };
    }
  }

  const timestamp = now.toISOString();
  const record: ContextRestoreRequestRecord = {
    ...request,
    status: "pending",
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.contextRestoreRequests.set(record.id, record);
  if (record.idempotency_key) {
    store.contextRestoreRequestIdsByIdempotencyKey.set(record.idempotency_key, record.id);
  }

  return { record, inserted: true };
}

export function claimNextContextRestoreRequest(
  store: InMemoryStore,
  leaseOwner: string,
  now: Date,
  leaseMs: number,
): ContextRestoreRequestRecord | undefined {
  reapExpiredContextRestoreRequestLeases(store, now);
  const record = peekNextContextRestoreRequest(store, now);

  if (!record) return undefined;

  record.status = "leased";
  record.lease_owner = leaseOwner;
  record.lease_expires_at = new Date(now.getTime() + leaseMs).toISOString();
  record.updated_at = now.toISOString();
  return record;
}

export function peekNextContextRestoreRequest(
  store: InMemoryStore,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  reapExpiredContextRestoreRequestLeases(store, now);
  return Array.from(store.contextRestoreRequests.values())
    .filter((candidate) => candidate.status === "pending")
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))[0];
}

export function getContextRestoreRequest(
  store: InMemoryStore,
  restoreRequestId: string,
): ContextRestoreRequestRecord | undefined {
  return store.contextRestoreRequests.get(restoreRequestId);
}

export function markContextRestoreRequestDone(
  store: InMemoryStore,
  restoreRequestId: string,
  result: unknown,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  const record = store.contextRestoreRequests.get(restoreRequestId);
  if (!record) return undefined;

  record.status = "done";
  record.updated_at = now.toISOString();
  record.result = result;
  record.lease_owner = undefined;
  record.lease_expires_at = undefined;
  return record;
}

export function markContextRestoreRequestFailed(
  store: InMemoryStore,
  restoreRequestId: string,
  result: unknown,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  const record = store.contextRestoreRequests.get(restoreRequestId);
  if (!record) return undefined;

  record.status = "failed";
  record.updated_at = now.toISOString();
  record.result = result;
  record.lease_owner = undefined;
  record.lease_expires_at = undefined;
  return record;
}

export function retryContextRestoreRequest(
  store: InMemoryStore,
  restoreRequestId: string,
  now: Date,
): ContextRestoreRequestRecord | undefined {
  const record = store.contextRestoreRequests.get(restoreRequestId);
  if (!record) return undefined;

  record.status = "pending";
  record.updated_at = now.toISOString();
  record.result = undefined;
  record.lease_owner = undefined;
  record.lease_expires_at = undefined;
  return record;
}

export function reapExpiredContextRestoreRequestLeases(store: InMemoryStore, now: Date): number {
  let reaped = 0;
  for (const record of store.contextRestoreRequests.values()) {
    if (record.status !== "leased" || !record.lease_expires_at) continue;
    if (new Date(record.lease_expires_at).getTime() > now.getTime()) continue;

    record.status = "pending";
    record.lease_owner = undefined;
    record.lease_expires_at = undefined;
    record.updated_at = now.toISOString();
    reaped += 1;
  }
  return reaped;
}
