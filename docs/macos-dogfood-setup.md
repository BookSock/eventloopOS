# macOS Dogfood Setup

Use this when setting up a Mac for eventloopOS dogfood or when a lab Mac
returns after reboot. The goal is to keep the common loop short and reserve the
slow proof matrix for release confidence.

## Fast Loop

Run this first on the Mac that will dogfood eventloopOS:

```sh
corepack enable
pnpm install
pnpm setup:status
```

`pnpm setup:status` runs the local quick gate. It checks Codex CLI status,
unsigned-dev app install, and macOS permissions without touching the remote lab,
real Codex dogfood scenarios, screenshots, reboot, or Postgres fault proofs.

If it fails on macOS permissions, run:

```sh
pnpm setup:prompt
```

Approve the missing Privacy & Security prompts, then rerun:

```sh
pnpm setup:status
```

If it fails on AeroSpace CLI/app version mismatch instead of a privacy prompt,
run:

```sh
pnpm macos:aerospace-repair:restart
pnpm setup:status
```

If restart still reports the mismatch, use the explicit reinstall repair:

```sh
pnpm macos:aerospace-repair:reinstall
pnpm setup:status
```

If restart says `launchservices_server_ready=false`, the AeroSpace binary can
start but `open -a AeroSpace` is not producing a durable app server. Open
AeroSpace normally, re-grant AeroSpace Accessibility in System Settings, and
rerun `pnpm setup:status`.

Start memory-mode dogfood after setup status is green:

```sh
pnpm setup:dogfood
```

This avoids Docker/Postgres while validating the real Mac app, orchestrator,
AeroSpace, and Codex paths needed for normal dogfood.

## Remote Lab Loop

From the controller Mac, use the cheapest lab check first:

```sh
pnpm product:transport
```

For visual dogfood, prefer a window-only capture of the local Screen Sharing
app so the artifact contains the Mac Studio screen without exposing the rest of
the controller desktop:

```sh
SCREEN_SHARING_TITLE=Zeus bin/local-screen-sharing-capture
```

The helper writes `artifacts/screen-sharing-captures/<timestamp>-screen-sharing.png`
and a sibling JSON manifest with the CGWindow id used by `screencapture -l`.

This answers only "are SSH and VNC reachable?" and skips sync, baseline,
screenshots, and Codex. Use it while the Mac is rebooting or probably offline.

After transport is green, use the setup gate:

```sh
pnpm setup:lab-status
```

This runs remote connectivity, sync, baseline, and Screen Recording status. It
uses a short first transport preflight by default and fails before spending time
on Codex if SSH, Tailscale, VNC, auto-login, AeroSpace, Codex auth, or core
developer setup is broken.

After lab status is green, run one real scenario:

```sh
pnpm product:lab-ready
pnpm product:dogfood
```

For the hands-on Mac Studio UX demo, run:

```sh
bin/lab-mac-human-demo-setup
```

Then follow `docs/human-demo-walkthrough.md`. That walkthrough covers the
two-paper shared-window demo, ambient autosave check, Rectangle-style hotkeys,
Manual Mode return, and the proof artifacts to inspect.

Use release proof only when product behavior is stable enough that the long run
is worth it:

```sh
PRODUCT_READINESS_RUNS=3 \
PRODUCT_READINESS_REBOOT=1 \
PRODUCT_READINESS_FRESH_CLONE=1 \
PRODUCT_READINESS_POSTGRES_MIGRATION_MISMATCH=1 \
pnpm product:readiness
```

## What Still Costs Time

These are intentionally kept out of the fast setup loop:

- real Codex queue followups,
- GUI screenshots, short Queue UI screen recordings, and VNC evidence,
- orchestrator crash/restart faults,
- Ghostty cleanup faults,
- workspace restore faults,
- full Mac reboot proof,
- fresh clone setup proof,
- Postgres migration mismatch proof.

Those checks mutate shared GUI or process state, consume model resources, or need
slow dependencies. Run them in `product:dogfood` or `product:readiness`, not in
every setup iteration.

`pnpm proof:fresh-clone` copies the repo into a temp directory and runs install,
preflight doctor, and typecheck with an isolated temp `HOME` plus temp
Corepack/pnpm/npm caches. This catches setup assumptions hidden in your normal
user account while staying lighter than creating a real macOS user.

## Faster Progress Rules

- Use `pnpm setup:status` after code or permission changes.
- Use `pnpm lab:wait-online:quick` for short agent/status reachability checks after lab reboot or network changes.
- Use `pnpm lab:wait-online:long` for deliberate reboot/operator handoff waits.
- Use `pnpm product:transport` when the Mac is rebooting or probably offline.
- Use `pnpm setup:lab-status` after reachability returns.
- Use `pnpm product:lab-ready` after both setup gates are green to start/check
  dogfood stack and capture status/snapshot without spending on a real task.
- Use `pnpm product:dogfood` after `product:lab-ready` is green.
- Leave `PRODUCT_READINESS_LAB_LOCK=1` unless you are doing a read-only probe.
  The product gate takes a local lock so two agents do not mutate the same lab
  GUI/process state at once.
- Leave `PRODUCT_READINESS_FAST_PREFLIGHT=1` for normal iteration. Set it to `0`
  only when debugging slow SSH/VNC connect behavior and you want the longer
  connectivity timeouts.
- Leave `PRODUCT_READINESS_BASELINE_CACHE=auto` for normal iteration. Quick and
  dogfood gates reuse a recent green lab baseline when the lab host/user and
  source fingerprint still match; release gates run a fresh baseline unless you
  explicitly opt into cache.
- Use `PRODUCT_READINESS_REPEAT_RUNS=20 pnpm product:dogfood:repeat` to measure
  flake rate once behavior looks correct.
- Use `PRODUCT_READINESS_REPEAT_RUNS=20 pnpm product:dogfood:repeat:fail-fast`
  while debugging; it preserves linked artifacts but stops at first red.
- Dogfood/release profiles record a short Queue UI `screen.mov` by default.
  Override with `PRODUCT_READINESS_CAPTURE_VIDEO_SECONDS=0` only for debugging
  speed; release readiness should keep it enabled.
- Use `pnpm readiness:summary` after any failed readiness run; it writes JSON
  and Markdown TODO artifacts with linked manifests, next commands, blockers,
  and requirement gaps. Without an explicit manifest argument it picks the
  newest `eventloopos.product_readiness_proof` manifest, ignoring nested copied
  sub-artifacts. Next commands are grouped by `local`, `lab`, and `release` so
  local setup fixes are not confused with lab recovery work.
- Product readiness commands call `readiness:summary` automatically after they
  update their manifest, including failure paths. Run `pnpm readiness:summary`
  manually only when you want to regenerate the latest TODO.

Readiness manifests include `requirement_coverage`. Each item maps one real-user
requirement to current evidence and marks it `passed`, `blocked`, `pending`,
`not_run`, or `missing`. Use that section to decide what to fix next instead of
guessing from raw logs.

`release_ready` is intentionally strict. It stays false unless the lab release
profile passes, repeat count is high enough, blockers are empty, and every
`requirement_coverage` item is passed. Check `release_ready_reasons` for the
short explanation.

## Xcode

Full Xcode is not part of the fast loop. Command Line Tools are enough for the
app build and unsigned-dev install proof. Install full Xcode later if Swift
`XCTest` coverage on the lab becomes important.

## Postgres

Memory-mode dogfood is the default setup path. Add Docker Desktop, Postgres.app,
or another Postgres runtime only when testing Postgres-backed durability and
migration mismatch proof.
