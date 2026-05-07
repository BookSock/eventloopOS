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
- Chrome alarm wakes poller.
- Poller claims work through `/contexts/restore-requests/claim-next`.
- Poller restores browser tab/scroll.
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
- Workspace restore planning pause in manual mode.
- Context resource restore request from queue UI.
- Restore request status refresh.
- Automatic restore request status polling while Mac UI is open.
- UI shows queued/done/failed restore state.

Gap:

- No real installed Chrome extension + Mac app combined live UI test yet.

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
- Native Postgres test runner creates a throwaway local cluster, runs live DB tests, stops server, and deletes temp data when Docker daemon is unavailable.
- Doctor checks orchestrator health, AeroSpace, Docker, browser Playwright readiness, optional voice transcript command readiness, and Codex app-server.
- `pnpm --filter @eventloopos/orchestrator run live:aerospace` builds and emits a machine-readable skip by default. With `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1`, it checks live AeroSpace status/capture/restore-plan without executing workspace moves.
- `voice:listen-command` runs a configured local STT command and pipes line-delimited transcripts into the same wake-phrase voice router. Command args are JSON argv, not shell-parsed strings.

Gap:

- Browser extension has one fixed lease owner; installed multi-profile behavior still needs live proof.
- Docker Postgres dev runner exists (`pnpm --filter @eventloopos/orchestrator run test:db:docker`) but has not passed here because local Docker daemon is absent. Native runner passed locally with `pnpm run test:db:native`.

## Testing Loop

Strong tests now:

- Unit tests for contracts, routing, MCP polling, task sessions, workspace, browser extension, native host, Mac view model.
- Fixture E2E for agent loops.
- Live harness scenario for browser store-only + restore request peek/claim/done status.
- Real Chromium Playwright extension E2E.
- Opt-in installed Chromium native messaging smoke that verifies extension -> native host -> orchestrator forwarding with real `chrome.runtime.sendNativeMessage`; passed locally on 2026-05-06.
- `voice:listen` accepts line-delimited local STT transcript streams, optional wake phrase filtering, and forwards into `/voice/commands`.
- `voice:listen-command` lets whisper.cpp stream, MLX Whisper wrappers, or other local STT tools feed the same router while staying unit-testable through an injected process.
- `dev:doctor` reports whether `EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND` is configured and can launch with `--help`; unconfigured voice command is treated as optional/pass.
- Mac live client smoke is skipped in normal CI and runs inside `pnpm run test:e2e:live:boot` via `EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL`.

Weak tests:

- Docker-backed Postgres live tests skip when Docker absent, but native Postgres live tests pass on this machine.
- AeroSpace live restore needs installed/running AeroSpace.
- AeroSpace live smoke exists, but `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1 pnpm --filter @eventloopos/orchestrator run live:aerospace` currently reports `server_unavailable` because AeroSpace.app is not running.
- No full installed extension + native host + Mac app manual UI flow; current coverage proves Mac client/orchestrator API round-trip and rendered Mac queue view, but not one combined installed flow.
- No real microphone wake-word/STT test yet; current coverage proves the local transcript command pipe and router contract with fake process output.

## Next Best Work

1. Run Docker/Postgres DB tests on machine with Docker daemon and record pass/fail.
2. Add installed extension + native host + Mac app rendered UI smoke.
3. Add real microphone/STT adapter feeding `voice:listen` (whisper.cpp, MLX Whisper, or macOS Speech).
