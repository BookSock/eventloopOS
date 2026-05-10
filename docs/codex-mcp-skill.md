# Codex MCP skill — `eventloopos.enqueue_paper`

Phase 7a exposes a single MCP tool that lets a coding agent (Codex CLI, Claude
Code, or any MCP client) self-report "I'm waiting on a human." Calling the tool
posts a paper into the eventloopOS queue, scoped to a task. This replaces the
heuristic Phase 5 file-watcher idleness check for any agent that opts in.

## Tool surface

```
eventloopos.enqueue_paper {
  task_id?:        string,                  // exact eventloopOS task id (preferred)
  task_hint?:      string,                  // matched server-side via taskIdForHint
  body_markdown:   string,                  // the paper body shown to the human
  urgency?:        "low" | "medium" | "high",
  source_kind?:    "agent_done" | "agent_blocked" | "agent_question",
  idempotency_key? string,                  // stable per logical event; agents WILL retry
  title?:          string
} -> { ok: true, event_id, idempotency_key, queue_item_id }
```

Either `task_id` or `task_hint` is required. The orchestrator resolves both via
the existing `taskIdForHint("task_<slug>")` mapper, so passing a real task id or
a hint that matches one will both land the paper on the same queue item.

## Wire it into Codex CLI

Codex's MCP config format moves between releases — check `codex --help` and the
Codex CLI docs for the canonical path. As of this writing, the relevant file is
typically `~/.codex/config.toml` (or `~/.codex/config.json` on older builds).

The eventloopOS orchestrator must be running. Then add:

```toml
[mcp_servers.eventloopos_skill]
command = "node"
args = ["/abs/path/to/eventloopOS/app/orchestrator/dist/src/mcp_sources/eventloopos_skill_server.js"]
env = { EVENTLOOPOS_ORCHESTRATOR_URL = "http://127.0.0.1:4377" }
```

Or, if you prefer the workspace script, point `command` at `pnpm` with
`args = ["--filter", "@eventloopos/orchestrator", "exec", "node",
"dist/src/mcp_sources/eventloopos_skill_server.js"]` and set the
`cwd` to the eventloopOS checkout root.

After restarting Codex, the tool appears as `eventloopos.enqueue_paper` and can
be invoked from any agent loop. Bind a per-machine token via
`EVENTLOOPOS_SKILL_TOKEN` if you want the orchestrator to enforce a Bearer
header (the route currently accepts unauthenticated local requests; the token
is forwarded as `authorization: Bearer <token>` for forward compatibility).
