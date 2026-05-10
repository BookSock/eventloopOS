# AI Engineering Principles

Lessons distilled from real production teams running heavy AI-coding workflows, mapped to how we work in this codebase. eventloopOS is itself an attention scheduler for agent-heavy work, so the way we build it should reflect what we believe about how agents should be used.

## Core stance

AI is a serious production multiplier. Blind "vibe coding" is not the frontier — the frontier is rigorous human direction, heavy AI execution, automated guardrails, and selective review. The CTO who distrusts unreviewed AI code is right; so is the CEO who sees more leverage available. Reconcile by automating the parts of review that can be automated, and reserving human attention for the parts that cannot.

## Where AI is already strong

- Internal tools, workflow automations, prototypes, low-risk experiments.
- Letting non-technical teammates build useful software.
- Repetitive implementation, test writing, bug fixing, mechanical refactors.

## Where AI quietly hurts you

The dangerous failure mode is not "AI breaks the build." It is "AI preserves surface-level behavior while damaging maintainability." Concretely:

- Duplicating components instead of extracting reusable ones (e.g., several near-identical UI cards across screens that later all need the same bugfix).
- Generating 2,000-line diffs that should have been 200 lines.
- Adding subtle behavioral changes that pass tests but degrade quality.
- Letting complexity inflate unchecked until simplification becomes hard.

Review bots catch correctness bugs and edge cases. They do not catch *complexity inflation* or *wrong approach*. That judgment is still human.

## The frontier workflow

A useful split:

- **Human:** architecture, taste, boundaries, data model, interface design, deciding the right approach.
- **AI:** implementation, repetitive work, tests, bug fixing, refactors, review assistance.
- **Human / automation:** review, correctness checks, guardrails, deploy confidence.

A second useful split:

- **Codex / review agent:** correctness and implementation review.
- **Human:** approach and idea review.

## Review

"Review every line forever" is too slow. "Review nothing" is reckless. The middle path:

- Review architecture and approach, not necessarily every line.
- Use AI/code-review agents for correctness, edge cases, and race conditions.
- Manually inspect sensitive areas: security, data correctness, complex product logic.
- Keep PRs small enough that review remains possible.
- Treat complexity inflation as a review concern that humans own.

If AI lets you ship 10× more PRs but each PR carries the same bug rate, you also get 10× the bugs. Speed without QA is operational drag, not leverage. Pair throughput with smaller diffs, stronger tests, staged rollouts, observability, and tighter review loops.

## Guardrails encode taste

Guardrails should encode *your* engineering preferences and *your* recurring failure modes — not just generic linting. Concrete categories:

- Lint, format, typecheck on every commit.
- Security and static analysis (Semgrep, Bandit, etc.) where relevant.
- SQL linting where relevant.
- Custom checks for AI's recurring local mistakes (e.g., missing `await`, duplicated components, bypassed design system).
- Post-commit AI review that posts findings somewhere a human will see them.
- Scheduled review jobs that inspect codebase drift.

When you see the same AI mistake twice, the right move is usually a check, not a comment in the prompt.

## Narrow recurring agents beat huge vague projects

Agents work best when scoped narrowly:

- "Find drift between MCP, CLI, SDK, and docs" → fix.
- "Find dead code" → fix.
- "Find missing analytics events" → fix.
- "Find regression in metric X" → fix.

The pattern: **one agent finds the gap, one agent fixes it, multiple agents review.** Small, specific PRs are easier to trust and merge than giant agent-generated sweeps.

Parallel agents multiply good task decomposition; they do not replace it. Ten agents on ten well-scoped bugs is great. Ten agents coordinating a greenfield system is not.

## MVP-first matters more, not less

Once a real code surface exists, agents can latch onto it and parallelize improvements, bug fixes, polish, refactors. So:

**Ship a thin MVP fast → let agents fan out on refinements → keep humans focused on product, architecture, and taste.**

## Tech debt math has shifted, but not vanished

AI may produce less elegant code, but it can also help clean up. The equation: you can probably tolerate more debt than before — *if* you have disciplined systems to detect, track, and repay it. Without those systems, complexity builds until simplification becomes prohibitive.

## Better metrics than "lines shipped"

Volume of code is the wrong scoreboard. Better questions:

- Regression rate.
- Breaking-change frequency.
- Dependency count and creep.
- Latency, throughput, query time, cache hit rate.
- How many modules/files must change when one feature changes (coupling).
- Time from "bug filed" to "fix in production."

The best use of AI may be freeing engineers to focus on architecture, system boundaries, APIs, scalability, and reliability — not generating more code.

## AI-friendly architecture

The single most leverage-y architectural principle:

**Every important behavior should be testable from the terminal — CLI, HTTP API, scriptable harness.**

If the only way to verify a feature works is to click around in a UI, agents cannot drive it autonomously. Conversely, a system where every action has an automatable verification path turns into a place where agents can run safely with light supervision.

Adjacent practices:

- Plug-in registries over monolithic switch statements (so adding a new kind doesn't require touching unrelated code).
- A small named "spine" of long-lived primitives that everything else hangs off (so context for any new task is small).
- Discriminated-union types over strings (so impossible states fail at compile time).
- Idempotency keys on side-effecting routes (so retries are safe).
- Live-proof binaries alongside unit tests (so "does this actually work end-to-end?" has a one-command answer).

In this repo: the `runtime` spine, the `restore_plans` registry, the `bin/v*-...-smoke` live-proof binaries, and the `Idempotency-Key` discipline on `/queue/:id/actions/recommended` are all concrete instances.

## AI-assisted cherry-picking

When an agent produces a PR, you don't have to accept it whole or reject it whole. A useful pattern:

1. Coding agent writes a PR.
2. Review agent reviews it.
3. Another model splits the PR into smaller logical pieces.
4. Human decides which pieces to accept, reject, or modify.

The human stays in control of direction without doing line-by-line implementation.

## Long-running agents

Worth experimenting with multi-hour agent runs on big tasks (refactors, rewrites, large features) — but not as fire-and-forget. The point of the experiment is to learn what level of ambition can be safely delegated, and how the supervision shape changes when the task is hours instead of minutes.

## Tooling decays fast

The teams getting frontier results constantly try new models, review setups, agent pipelines. An AI engineering workflow that was state-of-the-art six months ago is probably mid today. Staying current is part of the job.

## A practical checklist

For any production team trying to level up:

1. Strict pre-commit checks: lint, format, typecheck, security, SQL, custom rules.
2. AI review on every commit/PR.
3. Keep PRs small and reviewable.
4. Review architecture and approach, not necessarily every line.
5. Encode repeated AI mistakes as scripts/hooks/checks.
6. Make important workflows testable through CLI/API.
7. Use narrow recurring agents for drift, dead code, doc mismatch, analytics gaps.
8. Use different models for implementation vs review.
9. Periodically let agents inspect logs, bug reports, and suspicious areas.
10. Track regressions, complexity, dependencies, maintainability — not just code output.

## eventloopOS-specific implications

This codebase is built for the user persona that already operates this way. So the bar is higher: our own development practices should embody what we want users to be able to do with eventloopOS.

- Every orchestrator route should have a unit test *and* a `bin/*-smoke` proof. The `v8`, `v9`, `v10`, `v11`, `v12`, `v13`, `v14`, `v15` binaries are the template.
- Every restore-plan kind goes through the registry, not a switch statement.
- Idempotency keys on side-effecting routes by default.
- New persistence concerns mirror the B3 / V12b pattern: gateway-store interface methods → in-memory + Postgres impls → conformance test → migration → route.
- TODO.md is the human-readable backlog. When a proof surfaces a real follow-up bug, file it as a `*b` item rather than swallowing it. Honest gaps beat fudged proofs.
- Live-proof binaries should skip cleanly when their hardware/tools are missing, with a clear message — not silently pass.
- When work hits the human/hardware ceiling (real Ghostty, real microphone, real desktop), say so explicitly. Don't pretend a substitute proof completes the literal verify item.

## What's actually wired

This file is the *belief system*. [`guardrails.md`](./guardrails.md) is the *current ledger* of which beliefs are encoded as tooling vs still aspirational. When you read a principle here and want to know whether the repo enforces it today, check that file first.

## The honest read

There is real leverage available. The "tiny team, hundreds of engineers worth of output" rhetoric is overstated; ~10× for strong engineers is closer to ground truth. The way to get there is not "stop reviewing code." It is **turning review, testing, cleanup, and codebase hygiene into increasingly automated systems** so humans spend less time reading diffs and more time steering the product.
