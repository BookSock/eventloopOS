# Ambient Router + Workspace Backends

This doc updates plan after deeper integration/workspace thinking.

## Product Shift

Human queue is not inbox of all events.

Human queue is only for:

- judgment needed.
- approval needed.
- confidence low.
- side effect risky.
- priority conflict.
- missing context.

Agents should process inbound information in background first.

Core flow:

```text
new info -> ambient router -> task/thread match -> background agent work -> only queue human if blocked
```

## Local Gateway Shape

Use local gateway daemon, not loose scripts.

```text
orchestrator = eventloop Gateway
mac queue app = control client
browser native host/extension = client/node
MCP pollers = source plugins
task agents = sessions/runtimes
workspace backends = node capabilities
```

Gateway owns:

- source polling.
- event log.
- route decisions.
- task/session registry.
- queue.
- policy hooks.
- side-effect idempotency.

Clients connect over local HTTP first, then typed WebSocket once event streaming matters.

Rules:

- JSON Schema validates messages.
- first WS frame must be handshake.
- side-effect calls require idempotency key.
- clients refresh state if event stream gap happens.
- config validates before boot.
- keep last-known-good config.
- add `doctor` command early.

## Manual Mode / Escape Hatch

MVP must always let user leave event-loop orchestration and use Mac normally.

Behavior:

- hotkey toggles event-loop/manual mode.
- manual mode pauses workspace restore planning and execution.
- queue stays leased/visible so user can return without losing place.
- returning to event-loop mode may re-plan selected workspace restore.
- no attempt to rearrange windows while user is in manual mode.

Current implementation uses macOS `RegisterEventHotKey` for the mode toggle. Keep this for MVP because it registers one explicit shortcut without broad key monitoring. Apple docs for `NSEvent.addGlobalMonitorForEvents` say key-related global monitoring needs Accessibility trust, and Quartz event taps are lower-level input stream hooks. If we need arbitrary voice/keyboard command capture later, gate it behind explicit privacy settings and `doctor` checks.

References:

- Apple `NSEvent.addGlobalMonitorForEvents`: https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents%28matching%3Ahandler%3A%29
- Apple Quartz Event Services: https://developer.apple.com/documentation/coregraphics/quartz-event-services

Example:

```text
Slack DM arrives
router reads/classifies
router finds blog task + blog agent thread
router injects feedback into agent thread
agent revises draft
agent queues human only if approval/review needed
```

## Integration Model

Use MCP/poll-first for Jason/internal MVP, then add push where setup tradeoff worth it.

Reason:

- user may already have Slack/GitHub MCP configured.
- agent in terminal may already have GitHub access.
- less SaaS app registration/OAuth/webhook setup.
- faster path to prove ambient router behavior.
- polling latency acceptable for v0.

### Push Ingest

Best for fresh events, but not required for v0.

Use:

- Slack Events API / Socket Mode.
- GitHub webhooks.
- Notion webhooks later.

Why:

- low latency.
- less polling waste.
- durable delivery/retry where provider supports it.
- easier "what changed" event metadata.

### MCP / Pull Context

Best for v0 ingest + agent-readable context + actions.

Use:

- official Slack MCP server where available.
- official GitHub MCP server.
- Notion MCP server later.
- custom local MCP servers for local files, browser, queue, macOS workspace.
- any user-installed MCP server with declared polling recipe.

Why:

- good natural-language tool descriptions.
- agents can search/fetch context.
- easier to reuse existing auth/tool wrappers.
- works when event payload has only pointer and agent needs more.

### Polling

Use as primary v0 mechanism if setup friction beats push.

Examples:

- poll Slack MCP/search for unread DMs since cursor if Events API not installed.
- poll GitHub MCP/search for PR/comment/CI changes since cursor.
- poll local agent thread statuses.

Rules:

- every poller has cursor.
- every result becomes `Event`.
- poller never writes external systems directly.
- poll cadence visible in settings.

## Ambient Router

New orchestrator subsystem:

```text
app/orchestrator/src/router/
```

Owns:

- classify inbound events.
- link event to task/workspace/agent thread.
- decide: ignore, archive, route, start agent, update agent, queue human.
- maintain memory of current agent threads and what they own.
- accept voice/user commands and route them to relevant threads.
- manage top-level polling schedules across MCP/browser/local sources.
- reprioritize tasks when new information arrives.

Router decisions:

```text
ignore
store_only
attach_to_task
start_agent_thread
inject_into_agent_thread
create_review_packet
ask_human_now
defer_until_context
```

Router should be model-assisted but policy-constrained:

- deterministic candidates first: URL, Slack thread, GitHub PR, task doc, branch, file path, project keyword.
- model ranks candidates.
- high-impact routes require evidence.
- uncertain route creates review packet or low-priority "routing unsure" item.

## MCP Source Registry

Any installed MCP server can become event source if system knows how to query it.

Need registry:

```text
McpSource
  server_name
  capabilities
  poll_recipe
  cursor_state
  event_mapper
  risk_policy
```

Examples:

- Slack MCP: poll unread DMs, mentions, threads since cursor.
- GitHub MCP: poll PR comments, review requests, CI state, issue updates.
- Filesystem MCP: poll watched folders/files for changes.
- Browser MCP/custom server: poll captured tabs/page snapshots.
- Notion MCP: poll changed docs/tasks.
- Calendar MCP: poll new events or conflicts. Post-MVP unless product becomes ambient/interrupt-driven.

Poll recipe is explicit, not magical:

```text
tool: search_messages
args: { after: cursor, query: "is:dm OR mentions:me" }
cursor: max(message.ts)
map: slack_message_to_event
```

Rules:

- no provider-specific logic in queue UI.
- each source emits normalized `Event`.
- pollers store cursor.
- pollers have budget/rate limit.
- write tools disabled unless policy allows.
- if source cannot provide cursor, use hash/dedupe window.

This lets power users add new MCP sources without rebuilding product core.

### MCP Runtime Hardening

MCP source runtime needs real survival features from day one.

Required:

- per-server timeout.
- reconnect with backoff.
- circuit breaker with half-open probe.
- subprocess PID tracking.
- orphan MCP child cleanup.
- MCP stderr redirected to log file.
- credential stripping in logs.
- env filtering before server spawn.
- dynamic reload/discovery.
- rate budget per server.

Reason:

MCP polling becomes heartbeat of ambient router. Flaky MCP server must not freeze whole queue.

## Loop Hierarchy

There are multiple loops.

### Master Loop

Owns global attention system.

Responsibilities:

- poll MCP/event sources.
- create normalized events.
- route events to tasks/agent threads.
- reorder task queue.
- decide whether to queue human-blocked work.
- send messages to task agents.
- maintain workspace/task registry.
- enforce side-effect policy.

Master loop should be cheap + persistent. It can use smaller/cheaper model for classification/routing, with stronger model only for hard ambiguous routing. V1 does not need budget dashboard; model choice and poll cadence config are enough until dogfood shows burn.

### Task Loops

Each task can have one or more agent threads.

Responsibilities:

- do actual work.
- run tests/builds.
- watch local command completion.
- poll task-specific sources.
- request human approval when blocked.
- update task state.

Task loops can be Codex CLI sessions. They may spawn Codex subagents internally.

### Local Watch Loops

Small deterministic loops, no model by default:

- process monitor waits for build/test command.
- file watcher sees build artifact/log changes.
- browser watcher sees known page/tab change.
- timer loop wakes pollers.

These produce `Event`s too.

## Task Agent Control

Master must control or communicate with task agents.

Preferred order:

1. Structured agent API.
   - Codex App Server thread start/resume/read/status.
   - `codex exec --json` for machine-readable runs.
   - MCP tools wrapping Codex where useful.

2. Session file/log protocol.
   - task agent writes state/log/blocked packet.
   - master injects new instructions through structured resume command.

3. Terminal/tmux control.
   - send text to specific session/pane/window.
   - useful for Ghostty/tmux/manual Codex CLI sessions.
   - more brittle, but necessary fallback.

Terminal control adapter:

```text
TaskSessionBackend
  listSessions()
  identifySession(task_id)
  sendText(session_id, text)
  readRecentOutput(session_id)
  focusSession(session_id)
```

### Task Session Steering

New info may arrive while task agent already running.

Need message modes:

- `steer`: send into active run before next model decision if runtime supports.
- `followup`: queue later turn after active run.
- `collect`: debounce/coalesce many compatible messages into one later turn.
- `steer_backlog`: steer now and keep followup record.
- `interrupt`: stop active run and start newest instruction. Not default v1 behavior; use only through structured runtime support and explicit policy.

Use:

```text
Slack DM about blog -> router finds blog task -> task session send(mode=steer|followup)
```

Terminal injection cannot truly steer. It can only visible-paste/followup. App-server backend should support better steering/resume.

Backends:

- Codex App Server backend.
- Codex exec/resume backend.
- tmux backend.
- Ghostty/AppleScript/AX backend.
- raw terminal paste backend as last resort.

Rules:

- prefer structured resume over typing text into terminal.
- terminal injection must be visible/audited.
- never paste sensitive/external-send instructions without policy check.
- require stable session identity before sending text.
- require explicit terminal-control grant before auto-submit.
- if uncertain session match, queue human.

## Ownership Locks

Need prevent duplicate agents acting on same external thread/resource.

Track:

```text
OwnershipLock
  resource_key
  owner_task_id
  owner_agent_run_id
  lock_kind
  lease_expires_at
  evidence
```

Resources:

- Slack thread/DM.
- GitHub PR/comment thread.
- email thread.
- browser page poll target.
- task agent session.
- doc section.

Rules:

- external send requires ownership lock or human approval.
- route into task prefers current owner.
- lock conflict creates review packet, not duplicate agent.
- stale locks expire with audit trail.

## Hook Policy

Need small hook layer for safety and future hacks.

Hooks:

- `source_event_received`
- `before_route`
- `after_route`
- `before_task_message`
- `after_task_message`
- `before_action_execute`
- `after_action_execute`
- `before_workspace_restore`
- `message_sending`

Hook can:

- allow.
- block.
- rewrite safe fields.
- require approval.
- attach evidence.

Rules:

- hooks have timeout.
- hooks have priority.
- every blocking/approval decision audited.
- no hook gets raw secrets by default.

## Trust Tiers

Use explicit trust tiers.

```text
host_trusted
task_sandbox
browser_readonly
browser_debug
external_draft
external_send
```

Meaning:

- main local user control can run on host.
- non-main task agents should sandbox where possible.
- browser content script read-only by default.
- CDP/debugger is opt-in advanced mode.
- external drafts okay with policy.
- external send requires approval unless user grants high-trust setting.

## Browser Page Polling

Future browser source can poll pages for app-specific changes.

Use cases:

- LinkedIn messages open in browser.
- Facebook Messenger open in browser.
- random web dashboard no API.
- support queue inside SaaS app.

Options:

1. Chrome extension content script observer.
   - best default.
   - can watch DOM mutations in allowlisted domains.
   - emits page event summaries.

2. Page snapshot polling.
   - extension captures visible text/title/badges.
   - model/classifier detects changes.
   - lower permission than CDP.

3. CDP/debugger advanced mode.
   - only opt-in.
   - useful when extension APIs insufficient.

4. Computer-use fallback.
   - last resort.

Policy:

- page pollers are per-domain opt-in.
- read-only by default.
- no clicks/types/submits without approval.
- sensitive sites need local-only processing or explicit consent.
- DOM events become normalized `Event`s, not direct human queue items.

## Task Workspace Layout

Each task should own workspace context.

Task context includes:

- AeroSpace workspace name.
- window IDs/app bundle IDs.
- Chrome tab resources.
- terminal/Codex session.
- file/doc URLs.
- last layout snapshot.
- restore recipe.

User switching tasks:

```text
queue next -> restore task workspace -> show decision briefing -> user acts -> task agent resumes
```

This is task-virtual-desktop, backed by AeroSpace where available.

Need normal-computer escape hatch:

```text
event-loop mode -> manual-mode hotkey -> freeze automation -> user works normally -> return hotkey -> snapshot manual layout -> restore next queue item
```

Rules:

- Manual mode never closes/moves windows automatically.
- Queue ranking and background agent loops continue.
- New urgent work may rise in the queue, but does not steal focus in v1 unless user opts into interrupt behavior later.
- Returning to event-loop mode should record current visible layout as `manual_workspace_snapshot` so it can be restored if user exits again.
- If task workspace restore has stale/missing windows, fallback is briefing overlay + open links, not aggressive window rearrangement.
- AeroSpace backend should reserve eventloop-managed workspace names and avoid touching unmanaged workspaces in manual mode.

Current implementation:

- macOS app has `Cmd-Option-Shift-M` global hotkey for manual/event-loop toggle.
- macOS app auto-renews the selected queue lease while human reviews.
- macOS app can ask orchestrator for workspace restore plans and skips that call in manual mode.
- macOS app currently captures a manual workspace snapshot when entering manual mode. Product intent prefers capturing on exit from manual mode, so the next implementation patch should align code with this doc.
- orchestrator exposes workspace status/capture/restore-plan and reports `execute_supported`.
- orchestrator can execute restore only when `ORCHESTRATOR_WORKSPACE_EXECUTE=enabled`, request has `confirm_execute: true`, and request has an `idempotency-key`.
- test harness has `workspace_status_smoke` and `workspace_restore_disabled` fixture/live scenarios so agents can verify backend status and default no-execute behavior without moving windows.

MVP:

- remember resources per task.
- restore URLs/tabs/session.
- AeroSpace spike maps task -> workspace.
- add human-facing confirmation UI before invoking workspace restore execution.

Later:

- automatic layout snapshots.
- overlapping resources across tasks.
- task-specific Chrome windows/profiles.
- monitor-aware restore.

## Agent Thread Registry

Need registry of live/background agent threads.

Track:

- task ownership.
- current goal.
- active resources.
- last input.
- last output.
- current blocked state.
- allowed tools.
- side-effect permissions.
- priority.
- freshness.

Use this to route new info.

Example voice command:

```text
"Blog post priority. Include launch details from two weeks out."
```

Router:

1. converts voice to `Event`.
2. finds blog task/thread.
3. updates task priority.
4. injects message into blog agent thread.
5. does not interrupt human unless route ambiguous or high-risk.

## Voice Input

Voice transcript ingress is optional for v1 dogfood. It should stay below queue/MCP/task-runtime work unless Jason explicitly pulls it forward.

Recommended shape:

- push-to-talk first.
- wake word later.
- local transcription preferred.
- voice event goes through same router as Slack/GitHub.

Possible stack:

- WhisperKit/local dictation for private on-device transcription.
- Picovoice Porcupine for optional wake word.
- OpenAI Realtime for cloud low-latency voice agent mode if user opts in.

Voice commands produce:

```ts
Event.source = "voice"
Event.type = "voice.command"
Event.summary = transcript
```

Voice safety:

- configurable listen modes: off, push-to-talk, wake word, always-on.
- visible mic state.
- local-first default.
- store transcript, not raw audio, unless user enables audio retention.
- commands causing side effects still require policy gate.

## Human Queue Packet UX

When queue item appears, user needs quick memory restore.

Review packet overlay should show:

- what this is.
- why now.
- what agent thread was doing.
- latest agent state.
- new info that changed situation.
- exact decision needed.
- likely approve/reject/defer actions.
- source links and evidence.

This is decision briefing, not full chat transcript.

## Workspace Backend Decision

macOS native window APIs useful but unreliable for full workspace control.

V0 should support backend interface:

```text
WorkspaceBackend
  capture()
  restore(context)
  focus(resource)
  move(resource, target)
  listWindows()
  listWorkspaces()
```

Backends:

1. `url_open_backend`
   - always available.
   - opens URLs/files/apps.
   - lowest reliability risk.

2. `chrome_extension_backend`
   - controls tabs, scroll, anchors.
   - best browser control.

3. `mac_ax_backend`
   - Accessibility + CGWindow + NSWorkspace.
   - useful for focus/app/window.
   - fragile by app.

4. `aerospace_backend`
   - optional power-user backend.
   - best for deterministic workspaces/window placement.
   - requires AeroSpace installed + configured.

5. `computer_use_backend`
   - fallback/nightly smoke/weird UI.
   - not default.

## AeroSpace Position

For power-user MVP, AeroSpace can help a lot, but it is a blessed optional backend, not the center of the product.

Why:

- name-addressable workspaces.
- CLI commands for workspace/window movement.
- query commands for windows/workspaces.
- callbacks for focus/workspace/window events.
- config rules for app placement.
- easier deterministic restore than raw macOS Spaces.

Use it as optional but blessed backend:

```text
If AeroSpace installed:
  eventloopOS creates/manages eventloop section in config
  uses CLI to list/focus/move windows
  maps tasks to workspace names
Else:
  fall back to URL/app/tab restore
```

Do not make AeroSpace required forever.

Default MVP path should still work through queue briefing, URLs, browser tabs, and manual mode even when AeroSpace is absent or disabled.

Risks:

- user config conflicts.
- multi-monitor quirks.
- macOS app/tab/window weirdness still leaks through.
- AeroSpace workspaces are not native Mission Control spaces.
- browser tabs still need extension; AeroSpace sees windows, not semantic tabs.

## Chrome Extension Still Needed

AeroSpace does not replace Chrome extension.

AeroSpace controls windows/workspaces. It does not know:

- active tab URL.
- tab title/favIcon.
- Slack thread URL inside browser.
- scroll position.
- DOM anchor/text quote.
- Google Docs paragraph context.

Chrome extension remains best browser semantic layer.

Alternative browser tab sources:

- AppleScript can list/focus Chrome tabs by title/URL in many cases.
- Witch shows Chrome/Safari tabs, likely through macOS tab APIs plus AppleScript/accessibility.
- These are useful fallback/spike paths.
- They do not replace extension for DOM anchors, scroll restore, page highlights, and structured event flow.

Use:

- extension for tabs/page context.
- AeroSpace for window/workspace placement.
- orchestrator combines both into one `ContextResource`.

## Computer Use Position

Computer use is not core control plane.

Use for:

- fallback when no API/extension exists.
- exploratory automation.
- nightly real-desktop smoke.
- weird sites/apps with no structured access.

Do not use for:

- primary Slack/GitHub/MCP ingest.
- primary Chrome tab restore.
- queue correctness.
- trusted external writes.

Reason:

- slower.
- less deterministic.
- harder to test.
- screenshot/prompt-injection risk.
- should run in sandbox/allowlisted contexts.

## CDP / Debugger Position

CDP is powerful but high-trust.

Options:

- remote debugging port: bad default for real user browser.
- `chrome.debugger` extension API: possible advanced mode, requires scary `debugger` permission.
- Playwright/CDP: great for test browser profile, not daily browser.

Use CDP only in explicit advanced/debug mode.

Policy:

- default extension uses `chrome.tabs`, `chrome.scripting`, `activeTab`, native messaging.
- no DOM mutation unless user approves or feature specifically needs restore/highlight.
- no form submit/click/write actions through browser automation by default.
- CDP/debugger backend denylisted from external writes unless opt-in.

## Modularity Rule

Everything is adapter behind contracts.

```text
SourceAdapter -> Event
ContextTool -> Evidence/ContextResource
WorkspaceBackend -> RestoreResult
AgentAdapter -> AgentRun/ReviewPacket
Router -> RouteDecision
Queue -> QueueItem
```

Adding new provider should not alter queue UI.

Adding new workspace backend should not alter agent adapters.

Adding voice should not special-case task routing; it produces `Event`.

## New Planning Changes

Add after first 10 tickets:

- Ambient Router V0.
- Agent Thread Registry.
- Voice Command Capture.
- AeroSpace Backend Spike.
- MCP Context Adapter.

Do not block first 10 on these. But architecture must leave slots for them.
