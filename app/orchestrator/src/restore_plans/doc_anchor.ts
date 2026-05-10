import type { RestorePlanBuilder } from "./registry.js";
import { pickAnchor, readUrl } from "./helpers.js";

export const buildDocAnchorPlan: RestorePlanBuilder = (resource) => {
  const url = readUrl(resource);
  if (!url) return undefined;
  return {
    kind: "open_doc_anchor",
    side_effect: "local",
    execute_supported: false,
    url,
    anchor: pickAnchor(resource.details, ["doc_id", "heading_id", "comment_id", "selection_quote"]),
  };
};
