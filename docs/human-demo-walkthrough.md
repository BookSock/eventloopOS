# eventloopOS Human Demo Walkthrough

Use this for the Mac Studio hands-on dogfood walkthrough. The demo is intentionally local/fake work: two workspace papers, one waiting-agent paper, two Chrome windows, and one shared TextEdit window that belongs to both workspace papers with different saved positions.

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
- queues two workspace papers plus one waiting-agent paper,
- proves the shared TextEdit window restores to different positions per paper,
- proves ambient autosave updates future queue context after the shared window moves,
- proves a newly opened scratch TextEdit window on the current paper is saved
  into future queue context without pressing Done/Defer/Advance, then closes it
  before the hands-on walkthrough,
- proves a background/foreign paper window is moved back to its owning paper,
- proves a real agent-spawned Chrome window opened while Customer is focused
  is claimed for Metrics, moved back to Metrics, and leaves Customer focused,
- proves a Codex waiting-for-approval agent run creates a human-needed queue paper,
- captures a lab Mac desktop screenshot over SSH by default, with local Screen Sharing window-only capture available only when requested.

Before handing the keyboard to Jason, run a non-destructive readiness check:

```sh
bin/human-demo-ready
```

This does not restart or reseed the demo. It checks the current lab dogfood
stack, verifies the latest human-demo proof artifact, stages the live lab Mac
back to the Customer demo paper, captures the lab Mac desktop over SSH by
default, runs queue/workspace latency probes on the lab Mac, and writes
`artifacts/lab-runs/*-human-demo-ready/READY.md`. Treat that `READY.md` as the
source of truth for the current proof paths, screenshots, timings, and suggested
human result file.
The screenshot capture gate verifies the chosen artifact exists and has
readable PNG/JPEG dimensions, and the lab staging gate must pass, so readiness
cannot pass from an empty, invalid, or wrong-workspace screenshot file. The
default `lab` mode never captures or focuses the controller Mac desktop: it
captures the remote lab Mac desktop over SSH. Use
`EVENTLOOPOS_HUMAN_DEMO_SCREENSHOT_TARGET=local` to require only the local
Screen Sharing window. `EVENTLOOPOS_HUMAN_DEMO_SCREENSHOT_TARGET=auto` uses
the lab Mac desktop capture path.
Local Screen Sharing capture inside demo setup/readiness is skipped unless
`EVENTLOOPOS_ALLOW_LOCAL_SCREEN_SHARING_CAPTURE=1` is set. Use that only for
manual debugging, because even no-raise CoreGraphics window capture can change
the controller Mac's frontmost app on some macOS states. The direct local
helper refuses to run without that same opt-in, records frontmost app
before/after capture, and fails no-raise captures that change it. Raising or
focusing Screen Sharing requires both `SCREEN_SHARING_RAISE=1` and
`EVENTLOOPOS_ALLOW_SCREEN_SHARING_FOCUS=1`.
Demo setup/readiness manifests also include `controller_focus`; both sample the
controller Mac's frontmost app throughout the run. Readiness fails
`controller_screen_sharing_focus_ok` if Screen Sharing becomes frontmost after
starting from another app, and setup marks its `controller_focus.ok=false` for
the same transient focus leak.
Run `bin/human-demo-ready` after the queue app has Accessibility permission. By
default the latest proof must be no older than 24 hours; use
`EVENTLOOPOS_HUMAN_DEMO_PROOF_MAX_AGE_HOURS` or
`--demo-proof-max-age-hours` to change that window. It also writes read-only
queue/master latency and workspace capture/restore-plan latency manifests, so
demo readiness proves the Queue path and workspace path are responsive without
mutating the active paper. On macOS it includes a live repeated
restore-hotkey-to-first-feedback p95 latency gate and a separate top-HUD
feedback proof in the readiness artifact by running the probes on the Mac
Studio. By default the restore hotkey gate presses `Ctrl-Option-R` five times
and expects fresh Customer-paper feedback, so stale feedback, raw 409s, or
repeated-key silence fail readiness before handoff. The Queue feedback gate
requires a fresh `feedback_seq` change. Screenshot staging still verifies final
`Showing paper:` feedback after restore. The top-of-screen reminder HUD also
briefly echoes hotkey feedback, so keyboard users do not need to hunt for the
Queue footer after pressing a chord. The desktop HUD proof accepts stable
current-paper reminder feedback after restore, so it does not depend on catching
only the first transient `Restoring paper:` frame. Use `--skip-hotkey-latency`
or `--skip-paper-reminder-feedback` only while bootstrapping permission setup.
The readiness gate presses `Ctrl-Option-M` to prove Manual Mode entry and the
normal return-and-restore path produce visible feedback before any slow layout
save or restore finishes.
It also focuses the shared TextEdit window, presses `Ctrl-Option-Left`, and
verifies the window reaches the expected left-half Rectangle-style frame before
the final handoff restore puts the demo back on Customer.
`READY.md` also names the suggested human result file so the final checklist
does not accidentally reuse an older blank artifact.
Use `EVENTLOOPOS_HUMAN_DEMO_QUEUE_LATENCY_TARGET=local` or
`EVENTLOOPOS_HUMAN_DEMO_WORKSPACE_LATENCY_TARGET=local` only when the
orchestrator is running on the controller Mac; the lab demo default keeps
`127.0.0.1:4480` scoped to the Mac Studio.

Latest known-good proof:

- Run `bin/human-demo-ready`.
- Open the generated `artifacts/lab-runs/*-human-demo-ready/READY.md`.
- Use the paths and timings in that file as the current proof of record.
- Queue proof: 3 current-run papers: Customer, Metrics, and one Codex waiting-for-approval paper.
- Ambient proof: customer paper context saved the moved shared TextEdit, and the automated scratch window was remembered by the current paper before cleanup.
- Background containment proof: Metrics Chrome was intentionally pushed into the Customer paper and moved back to the Metrics paper.
- Agent-spawn containment proof: a Metrics-owned Chrome window was opened while Customer was focused, claimed, moved back to Metrics, and Customer focus was restored.
- Waiting-agent proof: a Codex `waiting_approval` run produced a `Codex needs human input` paper through `/agent-runs`.
- Visual feedback proof: Queue shows the paper briefing strip and green `Showing paper: ...` restore feedback in the Screen Sharing capture; readiness also proves live Queue feedback within the configured budget.
- Desktop reminder proof: readiness requires the top-of-screen paper reminder HUD to be visible for the current paper, including return-target context when an agent session is bound, and proves restore-hotkey HUD feedback within the configured budget.
- Master Command proof: readiness presses `Ctrl-Option-K` from another app and proves the Queue window opens a Master Command sheet with `Route to Master`, `Start Task`, `Rerank`, `Broadcast`, and the current task hint.
- Hotkeys sheet proof: readiness presses `Ctrl-Option-/` from another app and proves the Queue window opens a Hotkeys sheet with Queue and Windows command rows.
- Rectangle hotkey proof: readiness presses `Ctrl-Option-Left` on the shared TextEdit window and proves it moves to the expected left-half frame.
- Manual Mode feedback proof: readiness proves `Ctrl-Option-M` enter feedback and `Ctrl-Option-M` return-and-restore feedback within the configured budget.

## Starting State

Screen should be on AeroSpace workspace `demo-customer`.

Expected visible windows:

- Chrome: `eventloopOS Human Demo Customer Thread`
- TextEdit: `eventloopOS Human Demo Shared Notes.txt`
- eventloopOS Queue floating near lower right with three demo papers:
  - `Review Demo Customer Reply`
  - `Review Demo Metrics Review`
  - `Codex needs human input`

If Queue is hidden, click the eventloopOS Queue window, use the Dock icon, or press `Ctrl-Option-K` to summon the master command. The harness Queue window is configured as floating for this demo.

## Hotkeys

- Restore selected paper: `Ctrl-Option-R`
- Show Hotkeys sheet: `Ctrl-Option-/`
- Master command: `Ctrl-Option-K`
- Enter Manual Mode: `Ctrl-Option-M`
- Return from Manual Mode + restore saved paper: `Ctrl-Option-M`
- Return from Manual Mode and keep current windows where they are: `Ctrl-Option-Shift-M`
- Rectangle-style left/right/top/bottom: `Ctrl-Option-Left/Right/Up/Down`
- Rectangle-style center: `Ctrl-Option-C`
- Rectangle-style maximize: `Ctrl-Option-Shift-Return`

## Walkthrough

1. Press `Ctrl-Option-/`.
2. Confirm the Hotkeys sheet opens with Queue and Windows command rows, then close it with `Escape` or the `x`.
3. Click `Review Demo Customer Reply` in Queue.
4. Press `Ctrl-Option-R`.
5. Confirm Customer Chrome and the shared TextEdit come forward on `demo-customer`.
   Queue should immediately acknowledge `Restoring paper: Review Demo Customer Reply...`, then show green feedback starting with `Showing paper: Review Demo Customer Reply...`.
   The top-of-screen reminder HUD should briefly echo the restore feedback, then return to the current paper reminder.
6. Move the shared TextEdit window with `Ctrl-Option-Left`, or drag it manually toward the center/left.
   It starts on the right side, so `Ctrl-Option-Right` may look like nothing happened.
7. Wait 2 to 3 seconds. Ambient autosave should remember the moved position without pressing Done/Defer/Advance.
   The Queue footer should keep showing a compact `feedback=...` status so the demo is not silent while actions complete.
8. Click `Review Demo Metrics Review` in Queue.
9. Press `Ctrl-Option-R`.
10. Confirm the same TextEdit window moves to the metrics position and Metrics Chrome appears.
   Queue should show green feedback for `Review Demo Metrics Review`.
11. Click `Review Demo Customer Reply` again.
12. Press `Ctrl-Option-R`.
13. Confirm the same TextEdit window returns to the customer position.
    Queue should again remind you what decision the Customer paper needs.
14. Confirm the setup proof reports background window containment passed:
    Metrics Chrome was intentionally moved into the Customer paper and
    eventloopOS moved it back to the Metrics paper.
15. Confirm the Queue contains `Codex needs human input`.
    Click it once if you want to inspect it: the detail should say the Codex
    session needs human approval and the recommended action should be resume
    agent. Then click `Review Demo Customer Reply` again before continuing.
16. Confirm the Queue detail starts with a compact briefing strip that repeats
    the current paper title, exact decision needed, task id, priority, and
    session/binding state.
17. Confirm the top-of-screen paper reminder HUD shows the current paper title
    and decision while you work in Chrome/TextEdit. On agent/waiting papers it
    should also show a `Return target:` line with the bound Codex/Ghostty
    session or say that an agent session still needs binding. It should not
    take focus or block mouse clicks.
18. Try Rectangle-style hotkeys on TextEdit: left, right, top, bottom, center, maximize.
19. Press `Ctrl-Option-K`.
20. Confirm the Master Command sheet opens on the Queue window with `Route to Master`, `Start Task`, `Rerank`, and `Broadcast`.
    The Task Hint field should default to the current paper's task, such as `task_demo_customer`.
    Close the sheet with `Escape`, the `Close` button, or the top-right `x` so the hands-on demo stays clean.
21. Optional edge check: only if the Queue visibly has no selected paper, try
    `Ctrl-Option-H` or `Ctrl-Option-E` once and confirm the top HUD and Queue
    footer acknowledge `No paper selected.` instead of staying silent. Skip
    this during the default handoff if Customer remains selected.
22. Press `Ctrl-Option-M` to enter Manual Mode.
23. Open or move a dummy app.
24. Press `Ctrl-Option-M`.
25. Confirm eventloopOS restores the saved paper context and Queue remains usable.

## What To Report

Report any of these as product issues:

- restore sends focus to wrong app,
- same shared window does not move between paper-specific positions,
- ambient autosave misses a moved window after waiting 2 to 3 seconds,
- Queue briefing strip does not make the current decision obvious,
- top-of-screen paper reminder is missing, stale, lacks return-target context for agent papers, grabs focus, blocks clicks, or fails to briefly echo hotkey feedback,
- `Codex needs human input` is missing or does not explain why approval is needed,
- green `Showing paper: ...` feedback is missing, stale, or too hard to see after restore,
- Queue is hard to find or blocks work,
- Hotkeys sheet is missing, slow, clipped, or does not include the command you needed,
- Rectangle-style hotkeys feel surprising or conflict with another common app,
- Manual Mode return restores the wrong workspace or loses a user-opened window unexpectedly.
- Queue/HUD feedback stays stale or does not acknowledge restore/manual actions.
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
Readiness desktop HUD feedback:  ok= required=
Readiness master command hotkey:  ok= required=
Readiness Hotkeys sheet:  ok= required=
Readiness Rectangle hotkey:  ok= required=
Readiness manual mode feedback:  ok= required=
Readiness hotkey latency:  ok= required=

Pass/fail:
- Starting state on demo-customer with Queue visible:
- Ctrl-Option-R restores Customer paper:
- Moving shared TextEdit is remembered after 2-3 seconds:
- Automated new scratch window is remembered by current paper:
- Metrics paper brings same TextEdit to metrics position:
- Customer paper brings same TextEdit back to customer position:
- Background window containment proof passed:
- Agent-spawned window containment proof passed:
- Waiting agent paper appears in queue:
- Paper briefing strip shows current decision:
- Desktop paper reminder HUD is visible:
- Hotkeys sheet opens and is readable:
- Rectangle hotkeys feel usable:
- Manual Mode entry/return works:
- Master Command opens with current task hint:
- Queue/HUD hotkey feedback is visible and current:
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
