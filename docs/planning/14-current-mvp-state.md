# Current MVP State

## Build Truth

Repo now has working MVP spine:

- Mac queue app = human review surface.
- Orchestrator = event router, queue, context store, task-session bridge, workspace planner.
- Browser extension = Chrome tab capture, restore, config, poll loop.
- Native host = Chrome Native Messaging bridge.
- Test harness = repeatable agent feedback loop.
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
- Menu bar shell with queue count, selected item, mode, restore state, open queue, refresh, done/next, and mode toggle.
- Full window empty/loading/error placeholders with retry affordance and unit-covered presentation copy.
- Render smoke test for real SwiftUI `QueueWindowView` using seeded queue data and nonblank image pixel check.
- Launch smoke test builds `EventLoopQueueApp`, packages a temporary `.app` bundle, starts it in test mode through Launch Services, verifies it stays alive, then terminates it.
- Workspace restore planning pause in manual mode.
- Manual Mode captures the current workspace snapshot, shows saved-window count, and exposes `Restore Manual Workspace` to move back to that saved normal-computer context while keeping automation paused.
- Context resource restore request from queue UI.
- Restore request status refresh.
- Automatic restore request status polling while Mac UI is open.
- UI shows queued/done/highlighted/failed restore state.
- Live Mac client + Chromium extension restore smoke exists: Mac `HTTPQueueClient` creates a real orchestrator restore request, Chromium extension claims it, restores the tab/scroll, and Mac-readable restore request status becomes `done`.

Gap:

- No app bundle/XCUITest proof of the full installed Mac UI interaction flow yet.

## Orchestrator Loop

Done:

- `POST /events` routes events.
- Passive browser context can be `store_only`, no human queue noise.
- Task-hinted events can route into task session.
- `GET /contexts` ranked search.
- `POST /contexts/restore-plan`.
- `POST /contexts/restore-requests`.
- `GET /contexts/restore-requests/next` as read-only peek.
- `POST /contexts/restore-requests/claim-next` leases one pending restore request.
- `POST /contexts/restore-requests/:id/done`.
- `GET /contexts/restore-requests/:id`.
- Idempotency key support for restore request creation.
- Restore request persistence through same in-memory/Postgres store abstraction as queue storage.
- Expired restore request leases get reaped and reclaimed.
- Docker-backed Postgres tests pass locally with `pnpm run test:db:docker`. Native Postgres test runner also creates a throwaway local cluster, runs live DB tests, stops server, and deletes temp data.
- Doctor checks orchestrator health, AeroSpace, Docker, browser Playwright readiness, Mac/browser restore smoke Swift readiness, optional voice transcript command readiness, and Codex app-server.
- `pnpm --filter @eventloopos/orchestrator run live:aerospace` builds and emits a machine-readable skip by default. With `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1`, it checks live AeroSpace status/capture/restore-plan without executing workspace moves. With `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE_EXECUTE=1`, it also moves one real window to a scratch workspace, restores it, and verifies it returned.
- `voice:listen-command` runs a configured local STT command and pipes line-delimited transcripts into the same wake-phrase voice router. Command args are JSON argv, not shell-parsed strings.
- `voice:listen-command` also supports `EVENTLOOPOS_VOICE_STT_PRESET=whisper_cpp_stream` so local whisper.cpp microphone capture can be configured with env vars (`EVENTLOOPOS_WHISPER_MODEL`, optional step/length/keep/thread/capture/language settings) instead of manual JSON argv.
- `voice:stt-smoke` is an opt-in fixture-audio proof for local `whisper-cli`: it generates spoken audio with macOS `say`, converts it with `ffmpeg`, transcribes with a real GGML model, and checks expected transcript terms.

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
- Opt-in installed Chromium native messaging smoke that verifies extension -> native host -> orchestrator forwarding with real `chrome.runtime.sendNativeMessage`; passed locally on 2026-05-06 with `pnpm run test:e2e:native-browser`.
- Real orchestrator + installed Chromium extension/native host smoke exists as `pnpm run test:e2e:native-browser-real-orchestrator`; it starts the actual orchestrator, captures a real browser tab through native messaging, verifies `store_only`, checks no human queue item was created, and checks browser context search can find the captured tab.
- Mac client + browser restore smoke exists as `pnpm run test:e2e:mac-browser-restore`; it starts a real orchestrator, has Swift `HTTPQueueClient` create a restore request, and proves the Chromium extension claims/completes it.
- Full live boot smoke can reuse one running orchestrator for harness scenarios, Mac client live smoke, browser extension E2E, and installed Chromium extension/native host capture with `pnpm run test:e2e:live:full`.
- `queue_bind_then_recommended_action` proves the end-to-end dogfood path where agent handoff blocks before task-session binding, succeeds after binding, sends a task followup, and drains the queue.
- Opt-in invasive AeroSpace smoke passed locally with `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1 EVENTLOOPOS_ENABLE_LIVE_AEROSPACE_EXECUTE=1 pnpm run live:aerospace`; it moved window `282477` from workspace `1` to `eventloop-smoke` and restored it to `1`.
- Opt-in macOS UI automation smoke passed locally with `EVENTLOOPOS_ENABLE_MACOS_UI_SMOKE=1 pnpm run test:e2e:macos-ui`; it opens the menu bar extra, opens the queue window, toggles Manual Mode, verifies the manual workspace capture banner/menu summary, executes `Restore Manual Workspace`, verifies the restore receipt appears in the menu, and toggles back to Event Loop.
- `voice:listen` accepts line-delimited local STT transcript streams, optional wake phrase filtering, and forwards into `/voice/commands`.
- `voice:listen-command` lets whisper.cpp stream, MLX Whisper wrappers, or other local STT tools feed the same router while staying unit-testable through an injected process. The whisper.cpp stream preset is unit-covered and doctor-checked.
- Opt-in fixture-audio STT smoke passed locally with `EVENTLOOPOS_ENABLE_VOICE_STT_SMOKE=1 EVENTLOOPOS_WHISPER_MODEL=external-resources/models/whisper/ggml-tiny.en.bin pnpm run voice:stt-smoke`; transcript was `computer blog post priority changed.`
- `dev:doctor` reports whether `EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND` is configured and can launch with `--help`; unconfigured voice command is treated as optional/pass.
- Mac live client smoke is skipped in normal CI and runs inside `pnpm run test:e2e:live:boot` via `EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL`.
- Mac unit tests cover Manual Mode workspace capture/restore through `HTTPWorkspaceClient.capture()`, `QueueViewModel.enterManualModeAndCaptureWorkspace()`, and `QueueViewModel.confirmManualWorkspaceRestore()`.

Weak tests:

- Docker-backed Postgres live tests pass on this machine after launching Docker.app; native Postgres live tests also pass.
- AeroSpace live restore needs installed/running AeroSpace. Local live smoke proves capture, planning, and opt-in one-window restore execution; it does not prove full multi-window layout reconstruction under every app/window edge case.
- No full XCUITest flow; current coverage proves Mac client/orchestrator/browser-extension restore round-trip, real installed extension/native host/orchestrator browser capture, rendered Mac queue view, temp `.app` bundle launch, and opt-in AppleScript menu/window/manual-mode interaction.
- No real microphone wake-word proof yet; current coverage proves fixture-audio STT with `whisper-cli`, local transcript command pipe, whisper.cpp stream command construction, doctor readiness checks, and router contract with fake process output.

## Next Best Work

1. Add real microphone/wake-word smoke for local voice ingress.
2. Add app bundle/XCUITest smoke for installed Mac UI flow beyond the current AppleScript UI smoke.
3. Add real microphone/STT adapter feeding `voice:listen` (whisper.cpp, MLX Whisper, or macOS Speech).
