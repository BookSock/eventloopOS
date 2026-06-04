# Shared Contracts V0

TypeScript package for EventLoopOS public contracts.

## Import

```ts
import { EventSchema, type Event } from "@eventloopos/shared";

const event = EventSchema.parse(input);
```

Exports include Zod schemas, inferred TypeScript types, registry helpers, and JSON Schema generated with `zod-to-json-schema`.

Current public route payloads include task-window claims and follows-window
exclusion rules. These are the reusable primitives behind background-agent
window attribution and sticky-window cleanup.

## Local Commands

```bash
pnpm --dir app/shared install
pnpm --dir app/shared test
pnpm --dir app/shared typecheck
pnpm --dir app/shared test:fixtures
pnpm --dir app/shared contracts:json-schema
```

Future root infra can map `make test:contracts` to `pnpm --dir app/shared test && pnpm --dir app/shared test:fixtures`.
