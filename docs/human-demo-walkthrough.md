# eventloopOS Human Demo Walkthrough

Use this for the Mac Studio hands-on dogfood walkthrough. The demo is intentionally local/fake work: two papers, two Chrome windows, and one shared TextEdit window that belongs to both papers with different saved positions.

## Setup

From the controller Mac:

```sh
bin/lab-mac-human-demo-setup
```

The setup script:

- syncs the repo to the Mac Studio,
- installs the floating-first AeroSpace profile,
- restarts the lab dogfood stack with ambient autosave and follows-windows enabled,
- clears the human-demo profile store,
- opens the demo Chrome/TextEdit windows,
- queues exactly two papers,
- proves the shared TextEdit window restores to different positions per paper,
- proves ambient autosave updates future queue context after the shared window moves,
- proves a newly opened scratch TextEdit window on the current paper is saved
  into future queue context without pressing Done/Defer/Advance, then closes it
  before the hands-on walkthrough,
- proves a background/foreign paper window is moved back to its owning paper,
- captures a local Screen Sharing window-only screenshot, or falls back to a lab Mac desktop capture when Screen Sharing is unavailable.

Before handing the keyboard to Jason, run a non-destructive readiness check:

```sh
bin/human-demo-ready
```

This does not restart or reseed the demo. It checks the current lab dogfood
stack, verifies the latest human-demo proof artifact, stages the live lab Mac
back to the Customer demo paper, captures the local Screen Sharing window first,
falls back to a lab Mac desktop capture if that local window is unavailable,
runs queue/workspace latency probes on the lab Mac by default, and writes
`artifacts/lab-runs/*-human-demo-ready/READY.md`.
The screenshot capture gate verifies the chosen artifact exists and has
readable PNG/JPEG dimensions, and the lab staging gate must pass, so readiness
cannot pass from an empty, invalid, or wrong-workspace screenshot file. The
default `auto` mode never captures the controller Mac desktop: the first attempt
is a Screen Sharing window capture after the lab has been staged, and the
fallback captures the remote lab Mac desktop over SSH. Use
`EVENTLOOPOS_HUMAN_DEMO_SCREENSHOT_TARGET=local` to require only the local
Screen Sharing window, or `EVENTLOOPOS_HUMAN_DEMO_SCREENSHOT_TARGET=lab` to use
only the lab Mac desktop capture.
Run `bin/human-demo-ready` after the queue app has Accessibility permission. By
default the latest proof must be no older than 24 hours; use
`EVENTLOOPOS_HUMAN_DEMO_PROOF_MAX_AGE_HOURS` or
`--demo-proof-max-age-hours` to change that window. It also writes read-only
queue/master latency and workspace capture/restore-plan latency manifests, so
demo readiness proves the Queue path and workspace path are responsive without
mutating the active paper. On macOS it includes a live hotkey-to-feedback p95
latency gate in the readiness artifact by running the latency probe on the Mac
Studio. Use `--skip-hotkey-latency` only while bootstrapping permission setup.
`READY.md` also names the suggested human result file so the final checklist
does not accidentally reuse an older blank artifact.
Use `EVENTLOOPOS_HUMAN_DEMO_QUEUE_LATENCY_TARGET=local` or
`EVENTLOOPOS_HUMAN_DEMO_WORKSPACE_LATENCY_TARGET=local` only when the
orchestrator is running on the controller Mac; the lab demo default keeps
`127.0.0.1:4480` scoped to the Mac Studio.

Latest known-good proof:

- Manifest: `artifacts/lab-runs/20260603-132623-human-demo/manifest.json`
- Screenshot: `artifacts/lab-runs/20260603-132623-human-demo/screen-sharing.png`
- Queue proof: 2 current-run papers.
- Ambient proof: customer paper context saved only the shared TextEdit window and customer Chrome after the move.
- Visual feedback proof: Queue footer shows compact `feedback=...` status in the Screen Sharing capture.

## Starting State

Screen should be on AeroSpace workspace `demo-customer`.

Expected visible windows:

- Chrome: `eventloopOS Human Demo Customer Thread`
- TextEdit: `eventloopOS Human Demo Shared Notes.txt`
- eventloopOS Queue floating near lower right with two papers:
  - `Review Demo Customer Reply`
  - `Review Demo Metrics Review`

If Queue is hidden, click the eventloopOS Queue window, use the Dock icon, or press `Ctrl-Option-K` to summon the master command. The harness Queue window is configured as floating for this demo.

## Hotkeys

- Restore selected paper: `Ctrl-Option-R`
- Master command: `Ctrl-Option-K`
- Enter Manual Mode: `Ctrl-Option-M`
- Return from Manual Mode + restore saved paper: `Ctrl-Option-M`
- Return from Manual Mode and keep current windows: `Ctrl-Option-Shift-M`
- Rectangle-style left/right/top/bottom: `Ctrl-Option-Left/Right/Up/Down`
- Rectangle-style center: `Ctrl-Option-C`
- Rectangle-style maximize: `Ctrl-Option-Shift-Return`

## Walkthrough

1. Click `Review Demo Customer Reply` in Queue.
2. Press `Ctrl-Option-R`.
3. Confirm Customer Chrome and the shared TextEdit come forward on `demo-customer`.
4. Move the shared TextEdit window with `Ctrl-Option-Left`, or drag it manually toward the center/left.
   It starts on the right side, so `Ctrl-Option-Right` may look like nothing happened.
5. Wait 2 to 3 seconds. Ambient autosave should remember the moved position without pressing Done/Defer/Advance.
   The Queue footer should keep showing a compact `feedback=...` status so the demo is not silent while actions complete.
6. Click `Review Demo Metrics Review` in Queue.
7. Press `Ctrl-Option-R`.
8. Confirm the same TextEdit window moves to the metrics position and Metrics Chrome appears.
9. Click `Review Demo Customer Reply` again.
10. Press `Ctrl-Option-R`.
11. Confirm the same TextEdit window returns to the customer position.
12. Confirm the setup proof reports background window containment passed:
    Metrics Chrome was intentionally moved into the Customer paper and
    eventloopOS moved it back to the Metrics paper.
13. Confirm the Queue detail starts with a compact briefing strip that repeats
    the current paper title, exact decision needed, task id, priority, and
    session/binding state.
14. Try Rectangle-style hotkeys on TextEdit: left, right, top, bottom, center, maximize.
15. If no paper is selected, try `Ctrl-Option-H` or `Ctrl-Option-E` once and
    confirm the Queue footer acknowledges `No paper selected.` instead of
    staying silent.
16. Press `Ctrl-Option-M` to enter Manual Mode.
17. Open or move a dummy app.
18. Press `Ctrl-Option-M`.
19. Confirm eventloopOS restores the saved paper context and Queue remains usable.

## What To Report

Report any of these as product issues:

- restore sends focus to wrong app,
- same shared window does not move between paper-specific positions,
- ambient autosave misses a moved window after waiting 2 to 3 seconds,
- Queue briefing strip does not make the current decision obvious,
- Queue is hard to find or blocks work,
- Rectangle-style hotkeys feel surprising or conflict with another common app,
- Manual Mode return restores the wrong workspace or loses a user-opened window unexpectedly.
- Queue footer feedback stays stale or does not acknowledge restore/manual actions.
- Queue hotkeys do nothing silently when no paper is selected.
- A 409/manual-mode pause should surface as "Manual Mode active. Press Ctrl-Option-M to return.", not as a raw HTTP error.

## Result Template

Generate a prefilled template from the latest successful demo artifact, then fill in pass/fail and friction:

```sh
bin/human-demo-ready
bin/human-demo-result-template --write
```

The template write refuses stale or incomplete readiness by default, including
stale latest-demo proof freshness failures and missing/invalid proof
screenshots. If it says readiness is not green, rerun
`bin/lab-mac-human-demo-setup`, then `bin/human-demo-ready`, and fix any failed
gate before starting the human result artifact. It writes
`artifacts/human-demo-results/*-human-demo-result.md` with the latest proof
manifest, proof screenshot, readiness manifest, readiness screenshot, and
latency manifest paths. Fill the generated file after the hands-on pass. The
output shape is:

```text
Human demo date:
Mac:
Proof manifest:
Screenshot:
Readiness manifest:
Readiness screenshot:
Readiness queue latency:  ok= required=
Readiness workspace latency:  ok= required=
Readiness hotkey latency:  ok= required=

Pass/fail:
- Starting state on demo-customer with Queue visible:
- Ctrl-Option-R restores Customer paper:
- Moving shared TextEdit is remembered after 2-3 seconds:
- Automated new scratch window is remembered by current paper:
- Metrics paper brings same TextEdit to metrics position:
- Customer paper brings same TextEdit back to customer position:
- Background window containment proof passed:
- Paper briefing strip shows current decision:
- Rectangle hotkeys feel usable:
- Manual Mode entry/return works:
- Queue footer feedback is visible and current:
- Queue/master latency readiness gate passed:
- Workspace capture/restore-plan latency readiness gate passed:
- Hotkey feedback latency readiness gate passed or skipped intentionally:

Friction:
- 

Ship/block decision:
```

Use `pass` for passing checklist items. If something fails but is accepted, write
`fail - accepted non-blocking: ...`. Then verify the filled result and live lab
health:

```sh
bin/human-demo-result-verify artifacts/human-demo-results/<result>.md --lab-status
```

The verifier writes `artifacts/human-demo-verifications/*/manifest.json`. Keep
that manifest path with the filled result artifact as the final human gate
evidence. The verifier also checks the referenced proof/readiness manifests and
screenshots, so closeout cannot pass from stale notes with broken image paths.

## Current TODO

Human dogfood is still the remaining subjective proof. Automated Mac Studio proof passes, but Jason should run the walkthrough with real keyboard/mouse, record UX friction, and pass `bin/human-demo-result-verify --lab-status` before calling the goal complete. See `docs/human-demo-completion-audit.md` for the requirement-by-requirement evidence map.
