# eventloopOS Current Goal

Ship and prove macOS workspace UX for a real human dogfood session.

## Scope

- Keep AeroSpace in non-tiling/floating mode for eventloopOS dogfood.
- Ship Rectangle-style window-management hotkeys in the eventloopOS AeroSpace profile where they do not conflict with eventloopOS queue hotkeys.
- Capture and restore exact floating window geometry: workspace, monitor, layout, x, y, width, and height.
- Prove one real window can belong to more than one paper/task, with a different saved position per paper.
- Make ambient autosave/follows-window behavior production-real enough that moved or newly opened windows on the active paper are remembered without extra user work.
- Tighten snapshot capture so saved task layouts include the intended paper/follows windows, not unrelated lab windows.
- Use lab Mac desktop screenshots by default for automated demo readiness so the controller Mac keeps focus; keep local Screen Sharing window-only capture available as an explicit no-raise helper.
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
  - lab Mac desktop screenshot capture by default, plus explicit no-raise local Screen Sharing capture when needed
- Use screenshots during proof where useful.
- Push interesting completed commits to GitHub after tests pass.

## Finish Criteria

- Mac Studio is ready for Jason to sit down at keyboard/mouse and run a guided demo.
- Demo walkthrough explains what to press, what should happen, and what problems to report.
- Remaining blockers/TODOs are explicit and separated from shipped/proven behavior.

See `docs/human-demo-completion-audit.md` for the current evidence map and the remaining human gate.
