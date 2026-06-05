# Hotkey State Machine — iteration 5

Decisions locked across iterations:

1. **Task = agent thread + visible workspace context.** On one monitor, this usually means one AeroSpace workspace. On multiple monitors, a task may mean the set of AeroSpace workspaces visible together when the user is doing that task. The task-anchor Ghostty/Codex/Claude thread lives in that context as a persistent background presence.
2. **Multiple Codex sessions per task allowed.** The task-anchor thread is just the "always there" one; additional Codex windows can be added freely. Each additional Codex window emits its own paper when idle. No "primary vs auxiliary" distinction beyond "one is the task-anchor that defines the desktop."
3. **Shared windows are common, implicit, and reversible.** Default bias: keep useful context around across tasks until the user explicitly removes/dismisses it. Server records `(window_id → set_of_desktops_observed_on)` and window identity slots. A window seen on multiple task contexts can become "follows." No title tag required.
4. **Auto-paper threshold = 60s of Codex idle**, per-task override. Applies to *every* Codex window in the task, not just the anchor.
5. **Manual mode has two exits.** User can restore the pre-loop desktop snapshot, or leave windows where manual work put them. Both paths should be explicit and reversible where possible; never destroy window state unless the user closed the window themselves.
6. **Onboarding scan is a correction surface, not a dashboard.** Scan can propose current desktop groups and approve-all should be fast, but it must avoid forcing the user to classify hundreds of tabs. The natural path remains: work normally, press Advance, let eventloopOS infer/save task context.
7. **Custom user triggers** (e.g., "Slack message matches X → paper for task Y") are first-class but later. Phase 7 / future. Surface should be "easy to set" without writing code.

Iteration 5 clarifications from dogfood planning:

- Workspace restore should preserve **focus and useful stacking order** as much as macOS/AeroSpace allow. Saved layout should include focused window. If z-order can be read reliably, restore should focus windows from back to front, then final focused window last.
- Reading queue can be one shared task, but it must not become a giant setup chore. Unassigned tabs should become papers naturally over time or via explicit promotion, not a 100-row onboarding assignment problem.
- When Codex or Claude goes idle and the task has an idle trigger, paper enters the queue automatically. Suppress papers for the current foreground task where possible so the app does not fight the user while they are already reading that agent.
- Workspace reshuffle target: fast, deterministic, visible. Move only windows tied to the task context or follows layer; avoid surprising unrelated moves.

## What the user does in their day

> Sit down. Open Ghostty. Start a Codex session and start working. Hit a hotkey when you're at a clean break. Things save. Hit it again. Either you're moved to the next thing waiting for you, or you're "free" to start something new.

The Mac queue UI exists for inspection and recovery, **not for normal use**. The user's interaction surface is hotkeys + their normal Ghostty/Codex/browser/Slack windows.

## Task identity (resolved)

A **task** is the central unit of saved-and-restored work. A task has:

- A **task-anchor Codex thread** (UUID) — spawned at task creation, never reused, lives in this task's virtual desktop as a persistent background presence. Conceptually a "per-task agent" — not a master, not shared.
- An **AeroSpace workspace context** — usually one workspace ID. On multi-monitor setups this may expand to the tuple/set of workspaces visible together while the task is active.
- Zero or more **additional Codex sessions / Ghostty windows / arbitrary other windows** — anything else the user has open while working this task. Tracked but not anchoring.

Restoring a task = AeroSpace switches to its workspace context. The task-anchor Codex thread's Ghostty window is already there (or is restored there). Other task-owned windows return to their saved workspace/position when possible. Any *shared* windows (windows observed across multiple task contexts) get pulled along too.

The task-anchor is *the* thing that gives the task its identity and its idle-paper trigger. Multiple Codex sessions per task is fine — each can produce papers independently when idle. The task-anchor is just the one we know is always present.

## Hotkeys

| Hotkey | Name | What it does |
|---|---|---|
| `⌃⌥J` / `⌘⌥⇧J` | **Advance** | The state-machine. See below. This is the one the user is hitting all the time. |
| `⌃⌥E` | Done / Next | Superhuman-style archive/done. Marks the paper done and advances. |
| `⌃⌥Return` | Send to Agent | Runs the selected recommended action, then advances. |
| `⌃⌥H` | Defer 1 Hour | Superhuman-style remind-later hold. |
| `⌃⌥R` | Restore Workspace | Reapplies the selected paper's saved layout and focus. |
| `⌃⌥K` / `⌘⌥⇧K` | Master command | Sheet for explicit verbal/text commands (rerank, broadcast, fan-out, route-to-master). |
| `⌃⌥M` / `⌘⌥⇧M` | Manual mode toggle | Server-side queue pause + restore. |
| `⌃⌥⇧M` | Return Here | Exit manual mode without moving current windows. |

The "advance" hotkey replaces today's `Pull next paper` hotkey with a richer state machine.

The `⌃⌥` aliases keep the same letter shapes as common Superhuman flows while avoiding ordinary app shortcuts. Legacy `⌘⌥⇧` chords remain registered for existing muscle memory.

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
Orthogonal toggle (`⌘⌥⇧M`). Manual mode = server-side B7 flag set, auto-promote/auto-bind/auto-paper paused, and the user is free to use the computer normally. Advance during manual mode → toast "exit manual mode first."

Exiting manual mode needs two clear choices:

- **Restore pre-loop desktop** — use the snapshot from when event-loop mode/manual mode was entered, best-effort restore windows and focus.
- **Keep manual layout** — clear pause flag and resume queue without moving windows.

Both choices should be undoable by reapplying the held snapshot when possible.

## How shared windows work (implicit)

Server-side, on every layout save, record `(window_id → desktop_id)` observations and stable identity slots where possible `(app_bundle, title_prefix)`. A window seen across multiple task contexts over time can become "shared." Restoration of any task context pulls shared windows along in their last-known positions. No user tagging needed. No `[shared]` title required.

Bias: useful windows should remain available across tasks until explicitly dismissed. A window that accidentally becomes shared needs an easy exit ramp later (voice/hotkey/UI command such as "stop sharing Chrome" or "pin this window to this task").

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

Optional later (Phase 7): an MCP skill `eventloopos.enqueue_paper` exposed to Codex itself, so an agent can self-report "I'm waiting on a human" without file-watching. Same skill could let agents define custom triggers (e.g., "watch this Slack channel for my-name mentions → paper for this task"). Phase 7a ships the enqueue tool — see `docs/codex-mcp-skill.md` for the install snippet.

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

## Window sharing — the AeroSpace reality

**AeroSpace assigns each window to exactly one workspace.** It has no native "this window appears on multiple workspaces" concept. So eventloopOS necessarily builds a thin layer on top.

The mental model that fits this:

- A "shared" window in eventloopOS terms is really a **window that follows the user across workspaces.**
- On every AeroSpace workspace-switch (we observe via `aerospace focused-workspace` polling, or AeroSpace's `on-workspace-change` event hook), eventloopOS finds windows marked "follow" and issues `aerospace move-node-to-workspace <new-ws> --window-id <id>` to bring them along.
- From the user's perspective, those windows are simply "always there." They never disappeared.

### How a window becomes "follows" — implicit, no UI

Match the user's intuition: *"if I drag a window to another task's desktop, it should be shared, not moved away from the old one."*

Mechanism:
- When user uses AeroSpace's native `move-node-to-workspace` to bring a window from desktop A to desktop B, eventloopOS observes the move (workspace-change events).
- If the same window has been observed on **2+ distinct task desktops** within the last N hours, mark it as `follows`. From now on, it gets pulled along on every switch.
- Once `follows`, the window is implicitly present on every task desktop the user visits. AeroSpace shows it. Other tasks' saved layouts include its position.
- User can "un-share" by closing the window or by an explicit reverse hotkey (TBD — not in iteration 4).

This is a single-source-of-truth model: the user manipulates AeroSpace natively, eventloopOS observes and amplifies. No `[shared]` title tag. No right-click menu. No new UI.

### Edge case: pulling a window mid-paper

User is in State C (reading a paper), realizes they need a window from another task. They press AeroSpace's "switch to workspace X" hotkey, navigate to the other task's desktop, grab the window via AeroSpace's `move-node-to-workspace`, switch back. eventloopOS observes:
- Workspace switched to X (auto-paper cooldown for X resumes; current_task_id changes to whatever task is bound to X).
- Window moved from X to current paper's workspace.
- Eventloopos doesn't kick the user out of paper-reading mode — the paper UI stays open. AeroSpace just changed what's behind it.
- On switch back, current_task_id changes again. Paper UI continues showing the paper (the paper isn't bound to a workspace; it's a separate floating layer).

The lesson: **the paper UI is workspace-independent.** It floats on whatever desktop the user is currently on. When the user dismisses the paper (advance press), the system uses the user's *current* desktop as the "where they want to be," not the desktop the paper was originally for.

This means if the user wandered to a different desktop while reading a paper, dismissing it advances them from there, not from the original.

## Example user experience — a Tuesday

Concrete walk-through to pressure-test the design:

**8:30 AM.** Jason starts his Mac. eventloopOS service starts (LaunchAgent). AeroSpace shows workspace 1, his default. He opens Ghostty manually, runs `codex resume thread-blog-Q3-launch` in a tab. He starts working.

**8:32 AM.** Jason presses `⌘⌥⇧J`. State A → State B:
- System sees the Codex thread in foreground Ghostty (V10c-style title resolver).
- Calls `POST /tasks { codex_thread_id: thread-blog-..., aerospace_workspace_id: "1" }`. Task created, bound to workspace 1.
- `current_task_id` set. Toast (or no toast) confirms.
- Ambient saver starts capturing this workspace's layout every 5s.

**8:50 AM.** Codex finishes Jason's current ask and goes idle. ~60s later, auto-paper watcher emits a paper for this task. The paper sits in the queue. Jason doesn't notice — he's reading something.

**9:15 AM.** Jason wants to start a different task on Slack work. He uses AeroSpace's `workspace 2` hotkey (his existing muscle memory). AeroSpace switches him to empty workspace 2. He opens Ghostty, runs `codex` (fresh thread). Starts a conversation about the Slack work.

**9:18 AM.** He presses `⌘⌥⇧J`. State A → B:
- New thread detected, new task created, bound to workspace 2. Now two tasks exist.

**9:45 AM.** This Codex thread also goes idle. Another paper. Two papers queued total.

**9:50 AM.** Jason needs his Slack window (currently on workspace 2) to reference while doing the blog work. He uses AeroSpace's hotkey to switch to workspace 1. He notices Slack isn't there. He uses AeroSpace's `back-and-forth` hotkey to flip to 2, grabs Slack via AeroSpace's `move-node-to-workspace 1` hotkey, flips back to 1. Slack is now on workspace 1.

eventloopOS observes: Slack window has been on workspaces {2, 1}. **Marks Slack as `follows`.** From now on, every workspace switch pulls Slack along.

**10:00 AM.** Jason presses `⌘⌥⇧J`. State B → C:
- Layout saved (with Slack now part of workspace 1's saved state).
- Highest-priority paper popped — it's the workspace-1 task's idle paper.
- AeroSpace switches to workspace 1 (already there, no-op).
- Paper UI surfaces.

**10:02 AM.** Jason reviews, hits Send to Agent. Existing flow. Paper marked done. Press again → State C → next paper:
- Next paper is workspace-2's task. AeroSpace switches to workspace 2.
- Slack is automatically moved to workspace 2 (because it's `follows`).
- Paper UI shows on top of workspace 2.

**10:30 AM.** Jason finishes both papers. Press → State C → no more papers → return to State B on the last paper's task (workspace 2). Press again → State B → no papers → State A. AeroSpace switches to limbo (designated empty workspace, e.g. workspace 9).

**11:00 AM.** Lunch. Jason toggles `⌘⌥⇧M` (manual mode). AeroSpace switches to manual-personal workspace. Server pauses auto-promote/auto-bind. He browses YouTube. Toggle off → returns.

**14:00 PM.** Codex thread on workspace 1 finishes another work cycle, goes idle, emits paper. Jason is in limbo (State A). Press → State A → State C (paper popped, switch to workspace 1, Slack follows along).

**End of day.** Jason has implicitly accumulated 2 tasks, each with their own desktop, each with their own work history, with Slack as a shared `follows` window. Tomorrow he can wake up, open Mac, press `⌘⌥⇧J` from limbo and immediately resume work — the system pulls his most recent paper or, if none queued, switches to his last-active task's desktop.

### What "feels Apple" about this

- The user does AeroSpace things they already know (workspace switching, window-move).
- One hotkey for "advance the loop" — predictable.
- No clicking around in a Mac UI for normal flow.
- Sharing happens implicitly — no menu-diving.
- Manual mode is a familiar "step away" toggle.
- The system is aggressive about saving state but quiet about it. The user notices when things resume in the right place, not when things save.

## Sequencing for the actual refactor

1. ✓ Spec locked at iteration 3.
2. **Phase 2: `POST /tasks` + `current_task_id` singleton + `aerospace_workspace_id` column.** ✓ shipped.
3. **Phase 3: Mac advance hotkey state machine** (desktop-aware). ✓ shipped.
4. **Phase 4: Ambient AeroSpace saver.** ✓ shipped and wired through `GatewayStore`.
5. **Phase 5: Auto-paper-on-Codex-idle watcher.** ✓ shipped and wired through `GatewayStore`.
6. **Phase 6: Implicit shared-window "follows" layer.** Observe `(window_id × workspace_id)` membership; mark windows seen on 2+ workspaces as `follows`; on every workspace switch, AeroSpace `move-node-to-workspace` the follows windows along. The paper UI floats workspace-independently.
7. **Phase 7 (future): MCP skill for Codex self-reporting + custom triggers.**

## What's still open after iteration 4

- **Limbo workspace identity.** Iteration 4 says "designated workspace 9" but real value should be configurable. AeroSpace doesn't have a concept of "the unbound workspace" — eventloopOS picks one (default: highest-numbered workspace; user can override).
- **Un-sharing a follows window.** Closing or right-click "stop following" — defer until dogfood reveals if it's painful.
- **What if AeroSpace isn't running?** eventloopOS today already requires AeroSpace as a hard prerequisite (per README). Reaffirm: graceful skip for any flow that needs AeroSpace; clear startup error if AeroSpace is missing.
- **Does the paper UI float over AeroSpace gracefully?** SwiftUI sheet that's not bound to a workspace. Need to confirm AeroSpace doesn't try to assign it. Test in dogfood.

## Decisions log

Iteration 1 → 2 changes are at the top of this doc. Future iterations should append to this section, not edit history in place.
