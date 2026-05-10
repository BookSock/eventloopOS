# eventloopOS TODO

Live list of code gaps for the full vision. Sorted into **Build**, **Verify** (built but not proven live end-to-end), and **Polish**. Items are checked off as they ship.

## Build

- [x] **B1. Tab scroll-anchor capture.** ~~Chrome extension restores scroll, but capture currently records URL only, not the scroll position or selection. Vision says "scroll to exact paragraph" — capture-side needs to record scroll offset, optional CSS selector hint, and a quoted text snippet.~~ ✅ Shipped 2026-05-09: capture-page + content-script now emit `text_quote` + `selector_hint` from a viewport anchor; restore round-trip verified by tests.
- [x] **B2. Multi-display workspace restore.** ~~AeroSpace sees windows but workspace restore plans don't account for which monitor a window was on. Single-display works; multi probably broken.~~ ✅ Shipped 2026-05-09: restore plan emits `move-node-to-monitor` commands when saved `monitorId` differs from current; `capabilityStatus` reports `monitorCount`.
- [ ] **B3. Postgres `task_session_terminal_refs` persistence.** File-based codex-task-map persists fine for Codex. In-memory dev controller still loses `terminal_ref` on restart. Add a Postgres table for non-codex sessions when running with Postgres backend.
- [x] **B4. Crash recovery for in-flight queue items.** ~~If orchestrator dies mid-action (after terminal keystroke, before followup ack), resume on restart isn't proven. Need idempotency check on the recommended-action route + a postgres-backed proof.~~ ✅ Shipped 2026-05-09: `queue_action_attempts` table + `Idempotency-Key` header on `POST /queue/:id/actions/recommended`; partial-retry reuses cached `terminal_send_result` so the keystroke never fires twice.
- [ ] **B5. Doc / PDF / image paper sources.** Only browser/slack/gmail/manual/agent-runs today. Vision implies "any blocked work." A simple `paper:` source that ingests a markdown blob with `task_hint` would unblock note-style intake.
- [x] **B6. Master NL command parser extensions.** ~~"Raise priority of X" and "tell every Y task to Z" work. "Defer all non-critical for an hour", "wrap up by 3pm", "pause everything" not parsed yet. Extend `voice/intent_classifier.ts` with `defer` and `pause` intents.~~ ✅ Shipped 2026-05-09: `defer` (requires `all|every|each` quantifier + duration) and `pause` intents wired through `/voice/commands` ahead of rerank/fan-out routing.

## Verify (built but not proven live end-to-end)

- [ ] **V7. Real Chrome tab → reading queue → restore.** Extension is loaded; never tested with a real Slack/Notion/Docs tab through the queue.
- [ ] **V8. Real Send-to-Agent → real Codex thread with terminal_ref keystroke** landing in front Ghostty. Smoke proof uses tmux; never tested with real Codex + real Ghostty.
- [ ] **V9. Voice mic → real microphone → STT → /voice/commands → fan-out delivered.** Built end-to-end, never spoken into during dogfood.
- [ ] **V10. Auto-bind continuous timer** firing every 30s in real dogfood, finding real `[task:foo]` Ghostty windows, binding correctly.
- [ ] **V11. Reading queue auto-promote timer** firing on the orchestrator side under real captured tabs (env var exists; never enabled in dogfood).
- [ ] **V12. Onboarding scan → approve → first paper → done** as a real Mac flow with real windows and real Codex threads. Live proof exercises sub-steps; full happy path not done.
- [ ] **V13. Manual mode → real desktop returns → return to loop → original workbench back.** Exists in code; never run with real personal layout.
- [ ] **V14. Browser extension anchor restore on actual Slack/Notion/Docs sites** with real allowed-origins config. Handlers shipped; never opened against real sites.
- [ ] **V15. Master fan-out with `idle_min_seconds` filter against real running Codex threads** (uses `inspectCodexSession` rollout file). Unit-tested, never run against real `~/.codex/sessions/`.

## Polish

- [ ] **P16. Split `QueueModels.swift` (1.8k LOC)** by domain when it starts hurting (review packets, task sessions, onboarding, master command, etc).
- [ ] **P17. Split `FakeQueueClient` out of `QueueClient.swift`** (~700 of the 1.5k lines is test stub). Do when adding the next protocol method makes the file painful.
- [ ] **P18. Activity feed filter chips and search** so a long activity log is browsable.
- [ ] **P19. Onboarding "Approve all + Queue" hotkey** so day-1 onboarding feels one keystroke.
- [ ] **P20. Repo Topics on GitHub UI** (`event-loop`, `attention`, `agents`, `macos`, `chrome-extension`, etc) for discovery.

---

Last updated: 2026-05-09 (B4 + B6 landed). Updated as items complete.
