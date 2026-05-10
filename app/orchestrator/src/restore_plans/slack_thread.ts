import type { RestorePlanBuilder } from "./registry.js";
import { isRecord, pickAnchor, readUrl, stringFromRecord } from "./helpers.js";

export const buildSlackThreadPlan: RestorePlanBuilder = (resource) => {
  const url = readUrl(resource) ?? buildSlackUrl(resource);
  if (!url) return undefined;
  return {
    kind: "open_slack_thread",
    side_effect: "local",
    execute_supported: false,
    url,
    anchor: pickAnchor(resource.details, ["thread_ts", "message_ts", "channel_id", "workspace_id", "team_id"]),
  };
};

function buildSlackUrl(resource: Record<string, unknown>): string | undefined {
  const details = isRecord(resource.details) ? resource.details : {};
  const team = stringFromRecord(details, "team_domain") ?? stringFromRecord(details, "workspace_domain");
  const channel = stringFromRecord(details, "channel_id");
  const ts = stringFromRecord(details, "message_ts") ?? stringFromRecord(details, "thread_ts");
  if (team && channel && ts) {
    const tsCompact = ts.replace(".", "").replace(/[^0-9]/g, "");
    return `https://${team}.slack.com/archives/${channel}/p${tsCompact}`;
  }
  return undefined;
}
