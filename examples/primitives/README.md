# eventloopOS Primitive Examples

Tiny example apps that consume eventloopOS as an API layer instead of using the
full macOS queue product.

Run against a local orchestrator:

```sh
export EVENTLOOPOS_ORCHESTRATOR_URL=http://127.0.0.1:4377
node examples/primitives/restore-my-desk.mjs capture --output /tmp/desk.json
node examples/primitives/restore-my-desk.mjs plan --input /tmp/desk.json
node examples/primitives/agent-attention-queue.mjs list
node examples/primitives/window-hotkey-router.mjs claim --task-id task_demo --window-id 123
```

Examples:

- `restore-my-desk.mjs`: save, preview, and restore a workspace snapshot.
- `agent-attention-queue.mjs`: list, boost, and defer attention papers.
- `window-hotkey-router.mjs`: attach external hotkeys to task-window claims and follows-window rules.

Each script has `--self-test`; root `pnpm typecheck` checks syntax and self-tests.
