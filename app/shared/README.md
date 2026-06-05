# Shared Contracts V0

TypeScript package for EventLoopOS public contracts.

## Import

```ts
import { EventSchema, type Event } from "@eventloopos/shared";

const event = EventSchema.parse(input);
```

Exports include Zod schemas, inferred TypeScript types, registry helpers, JSON
Schema generated with `zod-to-json-schema`, and primitive catalog helpers.

Current public route payloads include every route in
`docs/primitives.catalog.json`. The catalog requires a response schema for each
HTTP route, and each mutating route must either declare a request schema or
`no_request_body: true`.

## Primitive Catalog Helpers

```ts
import {
  parsePrimitiveCatalog,
  buildPrimitiveOperationRequest,
  buildPrimitiveProofPlan,
  buildPrimitiveRequest,
  createPrimitiveHttpClient,
  createPrimitiveOperationsClient,
  getPrimitiveOperation,
  getPrimitiveRoute,
  PrimitiveHttpError,
  isPrimitiveHttpError,
  isPrimitiveRequestBuildError,
  isPrimitiveResponseParseError,
  isPrimitiveResponseValidationError,
  isPrimitiveTimeoutError,
  PrimitiveResponseParseError,
  PrimitiveResponseValidationError,
  PrimitiveTimeoutError,
  routeHasRequestBody,
  selectPrimitiveCapabilities,
  selectPrimitiveLatencyBudgets,
  selectPrimitiveSelfTestCommands,
  summarizePrimitiveCatalog
} from "@eventloopos/shared/primitives";

const catalog = parsePrimitiveCatalog(catalogJson);
const route = getPrimitiveRoute(catalog, "POST", "/onboarding/approvals/batch");
const operation = getPrimitiveOperation(catalog, "queue_paper_routing_get_queue_by_id_lineage");
const summary = summarizePrimitiveCatalog(catalog);

console.log(summary.statusCounts);
console.log(summary.categoryCounts);
console.log(summary.primitives.find((primitive) => primitive.id === "workspace_control"));
console.log(selectPrimitiveCapabilities(catalog, {
  categories: ["os_control"],
  statuses: ["stable_enough", "dogfood"],
  requireSelfTests: true,
  requireProofs: true
}));
console.log(selectPrimitiveSelfTestCommands(catalog, ["workspace_control"]));
console.log(selectPrimitiveLatencyBudgets(catalog, { requireResponsivenessCritical: true }));
console.log(buildPrimitiveProofPlan(catalog, { ids: ["workspace_control"] }));
console.log(route?.request_schema);
console.log(operation?.route.path);
console.log(route ? routeHasRequestBody(route) : false);

const request = buildPrimitiveRequest({
  catalog,
  method: "GET",
  path: "/queue/:id/lineage",
  pathParams: { id: "qit_feedback_001" },
  query: { limit: 25 },
  strictQuery: true
});

const requestFromOperation = buildPrimitiveOperationRequest({
  catalog,
  operation: "queue_paper_routing_get_queue_by_id_lineage",
  pathParams: { id: "qit_feedback_001" },
  query: { limit: 25 },
  strictQuery: true
});

const client = createPrimitiveHttpClient({
  catalog,
  baseUrl: "http://127.0.0.1:4377",
  timeoutMs: 5_000
});
const lineage = await client.request("GET", "/queue/:id/lineage", {
  pathParams: { id: "qit_feedback_001" },
  query: { limit: 25 },
  timeoutMs: 1_500
});

const ops = createPrimitiveOperationsClient({
  catalog,
  baseUrl: "http://127.0.0.1:4377",
  timeoutMs: 5_000
});
await ops.queue.done("qit_feedback_001", { actor_id: "human" });
await ops.taskWindowClaims.create({
  task_id: "task_checkout",
  process_root_pid: 4242,
  source: "demo_wrapper"
});
await ops.taskSessions.followup("codex_thread_123", {
  text: "please summarize current blocker"
});
await ops.agents.codex.autoBind();
await ops.agents.claude.inspect("claude_session_123");
await ops.master.fanOut({ message: "summarize status", selector: { idle_min_seconds: 60 } });
await ops.manualMode.set({ active: true, reason: "human_review" });
await ops.readingQueue.autoPromote({ min_age_ms: 900_000 });
await ops.onboarding.scan();
await ops.contexts.nextRestoreRequest();
await ops.triggers.list();
await ops.workspace.restore(workspaceRestoreRequest, "idem_restore_checkout");
```

Use this when building tools on top of eventloopOS primitives without importing
or running the orchestrator server package. Request helpers interpolate route
templates, encode query strings, enforce `no_request_body`, and validate known
request/response schemas through the exported Zod contract registry. By
default, undeclared query keys pass through for forward compatibility; set
`strictQuery: true` in request options to fail fast on typos or unsupported
filters.
`summarizePrimitiveCatalog` returns both global totals and per-primitive
capability rows, including status/category, route count, CLI command count,
self-test count, proof count, and request/response schema coverage, so tools can
pick stable surfaces without parsing prose docs. `selectPrimitiveCapabilities`
filters those rows by primitive id, status, category, minimum route count, CLI
availability, self-test coverage, and proof coverage.
`selectPrimitiveSelfTestCommands` returns selected primitive ids, missing ids,
and de-duplicated runnable self-test commands with the primitive ids each
command covers.
`selectPrimitiveLatencyBudgets` returns the cataloged p95 budget rows and proof
hooks by the same builder-facing primitive filters, so tools can surface or run
responsiveness checks for selected API surfaces.
`buildPrimitiveProofPlan` combines the selected capability rows, missing
primitive ids, de-duplicated self-test commands, and latency proof hooks in one
object for builders that need a single verification plan before using a
primitive subset.
`getPrimitiveOperation` and `buildPrimitiveOperationRequest` resolve the stable
operation ids from `docs/primitives.index.json` back into catalog routes and
validated requests, so generated/LLM-authored builders can call primitives
without hard-coding method/path pairs.
`createPrimitiveOperationsClient` layers small typed convenience methods over
the same validated routes for common master-command, manual-mode,
task-workspace, queue, workspace, task-session, Codex/Claude agent,
task-window-claim, follows-window, reading-queue, onboarding, context-restore,
trigger, MCP/source-hook, voice-command, agent-run, and observability
operations. Shared tests compare those operation helpers against every
cataloged HTTP route so route/helper drift is visible.
The catalog uses `pnpm --filter @eventloopos/shared run test:primitive-ops` as
the command-level self-test for HTTP/API primitives.

The HTTP client exposes catchable error classes for builder-facing tools:

- `PrimitiveHttpError`: non-2xx response, with `status`, `statusText`,
  `payload`, `responseText`, and `route`.
- `PrimitiveRequestBuildError`: invalid local request before fetch, with
  `kind` and optional `parameter`.
- `PrimitiveResponseParseError`: response body was not valid JSON.
- `PrimitiveResponseValidationError`: successful JSON response did not match
  the catalog response schema.
- `PrimitiveTimeoutError`: request exceeded configured timeout, with
  `timeoutMs`.

Guard helpers are exported for each recoverable error class:
`isPrimitiveHttpError`, `isPrimitiveRequestBuildError`,
`isPrimitiveResponseParseError`, `isPrimitiveResponseValidationError`, and
`isPrimitiveTimeoutError`.

```ts
try {
  await client.request("POST", "/onboarding/approvals/batch", { body });
} catch (error) {
  if (isPrimitiveHttpError(error, { status: 409, code: "idempotency_conflict" })) {
    console.log(error.detail);
  }
  if (isPrimitiveRequestBuildError(error, { kind: "missing_path_param" })) {
    console.error(error.parameter);
  }
  if (isPrimitiveTimeoutError(error, { path: "/workspace/capture" })) {
    console.error(error.timeoutMs);
  }
  if (isPrimitiveResponseValidationError(error)) {
    console.error(error.route?.path, error.cause);
  }
}
```

## Local Commands

```bash
pnpm --dir app/shared install
pnpm --dir app/shared test
pnpm --dir app/shared typecheck
pnpm --dir app/shared test:fixtures
pnpm --dir app/shared contracts:json-schema
```

Future root infra can map `make test:contracts` to `pnpm --dir app/shared test && pnpm --dir app/shared test:fixtures`.
