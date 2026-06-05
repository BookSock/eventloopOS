# MCP Source Hooks

MCP source hooks let local or third-party event sources create eventloopOS
papers without taking over the desktop. A source can be Slack, GitHub
notifications, Gmail through `gws`, a local JSON file, a todo markdown file, or
any read-only script that returns items.

## Safety Model

Source templates are intentionally read-only.

- Config files list environment variable names, not secret values.
- `riskPolicy.readOnly` must be `true`.
- `riskPolicy.allowWriteTools` must be `false`.
- `riskPolicy.maxRiskLevel` must be `low`.
- `riskPolicy.untrustedTextFields` must name fields that can contain user or
  internet text.
- stderr logs stay under `var/log/mcp/*.stderr.log`.
- poll timeouts are bounded at 30 seconds or less.

Run this before committing template changes:

```sh
node bin/mcp-source-templates-audit
```

Root `pnpm typecheck` runs the same audit, plus the audit self-test.
`pnpm primitives:doctor` runs `node bin/mcp-source-templates-audit --include-local`,
so a present local `config/mcp-sources.json` is also checked before calling a
host ready for builders or dogfood.

## Configure

Copy an example into the live local config:

```sh
cp config/mcp-sources.dogfood.example.json config/mcp-sources.json
```

Then set only external environment variables needed by that source. Do not put
token values in `config/mcp-sources.json`.

Useful templates:

- `config/mcp-sources.agent-slack.example.json`: local `agent-slack` message
  search through `agent_slack_events_server`.
- `config/mcp-sources.gh-notifications.example.json`: GitHub notifications
  through `gh_notifications_server`.
- `config/mcp-sources.gmail-gws.example.json`: unread Gmail through `gws` and
  `scripts/poll-gmail-unread.mjs`.
- `config/mcp-sources.todo-md.example.json`: todo markdown files through
  `scripts/poll-todo-md.mjs`.
- `config/mcp-sources.local-events.example.json`: local JSON events file.
- `config/mcp-sources.script-events.example.json`: generic read-only script
  output.

## Preview

Build orchestrator code, then inspect source output without routing anything:

```sh
pnpm mcp:sources
pnpm mcp:preview -- todo_md_source
```

Preview output strips full text by default. Use source-specific env vars to
limit queries and item counts before routing.

## Route Once

Route one source into the queue:

```sh
pnpm mcp:route-once -- todo_md_source
```

Route every configured source once:

```sh
curl -sS -X POST http://127.0.0.1:4377/mcp-sources/poll-all-and-route \
  -H 'content-type: application/json' \
  -d '{"dry_run": false}'
```

Use `dry_run: true` for smoke tests that should not create papers.

## Local Fixture Cleanup

The source-hook self-test uses temporary directories for todo markdown and fake
Gmail command fixtures, then removes them after the test run. Run it directly:

```sh
pnpm --filter @eventloopos/orchestrator run test:agent-source-hooks
```

This proves local events, script events, source CLI preview/route paths,
generic MCP polling, agent-run CLI updates, voice command ingestion, and master
command routing keep working together.
