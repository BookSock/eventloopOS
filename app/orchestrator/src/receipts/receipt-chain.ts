import { createHash } from "node:crypto";

export type RawRef = {
  id: string;
  kind: string;
  uri: string;
  sha256?: string;
};

export type EvidenceReceiptActionType =
  | "source_poll"
  | "event_normalize"
  | "task_message"
  | "workspace_restore"
  | "test_run"
  | "browser_capture"
  | "external_draft"
  | "external_send";

export type EvidenceReceipt = {
  id: string;
  action_type: EvidenceReceiptActionType;
  actor_id: string;
  input_hash: string;
  output_hash?: string;
  previous_receipt_hash?: string;
  artifact_refs: RawRef[];
  created_at: string;
};

export type BuildEvidenceReceiptInput = {
  id?: string;
  action_type: EvidenceReceiptActionType;
  actor_id: string;
  input: unknown;
  output?: unknown;
  previous_receipt?: EvidenceReceipt;
  artifact_refs?: RawRef[];
  created_at?: string;
};

export type ReceiptBackedClaim = {
  claim: string;
  required_action_type: EvidenceReceiptActionType;
  receipt_ids: string[];
};

export function buildEvidenceReceipt(input: BuildEvidenceReceiptInput): EvidenceReceipt {
  const previousReceiptHash = input.previous_receipt ? hashReceipt(input.previous_receipt) : undefined;

  return {
    id: input.id ?? `rcpt_${hashStableJson([input.action_type, input.actor_id, input.input, input.created_at]).slice(0, 16)}`,
    action_type: input.action_type,
    actor_id: input.actor_id,
    input_hash: hashStableJson(input.input),
    output_hash: input.output === undefined ? undefined : hashStableJson(input.output),
    previous_receipt_hash: previousReceiptHash,
    artifact_refs: input.artifact_refs ?? [],
    created_at: input.created_at ?? new Date().toISOString(),
  };
}

export function hashReceipt(receipt: EvidenceReceipt): string {
  return hashStableJson(receipt);
}

export function hashStableJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function claimHasRequiredReceipt(claim: ReceiptBackedClaim, receipts: EvidenceReceipt[]): boolean {
  const receiptsById = new Map(receipts.map((receipt) => [receipt.id, receipt]));

  return claim.receipt_ids.some((receiptId) => receiptsById.get(receiptId)?.action_type === claim.required_action_type);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
