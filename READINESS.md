# eventloopOS Readiness

This file is the live release-readiness ledger. `bin/product-readiness-proof lab`
is the top-level gate for the remote Mac Studio dogfood lab.

## Current Gate

Run:

```sh
pnpm product:readiness
pnpm readiness:summary
```

Faster iteration gates:

```sh
pnpm product:next   # cheapest useful next probe/action; emits selected_command
pnpm --silent readiness:next # quiet JSON for agent loops
pnpm setup:status   # local install/Codex/permission preflight, no lab
pnpm setup:prompt   # open missing macOS Privacy & Security prompts
pnpm setup:dogfood  # memory-mode local dogfood after setup is green
pnpm setup:lab-status # remote lab quick gate
pnpm product:transport # remote SSH/VNC only; use during reboot/offline loops
pnpm product:quick    # setup/status/connectivity only, no real Codex or GUI scenario
pnpm product:lab-ready # starts/checks dogfood stack and captures status/snapshot, no queue task
pnpm product:local:quick # local install/Codex/permission preflight, no lab
pnpm product:dogfood  # one real Codex queue followup plus screenshots
pnpm product:local:dogfood # local preflight plus proof:live
pnpm product:release  # full release matrix; same as product:readiness
pnpm product:release:fast # 3x user flows, 1x isolated fault matrix for iteration
PRODUCT_READINESS_REPEAT_RUNS=20 pnpm product:dogfood:repeat # flake-rate manifest
PRODUCT_READINESS_REPEAT_RUNS=20 pnpm product:dogfood:repeat:fail-fast # stop at first red during iteration
pnpm lab:wait-online:quick # short SSH/VNC reachability wait for agent/status loops
pnpm lab:wait-online:long  # bounded SSH/VNC wait after lab reboot
pnpm lab:local-bootstrap # run locally on lab Mac after reboot outage
bin/product-readiness-proof lab quick
bin/product-readiness-proof lab lab-ready
bin/product-readiness-proof lab dogfood
```

Before declaring the product ready for real users, run:

```sh
pnpm product:readiness
```

`pnpm product:readiness` and `pnpm product:release` default to the full release
definition: 3 lab runs, reboot proof, fresh-clone proof, and Postgres migration
mismatch proof. Override `PRODUCT_READINESS_RUNS`,
`PRODUCT_READINESS_REBOOT`, `PRODUCT_READINESS_FRESH_CLONE`, or
`PRODUCT_READINESS_POSTGRES_MIGRATION_MISMATCH` only for narrower diagnostic
runs.

Set `PRODUCT_READINESS_INSTALL_ARTIFACT=artifacts/install/<run-id>/manifest.json`
only when reusing an existing local install proof; otherwise release mode runs
`bin/lab-mac-install-proof` on the lab automatically.

The command writes `artifacts/product-readiness/<run-id>/manifest.json` with:

- lab setup/status evidence,
- install/onboarding baseline manifest with required fixes,
- Codex CLI auth/network status proof,
- unified macOS Screen Recording, Accessibility, and AeroSpace permission status proof,
- before/after snapshots,
- Queue UI screen recording in dogfood/release profiles (`screen.mov`),
- real Codex queue followup proof artifacts,
- queue defer/ignore decision proof artifacts,
- stale Codex recovery proof artifacts,
- Codex completion + Ghostty + AeroSpace workspace proof artifacts,
- Codex app-server down fault-injection proof artifacts,
- orchestrator crash/restart fault-injection proof artifacts,
- duplicate idempotency fault-injection proof artifacts,
- Postgres unavailable fault-injection proof artifacts,
- Postgres migration mismatch fault-injection proof artifacts when `PRODUCT_READINESS_POSTGRES_MIGRATION_MISMATCH=1`,
- AeroSpace unavailable fault-injection proof artifacts,
- AeroSpace permission-missing fault-injection proof artifacts,
- Ghostty cleanup failure fault-injection proof artifacts,
- Screen Recording denied fault-injection proof artifacts,
- Queue app Accessibility denied fault-injection proof artifacts,
- AeroSpace restore server-down fault-injection proof artifacts,
- Tailscale/VNC disconnected fault-injection proof artifacts,
- reboot + relaunch + post-reboot queue followup proof artifacts when `PRODUCT_READINESS_REBOOT=1`,
- lab Mac fresh-clone setup proof when `PRODUCT_READINESS_FRESH_CLONE=1`,
  now using a temp clone plus isolated temp `HOME`/cache to better approximate a
  fresh user account instead of reusing this user's package caches,
- signed/notarized or reliable unsigned-dev install proof when `PRODUCT_READINESS_INSTALL_ARTIFACT` points at a real manifest,
- no-orphan windows/process/listener proof after dogfood cleanup,
- pass/fail steps and remaining release blockers,
- requirement coverage for each real-user readiness requirement, with `passed`,
  `blocked`, `pending`, `not_run`, or `missing` status and linked evidence keys,
- strict `release_ready_reasons`; release-ready is true only when lab release
  profile passes, repeat count is sufficient, blockers are empty, and every
  requirement coverage item is passed,
- automatic readiness summary JSON and Markdown TODO generation after each
  manifest update, including failure paths.
- fast lab transport preflight by default (`PRODUCT_READINESS_FAST_PREFLIGHT=1`)
  so offline SSH/VNC fails before sync, baseline, Codex, or GUI work,
- per-step product gate timeouts (`PRODUCT_READINESS_STEP_TIMEOUT_SECONDS`,
  default 600 quick / 900 lab-ready / 1800 dogfood / 3600 release; `0` disables) so an inner
  lab/Codex/GUI step records a failed step, timeout result, stdout, stderr, and
  readiness summary instead of relying only on the outer repeat timeout,
- split release repeat counts (`PRODUCT_READINESS_RUNS` for user-flow proofs,
  `PRODUCT_READINESS_FAULT_RUNS` for isolated fault injections). Defaults keep
  old behavior by repeating faults as often as user flows, while
  `pnpm product:release:fast` keeps 3x queue/decision/recovery/workspace proof
  and runs each isolated fault once for faster iteration,
- transport-only lab quick scope (`PRODUCT_READINESS_LAB_QUICK_SCOPE=transport`
  or `pnpm product:transport`) for reboot/offline loops where SSH/VNC
  reachability is the only useful question,
- local lab-run lock evidence (`PRODUCT_READINESS_LAB_LOCK=1`) so concurrent
  agents do not mutate the same lab GUI/process state. Locks now clear when
  their recorded local controller pid is gone, in addition to the TTL, so a
  killed or piped proof does not strand later lab probes.
- conservative lab baseline cache (`PRODUCT_READINESS_BASELINE_CACHE=auto`) so
  quick/dogfood gates can reuse a recent green baseline when lab host/user and
  source fingerprint match; release gates still run a fresh baseline by default.
- lab self-heal LaunchAgent installer/status commands (`pnpm lab:self-heal` and
  `pnpm lab:self-heal:remote`) to reopen Tailscale/AeroSpace, keep the Mac
  awake, and rerun local recovery checks after the lab user session starts.
- bounded lab wait commands (`pnpm lab:wait-online:quick` and
  `pnpm lab:wait-online:long`) so agent/status loops can fail fast while
  reboot/operator loops can wait for SSH/VNC with one artifact. Wait manifests
  include machine-readable next commands for lab bootstrap, controller wait, and
  controller lab status, and derive the controller Tailscale IP from
  `tailscale ip -4` when available.
- smart next-action selector (`pnpm product:next`) so agent/status loops run a
  short lab wait, refresh local setup status only when useful, and emit one
  `selected_command` instead of wasting time on known-blocked dogfood gates.
  It reuses a fresh local quick blocker summary by default, so repeated status
  checks do not keep rerunning install/Codex/permission preflights. When the lab
  wait proves the remote Mac is offline, it promotes lab recovery/wait commands
  ahead of controller-local setup commands. If the lab has been offline for more
  than ten minutes and the next action is lab-local bootstrap, `auto` mode skips
  controller-local quick checks entirely; use `PRODUCT_NEXT_LOCAL_QUICK=1` to
  force them.
  `pnpm --silent readiness:next`, `pnpm --silent product:next -- --json`, or
  `node bin/product-next --json` emits quiet machine-readable JSON with
  `selected_command_clean`, `selected_command_target`, and
  `selected_command_run_hint` so agents can route controller commands versus
  lab-console commands without parsing comments.
  `pnpm --silent readiness:summary -- --json` or
  `node bin/readiness-summary --json` emits quiet machine-readable summary JSON.
  Implicit summaries ignore diagnostic product manifests whose per-step timeout
  is below `READINESS_SUMMARY_MIN_REUSABLE_STEP_TIMEOUT_SECONDS` (default 60s),
  so tiny timeout smokes cannot become the current product blocker by accident.
  Summary JSON includes the exact `product_manifest` plus failed-step timeout
  metadata used for each recommendation.
  Readiness summaries include `primary_next_action` with command group, run
  target, clean command, autorun safety, and reason. When fresh lab-wait evidence
  says the lab has been offline for more than ten minutes, that primary action is
  lab-local bootstrap even if a controller-local setup blocker also exists.
  `product:next` consumes that primary action when the lab is offline, so the
  status command and summary TODO share one next-action decision.
  Lab wait/summary selection now puts lab-local bootstrap first not only when
  Tailscale reports the lab as stale/offline, but also when the controller cannot
  see the lab in Tailscale at all and both SSH/VNC probes fail.
  `product:next` now reuses a fresh quick lab-wait manifest for
  `PRODUCT_NEXT_LAB_WAIT_MAX_AGE_SECONDS` (default 60), so repeated agent status
  loops do not spend another SSH/VNC poll window when the current actionable
  step is still lab-local bootstrap.
  It also reuses a fresh manual lab-local bootstrap decision for
  `PRODUCT_NEXT_DECISION_CACHE_MAX_AGE_SECONDS` (default 30), so tight agent
  loops during reboot/offline handoff can return the same lab-console command
  without rebuilding wait + summary artifacts. Cached decisions do not extend
  the cache window and are never autorun; set the value to `0` to force a fresh
  probe.
  `pnpm readiness:summary:self-test` asserts summary primary-action ordering:
  stale lab offline picks lab-local bootstrap first, non-stale local setup keeps
  controller-local prompt first, lab quick green promotes lab-ready, lab-ready
  green promotes dogfood, and dogfood green promotes `pnpm product:release:fast`
  before the full release matrix. This
  self-test runs inside `pnpm run typecheck`.
  `pnpm product:next:self-test` asserts that lab-local bootstrap remains
  non-autorun on the controller, stale lab-wait commands are ordered correctly,
  and lab-online mode still promotes dogfood. This self-test runs inside
  `pnpm run typecheck`. `readiness:next` also includes
  `selected_command_skip_reason` in normal status output whenever the selected
  command is not safe to autorun. It also includes summary pass/release state,
  release-ready reasons, requirement gaps, artifact contract failures,
  `macos_permission_status`, `aerospace_repair`, `lab_wait`, and
  `primary_next_action` so one command carries the current blocker context for
  agent loops. Each `product:next` artifact also writes `NEXT.md`, a readable
  handoff with the selected command, lab/operator instructions, permission
  failures, lab wait checks, and evidence links. `product:next`
  also refuses to reuse short-timeout diagnostic summaries below
  `PRODUCT_NEXT_MIN_REUSABLE_STEP_TIMEOUT_SECONDS` (default 60s), and exposes
  `summary_product_manifest` plus `summary_failed_steps` in its JSON/manifest.
  `product:next run` refuses to execute commands marked as needing the lab Mac
  locally, so it cannot accidentally run `pnpm lab:local-bootstrap` on the
  controller when the selected command is an in-person lab recovery step.
- Release repeat confidence now counts only nested proof manifests whose
  `ok`/`passed` value is true, and summary output includes failed/missing nested
  manifest paths instead of treating any listed artifact as green.
- Queue/decision/recovery scenario evidence now also has an `artifact_contract`
  check: green nested manifests only count when screenshot, video when
  requested, API state, window list, process list, and Queue AX artifacts are
  present and nonempty. Fault and connectivity proof manifests are also audited
  by kind-specific contracts, so release repeats cannot count a green fault run
  unless its declared artifacts, API state, process/window bundle, screenshot
  or intentional screen-denied evidence, and actionable assertions are present.
  The `queue_ui_video_artifact` requirement also requires video-backed
  `queue_followup_runs` count to meet `requested_runs`, so one good recording
  cannot satisfy a multi-run dogfood/release proof.
  No-orphan proof evidence is also audited by a kind-specific contract, so the
  no-orphan requirement only passes when the orphan manifest is green, all
  assertions are green, and process/listener/window artifact files exist.
  Readiness summaries expose scenario, fault, connectivity, and single-artifact
  contract failures directly in Markdown and JSON, including missing files and
  failed checks.
- Scenario artifact contracts also require stable top-level debug aliases:
  `api-state.json`, `task-messages.json`, `windows.json`,
  `screenshot-after.png`, and `screen.mov` when video is requested, so green
  dogfood/release artifacts are inspectable without knowing nested capture/API
  directory layout.
- `pnpm readiness:artifact-audit <manifest>` independently validates a product
  readiness manifest or a single lab scenario/fault/connectivity manifest
  against that artifact contract, so copied artifacts can be checked without
  rerunning the lab.
  It now also validates product snapshot directories (`snapshot_before` and
  `snapshot_after`) against the lightweight snapshot contract, and accepts a
  snapshot directory path directly (for example `pnpm readiness:artifact-audit
  artifacts/.../snapshot-after`). `pnpm readiness:artifact-audit:self-test`
  covers normal scenario, screen-denied fault, connectivity proof, snapshot
  proof, direct snapshot-directory audit, product-manifest aggregation, and
  broken missing-screenshot / broken-snapshot fixtures; it runs inside `pnpm
  run typecheck`.
- Release profile `passed` is now tied to full `release_ready`, so a release
  manifest cannot look green while release-ready reasons still exist.
- Install, Codex login, and first-run permission coverage now require passing
  evidence manifests/checks, not just the presence of `macos_install`,
  `codex_status`, `macos_permissions`, or `baseline` file paths. Baseline only
  satisfies those requirements when the relevant baseline step IDs are green.
  `pnpm product:readiness:self-test` exercises that coverage rule against fake
  green/red evidence manifests and runs inside `pnpm run typecheck`.
- Core queue/recovery/workspace and reliability coverage now also requires green
  nested scenario/fault artifact contracts, not just listed artifact paths. This
  prevents red or incomplete lab manifests from satisfying queue followup,
  queue review, restart recovery, workspace restore, or fault-injection
  requirements.
- Lab dogfood status now writes a structured `eventloopos.lab_dogfood_status`
  manifest with orchestrator health, task-session API, queue API, dogfood
  process, port 4480 listener, Queue app process, window artifact, and process
  list checks. `connect_orchestrator` coverage requires that green manifest
  instead of treating a successful text status command as enough. Artifact
  audit validates `dogfood_status_before` / `dogfood_status_after` manifests and
  their declared API/process/window artifacts. Product readiness manifests and
  readiness summaries now include dogfood status artifact contract failures
  alongside snapshot/scenario/fault/orphan failures; summary JSON also exposes
  dogfood status checks, failed checks, URL, Queue-app requirement, and artifact
  paths when status evidence exists. `readiness:artifact-audit` can validate a
  dogfood-status artifact directory directly by reading its `manifest.json`.
  Release-ready reasons now fail explicitly when dogfood status artifacts do not
  prove orchestrator/app health. Dogfood status contracts require a nonempty,
  all-green `checks` object so a sparse manifest cannot pass by accident.
- `bin/lab-mac-dogfood wait-ready` retries strict status after stack start
  (`LAB_DOGFOOD_READY_TIMEOUT_SECONDS`, default 90) so lab-ready/dogfood/release
  gates do not fail just because the orchestrator or Queue app is still booting.
- Product readiness manifests now include `passed`, `release_ready`,
  `release_ready_reasons`, `profile_gate_passed`, and `profile_gate_reasons`.
  Non-release lab gates can stay narrower than release, but `lab-ready` cannot
  pass without green dogfood status + snapshot artifacts, and `dogfood` cannot
  pass without green status, before/after snapshots, real queue-followup
  artifacts, and no-orphan cleanup proof. Local dogfood cannot pass without a
  green `proof:live` manifest plus Queue UI presentation proof.
  `readiness:artifact-audit` fails product manifests whose outcome is red,
  whose release profile is not release-ready, or whose profile gate is red,
  missing, or missing gate reasons, even if individual copied artifact
  directories look structurally valid. It also requires at least one auditable
  artifact status beyond the product outcome/profile gate, so a profile-only
  product manifest cannot pass artifact audit.
  `bin/product-readiness-proof` now emits `artifact_audit` evidence on both
  successful and failed exits, linking the independent audit manifest directly
  from the product-readiness manifest so offline/connectivity failures still
  have inspectable proof evidence. Readiness summaries and `readiness:next`
  now surface that audit manifest plus failure count so agents can triage red
  proofs without opening nested JSON first.
- Local dogfood/status-history coverage now requires a green `local_live_manifest`
  and passed Queue UI presentation step, not just local artifact paths.
- Before/after snapshot evidence now has a lightweight artifact contract too:
  `health.json`, activity, ready queue state, task messages, windows, process
  list, and nonempty screenshot when present. Snapshot paths alone no longer
  satisfy active-task-window or observability coverage, keeping quick/dogfood
  gates cheap without accepting empty copied directories. Readiness summaries
  surface snapshot contract failures alongside scenario/fault/orphan artifact
  failures.
- Queue window error text now maps stale Codex thread, Tailscale/VNC/Remote
  Login outage, Postgres/migration failure, and Ghostty/Terminal cleanup failure
  into explicit recovery copy, not raw backend errors.
- Task message API and Queue lineage rows now carry `recovery_hint`, so failed
  followups show the next repair action beside the durable message record.
- local lab bootstrap command (`pnpm lab:local-bootstrap`) that installs
  self-heal, checks its status, runs local recovery, emits one bootstrap
  manifest, and writes an `OPERATOR.md` handoff with lab-side fixes plus next
  controller commands when someone is physically at the lab Mac. `pnpm
  lab:local-bootstrap:self-test` runs a fake bootstrap in a temp artifact root
  and verifies the manifest, summary, and operator handoff contract; it runs
  inside `pnpm run typecheck`.
- Lab bootstrap now refuses to run when the local Tailscale IP matches
  `LAB_CONTROLLER_TAILSCALE_IP`, avoiding accidental controller-Mac self-heal
  installation when an in-person lab recovery command is pasted on the wrong
  machine.
- lab self-heal now embeds a heartbeat manifest with Tailscale IP, SSH/VNC
  listener, controller ping, and Tailscale/AeroSpace process checks in every
  self-heal artifact.

## Requirements Map

| Requirement | Current proof |
| --- | --- |
| Install/build Mac app | `bin/lab-mac-baseline` required checks, `bin/lab-mac-fresh-clone-proof`, and `bin/macos-install-proof` |
| Codex login/status check | `bin/codex-status-proof` validates CLI install, `codex login status`, `codex doctor --json`, auth, websocket, provider reachability, and install consistency |
| Connect app to orchestrator | `bin/lab-mac-dogfood start/status`, queue app process and health checks |
| Non-Postgres dev state durability | `bin/dev-dogfood` sets `EVENTLOOPOS_IN_MEMORY_STORE_FILE=.eventloopos/<profile>/gateway-store.json`; orchestrator restart fault proof verifies persisted task state |
| Start/bind real Codex task | `bin/lab-mac-scenario queue-followup`, `bin/event-loop-codex-completion-workspace-proof-smoke` |
| See active tasks in menu/window | `bin/lab-mac-scenario` AX/menu/window assertions and screenshots |
| Review queue items | `queue_paper_created`, Queue app open-window assertions |
| Approve/reject/defer followups | approve path in completion-workspace proof; defer/ignore path in `bin/lab-mac-scenario queue-decisions` |
| Resume after interruption/restart | `bin/lab-mac-scenario codex-recovery` |
| Codex app-server down | `bin/lab-mac-fault-proof codex-app-server-down` asserts failed followup is durable/actionable and stack recovers |
| Orchestrator crash/restart | `bin/lab-mac-fault-proof orchestrator-crash-restart` asserts task, queue item, messages, replacement recovery, and queue UI survive restart |
| Duplicate idempotency edges | `bin/lab-mac-fault-proof duplicate-idempotency` asserts repeated task start/followup keys dedupe without duplicate queue items, task records, or messages |
| Postgres unavailable | `bin/lab-mac-fault-proof postgres-unavailable` runs an isolated bad `DATABASE_URL` and asserts nonzero/actionable failure while main dogfood stays healthy |
| Postgres migration mismatch | `bin/lab-mac-fault-proof postgres-migration-mismatch` runs isolated Postgres dogfood with a deliberately broken migration directory, when a lab Postgres runtime is available, and asserts actionable migration failure while main dogfood stays healthy |
| AeroSpace unavailable | `bin/lab-mac-fault-proof aerospace-unavailable` runs isolated dogfood with AeroSpace hidden from `PATH` and asserts nonzero/actionable setup failure while main dogfood stays healthy |
| AeroSpace permission missing | `bin/lab-mac-fault-proof aerospace-permission-missing` injects a failing AeroSpace CLI and asserts actionable Accessibility setup failure while main dogfood stays healthy |
| Ghostty cleanup failure | `bin/lab-mac-fault-proof ghostty-cleanup-failure` injects a skipped cleanup into the real Codex completion/workspace proof, asserts the orphan is reported, then closes the leftover Ghostty window/process |
| Screen Recording denied | `bin/lab-mac-fault-proof screen-capture-denied` injects a denied `screencapture` path and asserts actionable Screen & System Audio Recording setup guidance plus no stale GUI fallback |
| Queue app Accessibility denied | `bin/lab-mac-fault-proof queue-app-accessibility-denied` injects denied Terminal/System Events Accessibility for Queue UI capture and asserts actionable Privacy & Security guidance while preserving screenshot/process/window/TCC artifacts |
| AeroSpace server down during restore | `bin/lab-mac-fault-proof aerospace-restore-server-down` injects a restore-command failure in the isolated proof and asserts actionable recovery text plus smoke-window cleanup |
| Tailscale/VNC disconnected | `bin/lab-mac-connectivity-proof fault` safely injects transport-down conditions into local connectivity evidence and asserts actionable Tailscale, ACL, Screen Sharing, auto-login, and port 5900 repair guidance |
| Relaunch after full Mac reboot | `LAB_MAC_REBOOT=1 bin/lab-mac-reboot-proof`; included in readiness with `PRODUCT_READINESS_REBOOT=1` |
| AeroSpace save/restore | isolated proof inside completion-workspace proof |
| Understand status/history | local Queue UI presentation tests record `queue_ui_presentation`; dogfood/release scenario manifests must include API/activity/task-message artifacts |
| Queue UI screenshot/video proof | dogfood/release `bin/lab-mac-scenario` runs request `LAB_MAC_CAPTURE_VIDEO_SECONDS>0` and assert `screen.mov` exists |
| Missing-permission status | `bin/macos-permission-status` for local/lab TCC and AeroSpace checks; `bin/lab-mac-screen-capture-permission status` for focused remote Screen Recording prompts |
| User-facing dependency error text | `bin/product-readiness-proof local quick` now runs `swift test --filter QueueWindowPresentationTests` and records `queue_ui_error_text` evidence before permission checks; release also needs fault matrix evidence |
| Remote lab survives reboot | `bin/lab-mac-baseline` now checks Remote Login, Tailscale 100.x IP, Tailscale self status, Screen Sharing/VNC port 5900, SSH/VNC self tailnet reachability, optional controller peer Tailscale ping via `LAB_CONTROLLER_TAILSCALE_IP`, lab-user auto-login, and the self-heal LaunchAgent before destructive reboot proof |
| Wait for lab after reboot | `bin/lab-mac-wait-online quick|long` writes one manifest while polling SSH/VNC for a bounded time |
| Fast lab transport check | `pnpm product:transport` runs only lab SSH/VNC connectivity and skips sync/baseline/screenshot setup |
| Local reboot-outage recovery | `bin/lab-mac-local-recovery-check` runs on the lab Mac after local login and writes a manifest for console user, Tailscale, Tailscale self status, SSH/VNC local listeners, SSH/VNC self tailnet reachability, optional controller peer Tailscale ping via `LAB_CONTROLLER_TAILSCALE_IP`, auto-login, sleep, caffeinate, and FileVault state |
| Flake confidence | `bin/proof-repeat` runs any proof command N times, keeps going after failures, enforces optional per-run timeouts, writes pass/fail rate, linked artifact paths, per-run linked manifest summaries, and aggregate failure signatures |
| No orphaned windows/processes | `bin/lab-mac-orphan-proof` runs after product dogfood cleanup and fails on leftover dogfood processes, port listeners, Queue/capture windows, or eventloopOS Ghostty windows |
| One readiness command | `bin/product-readiness-proof lab` |

## Known Blockers Before Real-User Ready

- Lab Mac fresh-clone setup proof is opt-in; run readiness with `PRODUCT_READINESS_FRESH_CLONE=1`.
  - Local isolated-home fresh setup evidence: `artifacts/fresh-clone/2026-06-02T07-40-47-969Z-60783/manifest.json` passed dependency install, preflight doctor, and typecheck from a temp clone with temp `HOME`, temp Corepack/pnpm/npm cache, and gitignored generated artifact dirs excluded from copy input.
  - This is stronger than the previous temp-clone-only smoke, but final release still needs the same proof green on the lab Mac once reachable.
- Product readiness needs `PRODUCT_READINESS_RUNS=3` green before release-ready confidence.
  - Repeat harness evidence: `artifacts/proof-repeat/20260602T054014Z-product-quick-repeat/manifest.json` ran `pnpm product:quick` twice, continued after both lab-offline failures, and linked both failed readiness/connectivity artifacts with `flake_rate=1`.
  - Repeat manifests now include `failure_signatures` and `linked_manifest_summaries`, so 20x dogfood/release loops group flakes by failed step, blocker, release-ready reason, or nested artifact contract without opening each sub-manifest manually.
  - Repeat runs now support `--timeout-seconds` / `PROOF_REPEAT_TIMEOUT_SECONDS`; product quick/dogfood repeat scripts set defaults via `PRODUCT_READINESS_REPEAT_TIMEOUT_SECONDS` so stuck lab/Codex runs fail with a `timeout_Ns` signature and manifest instead of hanging.
  - Product readiness steps also have inner timeouts via `PRODUCT_READINESS_STEP_TIMEOUT_SECONDS`, so the failing child step keeps its own stdout/stderr/timeout metadata before the outer repeat harness groups the failure signature.
  - `pnpm proof:repeat:self-test` asserts linked-manifest summaries, aggregate signatures, and real child-process timeout handling; it runs inside `pnpm run typecheck`.
- Full reboot-level proof is integrated but currently failing: latest release-fast evidence `artifacts/product-readiness/20260602T204124Z-86194-lab-release/manifest.json` passed every non-reboot lab scenario/fault, then `artifacts/lab-runs/20260602-135609-reboot-proof/manifest.json` requested reboot and observed SSH go down, but SSH/Tailscale/VNC did not come back within 420s.
  - The same run passed queue followup, queue decisions, Codex stale-session recovery, Codex completion/workspace, all reliability fault proofs, final window churn guard, dogfood status, snapshot, cleanup, and no-orphan proof before reboot.
  - Queue-window duplication found during release-fast is fixed in `a78351b`: capture/scenario scripts now reuse an existing Queue window instead of repeatedly clicking "Open Queue", and cleanup removes stale Queue/Ghostty/Terminal capture leftovers. Focused `codex-recovery` showed one live Queue window after the fix.
  - Current quick reachability evidence: `artifacts/lab-runs/20260602-140903-wait-online-quick/manifest.json` failed after 3 polls with `ssh_reachable=false`, `vnc_reachable=false`, `lab_tailscale_visible=true`, `lab_tailscale_offline=true`, and `lab_offline_last_seen_seconds=540`.
  - Reboot proof now records controller-side Tailscale last-seen/offline state in its manifest and gives exact lab-console plus controller wait/status commands when SSH does not return.
  - Current follow-up quick-gate evidence: `artifacts/product-readiness/20260602T073643Z-53517-lab-quick/manifest.json` fails first on lab connectivity in 10s with fast preflight, includes a blocker, preserves `failed_lab_connectivity_status`, records `lab_lock` evidence, marks requirement coverage for observability, Tailscale/VNC, and reboot relaunch as blocked, now includes an explicit `queue_ui_video_artifact` dogfood/release requirement, and records strict `release_ready_reasons`.
  - Current connectivity artifact: `artifacts/lab-runs/20260602-003643-lab-connectivity-status/manifest.json` reports SSH timeout, no Tailscale status visibility, and VNC port 5900 timeout. It also captures the controller's Tailscale IP and embeds `LAB_CONTROLLER_TAILSCALE_IP=100.76.35.66 pnpm lab:local-bootstrap` in repair text.
  - Current long bounded wait evidence: `artifacts/lab-runs/20260602-005417-wait-online/manifest.json` waited 24 polls and still found SSH/VNC unreachable.
  - Earlier quick reachability evidence: `artifacts/lab-runs/20260602-011323-wait-online-quick/manifest.json` failed in one poll with `wait_mode=quick`, `connect_timeout_seconds=2`, `lab_tailscale_visible=true`, and `lab_tailscale_offline=true`, confirming the controller can see the lab node in Tailscale but it is offline without spending a 10-minute reboot wait.
  - Controller Tailscale status currently reports `eventloop-lab-mac` (`100.71.111.25`) as offline after the latest reboot proof.
  - Fix before claiming ready: verify Mac auto-login, Tailscale launch-at-login/session startup, Remote Login after reboot, and VNC/Screen Sharing availability without in-person intervention.
  - If someone has local access to the lab Mac, run `LAB_CONTROLLER_TAILSCALE_IP=100.76.35.66 pnpm lab:local-bootstrap` after logging in and use the emitted fixes before rerunning `pnpm product:quick`. Bootstrap installs self-heal first, then runs local recovery checks for SSH/VNC on the lab's own Tailscale IP and can ping the controller peer, not just local listeners.
- Postgres migration mismatch proof now works on the lab without Docker by using native Homebrew Postgres tools when present.
  - Current lab evidence: `artifacts/lab-runs/20260602-130637-lab-fault-postgres-migration-mismatch/manifest.json` passed with the native Postgres fallback.
- Fault-injection coverage now covers the named reliability matrix in release profile. Remaining release proof depth is fresh-clone, reboot, 3x flake confidence, and signing/notarization.
  - Release coverage now requires the actual `bin/lab-mac-connectivity-proof fault` artifact for the Tailscale/VNC disconnected requirement; ordinary connectivity status can still inform quick/setup status, but no longer satisfies release fault-injection coverage by itself.
- App signing/notarization is not proven; `bin/macos-install-proof` can satisfy the current unsigned-dev install gate, while signed/notarized distribution remains a later shipping proof.
  - Current unsigned-dev install evidence: `artifacts/install/20260602T053336Z-macos-install-proof/manifest.json` passed app bundle creation, Info.plist lint, launch smoke, and process cleanup; codesign/Gatekeeper checks failed as expected for unsigned-dev mode.
- Codex local status proof is green on this controller Mac: `artifacts/codex-status/20260602T054653Z-codex-status-proof/manifest.json` proves CLI available, login status ok, auth configured, websocket reachable, provider reachable, and install consistent. This still needs to run green on the lab via `bin/lab-mac-baseline` once the lab is reachable again.
  - macOS permission checker now emits one manifest for Screen Recording, Accessibility/System Events, and AeroSpace readiness.
  - AeroSpace permission/status now separates `aerospace_app_process_visible` from `aerospace_server_ready`, so setup can tell whether AeroSpace.app is not running at all versus running but inaccessible to the CLI.
  - Readiness summaries now promote the failed macOS permission manifest into a first-class `macos_permission_status` section with checks, AeroSpace process list, and concrete fixes.
  - Current local evidence: `artifacts/macos-permissions/20260602T060504Z-macos-permission-status/manifest.json` proves Screen Recording and System Events are usable on this controller Mac, and reports an actionable AeroSpace server fix because AeroSpace is not running here.
  - `pnpm macos:permission-prompt` now opens the relevant Privacy & Security panes and AeroSpace.app for failed checks, then records prompt guidance in its manifest.
  - This still needs to run green on the lab through `bin/lab-mac-baseline` before real-user readiness.
- Local setup status gate collects preflight evidence without the lab. Earlier green evidence `artifacts/product-readiness/20260602T073619Z-52634-local-quick/manifest.json` passed Codex status, unsigned-dev install, and the older macOS permission status on this controller Mac. After adding the AeroSpace mutation probe, the current local quick gate correctly fails earlier on workspace-mutation readiness instead of reaching dogfood first. Local summaries avoid mixing in unrelated latest lab outage commands.
- Local dogfood is currently blocked earlier by AeroSpace server/Accessibility readiness instead of spending a full dogfood run before failing in workspace restore.
  - Failing dogfood evidence: `artifacts/product-readiness/20260602T074447Z-65787-local-dogfood/manifest.json`.
  - Nested workspace evidence: `artifacts/live-aerospace-isolated/2026-06-02T07-46-17-139Z-76200/manifest.json` failed `aerospace layout --window-id ... floating` with `AeroSpace client/server versions don't match`.
  - Previous AeroSpace reinstall repaired CLI/app version skew: the CLI and app now both report commit `419bac96b64cc412c0a2c27704d97e860d352131`, so reinstall is no longer the next recommendation unless mismatch returns.
  - Current fast local setup evidence: `artifacts/product-readiness/20260602T090328Z-17996-local-quick/manifest.json` passes Codex status, unsigned-dev install, and the new Queue UI error-text proof, then fails at `local macos permission status`; summary `artifacts/readiness-summary/20260602T090340-419Z-18634-summary.md` recommends one local next command: `pnpm setup:prompt # re-grant AeroSpace Accessibility, open AeroSpace normally, then run pnpm setup:status`.
  - Current permission evidence: `artifacts/macos-permissions/20260602T090339Z-macos-permission-status/manifest.json` records `aerospace_server_ready=false` and `aerospace_mutation_commands_ready=false` because the AeroSpace server is not running. The fix is to launch AeroSpace, grant/regrant Accessibility if prompted, then rerun setup status.
  - AeroSpace repair is now a repo-owned command with artifacts: `pnpm macos:aerospace-repair`, `pnpm macos:aerospace-repair:restart`, and explicit `pnpm macos:aerospace-repair:reinstall`. Reinstall should be reserved for an actual CLI/server mismatch.
  - AeroSpace repair manifests now expose when direct app-binary launch fallback was used and whether it was diagnostic-only. Direct launch can prove the binary can start, but normal LaunchServices `open -a AeroSpace` readiness is still required for setup/dogfood.
  - AeroSpace repair now records Gatekeeper assessment, app bundle candidates, LaunchServices registration count, fixes, and explicit `fix_commands` for rejected apps or duplicate `bobko.aerospace` registrations.
  - AeroSpace repair status mode no longer reports `final_stability_ready=true` or `launchservices_server_ready=true` unless the AeroSpace server is actually reachable, avoiding misleading local setup summaries when the app is not running. `pnpm macos:aerospace-repair:self-test` asserts this contract and now runs inside `pnpm run typecheck`.
  - Current repair artifact: `artifacts/macos-aerospace-repair/20260602T085213Z-macos-aerospace-repair-restart/manifest.json` correctly fails with `launchservices_server_ready=false`: direct binary launch can reach the server transiently, but `open -a AeroSpace` is not producing a durable normal app server. The fix is to open AeroSpace normally and re-grant Accessibility instead of treating direct launch as readiness.
  - Readiness summary command now turns latest manifests into blocker/next-command output, requirement coverage status counts, and a Markdown TODO artifact:
  - Local quick summary: `artifacts/readiness-summary/20260602T062726Z-summary.json` reports 3 passed, 1 blocked, 19 pending, and 3 not-run requirements, plus release-ready reasons.
  - Lab quick summary: `artifacts/readiness-summary/20260602T074323-652Z-65406-summary.json` reports 1 passed, 3 blocked, 22 pending, and 1 not-run requirement, plus release-ready reasons, with `LAB_CONTROLLER_TAILSCALE_IP=100.76.35.66 pnpm lab:local-bootstrap`, `pnpm lab:wait-online:quick`, and `pnpm setup:lab-status` as next commands.
  - Current Markdown TODO: `artifacts/readiness-summary/20260602T090137-660Z-13813-summary.md` contains release-ready reasons, next commands, blockers, failed steps, an explicit AeroSpace Repair section with freshness/checks/fixes, and grouped requirement gaps. It now avoids recommending repeated AeroSpace restart when a fresh repair already proved `launchservices_server_ready=false`; it points to re-granting Accessibility and opening AeroSpace normally instead.
  - Readiness summary treats AeroSpace repair evidence as current only when it is fresh relative to the product run (`READINESS_AEROSPACE_REPAIR_MAX_AGE_SECONDS`, default 1800). This prevents an old repair artifact from suppressing a useful restart recommendation after state changes.
  - Default `pnpm readiness:summary` now selects the newest `eventloopos.product_readiness_proof` manifest by kind, so nested copied sub-artifact manifests cannot be mistaken for the product readiness run.
  - Summary output now includes `next_command_groups` with `local`, `lab`, and `release` buckets while keeping the flat `next_commands` array for compatibility.
  - Summary output now promotes fresh `lab-mac-wait-online` artifacts into a
    `lab_wait` section and lab command group, so offline-lab recovery remains
    visible even when the newest product proof is local setup status.
  - Summary output artifact names now include milliseconds and PID so parallel summary runs do not overwrite each other.
  - Lab-mode summaries now suppress controller-local AeroSpace repair artifacts, so a lab transport outage points only at lab bootstrap/wait/status commands instead of mixing in unrelated local setup fixes.
  - Product readiness commands now call `node bin/readiness-summary <manifest>` after updating their manifest, so `pnpm setup:lab-status`, `pnpm product:lab-ready`, `pnpm product:dogfood`, and `pnpm product:readiness` emit the JSON and Markdown TODO without a second manual command.
- Queue window failure text is now actionable in both empty-state summaries and the visible error banner for common missing dependencies: orchestrator unavailable, server error, AeroSpace, Screen Recording, Accessibility/System Events, and Codex login/auth. Verified with `swift test --filter QueueWindowPresentationTests`, `swift test --filter QueueWindowRenderTests`, and `pnpm run typecheck`.
  - AeroSpace CLI/app version skew now has specific visible Queue UI copy: restart AeroSpace, then reinstall if the CLI and app bundle still do not match. Verified with `swift test --filter QueueWindowPresentationTests` and `pnpm run typecheck`.
  - AeroSpace LaunchServices/direct-launch failure now has specific visible Queue UI copy: run `pnpm setup:prompt`, re-grant AeroSpace Accessibility, and open AeroSpace normally. Verified with `swift test --filter QueueWindowPresentationTests` and `pnpm run typecheck`.
  - Product readiness now has dedicated `user_facing_dependency_error_text` and `status_history_explainability` coverage items. Current evidence `artifacts/product-readiness/20260602T090328Z-17996-local-quick/steps/local-queue-ui-error-text-proof.stdout.log` proves the Queue UI copy and presentation states locally; lab release still requires live fault matrix and API/activity/task-message evidence for real recovery behavior.
  - Release flake confidence now requires actual 3x artifact counts for each critical queue, recovery, workspace, fault, and transport proof family. A release run that requests 3 passes but fails before scenarios start now leaves `flake_confidence_3x` pending instead of falsely passing.
  - Release manifests and summaries now expose active release options, requested/required run counts, capture-video duration, per-proof-family artifact counts, and an explicit release-ready reason when 3x artifacts are missing.
  - Local dogfood now records the `proof:live` manifest path from stdout when the live proof runs green, and blocks if a successful live proof fails to emit a manifest. Current local dogfood still stops earlier on AeroSpace server readiness.
- Fast setup doc and scripts now make the short loop explicit: `docs/macos-dogfood-setup.md`, `pnpm setup:status`, `pnpm setup:prompt`, `pnpm setup:dogfood`, and `pnpm setup:lab-status`. The doc now also calls out `PRODUCT_READINESS_FAST_PREFLIGHT`, `PRODUCT_READINESS_LAB_LOCK`, and `PRODUCT_READINESS_BASELINE_CACHE`.
  - Lab recovery doc now includes self-heal install/status commands and states the
    boundary clearly: the LaunchAgent can reopen user apps and keep the Mac awake,
    but cannot grant macOS privacy permissions, enable Sharing services, configure
    auto-login, or sign into Tailscale.
  - Local lab bootstrap manifests now summarize the nested local recovery result,
    include required/optional recovery failures, and print the controller-side
    next commands (`lab:wait-online:quick`, `setup:lab-status`,
    `product:transport`, `product:lab-ready`, `product:dogfood`,
    `product:readiness`) when bootstrap
    is green.
  - Self-heal runner now writes `eventloopos.lab_mac_self_heal` manifests even
    when local recovery fails, preserves the linked local recovery manifest path,
    and exposes dry-run hooks so failure/success manifest paths can be tested
    without opening apps or starting `caffeinate`.
  - `bin/lab-mac-baseline` and `bin/lab-mac-local-recovery-check` now require
    the self-heal LaunchAgent plist to exist, pass `plutil -lint`, contain the
    self-heal runner command, and be loaded in the lab user session.
  - `bin/lab-mac-local-bootstrap` gives the in-person operator one command that
    installs self-heal before final recovery checks, avoiding the old sequencing
    trap where recovery required a LaunchAgent that docs installed afterward.
    Its artifact dir includes PID to avoid concurrent run collisions, and it
    exits before installing self-heal if the command is run on the controller
    Mac instead of the lab Mac.
  - `bin/lab-mac-wait-online quick|long` adds bounded polling artifacts for
    short agent/status checks and longer reboot/operator handoff loops, separate
    from the fast-fail product quick gate. Its manifest now carries suggested
    bootstrap/wait/status commands for `pnpm product:next`.
  - Shell fix text no longer uses unescaped backtick command examples, preventing
    accidental command execution while constructing baseline/recovery step
    metadata. Verified with fake bootstrap and plist lint smoke.

## Useful Commands

```sh
bin/lab-mac-baseline
bin/lab-mac-screen-capture-permission status
bin/lab-mac-connectivity-proof status
pnpm lab:local-recovery
pnpm lab:local-bootstrap
pnpm lab:wait-online:quick
pnpm lab:wait-online:long
pnpm lab:self-heal -- install
pnpm lab:self-heal -- status
pnpm lab:self-heal:remote -- install
pnpm lab:orphan-proof
pnpm macos:install-proof
pnpm lab:install-proof
pnpm codex:status-proof
pnpm macos:permission-status
pnpm macos:permission-prompt
LAB_DOGFOOD_REAL_CODEX=1 LAB_DOGFOOD_POSTGRES=0 bin/lab-mac-scenario queue-followup
LAB_DOGFOOD_REAL_CODEX=1 LAB_DOGFOOD_POSTGRES=0 bin/lab-mac-scenario queue-decisions
LAB_DOGFOOD_REAL_CODEX=1 LAB_DOGFOOD_POSTGRES=0 bin/lab-mac-scenario codex-recovery
bin/lab-mac-fault-proof codex-app-server-down
bin/lab-mac-fault-proof orchestrator-crash-restart
bin/lab-mac-fault-proof duplicate-idempotency
bin/lab-mac-fault-proof postgres-unavailable
bin/lab-mac-fault-proof postgres-migration-mismatch
bin/lab-mac-fault-proof aerospace-unavailable
bin/lab-mac-fault-proof aerospace-permission-missing
bin/lab-mac-fault-proof ghostty-cleanup-failure
bin/lab-mac-fault-proof screen-capture-denied
bin/lab-mac-fault-proof queue-app-accessibility-denied
bin/lab-mac-fault-proof aerospace-restore-server-down
bin/lab-mac-connectivity-proof fault
LAB_MAC_REBOOT=1 bin/lab-mac-reboot-proof
bin/lab-mac-fresh-clone-proof
pnpm proof:fresh-clone
pnpm product:quick
PRODUCT_READINESS_REPEAT_RUNS=20 pnpm product:quick:repeat
pnpm product:lab-ready
pnpm product:dogfood
PRODUCT_READINESS_REPEAT_RUNS=20 pnpm product:dogfood:repeat
pnpm product:readiness
```
