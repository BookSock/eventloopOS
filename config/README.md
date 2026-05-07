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

For dogfood without an external service, use the file-backed local events server:

```sh
cp config/local-events.example.json var/local-events.json
EVENTLOOPOS_LOCAL_EVENTS_PATH=var/local-events.json \
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.local-events.example.json \
pnpm run dev:dogfood
```

The `local_events_source` config launches `app/orchestrator/dist/src/mcp_sources/local_events_server.js` over stdio and reads `EVENTLOOPOS_LOCAL_EVENTS_PATH`. It is read-only: edit the JSON file yourself, then run `pnpm --filter @eventloopos/orchestrator run poll:mcp:once` or enable the dogfood poll loop.

For hackable polling, use the script source. This lets Codex write one-off Gmail, X/Twitter, todo, CRM, or website poll scripts without changing orchestrator code:

```sh
pnpm --filter @eventloopos/orchestrator build
EVENTLOOPOS_SCRIPT_EVENTS_COMMAND=node \
EVENTLOOPOS_SCRIPT_EVENTS_ARGS='["scripts/poll-gmail.js","--query","is:unread newer_than:1d"]' \
EVENTLOOPOS_SCRIPT_EVENTS_CURSOR_ARG=--cursor \
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.script-events.example.json \
pnpm --filter @eventloopos/orchestrator start
```

Script stdout must be JSON shaped like `{"items":[...],"nextCursor":"optional"}` or a bare item array. Items should use `generic_item_to_event` fields: `id`, `source`, `type`, `title`, `summary`, optional `url`, `task_hint`, `project_hint`, `links`, and `resources`. Cursor is passed as configured arg and/or env var.

Todo files can use the bundled script source:

```sh
pnpm --filter @eventloopos/orchestrator build
EVENTLOOPOS_SCRIPT_EVENTS_COMMAND=node \
EVENTLOOPOS_SCRIPT_EVENTS_ARGS='["../../scripts/poll-todo-md.mjs"]' \
EVENTLOOPOS_TODO_MD_PATHS='/path/to/first/todo.md,/path/to/second/todo.md' \
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.todo-md.example.json \
pnpm --filter @eventloopos/orchestrator start
```

The todo script emits unchecked markdown tasks (`- [ ] ...`) and `- TODO: ...` lines as generic events. Add `[task:blog feedback]` inside a todo line when it should route to an existing task session.

Inspect configured sources before routing:

```sh
pnpm run mcp:sources
pnpm run mcp:preview
pnpm run mcp:preview local_events_source
```

`mcp:preview` calls the source read-only and does not route events or commit MCP cursors. By default preview output avoids event title/body/summary text so agents can verify source shape without dumping private content into logs. Set `EVENTLOOPOS_MCP_PREVIEW_INCLUDE_TEXT=1` only when you intentionally want raw preview text in terminal output.

Route once when preview looks sane:

```sh
pnpm run mcp:route-once local_events_source
```

For dogfood with Jason's local Slack setup, use the read-only `agent-slack` wrapper:

```sh
pnpm --filter @eventloopos/orchestrator build
EVENTLOOPOS_AGENT_SLACK_QUERY='blog OR launch' \
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.agent-slack.example.json \
pnpm --filter @eventloopos/orchestrator start
```

Then in another shell:

```sh
EVENTLOOPOS_AGENT_SLACK_QUERY='blog OR launch' \
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.agent-slack.example.json \
pnpm --filter @eventloopos/orchestrator run poll:mcp:once
```

Optional filters:

- `EVENTLOOPOS_AGENT_SLACK_WORKSPACE`
- `EVENTLOOPOS_AGENT_SLACK_CHANNELS` as comma-separated channel IDs/names.
- `EVENTLOOPOS_AGENT_SLACK_USER`
- `EVENTLOOPOS_AGENT_SLACK_AFTER` / `EVENTLOOPOS_AGENT_SLACK_BEFORE` as dates.
- `EVENTLOOPOS_AGENT_SLACK_LIMIT`
- `EVENTLOOPOS_AGENT_SLACK_MAX_CONTENT_CHARS`

The wrapper shells out to `agent-slack search messages`, returns only Slack-like read items, and maps them through `slack_message_to_event`. It does not expose Slack send/edit/delete/draft tools to the orchestrator. Keep query/channel filters tight; broad Slack search can be noisy and may return old messages that cursor dedupe then ignores. This config allowlists `PATH`, `HOME`, `XDG_CONFIG_HOME`, and `XDG_RUNTIME_DIR` so the local `agent-slack` binary and local auth files can be found by the child MCP process.

If `EVENTLOOPOS_AGENT_SLACK_AFTER` is unset, the wrapper maps the orchestrator MCP cursor to `agent-slack --after YYYY-MM-DD`. Slack timestamps are more precise than date filters, so same-day messages can be refetched; event idempotency and cursor dedupe remain the exact duplicate guard.

For dogfood with Jason's local GitHub setup, use the read-only `gh` notifications wrapper:

```sh
pnpm --filter @eventloopos/orchestrator build
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.gh-notifications.example.json \
pnpm --filter @eventloopos/orchestrator start
```

Then in another shell:

```sh
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.gh-notifications.example.json \
pnpm --filter @eventloopos/orchestrator run poll:mcp:once
```

Optional filters:

- `EVENTLOOPOS_GH_REPO` as `owner/repo` to poll one repository's notifications.
- `EVENTLOOPOS_GH_PARTICIPATING=false` to include broader watched notifications. Default is `true` to reduce queue noise.
- `EVENTLOOPOS_GH_ALL=true` to include read notifications. Default is unread only.
- `EVENTLOOPOS_GH_SINCE` / `EVENTLOOPOS_GH_BEFORE` as ISO timestamps.
- `EVENTLOOPOS_GH_LIMIT` capped at 50.

The wrapper shells out to `gh api -X GET notifications` or `gh api -X GET repos/<owner>/<repo>/notifications`, returns GitHub-like read items, and maps them through `github_update_to_event`. It does not expose GitHub write tools. If `EVENTLOOPOS_GH_SINCE` is unset, the orchestrator MCP cursor becomes the GitHub `since` timestamp, using notification `updated_at` as the cursor.

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
      "project_hint": "acme",
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

To expose Codex and Claude Code sessions at the same time:

```sh
ORCHESTRATOR_TASK_SESSIONS=codex_app_server,claude_cli \
ORCHESTRATOR_CODEX_TASK_MAP_PATH=config/codex-task-map.json \
ORCHESTRATOR_CLAUDE_SESSIONS='{"claude-session-id":{"task_id":"task_blog_feedback","name":"Blog Claude","cwd":"/path/to/repo"}}' \
pnpm --filter @eventloopos/orchestrator start
```

The composite task-session controller lists both providers through `/task-sessions` and routes followups/bindings to the controller that owns the selected session ID. Use `off` alone to disable task sessions; do not combine `off` with provider modes.
