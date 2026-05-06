export const RUN_STATUSES = Object.freeze([
  "queued",
  "running",
  "blocked",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const TASK_MESSAGE_MODES = Object.freeze([
  "steer",
  "followup",
  "collect",
  "steer_backlog",
  "interrupt",
]);

export function isoNow(clock = () => new Date()) {
  return clock().toISOString();
}

export function makeEvidenceRef({ id, kind = "raw", title, ref, captured_at }) {
  return {
    id,
    kind,
    title,
    ref,
    captured_at,
  };
}

export function makeRawRef({ id, uri, mime_type = "application/jsonl" }) {
  return {
    id,
    uri,
    mime_type,
  };
}

export function makeAction({ id, type, label, payload = {}, requires_approval = false }) {
  return {
    id,
    type,
    label,
    payload,
    requires_approval,
  };
}
