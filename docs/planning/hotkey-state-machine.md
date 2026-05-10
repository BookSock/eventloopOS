# Hotkey State Machine — iteration 3

Decisions locked across iterations:

1. **Task = (Codex thread UUID, AeroSpace virtual desktop).** Each task has a dedicated Codex thread spawned at task creation. That thread's Ghostty window lives in the task's virtual desktop as a persistent background presence — never moved between tasks. Other Codex/Ghostty/Slack/Chrome windows are free to move; AeroSpace tracks them.
2. **Multiple Codex sessions per task allowed.** The task-anchor thread is just the "always there" one; additional Codex windows can be added freely. Each additional Codex window emits its own paper when idle. No "primary vs auxiliary" distinction beyond "one is the task-anchor that defines the desktop."
3. **Shared windows tracked implicitly, no title tag.** Server records `(window_id → set_of_desktops_observed_on)`. A window seen on N>1 desktops is "shared." Restored on any desktop switch where it was previously seen. No user action required.
4. **Auto-paper threshold = 60s of Codex idle**, per-task override. Applies to *every* Codex window in the task, not just the anchor.
5. **Manual mode** = a designated personal AeroSpace virtual desktop. Toggle on → switch to it; server-side B7 flag pauses orchestrator auto-work. Toggle off → AeroSpace returns to the previous desktop. Advance pressed during manual mode → toast.
6. **Onboarding scan dropped as primary path.** First-run UX = one screen: "press ⌘⌥⇧J in a Ghostty window to make your first task." Existing-thread import is a future skill (B-tier).
7. **Custom user triggers** (e.g., "Slack message matches X → paper for task Y") are first-class but later. Phase 7 / future. Surface should be "easy to set" without writing code.

## What the user does in their day

> Sit down. Open Ghostty. Start a Codex session and start working. Hit a hotkey when you're at a clean break. Things save. Hit it again. Either you're moved to the next thing waiting for you, or you're "free" to start something new.

The Mac queue UI exists for inspection and recovery, **not for normal use**. The user's interaction surface is hotkeys + their normal Ghostty/Codex/browser/Slack windows.

## Task identity (resolved)

A **task** is the central unit of saved-and-restored work. A task has:

- A **task-anchor Codex thread** (UUID) — spawned at task creation, never reused, lives in this task's virtual desktop as a persistent background presence. Conceptually a "per-task agent" — not a master, not shared.
- An **AeroSpace virtual desktop** ID — the literal desktop the user is on when working this task. Switching tasks = switching desktops. AeroSpace handles the actual screen change.
- Zero or more **additional Codex sessions / Ghostty windows / arbitrary other windows** — anything else the user has open while working this task. Tracked but not anchoring.

Restoring a task = AeroSpace switches to its virtual desktop. The task-anchor Codex thread's Ghostty window is already there (it never moved). Other windows are wherever AeroSpace last placed them. Any *shared* windows (windows observed on multiple tasks' desktops) get pulled into the new desktop too.

The task-anchor is *the* thing that gives the task its identity and its idle-paper trigger. Multiple Codex sessions per task is fine — each can produce papers independently when idle. The task-anchor is just the one we know is always present.

## Three hotkeys, kept

| Hotkey | Name | What it does |
|---|---|---|
| `⌘⌥⇧J` | **Advance** | The state-machine. See below. This is the one the user is hitting all the time. |
| `⌘⌥⇧K` | Master command | Sheet for explicit verbal/text commands (rerank, broadcast, fan-out, route-to-master). Unchanged from today. |
| `⌘⌥⇧M` | Manual mode toggle | Server-side queue pause + restore. Unchanged from B7. |

The "advance" hotkey replaces today's `Pull next paper` hotkey with a richer state machine.

## Advance state machine (desktop-aware)

The current state is read from "what AeroSpace virtual desktop am I on, and is it bound to a task?"

### State A — Limbo desktop (no task bound)
The user is on a virtual desktop that has no associated task. (First launch lands here. Also: when the user advances out of a task with no paper queued, they end up here.)

**On press:**
1. Look at the foregrounded Ghostty window.
   - If it has a Codex/Claude thread visible (resolved via V10c-style title or Codex CLI session detection): use that thread as the task-anchor. **No new thread spawned.**
   - If foreground is Ghostty but no thread detectable: spawn a new Codex thread, attach it to this Ghostty window's foreground tab, use it as the task-anchor.
   - If foreground isn't Ghostty: launch Ghostty + spawn a new Codex thread + use that.
2. Bind the current AeroSpace virtual desktop ID to this new task.
3. Capture current window layout.
4. Register all Codex windows in this desktop as paper-trigger sources.
5. User now in **State B** (on this task).

### State B — On a task, no paper queued
Current desktop is bound to a task. User is doing the work. Codex thread may be active or idle.

**On press:**
1. Capture latest layout for this task (debounced ambient saver was already doing this; press forces an immediate save).
2. If queue has any pending paper for ANY task → pop highest-priority, switch AeroSpace to that paper's desktop, transition to **State C**. AeroSpace handles the visual switch.
3. If queue is empty → AeroSpace switches to the limbo desktop. User is in **State A**.

### State C — On a paper
Current desktop is bound to a task and a paper is open. (The paper was generated for this task or a sibling.)

**On press (Done / Next):**
1. Capture latest layout for this task.
2. Mark paper done, fire send-to-agent if applicable.
3. If queue has more papers → pop next, switch desktop, stay in State C.
4. Otherwise → AeroSpace returns to the desktop the user was on before the paper popped (often State B); if that desktop is gone, fallback to limbo (State A).

### State D — Manual mode
Orthogonal toggle (`⌘⌥⇧M`). Manual mode = AeroSpace switched to the designated personal desktop + server-side B7 flag set. Auto-promote/auto-bind/auto-paper paused. Advance during manual mode → toast "exit manual mode first." Toggle off → AeroSpace returns + flag cleared.

## How shared windows work (implicit)

Server-side, on every layout save, record `(window_id → desktop_id)` observations. A window seen on multiple distinct desktops over time is "shared." Restoration of any desktop pulls in all shared windows last seen on that desktop, in their last-known positions. No user tagging needed. No `[shared]` title required.

Edge case: a window the user genuinely *just* moved across desktops, that was once unique to one task, now becomes shared. That's correct behavior — the user implicitly opted-in by using it across desktops.

## Implicit ambient saves

Between hotkey presses, while in State B or C:
- AeroSpace event-listen (or 5s polling fallback) → debounce 3s after last change → save snapshot to the current task.
- Cheap, always-on. Means the next time the user resumes this task, the windows are *exactly* where they last were, even without an explicit advance press.

## Auto-paper generation

For *every* Codex window in *every* task — not just task-anchors:
- Watcher tracks each `(taskId, codexThreadId)` registered.
- Every 30s, read the rollout file via `inspectCodexSession`.
- If `idle_seconds >= task.auto_paper_idle_seconds` (default 60s) AND we haven't already emitted a paper for this `(taskId, codexThreadId)` in the current idle period → emit a paper. Body = recent transcript summary; restore plan = task's saved window layout.
- Throttle keys on the rollout's `last_event_at`. Once activity advances `last_event_at`, a new idle period starts and a new paper can fire.

Optional later (Phase 7): an MCP skill `eventloopos.enqueue_paper` exposed to Codex itself, so an agent can self-report "I'm waiting on a human" without file-watching. Same skill could let agents define custom triggers (e.g., "watch this Slack channel for my-name mentions → paper for this task").

## What changes vs today

- **`pullNextPaper` becomes `advance`.** Desktop-aware state machine.
- **Onboarding scan + approve flow** dropped as primary path. First-run = one tutorial screen. Existing-thread import filed as future skill.
- **Auto-promote / auto-bind timers** keep running. Auto-bind is now subordinate to "task created via advance" — it fills in `terminal_ref` for tasks created without a session attached.
- **New `POST /tasks` route** — body `{ task_anchor: { codex_thread_id }, aerospace_workspace_id, captured_layout }`. Idempotency-keyed by `(codex_thread_id, aerospace_workspace_id)`.
- **New `current_task` server state** — singleton pointing at the active task ID; null = limbo desktop. Updated by the Mac on every desktop switch (or by AeroSpace event hook eventually).
- **Implicit shared-window observation** — server records every `(window_id, desktop_id)` seen on every layout save. Window-shared-across-desktops detection is a SQL aggregate, not a user-set tag.
- **AeroSpace desktop is first-class.** Tasks bind to a workspace ID. The Mac listens for AeroSpace workspace-change events (via `aerospace list-workspaces` polling or the in-config event hooks) and updates `current_task` accordingly.

## What's not in this iteration

- Cross-Mac sync (multiple Macs sharing tasks).
- Codex skill for self-reporting + custom triggers (Phase 7, future).
- Voice-driven advance (today voice goes through master command sheet; advance is hotkey-only).
- Time-based advance ("auto-advance every 30 min if no human input").
- Existing-Codex-thread import flow on first launch.

## Sequencing for the actual refactor

1. ✓ Spec locked at iteration 3.
2. **Phase 2: `POST /tasks` + `current_task_id` singleton + `aerospace_workspace_id` column.** (in flight)
3. **Phase 3: Mac advance hotkey state machine** (desktop-aware). Depends on phase 2.
4. **Phase 4: Ambient AeroSpace saver.** ✓ shipped (needs phase-2-integration to wire).
5. **Phase 5: Auto-paper-on-Codex-idle watcher.** ✓ shipped (needs phase-2-integration to wire).
6. **Phase 6: Implicit shared-window aggregation.** Server-side SQL view + restoration logic.
7. **Phase 7 (future): MCP skill for Codex self-reporting + custom triggers.**

## Decisions log

Iteration 1 → 2 changes are at the top of this doc. Future iterations should append to this section, not edit history in place.
