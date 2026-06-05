# eventloopOS Primitive Examples

Tiny example apps that consume eventloopOS as an API layer instead of using the
full macOS queue product.

Run against a local orchestrator:

```sh
export EVENTLOOPOS_ORCHESTRATOR_URL=http://127.0.0.1:4377
node examples/primitives/restore-my-desk.mjs capture --output /tmp/desk.json
node examples/primitives/restore-my-desk.mjs plan --input /tmp/desk.json
node examples/primitives/discover-primitives.mjs list --category os_control --require-self-tests
node examples/primitives/discover-primitives.mjs list --require-responsive --require-latency-budgets
node examples/primitives/discover-primitives.mjs self-tests --id workspace_control
node examples/primitives/discover-primitives.mjs latency-budgets --require-responsive
node examples/primitives/discover-primitives.mjs proof-plan --id workspace_control --json
node examples/primitives/primitive-workbench-walkthrough.mjs --id workspace_control
node examples/primitives/operation-id-client.mjs list --category os_control
node examples/primitives/operation-id-client.mjs list --side-effect none --read-only
node examples/primitives/operation-id-client.mjs helpers --side-effect os_control
node examples/primitives/operation-id-client.mjs describe workspace_control_get_workspace_status
node examples/primitives/operation-id-client.mjs workspace_control_get_workspace_status --json
node examples/primitives/agent-attention-queue.mjs list
node examples/primitives/window-hotkey-router.mjs claim --task-id task_demo --window-id 123
```

Examples:

- `discover-primitives.mjs`: inspect the primitive catalog, self-test command coverage, latency budgets, and combined proof plans through the shared `@eventloopos/shared/primitives` SDK before choosing which API surfaces to build on. If `app/shared/dist` is missing in a clean checkout, it builds the shared package on demand.
- `primitive-workbench-walkthrough.mjs`: turn selected primitive ids/categories into a starter workbench with prerequisites, proof commands, route operations, side-effect/read-only labels, schemas, and latency budgets through the shared catalog/proof-plan/operation-list helpers, backed by `examples/primitives/fixtures/workbench-catalog.json`.
- `operation-id-client.mjs`: list/describe cataloged operation ids and call any HTTP primitive by stable operation id, with side-effect/read-only filters, path/query/body options, and shared SDK request/response validation.
- `restore-my-desk.mjs`: save, preview, and restore a workspace snapshot.
- `agent-attention-queue.mjs`: list, boost, and defer attention papers.
- `window-hotkey-router.mjs`: attach external hotkeys to task-window claims and follows-window rules.

Each script has `--self-test`; root `pnpm typecheck` checks syntax and self-tests.
`bin/primitives-examples-audit` also keeps live examples on the shared
operation client and rejects hand-rolled fetch/request helpers.
