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
- captures a local Screen Sharing window-only screenshot.

Latest known-good proof:

- Manifest: `artifacts/lab-runs/20260603-125813-human-demo/manifest.json`
- Screenshot: `artifacts/lab-runs/20260603-125813-human-demo/screen-sharing.png`
- Queue proof: 2 current-run papers.
- Ambient proof: customer paper context saved only the shared TextEdit window and customer Chrome after the move.

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
- Return from Manual Mode: `Ctrl-Option-Shift-M`
- Rectangle-style left/right/top/bottom: `Ctrl-Option-Left/Right/Up/Down`
- Rectangle-style center: `Ctrl-Option-C`
- Rectangle-style maximize: `Ctrl-Option-Shift-Return`

## Walkthrough

1. Click `Review Demo Customer Reply` in Queue.
2. Press `Ctrl-Option-R`.
3. Confirm Customer Chrome and the shared TextEdit come forward on `demo-customer`.
4. Move the shared TextEdit window with `Ctrl-Option-Right`, or drag it manually.
5. Wait 2 to 3 seconds. Ambient autosave should remember the moved position without pressing Done/Defer/Advance.
   The Queue footer should keep showing a compact `feedback=...` status so the demo is not silent while actions complete.
6. Click `Review Demo Metrics Review` in Queue.
7. Press `Ctrl-Option-R`.
8. Confirm the same TextEdit window moves to the metrics position and Metrics Chrome appears.
9. Click `Review Demo Customer Reply` again.
10. Press `Ctrl-Option-R`.
11. Confirm the same TextEdit window returns to the customer position.
12. Try Rectangle-style hotkeys on TextEdit: left, right, top, bottom, center, maximize.
13. Press `Ctrl-Option-M` to enter Manual Mode.
14. Open or move a dummy app.
15. Press `Ctrl-Option-Shift-M`.
16. Confirm eventloopOS restores the saved paper context and Queue remains usable.

## What To Report

Report any of these as product issues:

- restore sends focus to wrong app,
- same shared window does not move between paper-specific positions,
- ambient autosave misses a moved window after waiting 2 to 3 seconds,
- Queue is hard to find or blocks work,
- Rectangle-style hotkeys feel surprising or conflict with another common app,
- Manual Mode return restores the wrong workspace or loses a user-opened window unexpectedly.
- Queue footer feedback stays stale or does not acknowledge restore/manual actions.

## Current TODO

Human dogfood is still the remaining subjective proof. Automated Mac Studio proof passes, but Jason should run the walkthrough with real keyboard/mouse and record UX friction before calling the goal complete.
