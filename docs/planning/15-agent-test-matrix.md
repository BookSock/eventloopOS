# Agent Test Matrix

This is the current reality map for agents. Pick the narrowest command that proves the thing you changed, then run the broader gate before handoff when behavior crosses a boundary.

## Always Useful

| Change area | Fast proof | Broader proof | Evidence produced |
| --- | --- | --- | --- |
| Any code change | `make ci` | `pnpm run test:e2e:live:boot` | Terminal pass/fail, harness artifacts |
| Command/script wiring | `pnpm run typecheck` | `make ci` | Node syntax checks, Swift build, package tests |
| Current MVP live spine | `pnpm run test:e2e:live:boot` | `pnpm run test:e2e:live:full` | Orchestrator boot, live scenarios, native/browser/Mac smoke |
| Dogfood stack launch | `pnpm run dev:dogfood:smoke` | `pnpm run dev:dogfood` | Orchestrator + Mac queue app startup path |
| Planning/scope docs | `rg "intake stack|aggressive interruption|dogfood metrics|deeplink" docs/planning` | docs review | Confirms agents read current scope before adding calendar/notification/voice-out work |

## Subsystem Proofs

| Subsystem | Command | What it proves | Notes |
| --- | --- | --- | --- |
| Orchestrator API + router | `pnpm --filter @eventloopos/orchestrator test` | Event routing, queue lease/done, task sessions, MCP polling, workspace API, voice command path | Docker-backed DB tests skip without container runtime. |
| Ambient context routing | `app/test-harness/bin/run-scenario ambient_context_route --orchestrator-url http://127.0.0.1:4377` | Stored task-bound browser context lets an unhinted Slack-style event inject into the matching task session without queueing human review | Included in `pnpm run test:e2e:live:boot`. |
| MCP ambient context routing | `app/test-harness/bin/run-scenario mcp_ambient_context_route --orchestrator-url http://127.0.0.1:4377` | Generic MCP poll item with no `task_hint` routes through stored task context into the matching task session | Included in `pnpm run test:e2e:live:boot`. |
| Local events MCP dogfood | `EVENTLOOPOS_LOCAL_EVENTS_PATH=config/local-events.example.json ORCHESTRATOR_MCP_SOURCES_PATH=config/mcp-sources.local-events.example.json pnpm --filter @eventloopos/orchestrator start`, then `pnpm --filter @eventloopos/orchestrator run poll:mcp:once` | File-backed local MCP server is launched over stdio, polled by orchestrator, and routed into queue/task path | Passed locally; stop the orchestrator after the probe. |
| Local activity/metrics | `pnpm --filter @eventloopos/orchestrator test` | `/metrics` and `/activity` record event routing and queue done counters in-memory | Durable Postgres history not covered yet. |
| Postgres queue store | `pnpm run test:db:docker` or `pnpm run test:db:native` | Migrations, idempotent events, queue leases, stale lease reap, context restore request persistence against real Postgres | Docker path uses temp container; native path uses temp local cluster and deletes it. Both passed locally. |
| Browser extension | `pnpm run test:e2e:browser` | MV3 extension capture/restore in Chromium via Playwright persistent context, including distinct restore-request lease owners across two Chromium profiles | No real native host unless opt-in smoke is used. |
| Installed native browser bridge | `pnpm run test:e2e:native-browser` | Installed Chromium native messaging manifest, real extension `chrome.runtime.sendNativeMessage`, native host forwarding to fixture server | Mutates and restores temporary native messaging manifests. |
| Installed native browser + real orchestrator | `pnpm run test:e2e:native-browser-real-orchestrator` | Real orchestrator receives browser capture through installed extension/native host, routes `store_only`, creates no queue item, stores searchable context | Starts its own orchestrator on random port. |
| Mac client + browser restore | `pnpm run test:e2e:mac-browser-restore` | Swift `HTTPQueueClient` creates a real restore request, Chromium extension claims it, restores the tab/scroll, and marks request done | Uses unpacked Chromium extension, not app bundle/XCUITest. |
| macOS queue UI render + launch | `pnpm run test:e2e:macos` | Real SwiftUI `QueueWindowView` renders seeded queue data to nonblank image, then built temp `.app` launches in test mode and stays alive | No XCUITest interaction yet. |
| macOS app launch | `pnpm run test:e2e:macos-launch` | Builds `EventLoopQueueApp`, launches it in test mode, verifies it stays alive, and terminates it | Smoke only; no UI interaction assertions. |
| macOS app UI interaction | `EVENTLOOPOS_ENABLE_MACOS_UI_SMOKE=1 pnpm run test:e2e:macos-ui` | Builds temp `.app`, opens menu bar extra, opens queue window, toggles Manual Mode, toggles back to Event Loop, then terminates exact bundle process | Requires macOS Accessibility permission for `osascript`/System Events; not default CI. |
| macOS client + live orchestrator | `pnpm run test:e2e:live:boot` | Booted orchestrator plus Mac `HTTPQueueClient` context restore request round-trip | Also runs live harness/native/browser smoke. |
| Full local installed smoke | `pnpm run test:e2e:live:full` | One booted orchestrator reused by harness scenarios, Mac client smoke, browser E2E, and installed Chromium extension/native host capture | Best local daily-driver verifier. |
| AeroSpace backend | `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE=1 pnpm run live:aerospace` | Live AeroSpace status/capture/restore-plan without executing moves | Requires AeroSpace.app running; passed locally with real window capture and non-executing restore plan. Add `EVENTLOOPOS_ENABLE_LIVE_AEROSPACE_EXECUTE=1` to move one real window to scratch workspace and restore it. |
| Voice transcript command | `pnpm run voice:listen-command` with `EVENTLOOPOS_VOICE_TRANSCRIPT_COMMAND` or `EVENTLOOPOS_VOICE_STT_PRESET=whisper_cpp_stream` | External line-delimited STT command can feed router; whisper.cpp stream preset builds mic command from env | Fake process path and preset construction are unit-tested; real mic/audio proof still pending. |
| Voice fixture STT | `EVENTLOOPOS_ENABLE_VOICE_STT_SMOKE=1 EVENTLOOPOS_WHISPER_MODEL=<ggml-model> pnpm run voice:stt-smoke` | macOS `say` generates audio, `ffmpeg` converts it, real `whisper-cli` transcribes it, expected terms are checked | Requires `whisper-cpp`, `ffmpeg`, macOS `say`, and a local GGML model; passed locally with `ggml-tiny.en.bin`. |
| Dev readiness | `pnpm run dev:doctor` | JSON readiness for orchestrator health, AeroSpace, Docker, browser E2E, Mac/browser restore smoke prerequisites, optional MCP source config, optional STT command, Codex app-server | Doctor is a readiness report, not a substitute for smoke tests. |

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

- Real XCUITest interaction is not scaffolded. Current Mac UI proof is SwiftUI render smoke, temp `.app` launch smoke, opt-in AppleScript menu/window/manual-mode smoke, and HTTP client live smoke.
- Real AeroSpace live proof needs AeroSpace.app running. Opt-in execute smoke proves one real window move/restore, not full multi-window layout reconstruction under every edge case.
- Docker Postgres proof needs Docker daemon running. Docker-backed and native Postgres proofs passed locally.
- Real microphone/wake-word proof is not implemented. Fixture-audio STT, transcript command pipe, and whisper.cpp stream command construction are test-covered.
- Full installed Mac app UI flow still needs XCUITest interaction proof.
