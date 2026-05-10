import type { RestorePlanBuilder } from "./registry.js";
import { pickAnchor, readUrl } from "./helpers.js";

export const buildNotionPagePlan: RestorePlanBuilder = (resource) => {
  const url = readUrl(resource);
  if (!url) return undefined;
  return {
    kind: "open_notion_page",
    side_effect: "local",
    execute_supported: false,
    url,
    anchor: pickAnchor(resource.details, ["page_id", "block_id", "database_id"]),
  };
};
