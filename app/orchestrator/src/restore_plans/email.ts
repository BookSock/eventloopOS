import type { RestorePlanBuilder } from "./registry.js";
import { isRecord, pickAnchor, readUrl, stringFromRecord } from "./helpers.js";

export const buildEmailPlan: RestorePlanBuilder = (resource) => {
  const url = readUrl(resource) ?? buildGmailUrl(resource);
  if (!url) return undefined;
  return {
    kind: "open_email",
    side_effect: "local",
    execute_supported: false,
    url,
    anchor: pickAnchor(resource.details, ["thread_id", "message_id", "account", "subject_hash"]),
  };
};

function buildGmailUrl(resource: Record<string, unknown>): string | undefined {
  const details = isRecord(resource.details) ? resource.details : {};
  const threadId = stringFromRecord(details, "thread_id") ?? stringFromRecord(details, "message_id");
  if (threadId) {
    return `https://mail.google.com/mail/u/0/#all/${threadId}`;
  }
  return undefined;
}
