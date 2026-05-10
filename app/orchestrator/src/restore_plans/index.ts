import { buildBrowserTabPlan } from "./browser_tab.js";
import { buildDocAnchorPlan } from "./doc_anchor.js";
import { buildEmailPlan } from "./email.js";
import { buildFilePlan } from "./file.js";
import { buildNotionPagePlan } from "./notion_page.js";
import { buildPaperPlan } from "./paper.js";
import { RestorePlanRegistry, type RestorePlan, type RestorePlanResource } from "./registry.js";
import { buildSlackThreadPlan } from "./slack_thread.js";
import { buildUrlFallbackPlan } from "./url_fallback.js";

export type { RestorePlan, RestorePlanBuilder, RestorePlanResource } from "./registry.js";
export { RestorePlanRegistry } from "./registry.js";

export function createDefaultRestorePlanRegistry(): RestorePlanRegistry {
  const registry = new RestorePlanRegistry();
  registry.register("browser_tab", buildBrowserTabPlan);
  registry.register("slack_thread", buildSlackThreadPlan);
  registry.register("gmail_thread", buildEmailPlan);
  registry.register("email", buildEmailPlan);
  registry.register("notion_page", buildNotionPagePlan);
  registry.register("google_doc", buildDocAnchorPlan);
  registry.register("doc_anchor", buildDocAnchorPlan);
  registry.register("file", buildFilePlan);
  registry.register("paper", buildPaperPlan);
  registry.registerFallback(buildUrlFallbackPlan);
  return registry;
}

const defaultRegistry = createDefaultRestorePlanRegistry();

export function buildContextRestorePlan(resource: RestorePlanResource, registry: RestorePlanRegistry = defaultRegistry): RestorePlan | undefined {
  return registry.build(resource);
}

const BROWSER_RESTORE_PLAN_KINDS = new Set([
  "browser_extension_message",
  "open_slack_thread",
  "open_email",
  "open_notion_page",
  "open_doc_anchor",
]);

export function wrapPlanForBrowserExtension(
  plan: RestorePlan,
  resource: RestorePlanResource,
): RestorePlan | undefined {
  const kind = typeof plan.kind === "string" ? plan.kind : undefined;
  if (!kind || !BROWSER_RESTORE_PLAN_KINDS.has(kind)) return undefined;
  if (kind === "browser_extension_message") return plan;

  const anchor = isRecord(plan.anchor) ? plan.anchor : undefined;
  const url = typeof plan.url === "string" ? plan.url : undefined;
  return {
    kind: "browser_extension_message",
    side_effect: "local",
    execute_supported: false,
    target: "eventloopOS browser extension runtime",
    plan_kind: kind,
    message: {
      type: "eventloop.restore",
      resource: {
        ...resource,
        ...(url ? { url } : {}),
        anchor,
        plan_kind: kind,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
