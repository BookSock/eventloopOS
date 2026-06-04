# eventloopOS Human Demo Completion Audit

Status: automated proof is green; human hands-on walkthrough is still pending.

Use this audit to decide whether the macOS non-tiling workspace UX goal can close. Do not mark the goal complete until the Human Gate is filled from a real keyboard/mouse walkthrough.

## Current Evidence

- Latest automated human demo: `artifacts/lab-runs/20260603-132623-human-demo/manifest.json`
- Latest demo screenshot: `artifacts/lab-runs/20260603-132623-human-demo/screen-sharing.png`
- Current result template/artifact writer: `bin/human-demo-result-template --write`
- Current result verifier: `bin/human-demo-result-verify --lab-status`
- Walkthrough: `docs/human-demo-walkthrough.md`
- Mac Studio status check: `bin/lab-mac-dogfood status`

## Requirement Audit

| Requirement | Evidence | Status |
| --- | --- | --- |
| AeroSpace profile floats by default | `config/aerospace/eventloopos-floating.toml` enables `experimental-force-floating-windows = true` and `[[on-window-detected]] run = "layout floating"`; `bin/macos-aerospace-profile --self-test`; `app/orchestrator/src/config/aerospace_profile.test.ts` | Proven |
| Rectangle-compatible hotkeys | `config/aerospace/eventloopos-floating.toml`; `bin/macos-window-snap`; hotkey profile tests; `bin/macos-aerospace-profile` safe override support | Proven |
| Event-loop hotkey conflicts avoided | `ctrl-alt-enter`, `ctrl-alt-j`, `ctrl-alt-k`, `ctrl-alt-r`, `ctrl-alt-m`, `ctrl-alt-shift-m` rejected or avoided by profile validation | Proven |
| Exact floating geometry capture/restore | `app/orchestrator/src/workspace/aerospace.ts`; focused AeroSpace workspace tests; live human demo manifest shows `layout: "floating"` and frame `x/y/width/height` restored | Proven |
| Missing/stale windows skipped | `app/orchestrator/src/workspace/aerospace.test.ts` stale-window coverage | Proven |
| One window in multiple papers with different positions | Human demo manifest proves shared TextEdit window id appears in both demo paper snapshots with different frames and restores both ways | Proven by automation |
| Later saves do not destroy older paper snapshots | Human demo ambient probe updates customer context, then final customer restore is re-proven; task workspace memory tests cover separate task layouts | Proven by automation |
| Ambient autosave after move | Human demo `proofs.ambient_autosave.ok=true`; `ambient_workspace_saver` unit/integration tests; live activity emits save/skip events | Proven by automation |
| Snapshot capture avoids unrelated lab/system windows | Human demo queue context includes only shared TextEdit and matching Chrome; ambient saver filtering tests cover blocklisted apps | Proven by automation |
| Autosave observability | `/activity` shows `ambient_workspace_save_*`; `ambient_workspace_saver` tests cover commit/skip/fail paths | Proven |
| Local Screen Sharing window-only capture | `bin/local-screen-sharing-capture`; capture manifests use `capture_mode=local_screen_sharing_window`; screenshots show only Screen Sharing window | Proven |
| Repeatable human demo setup | `bin/lab-mac-human-demo-setup`; latest manifest `ok=true`, queue count 2 | Proven |
| Visible feedback during demo | Queue footer `feedback=...`; `QueueHarnessStatusTextTests`; `QueueViewModelTests` post-action lease-conflict coverage proves Done/Defer/Send show saved-action feedback instead of surfacing 409 noise; latest screenshot shows `feedback=ready` | Proven |
| Human keyboard/mouse UX | Jason must run `docs/human-demo-walkthrough.md`, fill `bin/human-demo-result-template --write` output, and pass `bin/human-demo-result-verify --lab-status` | Pending |

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
that manifest as the final machine-readable closeout evidence.

## Current Blockers

- Human dogfood is not yet recorded.

## Non-Blocking Notes

- Remote Mac Studio repo can be synced to latest `main` without restarting the demo when changes are docs/tests/helpers only.
- Human demo proof artifacts are controller-side artifacts; they are not expected to exist under the remote Mac repo after `bin/lab-mac-sync`.
