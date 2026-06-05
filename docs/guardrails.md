# Guardrails: wired vs aspirational

Companion to [`ai-engineering-principles.md`](./ai-engineering-principles.md). That doc says guardrails should encode taste; this doc says **what is actually in the build today** versus what is still a sticky note. Keep them honest with each other — when something here moves from aspirational to wired, update both files.

## Wired today

### Pre-commit (lefthook)

Configured in [`lefthook.yml`](../lefthook.yml). Installed by `pnpm install` via the root `prepare` script, which runs `lefthook install` and writes the hook stubs into `.git/hooks/`.

Pre-commit runs (in parallel, scoped to staged files where possible):

- `pnpm lint` — runs each package's `lint` script via `pnpm -r --if-present lint`. Triggers only when staged files include source extensions.
- `pnpm typecheck` — runs the workspace typecheck (`tsc --noEmit` per TS package + `node --check` for shell-shaped JS bins). Triggers only when staged files include `.ts` / `.tsx`.
- `gitleaks protect --staged` — fails if a secret pattern is found in the staged diff. Allow-list lives in [`.gitleaks.toml`](../.gitleaks.toml) (currently the audited Chrome extension public key).
- `scripts/guard-file-size.mjs` — rejects any new file > 1 MB unless it's an image/asset under `external-resources/` or `artifacts/`. Catches accidental binary commits.
- `scripts/guard-newline-eof.mjs` — rejects source files without a trailing LF. Matches [`.gitattributes`](../.gitattributes) line-ending discipline.

Commit-msg also runs `gitleaks protect --staged` as a belt-and-suspenders pass.

**Honest timing note.** `pnpm typecheck` is the slowest hook — the orchestrator full `tsc -p` typecheck plus the per-package typechecks together can take 5–15s on a cold Node cache. Pre-commit hooks are *supposed* to stay under 5s; this one doesn't, and we're keeping it because catching a typecheck failure pre-push is worth more than a couple extra seconds at commit time. If the timing becomes painful, candidates to drop:
1. Move typecheck to `pre-push` instead of `pre-commit`.
2. Replace with a fast `tsc --noEmit --incremental` scoped to changed packages.

Run hooks manually with `pnpm hooks:run`.

If commits print `Can't find lefthook in PATH`, the local install is stale or
was created with scripts disabled. Repair with `pnpm hooks:repair`; it refreshes
the frozen install with scripts enabled, reinstalls Lefthook's git hooks, and
runs the pre-commit hook once so the failure is visible immediately.

### CI

GitHub Actions in `.github/workflows/`:

- [`ci.yml`](../.github/workflows/ci.yml) — runs `pnpm run ci` through [`bin/ci-linux`](../bin/ci-linux) on Ubuntu. This is the Linux-safe lane: contracts, lint, cataloged primitive self-tests, shared-SDK package audit, package typechecks, package tests, and non-macOS e2e smoke. It skips browser-download/live-mac work with `EVENTLOOPOS_SKIP_BROWSER_E2E=1`, ignores docs/artifacts-only pushes and PRs, cancels stale runs on newer pushes, uses read-only repo permissions, and has a 20-minute timeout.
- [`macos-app.yml`](../.github/workflows/macos-app.yml) — runs `swift test --package-path app/macos` on GitHub's macOS runner. It triggers only when the macOS package or this workflow changes, can be launched manually, cancels stale runs, uses read-only repo permissions, and has a 20-minute timeout.
- [`secret-scan.yml`](../.github/workflows/secret-scan.yml) — runs `gitleaks/gitleaks-action@v2` on every push to `main` and on every PR. Uses [`.gitleaks.toml`](../.gitleaks.toml) for allow-listing. It cancels stale scans on newer pushes, uses read-only repo permissions, and has a 10-minute timeout. History scan on initial install came back clean (no leaks across 250 commits).
- [`ai-review-template.yml`](../.github/workflows/ai-review-template.yml) — **opt-in** PR commenter. Triggers only when a PR is labeled `needs-ai-review`. Posts or updates one templated review checklist that reflects the categories in `ai-engineering-principles.md` (architecture, complexity inflation, reuse, security, etc.). It is *not* a paid AI pass; it is a structured reminder so reviewers approach the diff with the right lens.

Cost/noise notes:

- The repo is public (`BookSock/eventloopOS`). Public repositories using standard GitHub-hosted runners are not billed for GitHub Actions minutes; see GitHub's billing docs: <https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions>.
- Normal CI is Ubuntu-only and skips live browser/download/macOS dogfood work with `EVENTLOOPOS_SKIP_BROWSER_E2E=1`.
- macOS CI is path-scoped to `app/macos/**` and manual runs, so ordinary orchestrator/shared/docs commits do not launch a macOS runner.
- CI and secret-scan both cancel stale in-progress runs for the same branch/ref. If several commits are pushed quickly, only the newest run should finish and email.
- Secret scan intentionally stays broad. Docs, notes, and fixtures are common places for pasted tokens, so docs-only pushes still get gitleaks coverage.
- [`bin/ci-workflows-audit`](../bin/ci-workflows-audit) is part of `pnpm typecheck` and fails if these CI cost/noise controls drift.

### Repo hygiene

- `.gitattributes` enforces LF endings + binary-file marking; `guard-newline-eof.mjs` enforces it at commit time.
- `.gitignore` excludes `artifacts/`, `dist/`, local config — and `guard-file-size.mjs` catches accidental large-file commits anyway.
- Status badges in [`README.md`](../README.md) for CI + secret-scan workflows.

### SQL Migrations

- [`bin/sql-migrations-audit`](../bin/sql-migrations-audit) checks Postgres
  migration filename order, semicolon termination, transaction-wrapper absence,
  banned destructive statements, and safe `DROP CONSTRAINT IF EXISTS` usage.
- It also enforces forward-looking idempotency for new migrations (`0022+`):
  `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and
  `ADD COLUMN IF NOT EXISTS`.
- `pnpm typecheck` runs the audit self-test and audits
  [`app/orchestrator/migrations`](../app/orchestrator/migrations), so persistence
  guardrails stay green in local hooks and CI.

### Bug-To-Fix Latency

- [`bin/bug-fix-latency-audit`](../bin/bug-fix-latency-audit) measures how long
  GitHub Actions bug signals stay red before the next green run for the same
  workflow on `main`.
- It ignores intentionally cancelled stale runs from workflow concurrency,
  records open incidents separately, and reports p50/p95/max fix latency hours.
- `pnpm typecheck` runs the audit self-test with fixture data so the metric logic
  cannot silently drift. Live measurement is explicit:
  `bin/bug-fix-latency-audit --json --manifest artifacts/bug-fix-latency/latest.json`.

## Still aspirational

These are mentioned in `ai-engineering-principles.md` but not yet wired:

- **Semgrep / Bandit static analysis.** No security-static-analysis pass beyond gitleaks (secrets only).
- **Custom AI-mistake checks.** The principles doc calls out things like "missing `await`", "duplicated components", "bypassed design system" as candidates for codified checks. None of those are codified yet — they live as review intuition.
- **Real AI-review pass.** Today's `ai-review-template.yml` is a templated comment. A real model-driven review (Codex / Claude) would need an API key + opt-in flow + cost guardrails — explicitly deferred per principles doc ("Don't add a paid Codex API integration without the user opting in").
- **Scheduled drift agents.** "Find drift between MCP, CLI, SDK, and docs" → fix. Pattern called out in the principles doc; no scheduled job yet.

When you wire something on this list, move its bullet to **Wired today** and update `ai-engineering-principles.md` if the example changes.

## Bypass policy

Hooks can be bypassed with `git commit --no-verify`. Use only when a hook is itself broken; **never** to push past a gitleaks finding without first auditing the secret.
