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

The current MVP mappers support Slack-like message items and GitHub-like update items. If an existing MCP server returns a different shape, add a tiny adapter tool or a new mapper before enabling it in the queue.

