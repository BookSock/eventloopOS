# One-Paper Queue UI

Goal: make the Mac app feel like one active paper on the desk, not a dashboard.

## Product Contract

The queue UI should answer only four questions first:

- What is the current paper?
- Why does it need a human?
- What context/evidence matters?
- What is the next action?

The stack can be visible, but it is secondary. The user should not feel like they are triaging a table of tickets.

Non-goal for MVP: pulling the user out of other work. No sound, banner, haptic, Focus-mode gate, or meeting-aware interruption is needed for this product shape. User enters event-loop mode intentionally and pulls from the stack.

## Required Actions

Current paper:

- `Done / Next`
- `Send back to agent` when a task session or recommended action exists.
- `Restore context`
- `Defer`
- `Ignore`
- `Open source`
- `Manual Mode`

Manual Mode must offer two exits:

- `Return + Restore` — resume event-loop mode and restore the saved pre-loop desktop snapshot.
- `Return Here` — resume event-loop mode without moving windows.

The user should never feel trapped in an event-loop layout. The app should preserve a reversible snapshot where possible and make the chosen restore behavior visible.

Secondary stack:

- Shows count and rough priority.
- Lets user jump only when needed.
- Avoids making queue management the primary work.

## Acceptance Criteria

MVP UI is acceptable when:

- Current packet dominates first viewport.
- User can complete simple packet with one primary action.
- Restore state is visible near the resource it affects.
- Disabled agent actions explain missing binding, policy block, or runtime failure.
- Manual Mode state is obvious and reversible.
- Manual Mode exit choice is explicit: restore saved desktop or keep current manual layout.
- Empty state does not look like marketing; it should show local daemon/source status and next setup step.
- Lineage/history shows enough to answer "what happened before this paper reached me?" without exposing raw task-message text.
- Task-session identity is visible enough that user knows which Codex/Claude thread will receive a send-back action.

## Test Proof

Tests should prove:

- Rendered queue view is nonblank.
- Current paper remains visible with long title/body/evidence.
- Done, defer, ignore, restore, and manual-mode actions call expected APIs.
- Full local smoke can move from queued paper to done/next.
- Send-back-to-agent proof shows visible Codex/Claude target identity before message send.
- Screenshot artifact exists for UI failures.

## Defer

Do not build now:

- Passive banners.
- Notification sounds.
- Calendar-aware surfacing.
- Focus-mode integration.
- Complex Kanban/list management.
