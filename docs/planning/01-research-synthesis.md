# Research Synthesis

Date: May 6, 2026.

## Market

Market validates pain. No product owns human event loop across apps, agents, and workspace context.

AI executive assistants like Lindy, Fyxer, Shortwave, Superhuman focus inbox/calendar/meetings. They reduce comms load. They do not coordinate multiple background agents or restore exact context across terminals, tabs, PRs, Slack threads, docs.

AI scheduling tools like Motion/Reclaim answer "what should I do now?" via calendar + tasks. Gap: calendar priority is proxy, not live computer state. Agent-heavy user needs "what human judgment blocks work right now?"

Workflow automation platforms like Zapier, n8n, Relevance AI, Gumloop, CrewAI support agents/tools/approvals. They are workflow runtimes, not attention runtimes. Human-in-loop exists as workflow step, not continuously ranked review inbox across work.

Work OS / PKM tools like Notion/ClickUp centralize tasks/docs/knowledge only if user lives inside platform. MVP should treat them as resources inside broader task context graph.

Browser/workspace tools like Workona, Dia, Raycast, Prefetch reduce navigation friction. Gap: semantic ownership. They restore places; they do not know which agent/task/workflow is blocked, what decision needed, what risk attached.

Focus tools like Rize, RescueTime, Freedom defend attention. eventloopOS allocates attention.

## Technical Feasibility

macOS-native MVP feasible. App Store sandbox bad fit. Use non-sandboxed Developer ID signed + notarized Mac app, with explicit permission onboarding for Accessibility and maybe Screen Recording.

Public APIs enough for useful v0:

- `CGWindowListCopyWindowInfo` for window inventory.
- `NSRunningApplication` + `NSWorkspace` for app launch/activation/opening URLs.
- Accessibility API for focusing, raising, moving, resizing windows where supported.
- AppleScript for per-app automation where useful.
- ScreenCaptureKit only for fallback visual context or explicit capture.

Do not infer browser internals from macOS windows. Use Chrome MV3 extension + native messaging. Gives tab URL/title/window state, tab open/focus, injected scripts for scroll restore, page anchors. Arc rides Chromium path best-effort. Safari later.

Integration strategy: MCP/poll-first for Jason/internal MVP, push later. Store raw events. Fetch context lazily when routing or building review packet. Avoid broad workspace crawling.

Best integration order:

1. MCP/poll adapter for Slack/GitHub/local sources already connected.
2. Codex adapter.
3. Browser context adapter.
4. Optional Slack Socket Mode / GitHub webhooks when latency/setup tradeoff worth it.
5. Notion/Gmail/Drive later with constrained scopes.

Agent orchestration: local-orchestrator first. MCP can be primary MVP integration path for already-connected user tools, while eventloopOS owns task state, queue ranking, tool permission, review packets. Codex has strong machine-readable non-interactive runs + App Server. Claude Code hooks useful for permission requests + notifications.

## Main Product Risks

Window management too early = biggest risk. Workspace restore starts as "open/focus correct resources," then grows into richer layouts.

False confidence dangerous. Model confidence weak signal. Prefer evidence: tests passed, diff size, tool outcomes, source links, trace graders, unresolved failures, external side effects.

Permissions are product surface. App needs powerful local + SaaS access. Default least privilege, scoped connectors, visible evidence, human approval for external writes, deletes, production actions, billing, credentials, customer-facing comms.

Queue correctness matters from day one. Need idempotency keys, leases, retries, dead-letter state, stale-run cleanup.

## Strategic Wedge

Start coding/agent review because:

- Pain already acute for power users.
- GitHub/Codex/Claude/Slack/local docs give event surfaces.
- Review packets grounded in concrete evidence: diffs, tests, CI, logs, comments.
- Workspace restore useful without perfect screen understanding.
- User already expects approval gates + risk review.
