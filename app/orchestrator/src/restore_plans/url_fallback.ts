import type { RestorePlanBuilder } from "./registry.js";
import { readUrl } from "./helpers.js";

export const buildUrlFallbackPlan: RestorePlanBuilder = (resource) => {
  const url = readUrl(resource);
  if (!url) return undefined;
  return {
    kind: "open_url",
    side_effect: "local",
    execute_supported: false,
    url,
  };
};
