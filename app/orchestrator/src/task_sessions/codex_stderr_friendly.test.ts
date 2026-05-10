import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { translateCodexStderr } from "./codex_stderr_friendly.js";

describe("translateCodexStderr", () => {
  it("translates rmcp TokenRefreshFailed into actionable codex-bridge line", () => {
    const raw =
      'worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed("invalid_grant: Invalid refresh token"))';
    const friendly = translateCodexStderr(raw);
    assert.ok(friendly, "expected a friendly message");
    assert.equal(friendly?.level, "warn");
    assert.match(friendly!.message, /\[codex-bridge\]/);
    assert.match(friendly!.message, /codex login/);
    assert.match(friendly!.message, /keystroke \+ queue paths still work/);
  });

  it("translates bare 'Transport channel closed' to a softer bridge warning", () => {
    const friendly = translateCodexStderr("worker quit with fatal: Transport channel closed");
    assert.ok(friendly);
    assert.equal(friendly?.level, "warn");
    assert.match(friendly!.message, /\[codex-bridge\]/);
    assert.match(friendly!.message, /transport closed/);
  });

  it("returns undefined for unknown stderr (lets it pass through verbatim)", () => {
    assert.equal(translateCodexStderr("debug: starting up"), undefined);
    assert.equal(translateCodexStderr(""), undefined);
    assert.equal(translateCodexStderr("   "), undefined);
  });
});
