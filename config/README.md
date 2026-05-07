# MCP Source Config

`mcp-sources.example.json` shows the local config shape for read-only MCP polling.

To use it:

```sh
cp config/mcp-sources.example.json config/mcp-sources.json
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.json pnpm --filter @eventloopos/orchestrator start
```

`pnpm run dev:doctor` validates this file when `ORCHESTRATOR_MCP_SOURCES_PATH` is set or `config/mcp-sources.json` exists. Missing default config is treated as optional; malformed configured JSON fails the readiness report.
Paths like `config/mcp-sources.json` are resolved from the repo root even when `pnpm --filter` runs the orchestrator from `app/orchestrator`.

Each source is expected to call one read-only MCP tool that returns:

```json
{
  "items": [],
  "nextCursor": "optional-cursor"
}
```

The current MVP mappers support Slack-like message items, GitHub-like update items, and generic event-ish items.

Use `generic_item_to_event` when a local MCP server can return items shaped like:

```json
{
  "items": [
    {
      "id": "stable-source-item-id",
      "source": "voice_note",
      "type": "voice.priority_hint",
      "title": "Blog launch detail now matters",
      "summary": "Blog post should mention launch in two weeks.",
      "occurred_at": "2026-05-06T17:03:00Z",
      "project_hint": "pagerfree",
      "links": [{ "label": "Source", "url": "eventloop://voice/1" }],
      "resources": []
    }
  ]
}
```

`id`, `source_id`, or `url` must exist so the queue can dedupe. `actor`, `links`, `resources`, `raw_ref`, `project_hint`, and `task_hint` are optional. If `task_hint` is absent, the ambient router can still inject the event into a running task session when stored task-bound browser/Slack/GitHub context is a clear match. Keep `riskPolicy.readOnly: true` and `allowWriteTools: false` for MVP polling sources.

## Codex Task Map

`codex-task-map.example.json` maps local Codex app-server thread IDs to eventloopOS task IDs. Use this when a master agent needs to route incoming MCP/voice/browser events into an already-running Codex thread without relying on a title marker.

```sh
cp config/codex-task-map.example.json config/codex-task-map.json
ORCHESTRATOR_TASK_SESSIONS=codex_app_server \
ORCHESTRATOR_CODEX_TASK_MAP_PATH=config/codex-task-map.json \
pnpm --filter @eventloopos/orchestrator start
```

Repo-root relative task-map paths are resolved the same way as MCP source config paths.

The orchestrator reads this file on each task-session lookup. A master agent can update it while the daemon runs, then the next `/task-sessions` call sees the new binding. File entries override `ORCHESTRATOR_CODEX_TASK_MAP`; thread title/preview tags like `[task:blog feedback]` remain fallback.

When the map path is configured, agents can bind through HTTP instead of editing JSON directly:

```sh
curl -X PUT http://127.0.0.1:4377/task-sessions/<task-session-id>/task-binding \
  -H 'content-type: application/json' \
  -d '{"task_id":"task_blog_feedback"}'
```
