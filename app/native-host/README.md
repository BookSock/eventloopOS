# eventloopOS Native Host

Chrome Native Messaging host for the browser extension.

## What It Does

- Reads Chrome native messaging frames from stdin.
- Validates `eventloop.nativeBridgeEnvelope.v1`.
- Accepts `eventloop.contextCaptured`.
- Appends captured browser context to JSONL.
- Returns structured `{ ok, payload, error }` responses.

Default context log:

```sh
artifacts/native-host/context-captures.jsonl
```

Override:

```sh
EVENTLOOPOS_CONTEXT_LOG=/tmp/eventloop-context.jsonl eventloop-native-host
```

Optional orchestrator forwarding:

```sh
EVENTLOOPOS_ORCHESTRATOR_URL=http://127.0.0.1:4377 eventloop-native-host
```

When set, captured browser context is also sent to `POST /events` as a `browser.context_captured` event.

## Chrome Manifest

Generate a macOS Chrome native messaging host manifest:

```sh
pnpm --filter @eventloopos/native-host exec eventloop-print-chrome-host-manifest <chrome-extension-id>
```

Install it:

```sh
pnpm --filter @eventloopos/native-host exec eventloop-install-chrome-host <chrome-extension-id>
```

Install target:

```sh
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.eventloopos.browser_context.json
```

Dry run:

```sh
pnpm --filter @eventloopos/native-host exec eventloop-install-chrome-host <chrome-extension-id> --dry-run
```

## Test

```sh
pnpm --filter @eventloopos/native-host test
```
