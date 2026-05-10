# Hotkey State Machine — iteration 2

Decisions locked from iteration 1's six open questions:

1. **Task identity = primary Codex thread UUID; Ghostty window id is fallback** when no thread is detectable.
2. **One primary anchor per task.** Multi-anchor deferred.
3. **Shared windows via `[shared]` title tag.** Mirrors V10c's `[task:<slug>]` convention.
4. **Auto-paper threshold = 60s of Codex idle**, per-task override allowed.
5. **Manual mode + advance** → toast "exit manual mode first." No queueing.
6. **Onboarding scan stays as recovery tool, not primary path.**

The rest of this doc is the executable spec.

## What the user does in their day

> Sit down. Open Ghostty. Start a Codex session and start working. Hit a hotkey when you're at a clean break. Things save. Hit it again. Either you're moved to the next thing waiting for you, or you're "free" to start something new.

The Mac queue UI exists for inspection and recovery, **not for normal use**. The user's interaction surface is hotkeys + their normal Ghostty/Codex/browser/Slack windows.

## Task identity (the single hardest design call)

A **task** is the central unit of saved-and-restored work. A task has:

- One **primary anchor** — the thing that represents "the work" of this task. Used to (a) detect when the task is idle (→ paper), (b) decide which windows to restore-front when the user resumes the task. Today's best candidate: a Codex thread UUID or a Ghostty window id. The orchestrator stores both when available; the resolver prefers Codex thread UUID because it survives Ghostty restarts.
- Zero or more **task-specific windows** — windows the user touched while on this task that aren't part of any other task. Restored when the user resumes.
- Zero or more **shared windows** (e.g., a "to-do list" Ghostty window, a docs Notion tab) — windows tagged as participating in multiple tasks. Restored on every resume regardless of which task.

Why anchor by Codex thread, not Ghostty window? Threads survive Ghostty restarts; window IDs don't. But a Codex thread doesn't have a screen position. So at restore time: look up the Ghostty window currently rendering this thread (V10c resolver pattern), or if none exists, launch a new Ghostty + `codex resume <thread-id>`. Window positions for the *containing* Ghostty are saved alongside the task.

This handles the "to-do list session in every task" case: that to-do list's Codex thread is registered as a `shared` resource. Other Codex threads (one per task) are primary anchors for their respective tasks.

**Open question for review:** should we let a task have *multiple* primary anchors (e.g., two Codex threads both representing "the work")? Iteration 1 says no — one primary, rest are auxiliaries — for simplicity. Push back if this is wrong.

## Three hotkeys, kept

| Hotkey | Name | What it does |
|---|---|---|
| `⌘⌥⇧J` | **Advance** | The state-machine. See below. This is the one the user is hitting all the time. |
| `⌘⌥⇧K` | Master command | Sheet for explicit verbal/text commands (rerank, broadcast, fan-out, route-to-master). Unchanged from today. |
| `⌘⌥⇧M` | Manual mode toggle | Server-side queue pause + restore. Unchanged from B7. |

The "advance" hotkey replaces today's `Pull next paper` hotkey with a richer state machine.

## Advance state machine

States the system can be in when the hotkey is pressed:

### State A — Unbounded
No active task. The user is just on their Mac doing whatever.

**On press:**
1. Inspect foreground app.
2. If it's a Ghostty window:
   - Find the Codex/Claude thread rendering inside it (V10c-style title resolver, or Codex CLI's own session detection).
   - Capture current AeroSpace window layout.
   - **Create a new task** keyed by the thread UUID (or Ghostty window id if no thread visible).
   - Register the thread as a watcher: when it goes idle >N seconds, emit a paper for this task.
   - User now in **State B**.
3. If foreground is *not* Ghostty:
   - Show a small toast: *"No agent thread detected — open Ghostty with a Codex session and try again, or use master command to start one."*
   - Stay in State A.

### State B — On task, no paper queued
A current task is active. User is doing the work.

**On press:**
1. Capture latest AeroSpace layout into the task.
2. Mark the task "soft-closed" (not deleted; we keep the saved state for future resume).
3. If queue has any pending paper across all tasks → pop the highest-priority one, restore its windows, transition to **State C**.
4. If queue is empty → return to **State A**.

### State C — On a paper
A paper has been pulled; the user is reviewing/working through it.

**On press (Done / Next semantic):**
1. Capture latest AeroSpace layout into the paper's task.
2. Mark paper done, send-to-agent if the paper is set to do that, etc. (existing flow).
3. If queue has more papers → pop next, restore, stay in State C with the new paper.
4. Otherwise → if a current task is still considered active (user is mid-flow) return to State B; else return to State A.

### State D — Manual mode (`⌘⌥⇧M` was pressed)
Orthogonal. Press advance while in manual mode → toast "in manual mode; toggle off first." (Or: queue advance for when manual mode exits — TBD.)

## Implicit ambient saves

Between hotkey presses, while in State B or C:
- AeroSpace event-listen (or 5s polling fallback) → debounce 3s after last change → save snapshot to the current task.
- Cheap, always-on. Means the next time the user resumes this task, the windows are *exactly* where they last were, even without an explicit advance press.

## Auto-paper generation

For each registered task, watch its primary anchor (Codex thread):
- Every 30s, read `~/.codex/sessions/<...>/<thread>.jsonl` (existing `inspectCodexSession` flow).
- If `idle_seconds > N` (default 60s, configurable per task) AND no paper is currently active for this task → emit a paper. Body markdown = recent transcript summary; restore plan = task's saved window layout.
- Throttle: once a paper is emitted for a task, suppress further auto-paper for that task until the user has either pulled the paper or marked it stale.

Optional later: an MCP skill `eventloopos.enqueue_paper` exposed to Codex itself, so an agent can self-report "I'm waiting on a human" without us file-watching.

## Shared windows

Mechanism iteration 1: a window is "shared" iff it's a Ghostty window whose title contains `[shared]` (analogous to the `[task:<slug>]` convention V10c reads). When saving a task layout, shared windows are recorded but with a flag. On restore, shared windows are positioned wherever they were last seen *globally* (across all tasks), not the per-task position.

Open question: do we need a config UI for this, or is title-based tagging enough? Iteration 1 says title-tagging is enough; revisit after dogfood.

## What changes vs today

- **`pullNextPaper` becomes `advance`.** Smarter behavior.
- **Onboarding scan + approve flow** becomes optional. Tasks are created implicitly via advance. Onboarding stays for "find existing Codex sessions worth recovering" but isn't the primary path.
- **Auto-promote / auto-bind timers** keep running. Auto-bind is now subordinate to "task created via advance press" — it fills in `terminal_ref` for tasks that were created without a session attached.
- **`POST /tasks`** new route for implicit task creation: `{primary_anchor: {kind: "codex_thread" | "ghostty_window", id: string}, captured_layout: WorkspaceSnapshot}`. Idempotency-keyed by `primary_anchor.id` so re-press in unbounded on the same window doesn't create duplicates.
- **Server-side state**: a singleton `current_task_id` (per-user; today single-user) so the orchestrator knows which task an ambient save belongs to.

## What's not in this iteration

- Multi-anchor tasks (one task with two equal-weight Codex threads).
- Cross-Mac sync (multiple Macs sharing tasks).
- Codex skill for self-reporting (filed as future once the rest stabilizes).
- Voice-driven advance (today voice goes through master command sheet; advance is hotkey-only).
- Time-based advance ("auto-advance every 30 min if no human input") — out of scope.

## Sequencing for the actual refactor

1. Lock this doc (you push back, we iterate, then we agree).
2. New `POST /tasks` route + `current_task_id` singleton.
3. Mac advance hotkey state machine (replace `pullNextPaper` wiring).
4. Ambient AeroSpace saver (event-listen or polling fallback).
5. Auto-paper-on-Codex-idle watcher.
6. Shared-window mechanism (title tag).
7. (Later) MCP skill for self-reporting.

## Decisions log

Iteration 1 → 2 changes are at the top of this doc. Future iterations should append to this section, not edit history in place.
