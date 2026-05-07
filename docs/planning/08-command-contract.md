# Command Contract

Goal: agents need stable commands. Commands are public API for development.

## Top-Level Commands

Use `make` as command facade. Underneath can call pnpm, xcodebuild, docker, playwright.

```bash
make install
make test
make test-unit
make test-contracts
make test-integration
make test-e2e
make test-e2e-browser
make test-e2e-native-browser
make test-e2e-native-browser-real-orchestrator
make test-e2e-macos
make test-e2e-live
make test-e2e-live-boot
make test-e2e-live-full
make test-db-native
make fixtures-seed
make packets-golden
make lint
make typecheck
make ci
```

## Meaning

### `make install`

Installs deps. Pulls browsers. Checks Xcode tools. Does not require secrets.

### `make test`

Runs unit + contract tests. Fast. Default command agents run often.

### `make test-unit`

Pure unit tests only. No Docker, no browser, no macOS UI.

### `make test-contracts`

Validates schemas, fixtures, golden contract shapes.

### `make test-integration`

Runs DB + adapter integration tests with fake services. No live external network.

### `make test-e2e`

Runs full deterministic scenario smoke.

### `make test-e2e-browser`

Runs Playwright extension tests with bundled Chromium.

### `make test-e2e-native-browser`

Runs installed Chromium native messaging smoke against a fixture server.

### `make test-e2e-native-browser-real-orchestrator`

Runs installed Chromium extension/native host capture against a real local orchestrator.

### `make test-e2e-macos`

Runs SwiftUI rendered queue window smoke.

### `make test-e2e-live-boot`

Builds and boots orchestrator, runs live harness, native-host smoke, browser E2E, and Mac client smoke.

### `make test-e2e-live-full`

Adds installed Chromium extension/native-host capture against the same booted orchestrator.

### `make test-db-native`

Runs real Postgres tests against a throwaway native local Postgres cluster.

### `make fixtures-seed`

Seeds local DB from deterministic fixtures.

### `make packets-golden`

Regenerates review packet outputs in compare mode by default.

Update mode must be explicit:

```bash
UPDATE_GOLDEN=1 make packets-golden
```

### `make ci`

Merge gate:

```text
lint
typecheck
test-unit
test-contracts
test-integration
packets-golden
test-e2e smoke
```

## Environment

Standard env:

```text
TEST_MODE=1
DATABASE_URL=postgres://eventloop:eventloop@localhost:5432/eventloop_test
EVENTLOOP_FIXED_TIME=2026-05-06T17:00:00Z
EVENTLOOP_ARTIFACT_DIR=artifacts
EVENTLOOP_NO_NETWORK=1
```

Rules:

- CI uses `EVENTLOOP_NO_NETWORK=1`.
- Live adapter tests require explicit `LIVE=1`.
- No command should use real Slack/GitHub/MCP providers by default.

## Artifacts

Write artifacts here:

```text
artifacts/logs/
artifacts/screenshots/
artifacts/traces/
artifacts/db/
artifacts/videos/
```

Every E2E failure should leave:

- command log.
- scenario log.
- screenshot if UI/browser involved.
- Playwright trace if browser involved.
- `.xcresult` if macOS involved.
- DB dump or queue snapshot if orchestrator involved.

## Exit Codes

- `0`: pass.
- `1`: test failure.
- `2`: environment/setup failure.
- `3`: contract/schema failure.
- `4`: external network attempted in test mode.

Agents use exit code + shortest error to pick next retry.
