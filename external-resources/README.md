# External Resources

Research date: May 6, 2026.

Use this folder for snapshots, source exports, screenshots, diagrams, and raw notes that support product or architecture decisions.

## Primary Technical Sources

### macOS

- Apple `AXUIElement`: https://developer.apple.com/documentation/applicationservices/axuielement
- Apple `CGWindowListCopyWindowInfo`: https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo%28_%3A_%3A%29
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit
- Apple AppleScript `activate` / `open location`: https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_cmds.html
- Apple Hardened Runtime: https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime/
- Apple notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution

### Browser

- Chrome `tabs` API: https://developer.chrome.com/docs/extensions/reference/tabs
- Chrome `windows` API: https://developer.chrome.com/docs/extensions/reference/api/windows
- Chrome `scripting` API: https://developer.chrome.com/docs/extensions/reference/scripting/
- Chrome `activeTab`: https://developer.chrome.com/docs/extensions/activeTab
- Chrome native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Safari Web Extensions: https://developer.apple.com/documentation/safariservices/safari-web-extensions
- Safari native messaging bridge: https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension

### Integrations

- Slack Events API: https://docs.slack.dev/apis/events-api/
- Slack Socket Mode: https://docs.slack.dev/apis/events-api/using-socket-mode
- Slack rate limits: https://docs.slack.dev/apis/web-api/rate-limits/
- GitHub webhooks: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub Apps permissions: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- Linear webhooks: https://linear.app/developers/webhooks
- Linear rate limiting: https://linear.app/developers/rate-limiting
- Notion webhooks: https://developers.notion.com/reference/webhooks
- Notion request limits: https://developers.notion.com/reference/request-limits
- Gmail push notifications: https://developers.google.com/workspace/gmail/api/guides/push
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes

### Agent Orchestration

- Model Context Protocol architecture: https://modelcontextprotocol.io/specification/2025-11-25/architecture
- MCP tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- OpenAI Agents SDK: https://platform.openai.com/docs/guides/agents-sdk/
- OpenAI Agents SDK docs: https://openai.github.io/openai-agents-python/agents/
- Codex non-interactive mode: https://developers.openai.com/codex/noninteractive
- Codex App Server: https://developers.openai.com/codex/app-server
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Postgres `SKIP LOCKED`: https://www.postgresql.org/docs/current/sql-select.html
- BullMQ prioritized jobs: https://docs.bullmq.io/guide/jobs/prioritized
- Temporal docs: https://docs.temporal.io/
- Slack MCP server guide: https://slack.com/help/articles/48855576908307-Guide-to-the-Slack-MCP-server
- Slack MCP + Real-time Search announcement: https://docs.slack.dev/changelog/2026/02/17/slack-mcp
- Slack MCP overview: https://docs.slack.dev/ai/mcp-server/
- GitHub MCP server: https://github.com/github/github-mcp-server
- GitHub MCP setup docs: https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server
- Linear MCP docs: https://linear.app/docs/mcp
- Notion MCP docs: https://developers.notion.com/guides/mcp/mcp
- Hermes Agent GitHub: https://github.com/NousResearch/hermes-agent
- Hermes tools docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
- OpenClaw Codex harness: https://docs.openclaw.ai/plugins/codex-harness
- OpenClaw gateway architecture: https://docs.openclaw.ai/concepts/architecture
- OpenClaw steering queue: https://docs.openclaw.ai/concepts/queue-steering
- OpenClaw plugin hooks: https://docs.openclaw.ai/plugins/hooks
- OpenClaw sandboxing: https://docs.openclaw.ai/gateway/sandboxing
- ZeroClaw GitHub: https://github.com/zeroclaw-labs/zeroclaw
- SwarmClaw GitHub: https://github.com/swarmclawai/swarmclaw
- NVIDIA NemoClaw GitHub: https://github.com/NVIDIA/NemoClaw
- Letta stateful agents: https://docs.letta.com/guides/core-concepts/stateful-agents/
- CrewAI human feedback in flows: https://docs.crewai.com/en/learn/human-feedback-in-flows
- CrewAI event listeners: https://docs.crewai.com/en/concepts/event-listener
- LangGraph durable execution: https://docs.langchain.com/oss/python/langgraph/durable-execution
- LangGraph persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- SemaClaw paper: https://arxiv.org/abs/2604.11548
- Structured Graph Harness paper: https://arxiv.org/abs/2604.11378
- OpenClaw PRISM paper: https://arxiv.org/abs/2603.11853
- ClawGuard paper: https://arxiv.org/abs/2604.11790

### Local Repo Snapshots

- `external-resources/repos/hermes-agent` cloned from https://github.com/NousResearch/hermes-agent at `a345f7b`.
- `external-resources/repos/openclaw` cloned from https://github.com/openclaw/openclaw at `16922649`.
- `external-resources/repos/zeroclaw` cloned from https://github.com/zeroclaw-labs/zeroclaw at `d145a24`.
- `external-resources/repos/swarmclaw` cloned from https://github.com/swarmclawai/swarmclaw at `7a8ee1b`.

### Workspace Control

- AeroSpace guide: https://nikitabobko.github.io/AeroSpace/guide
- AeroSpace commands: https://nikitabobko.github.io/AeroSpace/commands.html
- AeroSpace GitHub: https://github.com/nikitabobko/AeroSpace
- macOS WM AeroSpace overview: https://macoswm.com/wm/aerospace
- Apple `AXUIElement.h`: https://developer.apple.com/documentation/applicationservices/axuielement_h
- Apple `CGWindowListCopyWindowInfo`: https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo%28_%3A_%3A%29

### Voice

- OpenAI Realtime API: https://platform.openai.com/docs/guides/realtime/overview
- OpenAI Voice Agents: https://platform.openai.com/docs/guides/voice-agents
- OpenAI Realtime VAD: https://platform.openai.com/docs/guides/realtime-vad
- Picovoice Porcupine wake word: https://picovoice.ai/docs/porcupine/
- MacParakeet local dictation: https://macparakeet.com/
- Susurr local dictation: https://susurr.app/
- WhisperKey local dictation: https://whisperkey-84l.pages.dev/

### Computer Use

- OpenAI computer use: https://platform.openai.com/docs/guides/tools-computer-use

### Testing

- Apple Testing in Xcode: https://developer.apple.com/documentation/xcode/testing
- Apple `XCUIApplication`: https://developer.apple.com/documentation/XCUIAutomation/XCUIApplication
- Apple `XCTAttachment`: https://developer.apple.com/documentation/xctest/xctattachment
- Chrome extension E2E testing: https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing
- Playwright Chrome extensions: https://playwright.dev/docs/next/chrome-extensions
- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- Playwright test generator: https://playwright.dev/docs/codegen
- Docker Compose startup order / healthchecks: https://docs.docker.com/compose/how-tos/startup-order/
- Docker Postgres initialization: https://docs.docker.com/guides/postgresql/advanced-configuration-and-initialization/
- Testcontainers Postgres for Node: https://node.testcontainers.org/modules/postgresql/
- Slack request verification: https://docs.slack.dev/authentication/verifying-requests-from-slack/
- GitHub webhook validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- Linear webhook signatures: https://linear.app/developers/webhooks

## Market References

- Superhuman Mail: https://superhuman.com/products/mail
- Motion AI Calendar: https://www.usemotion.com/features/ai-calendar
- Reclaim automatic scheduling: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically
- Lindy docs: https://docs.lindy.ai/
- Zapier AI tools: https://zapier.com/apps/ai-tools
- Zapier human-in-the-loop MCP: https://zapier.com/mcp/human-in-the-loop
- n8n AI agents: https://n8n.io/ai-agents/
- Relevance AI docs: https://relevanceai.com/docs/get-started/introduction
- Workona: https://workona.com/
- Raycast: https://www.raycast.com/
- Rize: https://rize.io/
- RescueTime: https://www.rescuetime.com/features
