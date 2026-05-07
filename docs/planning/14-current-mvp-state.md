# Current MVP State

## Build Truth

Repo now has working MVP spine:

- Mac queue app = human review surface.
- Orchestrator = event router, queue, context store, task-session bridge, workspace planner.
- Browser extension = Chrome tab capture, restore, config, poll loop.
- Native host = Chrome Native Messaging bridge.
- Test harness = repeatable agent feedback loop.
- `pnpm run test:e2e:live:boot` boots orchestrator, runs live harness/native/browser E2E, then stops server.

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
- Doctor checks orchestrator health, AeroSpace, Docker, browser Playwright readiness, Codex app-server.

Gap:

- Postgres restore-request live test skips locally when Docker/container runtime is absent.
- Browser extension has one fixed lease owner; installed multi-profile behavior still needs live proof.
- Docker Postgres dev runner exists (`pnpm --filter @eventloopos/orchestrator run test:db:docker`) but has not passed here because local Docker daemon is absent.

## Testing Loop

Strong tests now:

- Unit tests for contracts, routing, MCP polling, task sessions, workspace, browser extension, native host, Mac view model.
- Fixture E2E for agent loops.
- Live harness scenario for browser store-only + restore request peek/claim/done status.
- Real Chromium Playwright extension E2E.
- Opt-in installed Chromium native messaging smoke that verifies extension -> native host -> orchestrator forwarding with real `chrome.runtime.sendNativeMessage`; passed locally on 2026-05-06.
- `voice:listen` accepts line-delimited local STT transcript streams, optional wake phrase filtering, and forwards into `/voice/commands`.

Weak tests:

- Postgres live tests skip when Docker absent.
- AeroSpace live restore needs installed/running AeroSpace.
- No full installed extension + native host + Mac app manual UI flow.
- No local voice wake-word/STT test.

## Next Best Work

1. Run Docker/Postgres DB tests on machine with Docker daemon and record pass/fail.
2. Add real microphone/STT adapter feeding `voice:listen` (whisper.cpp, MLX Whisper, or macOS Speech).
