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
  getPrimitiveRoute,
  routeHasRequestBody,
  summarizePrimitiveCatalog
} from "@eventloopos/shared/primitives";

const catalog = parsePrimitiveCatalog(catalogJson);
const route = getPrimitiveRoute(catalog, "POST", "/onboarding/approvals/batch");

console.log(summarizePrimitiveCatalog(catalog));
console.log(route?.request_schema);
console.log(route ? routeHasRequestBody(route) : false);
```

Use this when building tools on top of eventloopOS primitives without importing
or running the orchestrator server package.

## Local Commands

```bash
pnpm --dir app/shared install
pnpm --dir app/shared test
pnpm --dir app/shared typecheck
pnpm --dir app/shared test:fixtures
pnpm --dir app/shared contracts:json-schema
```

Future root infra can map `make test:contracts` to `pnpm --dir app/shared test && pnpm --dir app/shared test:fixtures`.
