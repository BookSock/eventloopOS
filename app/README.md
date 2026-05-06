# App Workspace

This folder is reserved for implementation.

Proposed structure:

```text
app/
  macos/              # Swift/AppKit or SwiftUI menu bar app
  browser-extension/  # Chrome MV3 extension + native messaging
  orchestrator/       # local service: events, queue, adapters, agents
  shared/             # schemas/types shared across app surfaces
  test-harness/       # fake world, fixtures, scenario runner, E2E proof
```

MVP implementation order:

1. Build shared contracts + test harness skeleton.
2. Build queue UI with seeded review packets.
3. Add browser extension native messaging and URL restore.
4. Add MCP/poll ingestion for Slack/GitHub/local sources.
5. Add ambient router.
6. Add Codex adapter and human approval loop.
7. Add push integrations later if needed.
