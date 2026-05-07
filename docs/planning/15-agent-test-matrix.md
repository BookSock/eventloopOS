# Agent Test Matrix

This is the current reality map for agents. Pick the narrowest command that proves the thing you changed, then run the broader gate before handoff when behavior crosses a boundary.

## Always Useful

| Change area | Fast proof | Broader proof | Evidence produced |
| --- | --- | --- | --- |
| Any code change | `make ci` | `pnpm run test:e2e:live:boot` | Terminal pass/fail, harness artifacts |
| Command/script wiring | `pnpm run typecheck` | `make ci` | Node syntax checks, Swift build, package tests |
| Current MVP live spine | `pnpm run test:e2e:live:boot` | `pnpm run test:e2e:live:full` | Orchestrator boot, live scenarios, native/browser/Mac smoke |

## Subsystem Proofs

| Subsystem | Command | What it proves | Notes |
| --- | --- | --- | --- |
| Orchestrator API + router | `pnpm --filter @eventloopos/orchestrator test` | Event routing, queue lease/done, task sessions, MCP polling, workspace API, voice command path | Docker-backed DB tests skip without container runtime. |
| Postgres queue store | `pnpm run test:db:native` | Migrations, idempotent events, queue leases, stale lease reap, context restore request persistence against real local Postgres | Uses temp native Postgres cluster and deletes it. |
| Browser extension | `pnpm run test:e2e:browser` | MV3 extension capture/restore in Chromium via Playwright persistent context, including distinct restore-request lease owners across two Chromium profiles | No real native host unless opt-in smoke is used. |
| Installed native browser bridge | `pnpm run test:e2e:native-browser` | Installed Chromium native messaging manifest, real extension `chrome.runtime.sendNativeMessage`, native host forwarding to fixture server | Mutates and restores temporary native messaging manifests. |
| Installed native browser + real orchestrator | `pnpm run test:e2e:native-browser-real-orchestrator` | Real orchestrator receives browser capture through installed extension/native host, routes `store_only`, creates no queue item, stores searchable context | Starts its own orchestrator on random port. |
| Mac client + browser restore | `pnpm run test:e2e:mac-browser-restore` | Swift `HTTPQueueClient` creates a real restore request, Chromium extension claims it, restores the tab/scroll, and marks request done | Uses unpacked Chromium extension, not app bundle/XCUITest. |
| macOS queue UI render | `pnpm run test:e2e:macos` | Real SwiftUI `QueueWindowView` renders seeded queue data to nonblank image | No app bundle/XCUITest yet. |
| macOS client + live orchestrator | `pnpm run test:e2e:live:boot` | Booted orchestrator plus Mac `HTTPQueueClient` context restore request round-trip | Also runs live harness/native/browser smoke. |
| Full local installed smoke | `pnpm run test:e2e:live:full` | One booted orchestrator reused by harness scenarios, Mac client smoke, browser E2E, and installed Chromium extension/native host capture | Best local daily-driver verifier. |
| AeroSpace backend | `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1 pnpm run live:aerospace` | Live AeroSpace status/capture/restore-plan without executing moves | Currently reports `server_unavailable` if AeroSpace.app is not running. |
| Voice transcript command | `pnpm run voice:listen-command` with `EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND` | External line-delimited STT command can feed router | Fake process path is unit-tested; real mic/STT still pending. |
| Dev readiness | `pnpm run dev:doctor` | JSON readiness for orchestrator health, AeroSpace, Docker, browser E2E, Mac/browser restore smoke prerequisites, optional STT command, Codex app-server | Doctor is a readiness report, not a substitute for smoke tests. |

## Agent Handoff Rule

Every agent handoff should include:

```text
Changed:
Smallest proof:
Broader proof:
Artifacts:
Known gap:
Next command:
```

Do not claim a subsystem works from `make ci` alone when the subsystem requires opt-in live state. Use the subsystem proof above.

## Known Weak Spots

- Real app bundle/XCUITest is not scaffolded. Current Mac UI proof is SwiftUI render smoke plus HTTP client live smoke.
- Real AeroSpace live proof needs AeroSpace.app running.
- Docker Postgres proof needs Docker daemon. Native Postgres proof is available and passed locally.
- Real microphone/STT proof is not implemented. Transcript command pipe is test-covered with fake process output.
- Full installed Mac app UI flow still needs app bundle/XCUITest proof.
