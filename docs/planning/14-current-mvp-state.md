# Current MVP State

## Build Truth

Repo now has working MVP spine:

- Mac queue app = human review surface.
- Orchestrator = event router, queue, context store, task-session bridge, workspace planner.
- Browser extension = Chrome tab capture, restore, config, poll loop.
- Native host = Chrome Native Messaging bridge.
- Test harness = repeatable agent feedback loop.
- Planning stance = intentional intake stack, not aggressive interruption product.
- Voice transcript ingress and AeroSpace execution are optional dogfood experiments, not next-lane MVP requirements.
- `pnpm run test:e2e:live:boot` boots orchestrator, runs live harness/native/browser E2E, then stops server.
- Boot live smoke also runs Mac `HTTPQueueClient` against the live orchestrator and proves context restore request create/read round-trip.
- `pnpm run test:e2e:live:full` runs the same booted-orchestrator smoke plus installed Chromium extension/native host capture against that same orchestrator.

Main command:

```sh
make ci
```

This runs lint, typecheck, unit tests, fixture E2E, macOS Swift tests, native-host tests, browser extension tests, and real Chromium extension E2E.

Live browser-context proof:

```sh
pnpm --filter @eventloopos/orchestrator build
pnpm --filter @eventloopos/orchestrator start
app/test-harness/bin/run-scenario browser_context_store_only --orchestrator-url http://127.0.0.1:4377
```

## Browser Restore Loop

Done:

- Extension options page stores orchestrator URL in `chrome.storage.local`.
- Runtime messages can get/set config.
- Restore poller reads URL at poll time, not hardcoded forever.
- Extension config stores an allowed-origin list. Default allowlist is local/dev only (`file://*`, `localhost`, `127.0.0.1`), and options UI lets the user add origins such as GitHub or Slack.
- Capture and restore check the allowed-origin list before reading page content, creating/focusing tabs, or sending native context. Disallowed restore requests are marked failed with `origin_not_allowed`.
- The extension no longer injects a content script on every page through `manifest.content_scripts`; it injects `src/content-script.js` programmatically only after an allowed capture/restore path needs page access.
- Remaining browser permission caveat: `host_permissions` is still `<all_urls>` so programmatic restore can work across user-configured origins. Later installer UX should move this toward optional host permissions if Chrome permission friction matters.
- Restore poller uses a per-profile stable lease owner from `chrome.storage.local`, avoiding fixed-owner collisions across Chromium profiles.
- Chrome alarm wakes poller.
- Poller claims work through `/contexts/restore-requests/claim-next`.
- Poller restores browser tab/scroll.
- Poller/browser runtime highlights restored quote text or selector target and reports `restoredHighlight` plus `highlightStrategy`.
- Poller POSTs `/contexts/restore-requests/:id/done`.
- Playwright E2E loads unpacked MV3 extension in Chromium and proves capture, options save, runtime restore, alarm poll restore, and done ACK.

Internet check used:

- Chrome extension storage/options docs: use `chrome.storage`, not service-worker `localStorage`.
- Chrome alarms docs: alarm wakes MV3 background service worker.
- Playwright extension docs: use persistent Chromium context with unpacked extension.

## Mac Queue Loop

Done:

- Queue fetch + lease-next.
- Done/next.
- Auto lease renewal.
- Manual mode hotkey (`Cmd-Option-Shift-M`).
- Menu bar shell with queue count, selected item, mode, restore state, open queue, refresh, done/next, restore queue workspace, skip/next, and mode toggle.
- Full window empty/loading/error placeholders with retry affordance and unit-covered presentation copy.
- Render smoke test for real SwiftUI `QueueWindowView` using seeded queue data and nonblank image pixel check.
- Launch smoke test builds `EventLoopQueueApp`, packages a temporary `.app` bundle, starts it in test mode through Launch Services, verifies it stays alive, then terminates it.
- Workspace restore planning pause in manual mode.
- Manual Mode pauses workspace switching immediately. Returning to Event Loop captures the manual workspace snapshot, shows saved-window count, and exposes `Restore Manual Workspace` to move back to that saved normal-computer context while keeping automation paused.
- Context resource restore request from queue UI.
- Restore request status refresh.
- Automatic restore request status polling while Mac UI is open.
- UI shows queued/done/highlighted/failed restore state.
- Context resource rows show restore confidence plus provider confidence reason when available, so the user can see whether a restore is backed by a provider anchor or a generic browser fallback.
- Context restore requests support failed status and retry back to pending. Browser extension marks unsupported/failed restores through `/failed`; `/retry` requeues for another claim.
- Live Mac client + Chromium extension restore smoke exists: Mac `HTTPQueueClient` creates a real orchestrator restore request, Chromium extension claims it, restores the tab/scroll, and Mac-readable restore request status becomes `done`.
- Queue window, menu bar, and command menu expose `Defer 1 Hour` and `Ignore Item` actions. Defer calls `POST /queue/:id/defer` with a future `due_at`, ignore calls `POST /queue/:id/ignore`, and both advance to the next leased item after the action succeeds.
- Queue detail now pushes the one-paper model harder: sidebar/stack column is constrained narrower, selected packet title is larger, and the detail header shows stack count/source above the current paper.

Gap:

- No app bundle/XCUITest proof of the full installed Mac UI interaction flow yet.

## Orchestrator Loop

Done:

- `POST /events` routes events.
- Passive browser context can be `store_only`, no human queue noise.
- Task-hinted events can route into task session.
- Unhinted Slack/voice/MCP/GitHub-style ambient events can infer a target task from stored task-bound context and inject into an existing task session. If no clear context match exists, event still queues human review.
- `poll-and-route` for generic MCP sources uses the same ambient inference path, so user-installed MCP servers can emit event-ish items without `task_hint` and still reach the right task session when stored context is clear.
- MCP source mappers normalize provider deeplinks for Slack, GitHub, Notion, Google Docs, Figma, and generic browser URLs into `resource.details` with stable provider IDs, confidence reasons, and browser fallback metadata.
- `ORCHESTRATOR_TASK_SESSIONS=claude_cli` exposes configured Claude Code sessions from `ORCHESTRATOR_CLAUDE_SESSIONS` through the same task-session API; followups run `claude -p --output-format json --resume <session>` in the configured `cwd`.
- Claude session config can pin `model`, `tools`, and `max_budget_usd`, so real smoke/followup runs can force cheap read-only behavior instead of inheriting an expensive or tool-enabled default.
- `ORCHESTRATOR_TASK_SESSIONS` now accepts comma-separated modes, so `codex_app_server,claude_cli` exposes Codex App Server threads and configured Claude Code sessions in one daemon. A composite task-session controller lists both providers and routes followups/bindings to the owner runtime by session ID.
- Task runtime boundary now has shared typed shapes for sessions, messages, capabilities, bindings, and errors. The contract is intentionally tolerant for MVP because Codex, Claude, fake, and terminal runtimes still carry provider-specific metadata, but controller methods no longer return raw `unknown`.
- `GET /queue/:id/lineage`, `pnpm queue:lineage -- --queue-item-id <id>`, and the Mac queue Lineage panel show the selected paper's queue item, review packet, related source events, activity timeline, and sanitized task-message history in one response. The Mac app auto-loads lineage when the selected paper changes. This makes after-the-fact debugging queue-item-centered instead of forcing global `/activity` and `/task-messages` dumps.
- `dogfood:review` now reports queue depth by state, pending/failed restore backlog, task followup status counts, and runtime failure count. `dogfood:check` has thresholds for ready queue depth, pending restore requests, and runtime failures.
- `POST /task-messages/reconcile-attempted` marks stale `attempted` task messages as failed with audit activity. It deliberately does not retry because raw followup text is not stored; agents should inspect queue lineage and resend manually when needed.
- `pnpm task:runtime-smoke` starts a temporary orchestrator with `codex_app_server,claude_cli`, checks live Codex app-server sessions plus a configured Claude session are exposed together, then shuts the daemon down.
- `GET /contexts` ranked search.
- `POST /contexts/restore-plan`.
- `POST /contexts/restore-requests`.
- `GET /contexts/restore-requests/next` as read-only peek.
- `POST /contexts/restore-requests/claim-next` leases one pending restore request.
- `POST /contexts/restore-requests/:id/done`.
- `GET /contexts/restore-requests/:id`.
- `POST /queue/:id/defer` hides a queue item until `due_at`, records `queue_item_deferred`, and increments `queue_items_deferred_total`.
- `POST /queue/:id/ignore` moves a queue item to `dead`, records `queue_item_ignored`, and increments `queue_items_ignored_total`.
- Idempotency key support for restore request creation.
- Restore request persistence through same in-memory/Postgres store abstraction as queue storage.
- Expired restore request leases get reaped and reclaimed.
- Docker-backed Postgres tests pass locally with `pnpm run test:db:docker`. Native Postgres test runner also creates a throwaway local cluster, runs live DB tests, stops server, and deletes temp data.
- Postgres API restart smoke proves a routed event stays idempotent across closing one orchestrator server and starting another against the same DB: duplicate retry returns the original route and queue item, with one event row and one queue item row.
- Postgres API restart smoke also proves a failed browser restore request remains visible after server restart, can be retried to `pending`, and can be claimed again by a browser worker.
- Event routing now falls back to the human queue when a task-session followup send fails or returns `blocked`. The followup failure/block is recorded in activity/metrics, the event is stored as a normal human queue item, and duplicate retries return the stored queue route without re-sending the failed/blocked followup.
- Task followups now pass through a shared `before_task_message` policy gate. Prompt-injection-looking untrusted Slack/GitHub/MCP/voice text is fenced as untrusted data in the followup body and blocks before runtime send; event-route blocks fall back to human queue review.
- Doctor checks orchestrator health, optional AeroSpace readiness, Docker, browser Playwright readiness, Mac/browser restore smoke Swift readiness, optional MCP source config readiness, optional voice transcript command readiness, and Codex app-server.
- `pnpm --filter @eventloopos/orchestrator run live:aerospace` builds and emits a machine-readable skip by default. With `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1`, it checks live AeroSpace status/capture/restore-plan without executing workspace moves. With `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE_EXECUTE=1`, it also moves one real window to a scratch workspace, restores it, and verifies it returned.
- `POST /workspace/restore` now caches execution receipts by `Idempotency-Key`. Duplicate calls return the first plan/receipt without re-executing workspace commands, and Postgres mode preserves this replay behavior across orchestrator restart through the `receipts` table.
- Optional voice transcript ingress exists for experiments: `voice:listen-command` runs a configured local STT command and pipes line-delimited transcripts into the same wake-phrase voice router. Command args are JSON argv, not shell-parsed strings.
- Optional voice smoke support exists: `voice:listen-command` supports `EVENTLOOPOS_VOICE_STT_PRESET=whisper_cpp_stream`, and `voice:stt-smoke` can test local `whisper-cli` with fixture audio.

Gap:

- No known Postgres persistence gap. Both Docker-backed and native throwaway Postgres test paths pass locally.

## Testing Loop

Strong tests now:

- Unit tests for contracts, routing, MCP polling, task sessions, workspace, browser extension, native host, Mac view model.
- Fixture E2E for agent loops.
- Live harness scenario for browser store-only + restore request peek/claim/done status.
- Real Chromium Playwright extension E2E.
- Real Chromium Playwright extension E2E proves restored quote highlight, not only scroll.
- Browser E2E launches two Chromium profiles and proves different restore-request lease owners.
- Browser extension tests prove allowed-origin config normalization, disallowed capture skip without native forwarding, disallowed restore skip without tab/page side effects, and restore poller failed ACK for `origin_not_allowed`.
- Opt-in installed Chromium native messaging smoke that verifies extension -> native host -> orchestrator forwarding with real `chrome.runtime.sendNativeMessage`; passed locally on 2026-05-06 with `pnpm run test:e2e:native-browser`.
- Real orchestrator + installed Chromium extension/native host smoke exists as `pnpm run test:e2e:native-browser-real-orchestrator`; it starts the actual orchestrator, captures a real browser tab through native messaging, verifies `store_only`, checks no human queue item was created, and checks browser context search can find the captured tab.
- Mac client + browser restore smoke exists as `pnpm run test:e2e:mac-browser-restore`; it starts a real orchestrator, has Swift `HTTPQueueClient` create a restore request, and proves the Chromium extension claims/completes it.
- Full live boot smoke can reuse one running orchestrator for harness scenarios, Mac client live smoke, browser extension E2E, and installed Chromium extension/native host capture with `pnpm run test:e2e:live:full`.
- `queue_bind_then_recommended_action` proves the end-to-end dogfood path where agent handoff blocks before task-session binding, succeeds after binding, sends a task followup, and drains the queue.
- Orchestrator API regression tests prove duplicate/retried events return the stored route before task-session side effects; a duplicate event that already queued human review cannot later inject into an agent thread after a task session appears.
- In-memory and Postgres stores both dedupe events by `(source, idempotency_key)`, so two sources can safely reuse the same idempotency token during local fixture tests.
- Orchestrator API tests and live harness scenario `ambient_context_route` prove browser-captured task context can later route an unhinted Slack/voice-style event into `task_session_blog` with `context_match` evidence and no human queue item.
- Orchestrator API tests and live harness scenario `mcp_ambient_context_route` prove a generic MCP `poll-and-route` item with no `task_hint` can route into `task_session_blog` using stored browser context and sends matched-context summary text to the task session.
- macOS menu/window surfaces show why a recommended agent handoff is blocked, so disabled action buttons are auditable instead of silent.
- Opt-in invasive AeroSpace smoke passed locally with `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1 EVENTLOOPOS_ENABLE_LIVE_AEROSPACE_EXECUTE=1 pnpm run live:aerospace`; latest run saw 42 windows, planned 42 restore commands, moved window `23173` from workspace `1` to `eventloop-smoke`, and restored it to `1`.
- Opt-in macOS UI automation smoke passed locally with `EVENTLOOPOS_ENABLE_MACOS_UI_SMOKE=1 pnpm run test:e2e:macos-ui`; it opens the menu bar extra, executes `Restore Queue Workspace` and verifies the restore receipt, opens the queue window, executes `Skip / Next Item` and verifies selection changed, toggles Manual Mode, verifies the manual workspace capture banner/menu summary, executes `Restore Manual Workspace`, verifies the restore receipt appears in the menu, and toggles back to Event Loop.
- `voice:listen` accepts line-delimited local STT transcript streams, optional wake phrase filtering, and forwards into `/voice/commands`.
- `voice:listen-command` lets whisper.cpp stream, MLX Whisper wrappers, or other local STT tools feed the same router while staying unit-testable through an injected process. The whisper.cpp stream preset is unit-covered and doctor-checked.
- Opt-in fixture-audio STT smoke passed locally with `EVENTLOOPOS_ENABLE_VOICE_STT_SMOKE=1 EVENTLOOPOS_WHISPER_MODEL=external-resources/models/whisper/ggml-tiny.en.bin pnpm run voice:stt-smoke`; transcript was `computer blog post priority changed.`
- `dev:doctor` reports whether `EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND` is configured and can launch with `--help`; unconfigured voice command is treated as optional/pass.
- `dev:doctor` reports whether `ORCHESTRATOR_MCP_SOURCES_PATH` or `config/mcp-sources.json` contains valid MCP polling sources; missing default config is treated as optional/pass. MVP MCP source config validation now rejects write-enabled/high-risk polling sources (`readOnly` must be true, `allowWriteTools` false, `maxRiskLevel` low), and SDK-backed polling checks the server-advertised poll tool before first call and requires `annotations.readOnlyHint=true`.
- MCP poll cursor/seen state persists through the gateway store. Config-backed real MCP sources hydrate state before polling and commit staged cursor state only after poll results successfully route, so a route failure does not skip events on retry. Postgres mode stores state in `mcp_poll_states`; in-memory mode has matching conformance coverage.
- `GET /mcp-sources`, `POST /mcp-sources/:id/preview`, `pnpm run mcp:sources`, and `pnpm run mcp:preview -- <source-id>` let a master agent inspect configured MCP sources and run a non-routing, non-cursor-committing source preview before enabling `mcp:route-once` or the poll loop. Preview output redacts title/body/summary text unless `EVENTLOOPOS_MCP_PREVIEW_INCLUDE_TEXT=1`.
- Config paths for MCP sources, Codex task maps, and seed fixtures resolve existing repo-root relative files even when package scripts run from `app/orchestrator`.
- File-backed local events MCP server exists for dogfood. `config/mcp-sources.local-events.example.json` launches it over stdio, reads `EVENTLOOPOS_LOCAL_EVENTS_PATH`, and returns generic event-ish `items[]` for MCP poll routing.
- Read-only `agent-slack` MCP wrapper exists for Jason dogfood. `config/mcp-sources.agent-slack.example.json` launches it over stdio, reads `EVENTLOOPOS_AGENT_SLACK_*` filters, shells out to `agent-slack search messages`, maps compact Slack search output into `slack_message_to_event` items, and accepts the orchestrator MCP cursor as an `--after YYYY-MM-DD` fallback when no explicit `EVENTLOOPOS_AGENT_SLACK_AFTER` is set. It does not expose Slack write tools. Same-day refetch is expected; idempotency/cursor dedupe owns exact duplicate suppression.
- Read-only `gh` notifications MCP wrapper exists for Jason dogfood. `config/mcp-sources.gh-notifications.example.json` launches it over stdio, shells out to `gh api -X GET notifications` or `repos/<owner>/<repo>/notifications`, maps GitHub notification threads into `github_update_to_event` items, and uses notification `updated_at` as the MCP cursor/GitHub `since` timestamp. It does not expose GitHub write tools.
- `GET /metrics` and `GET /activity?limit=` expose local dogfood counters and recent activity. Postgres mode persists them across orchestrator restarts; in-memory mode keeps current-process history. Current coverage records event routing, queue done, context restore request/done/failed/retry, and MCP poll cycles.
- `pnpm run dogfood:review` prints a local daily-ish review from `/metrics` and `/activity`; set `EVENTLOOPOS_DOGFOOD_REVIEW_FORMAT=json` for agent-readable output. The report now includes derived rates, task rollups, task-session rollups, queue rollups, queue time-to-done, daily rollups, and adjacent-day trend deltas.
- Restore activity and counters include provider-specific created/done/failed/retried data, and `dogfood:review` groups provider restore success/failure.
- Task followups record attempted plus sent/blocked/failed activity with origin, task session ID, idempotency key, event IDs, and text length, giving a lightweight outbox-style audit trail without a separate durable outbox table.
- Postgres and in-memory gateway stores now persist durable `task_messages` by idempotency key. Records keep internal stable IDs, runtime message IDs in sanitized message metadata, task/session/event linkage, status, payload hash/length, native thread/turn IDs when available, timestamps, and error summary.
- Duplicate task followups now return the durable stored result before runtime side effects, without incrementing counters or writing duplicate activity. Activity details sanitize runtime messages so raw followup text is not stored in metrics/history.
- `GET /task-messages` and `pnpm task:messages` expose filtered task-message lineage by task session, task, queue item, event, status, and idempotency key. Responses include text hash/length and sanitized runtime metadata, not raw followup text.
- Task followup chaos tests prove an event-route runtime failure or blocked followup creates a human queue fallback, records attempted/failed or attempted/blocked activity, and dedupes retry without sending another task message.
- Task-message policy tests prove direct followups with prompt-injection-looking text are blocked before runtime send, and task-hinted events with suspicious source text become human queue items instead of agent injections.
- Terminal task-session adapter tests prove visible-draft safety: omitted `submit` sends text only, does not press Enter, and does not append a Ghostty newline. Tmux argv and Ghostty AppleScript escaping are covered for shell-ish text, multiline text, and escaped targets.
- Queue defer/ignore API tests and Postgres tests prove deferred items disappear from active queue until due, then requeue; ignored items stop leasing. Mac Swift tests prove `HTTPQueueClient` sends correct defer/ignore request bodies, fake client mutates active queue state, and `QueueViewModel` advances to the next item after defer/ignore.
- Workspace restore idempotency tests prove duplicate restore calls with the same `Idempotency-Key` return the cached receipt without re-planning or re-executing, and Postgres restart tests prove the cached receipt survives a new orchestrator server.
- Mac live client smoke is skipped in normal CI and runs inside `pnpm run test:e2e:live:boot` via `EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL`.
- Mac unit tests cover Manual Mode workspace capture/restore through `HTTPWorkspaceClient.capture()`, exit-time manual workspace capture, and `QueueViewModel.confirmManualWorkspaceRestore()`.
- `pnpm run dev:dogfood:smoke` starts orchestrator + Mac queue app in empty in-memory mode, waits for health, launches the queue app, then exits automatically after a short smoke window.
- Real local-events MCP dogfood proof passed again after the SDK read-only tool gate: started orchestrator with `ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.local-events.example.json` and `EVENTLOOPOS_LOCAL_EVENTS_PATH=config/local-events.example.json`, ran `poll:mcp:once`, saw 1 event routed into a human queue item.
- Real agent-slack MCP no-content smoke passed with an impossible query and content cap: started orchestrator with `ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.agent-slack.example.json`, `EVENTLOOPOS_AGENT_SLACK_QUERY='eventloopos-impossible-query-4388-no-results'`, `EVENTLOOPOS_AGENT_SLACK_LIMIT=1`, and `EVENTLOOPOS_AGENT_SLACK_MAX_CONTENT_CHARS=80`; `poll:mcp:once` returned 0 events, 0 errors, proving the wrapper starts and passes the read-only tool metadata gate without printing Slack content.
- `gh` notifications wrapper tests prove read-only MCP tool metadata, `gh api` argv construction, cursor-to-`since`, notification-to-GitHub event item mapping, and common API URL to browser deeplink conversion without live GitHub content.
- `pnpm proof:agent` runs a local proof bundle and writes `artifacts/proof-manifest.json` plus per-command stdout/stderr logs under `artifacts/proof-agent/<run-id>/`. Default commands are lint, typecheck, test, and test:e2e. `EVENTLOOPOS_PROOF_COMMANDS` lets agents smoke the manifest writer without recursive full proof.
- `pnpm run ci` now runs `pnpm test:proof-agent` first to prove the override/manifest path with a cheap `node --version` command, then runs the full `pnpm proof:agent` bundle as the required correctness gate.
- `pnpm dogfood:check` exits non-zero when local dogfood thresholds fail. Checks currently cover ignored queue rate, restore success, task followup failures, stale queue leases, and pending restore age.
- `pnpm dogfood:check` also reads attempted task-message history through `/task-messages?status=attempted` and fails when a task message stays in `attempted` longer than `EVENTLOOPOS_DOGFOOD_MAX_ATTEMPTED_TASK_MESSAGE_AGE_MS`.
- `pnpm proof:live` writes `artifacts/proof-live-manifest.json`, runs `test:e2e:live:boot` with dogfood threshold checks against the temp live orchestrator before shutdown, runs provider deeplink proof, runs live Mac queue mutation + task handoff smokes, then runs `task:runtime-smoke`.
- `pnpm test:e2e:macos-live-ui` starts a temp live orchestrator, launches the packaged Mac queue app against it, uses AppleScript/System Events to click `Pull Next Paper` and `Done / Next`, then asserts `/queue?state=done`, `/activity`, and `/metrics` changed. `pnpm proof:live` now includes this smoke.
- `pnpm test:e2e:macos-live-handoff` starts a temp live orchestrator with a task-bound packet, launches the packaged Mac queue app, clicks `Pull Next Paper` and `Route to task agent`, then asserts `/queue?state=done`, `/activity`, `/metrics`, and `/task-sessions` prove the followup was sent and `task_session_blog` moved to `running`. `pnpm proof:live` includes this smoke.
- macOS render E2E now writes inspectable screenshots to `artifacts/screenshots/queue-window-selected-packet.png` and `artifacts/screenshots/queue-window-long-packet.png`; the long-content fixture catches basic one-paper wrapping/nonblank regressions.
- Mac queue has a one-step Pull Next Paper action in the menu, command menu, toolbar, and global hotkey (`Cmd+Opt+Shift+J`). It leases the top/current packet, returns from Manual Mode when needed, captures the manual workspace before return, loads matching task sessions, and plans queue workspace restore.
- Opening or refreshing the Mac queue is read-only now: it loads the stack without selecting/leasing an active paper. `Pull Next Paper` is the canonical action that turns a queued packet into the current paper.
- Router-created review packets now use human-block-specific decision copy: task-matched packets ask for approval before sending an update back to the task agent, while unmatched packets say there is no confident task match.
- Router decisions now tag human-queue creation with `human_queue_reason`: `human_blocked`, `ambiguous`, or `risky`. This keeps queue creation aligned to the intake-stack model instead of generic “ask human” routing.
- Real local Postgres + local-events MCP dogfood proof passed: started Docker Postgres, ran orchestrator with `DATABASE_URL`, `ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.local-events.example.json`, and `EVENTLOOPOS_LOCAL_EVENTS_PATH=config/local-events.example.json`, ran `poll:mcp:once`, saw one ambiguous human-queue packet, then `dogfood:check` passed. After orchestrator restart, `/queue`, `/activity`, and `/metrics` still showed the routed item and counters from Postgres.
- `pnpm run test:e2e:postgres-mcp-dogfood` now automates that proof: Docker Postgres up/down, local-events MCP poll, dogfood threshold check, orchestrator restart, persisted queue/activity/metrics assertions.
- `pnpm run test:e2e:claude-real-followup` is a gated real Claude smoke. Without `EVENTLOOPOS_ENABLE_REAL_CLAUDE_SMOKE=1` it prints a machine-readable skip. With the flag it creates a disposable Claude session using Haiku, disables tools, caps per-call budget, starts orchestrator with that session, sends a followup through `/task-sessions/:id/followup`, and asserts the task message is `sent` with the same native session ID.
- `pnpm run test:e2e:provider-deeplink` starts a temp orchestrator with local-events MCP fixtures and proves Slack permalink, GitHub code-line permalink, and generic browser URL resources survive MCP mapping into stored event context with provider details, restore confidence, and confidence reasons. `pnpm proof:live` includes this deterministic smoke.
- Opt-in AppleScript UI smoke now proves the Pull Next Paper menu item exists and that Manual Mode captures workspace only on return to Event Loop, then Restore Manual Workspace returns the user to manual mode.

Weak tests:

- Docker-backed Postgres live tests pass on this machine after launching Docker.app; native Postgres live tests also pass.
- AeroSpace live restore needs installed/running AeroSpace. Local live smoke proves capture, planning, and opt-in one-window restore execution; it does not prove full multi-window layout reconstruction under every app/window edge case.
- No full XCUITest flow; current coverage proves Mac client/orchestrator/browser-extension restore round-trip, real installed extension/native host/orchestrator browser capture, rendered Mac queue view, temp `.app` bundle launch, and opt-in AppleScript menu/window/manual-mode interaction.
- No real microphone wake-word proof yet. This is deferred; current optional coverage proves fixture-audio STT with `whisper-cli`, local transcript command pipe, whisper.cpp stream command construction, doctor readiness checks, and router contract with fake process output.
- Activity history is durable in Postgres mode and process-local in in-memory mode. The report groups by task/session/queue and compares adjacent days when the selected window spans multiple days.
- `server.ts` is much smaller: task-session injection policy, task followup audit, observability routes, task-session routes, context/context-restore routes, queue routes, workspace routes, MCP source routes, and events/voice/review-packet routes have been extracted into smaller modules. It is down to roughly 250 lines after the task-session route split.

## Next Best Work

1. Add stricter runtime normalization later only if provider-specific metadata starts leaking into queue UI or history.
2. Decide whether to promote `test:e2e:postgres-mcp-dogfood` and gated `test:e2e:claude-real-followup` into `proof:live` when local capabilities are available.
3. Add app bundle/XCUITest smoke only if the current SwiftUI render, launch, AppleScript, and live Mac handoff smokes stop catching enough UI regressions.
4. Add Notion/GDocs/Figma dogfood only if they appear in Jason's real loop.
5. Later: real microphone/wake-word proof and always-listening voice UX.
