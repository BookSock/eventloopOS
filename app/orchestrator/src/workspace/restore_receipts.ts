import type { RestoreExecutionReceipt, RestorePlan } from "./aerospace.js";

export type WorkspaceRestoreReceiptRecord = {
  id: string;
  idempotency_key: string;
  plan: RestorePlan;
  receipt: RestoreExecutionReceipt;
  created_at: string;
};
