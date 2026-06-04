import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GatewayStore } from "./gateway_store.js";
import type { InMemoryStore } from "./store.js";

const MAP_KEYS = [
  "reviewPackets",
  "eventsByIdempotencyKey",
  "eventsById",
  "contextRestoreRequests",
  "contextRestoreRequestIdsByIdempotencyKey",
  "agentRuns",
  "workspaceRestoreReceipts",
  "mcpPollStates",
  "taskMessagesByIdempotencyKey",
  "taskWorkspaceSnapshots",
  "queueActionAttempts",
  "taskSessionTerminalRefs",
  "onboardingRejections",
  "onboardingApprovalBatches",
  "tasks",
  "taskLayouts",
  "windowWorkspaceObservations",
  "followsWindowExclusions",
  "taskWindowClaims",
  "paperTriggers",
  "paperTriggerFirings",
] as const;

type MapKey = typeof MAP_KEYS[number];
type SerializedStore = Omit<Partial<InMemoryStore>, MapKey> & {
  schema_version: 1;
} & {
  [key in MapKey]?: Array<[string, unknown]>;
};

export async function loadOrCreatePersistentInMemoryStore(
  statePath: string,
  createFallback: () => Promise<InMemoryStore>,
): Promise<InMemoryStore> {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as SerializedStore;
    return deserializeStore(parsed);
  } catch (error) {
    if (isMissingFile(error)) return createFallback();
    throw error;
  }
}

export function withStorePersistence<T extends GatewayStore>(
  gatewayStore: T,
  inMemoryStore: InMemoryStore,
  statePath: string,
): T {
  let persistQueue = Promise.resolve();
  const persist = async () => {
    const next = persistQueue.then(() => savePersistentInMemoryStore(statePath, inMemoryStore));
    persistQueue = next.catch(() => undefined);
    await next;
  };

  return new Proxy(gatewayStore, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function" || !shouldPersistAfter(property)) {
        return value;
      }

      return async (...args: unknown[]) => {
        const result = await value.apply(target, args);
        await persist();
        return result;
      };
    },
  });
}

export async function savePersistentInMemoryStore(statePath: string, store: InMemoryStore): Promise<void> {
  const serialized = serializeStore(store);
  await mkdir(dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(serialized, null, 2)}\n`);
  await rename(tempPath, statePath);
}

function shouldPersistAfter(methodName: string): boolean {
  return /^(lease|renew|mark|defer|ignore|bump|save|create|claim|ingest|record|finalize|set|clear|update|delete|retry|upsert|tryRegister|wake|prune)/.test(
    methodName,
  );
}

function serializeStore(store: InMemoryStore): SerializedStore {
  const serialized: SerializedStore = {
    schema_version: 1,
    queue: store.queue,
    manualModeState: store.manualModeState,
    currentTaskState: store.currentTaskState,
  };

  for (const key of MAP_KEYS) {
    const value = store[key] as Map<string, unknown> | undefined;
    if (value instanceof Map) {
      serialized[key] = Array.from(value.entries());
    }
  }

  return serialized;
}

function deserializeStore(serialized: SerializedStore): InMemoryStore {
  const store: InMemoryStore = {
    queue: serialized.queue ?? [],
    reviewPackets: mapFromSerialized(serialized.reviewPackets) as InMemoryStore["reviewPackets"],
    eventsByIdempotencyKey: mapFromSerialized(serialized.eventsByIdempotencyKey) as InMemoryStore["eventsByIdempotencyKey"],
    eventsById: mapFromSerialized(serialized.eventsById) as InMemoryStore["eventsById"],
    contextRestoreRequests: mapFromSerialized(serialized.contextRestoreRequests) as InMemoryStore["contextRestoreRequests"],
    contextRestoreRequestIdsByIdempotencyKey: mapFromSerialized(serialized.contextRestoreRequestIdsByIdempotencyKey) as InMemoryStore["contextRestoreRequestIdsByIdempotencyKey"],
  };

  for (const key of MAP_KEYS) {
    if (key in store) continue;
    const serializedMap = serialized[key];
    if (serializedMap) {
      (store as unknown as Record<MapKey, Map<string, unknown>>)[key] = mapFromSerialized(serializedMap);
    }
  }

  store.manualModeState = serialized.manualModeState;
  store.currentTaskState = serialized.currentTaskState;
  return store;
}

function mapFromSerialized<T>(entries: Array<[string, T]> | undefined): Map<string, T> {
  return new Map(entries ?? []);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
