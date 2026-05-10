import type { RestorePlanBuilder } from "./registry.js";

export const buildFilePlan: RestorePlanBuilder = (resource) => {
  const path = typeof resource.path === "string" && resource.path ? resource.path : undefined;
  if (!path) return undefined;
  return {
    kind: "open_file",
    side_effect: "local",
    execute_supported: false,
    path,
    line: resource.line,
    column: resource.column,
  };
};
