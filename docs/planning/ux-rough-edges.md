# UX Rough Edges — Brainstorm

State as of 2026-06-04 commit `a1979cd`. Spec at `docs/planning/hotkey-state-machine.md` is iteration 4.

Going through the Tuesday walkthrough and the actual implementation, here's what I think will feel rough during real dogfood. Triaged by user-facing pain. Each item ends with a question for you.

---

## Tier 1 — would annoy you within an hour

### 1.1 Auto-paper false positives while reading Codex output

You're scrolling through a long Codex response. Codex is "idle" (waiting for your input). After 60s, the auto-paper watcher fires a paper *for the very task you're already engaged with*. You see a paper notification but you're literally looking at the thing.

**Mitigations:**
- Bump default threshold (60s → 5 min)?
- Suppress auto-paper if the task's Ghostty/Codex window is foregrounded? (We'd need to know which window has focus.)
- Suppress for N seconds after the user typed anything in that Codex thread? (Codex tracks last user input.)

**Question:** which suppression rule feels right? My instinct: *"don't fire a paper for task X if its Codex window has focus right now."*

---

### 1.2 Send-to-Agent gray for ~30s after task creation — resolved 2026-06-04

You press `⌘⌥⇧J`, task created, Codex thread becomes the anchor. But the auto-bind timer (V10) only ticks every 30s — so for up to 30s, `terminal_ref` is empty and Send-to-Agent stays disabled. First-task-ever frustration.

**Resolution:** foreground create-task now carries the Ghostty `terminal_ref` from
the Mac foreground resolver into `POST /tasks`; the orchestrator forwards it
when synchronously binding the matching task session. Evidence:
`app/orchestrator/test/tasks_route.test.ts`,
`app/macos/Tests/EventLoopQueueCoreTests/AdvanceCoordinatorTests.swift`, and
`app/macos/Tests/EventLoopQueueCoreTests/QueueViewModelAdvanceTests.swift`.

**Mitigations:**
- On task creation, immediately resolve the Ghostty window-id and write `terminal_ref` synchronously, instead of waiting for the next tick.
- OR: bind happens inside the `POST /tasks` handler (one extra step).

**Question:** OK to do the sync bind inside `POST /tasks`? It's ~1 extra AppleScript call, ~50ms.

---

### 1.3 Follows windows: accidental membership needs stronger live affordances

You drag Spotify from workspace 1 to workspace 2 because you wanted to listen to music while working on task 2. Now Spotify is `follows` and gets pulled to every workspace until excluded. The Queue toolbar and command menu now have a Follows Rules sheet where a user can add/remove app-bundle or title-substring exclusions, but the app still does not yet suggest "this window looks accidentally sticky; exclude it?" from the active desktop.

**Mitigations:**
- Add active-window suggestions to the Mac Follows Rules sheet.
- Aging: a window seen in only one workspace recently → un-mark follows.
- Threshold: require 3+ workspaces, not 2, before marking `follows`.
- Voice intent: "stop sharing Spotify."

**Question:** how cheap an exit ramp do you want? My lean: current rules sheet + 3-workspace threshold + voice "stop sharing X."

---

### 1.4 Multi-monitor: tasks bind to AeroSpace workspaces, but workspaces can be per-monitor

AeroSpace has the concept of "workspace 1 on monitor A" vs "workspace 1 on monitor B" depending on settings. If you task-bind workspace 1 on monitor A, then move monitor A's workspace 1 to monitor B, what does the orchestrator do?

**Question:** do you actually use multi-monitor for this work? If yes, I should test the real flow. If no, defer until it bites.

---

## Tier 2 — would annoy you within a day

### 2.1 Limbo workspace identity is hardcoded "9"

Spec said "designated workspace 9." Your AeroSpace config might have workspaces 1-5. We need to either auto-create a limbo workspace at first launch, or pick whichever workspace has no bound task at advance time.

**Question:** auto-create + name it `limbo` (forces an AeroSpace config edit), or "first unbound workspace wins" (more flexible, less predictable)?

---

### 2.2 Idle-threshold semantics: what counts as "idle"?

Today: `idle_seconds = now - rollout.last_event_at`. But Codex's rollout includes both user-input events and agent-output events. So if Codex is *generating output*, `last_event_at` keeps advancing → never idle. Good. But if Codex finishes output and is waiting for the user, `last_event_at` stops → idle counter starts. Also good. The edge case: Codex generated a long response 90s ago, you've been reading, you start typing a reply. Until you submit, Codex sees nothing — the idle clock kept running, paper fires, but you're actively engaged.

**Mitigations:** treat user keystrokes-in-progress as activity. Codex CLI doesn't log keystrokes-in-progress to the rollout (only the final submit). So we can't tell from the rollout alone. Need an extra signal — maybe Mac tracks "user typed in this Ghostty window in last N seconds" via Accessibility API.

**Question:** is "user typing into the Ghostty" a signal we can ignore for now (because most idle-while-reading is short), or worth wiring? I lean ignore for now.

---

### 2.3 Multiple papers queued — priority order

You have task A and task B both with auto-papers queued. You advance. Which paper pops first?

Today's queue uses `priority_score` (today set to default for auto-papers). They'd all have the same score → FIFO by `created_at`. Acceptable but boring.

**Mitigations:** auto-paper priority based on (a) which task you most-recently worked on, (b) how stale the auto-paper is, (c) explicit user-set urgency.

**Question:** for v1, FIFO is fine — agree?

---

### 2.4 Dead Codex thread → never-ending papers

Task references thread UUID X. You delete the rollout file (or never resume the thread). Inspector reads the rollout, finds `last_event_at = 3 days ago`, idle threshold met. Paper fires. Forever. Every 30s.

**Mitigations:** if the task's rollout is older than M minutes (e.g., 24h) AND the user hasn't pulled the resulting paper, mark the task `dormant` and stop emitting papers. User can resume manually.

**Question:** auto-dormant after 24h of staleness? Or let the user kill it from a future Mac UI?

---

## Tier 3 — would annoy you within a week

### 3.1 Custom triggers: substring conflicts across tasks

You set "Slack message about `deploy` → paper for task A." Later you set "Slack message about `deploy` → paper for task B." Now both fire. Confusing.

**Mitigations:** voice intent rejects creating an overlapping trigger. Or both fire and that's just user error.

**Question:** silent both-fire is honest. Reject-with-warning is friendlier. Lean toward "reject with warning showing the existing trigger."

---

### 3.2 Voice "define_trigger" + no current task

You say "if I get a Slack message about deploy, paper this task" while on the limbo desktop. There's no "this task." Today's intent classifier would route somewhere fuzzy.

**Question:** reject + toast "no current task; say `for task <name>` instead"? Or default to last-used task?

---

### 3.3 Task accumulation

After 6 months of dogfood you have 200+ tasks. Most dormant. The Mac UI lists all of them somewhere. UX gets cluttered.

**Mitigations:** auto-archive tasks that haven't had activity in 30 days. Manual archive UI. View-only filter.

**Question:** defer until it's actually a problem? My lean: yes, defer.

---

### 3.4 Codex login expired — visible "degraded mode" indicator

D2 fixes the cryptic log message. But the orchestrator runs in degraded mode (no WebSocket bridge) — the user just doesn't know. Some things will silently work worse.

**Mitigations:** menu-bar icon turns yellow when degraded. Notification on entry into degraded mode.

**Question:** worth a small visual indicator? Or "real users notice when something feels off and check logs"?

---

## Tier 4 — would surface in months

### 4.1 First-run with no AeroSpace installed

`brew install --cask nikitabobko/tap/aerospace` is in the README quickstart. If skipped, orchestrator crashes ungracefully. First-launch impression matters.

**Question:** clear "AeroSpace not detected — install first" toast on Mac app launch?

---

### 4.2 Foreground Codex thread detection has mtime ambiguity (Phase 3a finding)

If you have 5 recent Codex threads on disk, the mtime fallback picks the most recently modified globally — not necessarily the one in *your foreground Ghostty*. Cross-talk on rare cases.

**Mitigations:** Codex CLI doesn't expose "what thread is this terminal." Need an OSC 0 title injection (matching V10c) so the title carries the thread UUID. Then mtime fallback isn't needed.

**Question:** worth writing a small `codex` wrapper that auto-OSC-0s the thread UUID into the title? Then we never need the mtime guess.

---

## My priority for the next 1-2 work sessions

If I had to pick what to fix next, in order:

1. **1.2 Send-to-Agent gray** — this is the very first interaction; bad first impression.
2. **1.1 Auto-paper false positives** — would feel like the system is fighting you.
3. **1.3 Follows windows exit ramp** — Spotify-everywhere is a real risk.
4. **2.1 Limbo workspace** — pick a sensible default + document the override.
5. **2.4 Dead-thread papers** — auto-dormant after 24h.

Defer the rest until real dogfood proves they bite.

## Questions for you

- Do tiers 1 + 2 feel right priority-wise?
- Any rough edges I missed that you'd want filed?
- For the items above where I gave a "my lean," do you agree, or push back?
