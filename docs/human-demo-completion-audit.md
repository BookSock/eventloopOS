# eventloopOS Human Demo Completion Audit

Status: automated proof is green; human hands-on walkthrough is still pending.

Use this audit to decide whether the macOS non-tiling workspace UX goal can close. Do not mark the goal complete until the Human Gate is filled from a real keyboard/mouse walkthrough.

## Current Evidence

- Latest automated human demo and readiness artifacts are run-specific. Use
  `bin/human-demo-ready`, then read the generated
  `artifacts/lab-runs/*-human-demo-ready/READY.md` for the current proof
  manifest, screenshots, latency manifests, and suggested human result file.
- Current result template/artifact writer: `bin/human-demo-result-template --write`
- Current result verifier: `bin/human-demo-result-verify --lab-status`
- Current closeout auditor: `bin/human-demo-completion-audit --strict` (JSON output includes `next_actions` with the exact result-template, verification, and closeout commands while pending)
- Walkthrough: `docs/human-demo-walkthrough.md`
- Mac Studio status check: `bin/lab-mac-dogfood status`
- Broader non-demo UX proof: `bin/lab-mac-human-ux-proof` includes queue render, paper workspace switching, task workspace memory, Manual Mode, Codex waiting/lost auto-paper, live send-back handoff, and final orphan cleanup. It restarts and cleans the lab stack, so run it before re-staging the two-paper human demo, not during a ready-to-show demo.

## Requirement Audit

| Requirement | Evidence | Status |
| --- | --- | --- |
| AeroSpace profile floats by default | `config/aerospace/eventloopos-floating.toml` enables `experimental-force-floating-windows = true` and `[[on-window-detected]] run = "layout floating"`; `bin/macos-aerospace-profile --self-test`; `app/orchestrator/src/config/aerospace_profile.test.ts` | Proven |
| Rectangle-compatible hotkeys | `config/aerospace/eventloopos-floating.toml`; `bin/macos-window-snap`; hotkey profile tests; `bin/macos-aerospace-profile` safe override support; `bin/human-demo-ready` requires `checks.rectangle_hotkey_ok=true` from a live `Ctrl-Option-Left` shared-TextEdit movement proof | Proven |
| Event-loop hotkey conflicts avoided | `ctrl-alt-enter`, `ctrl-alt-j`, `ctrl-alt-k`, `ctrl-alt-r`, `ctrl-alt-m`, `ctrl-alt-shift-m` rejected or avoided by profile validation | Proven |
| Exact floating geometry capture/restore | `app/orchestrator/src/workspace/aerospace.ts`; focused AeroSpace workspace tests; live human demo manifest shows `layout: "floating"` and frame `x/y/width/height` restored | Proven |
| Missing/stale windows skipped | `app/orchestrator/src/workspace/aerospace.test.ts` stale-window coverage | Proven |
| One window in multiple papers with different positions | Human demo manifest proves shared TextEdit window id appears in both demo paper snapshots with different frames and restores both ways | Proven by automation |
| Later saves do not destroy older paper snapshots | Human demo ambient probe updates customer context, then final customer restore is re-proven; task workspace memory tests cover separate task layouts | Proven by automation |
| Ambient autosave after move | Human demo `proofs.ambient_autosave.ok=true`; `ambient_workspace_saver` unit/integration tests; live activity emits save/skip events | Proven by automation |
| Ambient autosave after opening a new window | Human demo `proofs.new_window_autosave.ok=true` opens a scratch TextEdit on the current paper, waits for ambient save, verifies future queue context includes the scratch window/frame, then closes it before the hands-on walkthrough; readiness requires this proof | Proven by automation |
| Snapshot capture avoids unrelated lab/system windows | Human demo queue context includes only shared TextEdit and matching Chrome; ambient saver filtering tests cover blocklisted apps | Proven by automation |
| Agent-spawned foreign window containment | Human demo `proofs.agent_spawn_window_containment.ok=true` uses `bin/task-window-spawn` to open a real Metrics-owned Chrome window while Customer is focused, proves it is claimed/moved to Metrics, and proves Customer focus is restored; readiness and completion audit require this proof | Proven by automation |
| Stuck/idle/waiting agent sessions queue human-needed papers without foreground spam | `AutoPaperCodexIdleWatcher` detects idle Codex/Claude anchors plus blocked/lost/waiting task-session statuses, suppresses current/focused task papers, dedupes repeated waiting states, and marks very old idle tasks dormant; `app/orchestrator/src/agents/auto_paper_codex_idle.test.ts`; `app/orchestrator/bin/p5-auto-paper-codex-idle-smoke`; `bin/lab-mac-human-ux-proof` command `Codex waiting/lost auto-paper proof`; `bin/event-loop-codex-completion-workspace-proof-smoke` proves real Codex completion marker -> agent-run queue -> approval back to same thread | Proven by automation; not shown in the staged two-paper hands-on demo to keep the demo queue simple |
| Autosave observability | `/activity` shows `ambient_workspace_save_*`; `ambient_workspace_saver` tests cover commit/skip/fail paths | Proven |
| Current paper briefing remains visible | Queue detail begins with `queue-paper-briefing-strip`, backed by `QueuePaperBriefingPresentation` tests, Swift render smoke screenshots, `bin/human-demo-ready` screenshot staging, and `bin/human-demo-completion-audit --strict` requiring `checks.queue_briefing_strip_visible=true` | Proven |
| Desktop paper reminder remains visible outside the queue window | The macOS app opens a non-activating floating `eventloopOS Paper Reminder` HUD with the selected paper title/decision/context and transient hotkey feedback; `QueuePaperReminderPresentation`, `PaperReminderHUDController`, and `PaperReminderFeedbackPresentation` tests cover presentation/window behavior; `bin/human-demo-ready` and completion audit require `checks.paper_reminder_hud_visible=true` and `checks.paper_reminder_feedback_ok=true` | Proven by automation |
| Screenshot capture for demo inspection | `bin/lab-mac-human-demo-setup` and `bin/human-demo-ready` default to `bin/lab-mac-desktop-capture` with `capture_mode=lab_desktop`, so routine checks do not focus the controller Mac's Screen Sharing window; demo setup/readiness skip local Screen Sharing capture unless `EVENTLOOPOS_ALLOW_LOCAL_SCREEN_SHARING_CAPTURE=1` is set; both manifests record `controller_focus`; readiness samples controller frontmost app throughout the run and fails `controller_screen_sharing_focus_ok` if Screen Sharing becomes frontmost after starting from another app; `bin/local-screen-sharing-capture` also refuses to run unless that opt-in is set and remains available only as a manual debugging helper with `capture_mode=local_screen_sharing_window`, frontmost before/after metadata, and a no-focus assertion that fails if capture changes focus; focusing Screen Sharing requires both `SCREEN_SHARING_RAISE=1` and `EVENTLOOPOS_ALLOW_SCREEN_SHARING_FOCUS=1`; `bin/human-demo-ready` requires a valid latest proof screenshot plus a fresh readiness screenshot with readable image dimensions; `bin/human-demo-result-verify` rejects missing proof/readiness screenshots | Proven by guards; rerun setup for any older no-screenshot demo artifact |
| Repeatable human demo setup | `bin/lab-mac-human-demo-setup`; latest manifest `ok=true`, queue count 3 with Customer, Metrics, and waiting-agent papers | Proven |
| Manual Mode feedback is immediate | `QueueViewModelTests/testManualModeToggleShowsFeedbackBeforeSavingTaskLayout`; `bin/human-demo-ready` requires `checks.manual_mode_feedback_ok=true`; latest `READY.md` names the current Manual Mode feedback manifest and timings | Proven by automation |
| Visible feedback during demo | Queue footer `feedback=...`; top HUD transient hotkey feedback; `QueueHarnessStatusTextTests`; `AdvanceToastBannerPresentationTests`; `QueueViewModelTests` post-action lease-conflict coverage proves Done/Defer/Send show saved-action feedback instead of surfacing 409 noise; latest readiness screenshot and `READY.md` name the current Queue, desktop HUD, hotkey, and Manual Mode feedback proof artifacts | Proven |
| Stale readiness cannot be reused silently | `bin/human-demo-ready` requires latest proof freshness by default; `bin/human-demo-result-template --write` refuses any failed readiness check; `bin/human-demo-completion-audit --strict` requires the latest readiness manifest timestamp to be within the freshness window | Proven |
| Stale result artifacts cannot be reused silently | `bin/human-demo-completion-audit` targets the current demo's expected result path from latest readiness/demo proof before falling back to older result files, so stale blank artifacts do not mask a missing current walkthrough result | Proven |
| Stale result verification cannot be reused silently | `bin/human-demo-completion-audit` only auto-selects verification manifests whose `result_path` matches the current expected result; `bin/human-demo-result-verify` records `result_sha256`; the audit compares it to the current result file and fails `verification_matches_current_result_content` after any edit | Proven |
| Human keyboard/mouse UX | Jason must run `docs/human-demo-walkthrough.md`, fill `bin/human-demo-result-template --write` output, pass `bin/human-demo-result-verify --lab-status`, and pass `bin/human-demo-completion-audit --strict` | Pending |

## Human Gate

Run:

```sh
bin/human-demo-result-template --write
```

Fill the generated `artifacts/human-demo-results/*-human-demo-result.md` checklist after the hands-on walkthrough. Goal can close only if:

- all pass/fail items are marked pass, or any failures are explicitly accepted as non-blocking,
- friction list has no production-blocking issue,
- ship/block decision says ship/accept,
- lab status remains green after walkthrough.

Verify:

```sh
bin/human-demo-result-verify artifacts/human-demo-results/<result>.md --lab-status
```

The verifier writes `artifacts/human-demo-verifications/*/manifest.json`; use
that manifest as the final machine-readable closeout evidence. It checks the
referenced proof/readiness manifests and screenshots before accepting the
checklist. Re-run the verifier after editing the result file; completion audit
rejects stale verification hashes.

Closeout audit:

```sh
bin/human-demo-completion-audit --strict
```

This must stay red until the filled result and lab-status verification exist.
By default it also rejects readiness manifests older than 24 hours. Use
`--readiness-max-age-hours` or
`EVENTLOOPOS_HUMAN_DEMO_COMPLETION_READINESS_MAX_AGE_HOURS` only when you
intentionally need a different closeout window.

## Current Blockers

- Human dogfood is not yet recorded.

## Non-Blocking Notes

- Remote Mac Studio repo can be synced to latest `main` without restarting the demo when changes are docs/tests/helpers only.
- Human demo proof artifacts are controller-side artifacts; they are not expected to exist under the remote Mac repo after `bin/lab-mac-sync`.
- The staged human demo includes a waiting-agent paper in the live queue. Use `bin/lab-mac-human-ux-proof` for broader non-demo auto-paper coverage, then rerun `bin/lab-mac-human-demo-setup` before handing the Mac to Jason.
