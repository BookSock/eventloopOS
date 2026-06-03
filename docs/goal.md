# eventloopOS Current Goal

Ship and prove macOS workspace UX for a real human dogfood session.

## Scope

- Keep AeroSpace in non-tiling/floating mode for eventloopOS dogfood.
- Ship Rectangle-style window-management hotkeys in the eventloopOS AeroSpace profile where they do not conflict with eventloopOS queue hotkeys.
- Capture and restore exact floating window geometry: workspace, monitor, layout, x, y, width, and height.
- Prove one real window can belong to more than one paper/task, with a different saved position per paper.
- Make ambient autosave/follows-window behavior production-real enough that moved or newly opened windows on the active paper are remembered without extra user work.
- Tighten snapshot capture so saved task layouts include the intended paper/follows windows, not unrelated lab windows.
- Keep local Screen Sharing window-only screenshot capture working so the agent can inspect the Mac Studio demo without capturing unrelated local desktop content.
- Build a repeatable Mac Studio human demo that starts from a clean state, opens real dummy work windows, queues several papers, and lets Jason test the UX with keyboard and mouse.

## Proof

- Run orchestrator tests, typecheck, focused Swift tests, and any new focused tests for geometry/workspace behavior.
- Run live Mac Studio proofs until they pass repeatedly:
  - dogfood stack health
  - floating AeroSpace profile loaded
  - Rectangle-style hotkeys present
  - exact geometry restore
  - one shared window restored to different positions on two papers
  - ambient autosave after moving/opening windows
  - local Screen Sharing screenshot capture
- Use screenshots during proof where useful.
- Push interesting completed commits to GitHub after tests pass.

## Finish Criteria

- Mac Studio is ready for Jason to sit down at keyboard/mouse and run a guided demo.
- Demo walkthrough explains what to press, what should happen, and what problems to report.
- Remaining blockers/TODOs are explicit and separated from shipped/proven behavior.
