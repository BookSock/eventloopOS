# MCP Source Config

`mcp-sources.example.json` shows the local config shape for read-only MCP polling.

To use it:

```sh
cp config/mcp-sources.example.json config/mcp-sources.json
ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.json pnpm --filter @eventloopos/orchestrator start
```

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
      "task_hint": "blog feedback",
      "links": [{ "label": "Source", "url": "eventloop://voice/1" }],
      "resources": []
    }
  ]
}
```

`id`, `source_id`, or `url` must exist so the queue can dedupe. `actor`, `links`, `resources`, and `raw_ref` are optional. Keep `riskPolicy.readOnly: true` and `allowWriteTools: false` for MVP polling sources.
