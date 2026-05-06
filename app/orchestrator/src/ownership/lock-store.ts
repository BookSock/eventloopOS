export type EvidenceRef = {
  id: string;
  kind: string;
  title: string;
  url?: string;
};

export type OwnershipLockKind = "route" | "draft" | "send" | "workspace" | "poll";

export type OwnershipLock = {
  id: string;
  resource_key: string;
  owner_task_id?: string;
  owner_agent_run_id?: string;
  lock_kind: OwnershipLockKind;
  lease_expires_at?: string;
  evidence: EvidenceRef[];
  created_at: string;
  updated_at: string;
};

export type OwnershipConflict = {
  resource_key: string;
  lock_kind: OwnershipLockKind;
  requested_owner_task_id?: string;
  requested_owner_agent_run_id?: string;
  active_lock: OwnershipLock;
};

export type AcquireOwnershipLockInput = {
  resource_key: string;
  owner_task_id?: string;
  owner_agent_run_id?: string;
  lock_kind: OwnershipLockKind;
  lease_expires_at?: string;
  evidence?: EvidenceRef[];
};

export type AcquireOwnershipLockResult =
  | {
      status: "acquired" | "renewed";
      lock: OwnershipLock;
    }
  | {
      status: "conflict";
      conflict: OwnershipConflict;
    };

export type OwnershipLockStoreOptions = {
  now?: () => Date;
  idFactory?: () => string;
};

export class InMemoryOwnershipLockStore {
  private readonly locks = new Map<string, OwnershipLock>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private nextId = 1;

  constructor(options: OwnershipLockStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `own_${this.nextId++}`);
  }

  acquire(input: AcquireOwnershipLockInput): AcquireOwnershipLockResult {
    const timestamp = this.now().toISOString();
    const activeLock = this.findActiveLock(input.resource_key, input.lock_kind);

    if (activeLock && !sameOwner(activeLock, input)) {
      return {
        status: "conflict",
        conflict: {
          resource_key: input.resource_key,
          lock_kind: input.lock_kind,
          requested_owner_task_id: input.owner_task_id,
          requested_owner_agent_run_id: input.owner_agent_run_id,
          active_lock: activeLock,
        },
      };
    }

    if (activeLock) {
      const renewedLock: OwnershipLock = {
        ...activeLock,
        lease_expires_at: input.lease_expires_at ?? activeLock.lease_expires_at,
        evidence: mergeEvidence(activeLock.evidence, input.evidence ?? []),
        updated_at: timestamp,
      };
      this.locks.set(renewedLock.id, renewedLock);

      return { status: "renewed", lock: renewedLock };
    }

    const lock: OwnershipLock = {
      id: this.idFactory(),
      resource_key: input.resource_key,
      owner_task_id: input.owner_task_id,
      owner_agent_run_id: input.owner_agent_run_id,
      lock_kind: input.lock_kind,
      lease_expires_at: input.lease_expires_at,
      evidence: input.evidence ?? [],
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.locks.set(lock.id, lock);

    return { status: "acquired", lock };
  }

  getActiveLock(resourceKey: string, lockKind: OwnershipLockKind): OwnershipLock | undefined {
    return this.findActiveLock(resourceKey, lockKind);
  }

  listActive(): OwnershipLock[] {
    return [...this.locks.values()].filter((lock) => !this.isExpired(lock));
  }

  release(lockId: string): boolean {
    return this.locks.delete(lockId);
  }

  private findActiveLock(resourceKey: string, lockKind: OwnershipLockKind): OwnershipLock | undefined {
    for (const lock of this.locks.values()) {
      if (lock.resource_key === resourceKey && lock.lock_kind === lockKind && !this.isExpired(lock)) {
        return lock;
      }
    }

    return undefined;
  }

  private isExpired(lock: OwnershipLock): boolean {
    if (!lock.lease_expires_at) {
      return false;
    }

    return Date.parse(lock.lease_expires_at) <= this.now().getTime();
  }
}

function sameOwner(lock: OwnershipLock, input: AcquireOwnershipLockInput): boolean {
  return lock.owner_task_id === input.owner_task_id && lock.owner_agent_run_id === input.owner_agent_run_id;
}

function mergeEvidence(existing: EvidenceRef[], next: EvidenceRef[]): EvidenceRef[] {
  const byId = new Map(existing.map((evidence) => [evidence.id, evidence]));

  for (const evidence of next) {
    byId.set(evidence.id, evidence);
  }

  return [...byId.values()];
}
