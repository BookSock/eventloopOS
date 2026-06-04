# eventloopOS

[![CI](https://github.com/BookSock/eventloopOS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BookSock/eventloopOS/actions/workflows/ci.yml)
[![Secret Scan](https://github.com/BookSock/eventloopOS/actions/workflows/secret-scan.yml/badge.svg?branch=main)](https://github.com/BookSock/eventloopOS/actions/workflows/secret-scan.yml)

eventloopOS turns your Mac into an attention scheduler for agent-heavy work: a single ranked queue of "papers" that need a human, where pulling a paper restores its full workspace (windows, Codex thread, Chrome tabs, source thread) so the decision takes seconds instead of minutes of context-hunting. It is built for people running many parallel coding/email/research agents who feel review bandwidth — not agent execution — as the bottleneck.

> **Status:** pre-1.0. Working dogfood for solo dev use. Many surfaces still need real-world verification — see [TODO.md](./TODO.md). Not production-ready. Engineering guardrails: see [docs/guardrails.md](./docs/guardrails.md).

## Vision

You are not "using apps" anymore. You are moving through work papers.

The main screen is your intake stack. Each paper is a human-blocked task — could come from Slack, Gmail, a Codex agent, a Chrome tab, a reading list, or your todo file. When you pull a paper:

- eventloopOS leases the top-priority queue item.
- Your Mac reshapes into that task's workbench: the right Ghostty window, Codex thread, browser tab, doc, and Slack thread come forward.
- A short context packet says *why this needs you*.
- You decide fast.

Then one action: **Done / Next**, **Send to Agent / Next**, **Defer**, **Ignore**, or **Manual Mode** (escape hatch to use the Mac normally). The current workspace saves to that task, the paper leaves your desk, agents continue async if needed, the next paper comes forward, the Mac reshapes again.

It is **not** a notification product and **not** trying to interrupt you constantly. It is "I sat down to process work — give me the next highest-leverage paper, with the whole workbench attached."

## Quickstart

```sh
brew install --cask nikitabobko/tap/aerospace   # required workspace backend
pnpm install
pnpm run dev:dogfood                            # builds + runs orchestrator + Mac queue app
```

Once the queue app is up, these global hotkeys do most of the work:

| Hotkey | Action |
|---|---|
| `Ctrl-Option-J` | Advance to the next paper/task state |
| `Ctrl-Option-E` | Done / Next |
| `Ctrl-Option-Return` | Send selected paper back to its bound agent |
| `Ctrl-Option-H` | Defer selected paper one hour |
| `Ctrl-Option-R` | Restore selected paper workspace |
| `Ctrl-Option-K` | Open master command sheet (route / start task / rerank / broadcast) |
| `Ctrl-Option-M` | Enter Manual Mode, or return and restore while in Manual Mode |
| `Ctrl-Option-Shift-M` | Return from Manual Mode and keep current layout |

Legacy `Cmd-Option-Shift-J/M/K` aliases are still registered for older dogfood setups.

For first-time setup on a fresh Mac (Codex CLI, Chrome extension, AeroSpace permissions, etc.), see [docs/try-on-mac.md](docs/try-on-mac.md).

## Repo layout

- `app/orchestrator/` — TypeScript HTTP gateway: queue, routing, MCP source polling, agent handoff, restore plans, observability.
- `app/macos/` — Swift/SwiftUI Mac app: queue UI, hotkeys, workspace capture/restore, master command sheet, voice mic.
- `app/browser-extension/` — Chrome extension: tab capture and scroll-anchor restore.
- `app/native-host/` — native messaging bridge between extension and orchestrator.
- `docs/planning/` — product brief, architecture, roadmap, research synthesis.
- `external-resources/` — source links, API docs, competitive references.

The named "spine" of the system is four primitives in `app/orchestrator/src/runtime.ts`: the queue store, the task-session controller, the workspace controller, and the observability pipeline. Routes, MCP sources, restore-plan providers, and the Mac/extension clients are all connectors and glue on top of those four.

## Roadmap and known gaps

See [TODO.md](./TODO.md) for the live list — what's built but not yet verified end-to-end, what's missing for full vision, and what's polish.

Major in-flight directions:

- Real-world dogfood: product-readiness and lab proofs are green, but daily-use friction still drives the roadmap.
- Primitive SDK/library hardening: run `pnpm primitives:doctor` to validate the catalog, OpenAPI export, examples, and optional live host API.
- Follows/unfollow UX: Queue toolbar and command menu now expose a Mac rule editor; remaining work is richer per-window suggestions and live demo proof.
- Richer starter apps/examples on top of `@eventloopos/shared/primitives`.

## Contributing

Single maintainer for now. If you want to use it, fork it and dogfood. If you want to discuss the design, open a Discussion.
