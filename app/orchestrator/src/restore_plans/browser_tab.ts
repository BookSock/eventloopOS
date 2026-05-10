import type { RestorePlanBuilder } from "./registry.js";
import { readUrl } from "./helpers.js";

export const buildBrowserTabPlan: RestorePlanBuilder = (resource) => {
  const url = readUrl(resource);
  if (!url) return undefined;
  return {
    kind: "browser_extension_message",
    side_effect: "local",
    execute_supported: false,
    target: "eventloopOS browser extension runtime",
    message: {
      type: "eventloop.restore",
      resource,
    },
  };
};
