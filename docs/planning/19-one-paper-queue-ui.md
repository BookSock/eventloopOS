# One-Paper Queue UI

Goal: make the Mac app feel like one active paper on the desk, not a dashboard.

## Product Contract

The queue UI should answer only four questions first:

- What is the current paper?
- Why does it need a human?
- What context/evidence matters?
- What is the next action?

The stack can be visible, but it is secondary. The user should not feel like they are triaging a table of tickets.

## Required Actions

Current paper:

- `Done / Next`
- `Send back to agent` when a task session or recommended action exists.
- `Restore context`
- `Defer`
- `Ignore`
- `Open source`
- `Manual Mode`

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
- Empty state does not look like marketing; it should show local daemon/source status and next setup step.

## Test Proof

Tests should prove:

- Rendered queue view is nonblank.
- Current paper remains visible with long title/body/evidence.
- Done, defer, ignore, restore, and manual-mode actions call expected APIs.
- Full local smoke can move from queued paper to done/next.
- Screenshot artifact exists for UI failures.

## Defer

Do not build now:

- Passive banners.
- Notification sounds.
- Calendar-aware surfacing.
- Focus-mode integration.
- Complex Kanban/list management.

