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
  buildPrimitiveRequest,
  createPrimitiveHttpClient,
  createPrimitiveOperationsClient,
  getPrimitiveRoute,
  PrimitiveHttpError,
  PrimitiveResponseParseError,
  PrimitiveResponseValidationError,
  routeHasRequestBody,
  summarizePrimitiveCatalog
} from "@eventloopos/shared/primitives";

const catalog = parsePrimitiveCatalog(catalogJson);
const route = getPrimitiveRoute(catalog, "POST", "/onboarding/approvals/batch");

console.log(summarizePrimitiveCatalog(catalog));
console.log(route?.request_schema);
console.log(route ? routeHasRequestBody(route) : false);

const request = buildPrimitiveRequest({
  catalog,
  method: "GET",
  path: "/queue/:id/lineage",
  pathParams: { id: "qit_feedback_001" },
  query: { limit: 25 }
});

const client = createPrimitiveHttpClient({
  catalog,
  baseUrl: "http://127.0.0.1:4377"
});
const lineage = await client.request("GET", "/queue/:id/lineage", {
  pathParams: { id: "qit_feedback_001" },
  query: { limit: 25 }
});

const ops = createPrimitiveOperationsClient({
  catalog,
  baseUrl: "http://127.0.0.1:4377"
});
await ops.queue.done("qit_feedback_001", { actor_id: "human" });
await ops.taskWindowClaims.create({
  task_id: "task_checkout",
  process_root_pid: 4242,
  source: "demo_wrapper"
});
await ops.workspace.restore(workspaceRestoreRequest, "idem_restore_checkout");
```

Use this when building tools on top of eventloopOS primitives without importing
or running the orchestrator server package. Request helpers interpolate route
templates, encode query strings, enforce `no_request_body`, and validate known
request/response schemas through the exported Zod contract registry.
`createPrimitiveOperationsClient` layers small typed convenience methods over
the same validated routes for common queue, workspace, task-window-claim, and
follows-window operations.

The HTTP client exposes catchable error classes for builder-facing tools:

- `PrimitiveHttpError`: non-2xx response, with `status`, `statusText`,
  `payload`, `responseText`, and `route`.
- `PrimitiveResponseParseError`: response body was not valid JSON.
- `PrimitiveResponseValidationError`: successful JSON response did not match
  the catalog response schema.

```ts
try {
  await client.request("POST", "/onboarding/approvals/batch", { body });
} catch (error) {
  if (error instanceof PrimitiveHttpError && error.status === 409) {
    console.log(error.payload);
  }
  if (error instanceof PrimitiveResponseValidationError) {
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
