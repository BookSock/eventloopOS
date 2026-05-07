# Current MVP State

## Build Truth

Repo now has working MVP spine:

- Mac queue app = human review surface.
- Orchestrator = event router, queue, context store, task-session bridge, workspace planner.
- Browser extension = Chrome tab capture, restore, config, poll loop.
- Native host = Chrome Native Messaging bridge.
- Test harness = repeatable agent feedback loop.

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
- Poller calls `/contexts/restore-requests/next`.
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
- Workspace restore planning pause in manual mode.
- Context resource restore request from queue UI.
- Restore request status refresh.
- UI shows queued/done/failed restore state.

Gap:

- No polished menu bar app shell yet.
- No automatic polling of restore status from Mac UI; user clicks refresh.
- No real installed Chrome extension + Mac app combined live UI test yet.

## Orchestrator Loop

Done:

- `POST /events` routes events.
- Passive browser context can be `store_only`, no human queue noise.
- Task-hinted events can route into task session.
- `GET /contexts` ranked search.
- `POST /contexts/restore-plan`.
- `POST /contexts/restore-requests`.
- `GET /contexts/restore-requests/next`.
- `POST /contexts/restore-requests/:id/done`.
- `GET /contexts/restore-requests/:id`.
- Idempotency key support for restore request creation.
- Doctor checks orchestrator health, AeroSpace, Docker, browser Playwright readiness, Codex app-server.

Gap:

- Restore requests still in memory.
- No claim/lease on restore request poll; one browser extension assumed.
- Postgres queue exists, but restore request persistence not done.

## Testing Loop

Strong tests now:

- Unit tests for contracts, routing, MCP polling, task sessions, workspace, browser extension, native host, Mac view model.
- Fixture E2E for agent loops.
- Live harness scenario for browser store-only + restore request status.
- Real Chromium Playwright extension E2E.

Weak tests:

- Postgres live tests skip when Docker absent.
- AeroSpace live restore needs installed/running AeroSpace.
- No full installed extension + native host + Mac app manual UI flow.
- No local voice wake-word/STT test.

## Next Best Work

1. Persist context restore requests in Postgres/in-memory store abstraction.
2. Add restore request claim/lease so duplicate extensions cannot process same pending item.
3. Add Mac auto-refresh for requested restore status.
4. Add installed Chrome/native-host live smoke with real extension ID.
5. Add tiny dev command that boots orchestrator + browser E2E + harness as one command.
6. Add local voice capture/wake-word adapter behind same `/voice/commands` path.
