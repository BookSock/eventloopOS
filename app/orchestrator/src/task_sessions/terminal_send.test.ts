import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGhosttyAppleScript,
  parseGhosttyTarget,
  triggerTerminalKeystroke,
  terminalSendEnabledFromEnv,
  type TerminalSendCommand,
} from "./terminal_send.js";

describe("triggerTerminalKeystroke", () => {
  it("invokes executor with built ghostty plan when enabled", async () => {
    const calls: TerminalSendCommand[] = [];
    const result = await triggerTerminalKeystroke({
      terminalRef: "ghostty:front",
      text: "[eventloopOS followup] Continue work",
      submit: true,
      executor: async (command) => { calls.push(command); },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.transport, "ghostty");
    assert.ok(calls.length > 0);
    assert.equal(calls[0].file, "osascript");
    assert.match(calls[0].args.join(" "), /tell application "Ghostty"/);
  });

  it("uses tmux send-keys for tmux: terminal refs", async () => {
    const calls: TerminalSendCommand[] = [];
    const result = await triggerTerminalKeystroke({
      terminalRef: "tmux:%blog",
      text: "hello tmux",
      submit: true,
      executor: async (command) => { calls.push(command); },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.transport, "tmux");
    assert.ok(calls.some((command) => command.file === "tmux" && command.args[0] === "send-keys"));
  });

  it("returns disabled when enabled is false", async () => {
    const result = await triggerTerminalKeystroke({
      terminalRef: "ghostty:front",
      text: "hello",
      submit: false,
      enabled: false,
      executor: async () => {},
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "disabled");
  });

  it("returns no_executor when no executor provided", async () => {
    const result = await triggerTerminalKeystroke({
      terminalRef: "ghostty:front",
      text: "hello",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "no_executor");
  });

  it("returns build_failed for unsupported terminal_ref scheme", async () => {
    const result = await triggerTerminalKeystroke({
      terminalRef: "iterm:front",
      text: "hello",
      executor: async () => {},
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "build_failed");
  });

  it("builds AppleScript addressing window id for ghostty:win-<id> refs", async () => {
    const calls: TerminalSendCommand[] = [];
    const result = await triggerTerminalKeystroke({
      terminalRef: "ghostty:win-12345",
      text: "per-window followup",
      submit: false,
      executor: async (command) => { calls.push(command); },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.transport, "ghostty");
    assert.equal(calls.length, 1);
    const script = calls[0].args[1];
    assert.match(script, /first window whose id is "12345"/);
    assert.doesNotMatch(script, /focused terminal of selected tab of front window/);
  });

  it("respects EVENTLOOPOS_TERMINAL_SEND env kill switch", () => {
    assert.equal(terminalSendEnabledFromEnv({}), true);
    assert.equal(terminalSendEnabledFromEnv({ EVENTLOOPOS_TERMINAL_SEND: "0" }), false);
    assert.equal(terminalSendEnabledFromEnv({ EVENTLOOPOS_TERMINAL_SEND: "false" }), false);
    assert.equal(terminalSendEnabledFromEnv({ EVENTLOOPOS_TERMINAL_SEND: "1" }), true);
  });
});

describe("parseGhosttyTarget", () => {
  it("parses ghostty:front as the front-window kind", () => {
    assert.deepEqual(parseGhosttyTarget("ghostty:front"), { kind: "front" });
  });

  it("parses ghostty:win-<id> as a window-id kind preserving the id verbatim", () => {
    assert.deepEqual(parseGhosttyTarget("ghostty:win-501"), { kind: "window-id", id: "501" });
    assert.deepEqual(parseGhosttyTarget("ghostty:win-abc-123"), { kind: "window-id", id: "abc-123" });
  });

  it("parses other ghostty: suffixes as a terminal-id kind (legacy)", () => {
    assert.deepEqual(parseGhosttyTarget("ghostty:term-xyz"), { kind: "terminal-id", id: "term-xyz" });
  });

  it("throws when terminalRef does not start with ghostty:", () => {
    assert.throws(() => parseGhosttyTarget("tmux:%blog"), /must start with "ghostty:"/);
  });

  it("throws when win- is empty", () => {
    assert.throws(() => parseGhosttyTarget("ghostty:win-"), /missing id/);
  });
});

describe("buildGhosttyAppleScript", () => {
  it("ghostty:front produces the legacy front-window AppleScript byte-for-byte", () => {
    const script = buildGhosttyAppleScript({ text: "hello", terminalRef: "ghostty:front" });
    assert.equal(script, [
      'tell application "Ghostty"',
      '  input text "hello" to focused terminal of selected tab of front window',
      "end tell",
    ].join("\n"));
  });

  it("ghostty:win-<id> addresses the matching window by Ghostty window id", () => {
    const script = buildGhosttyAppleScript({ text: "per-window", terminalRef: "ghostty:win-12345" });
    assert.match(script, /first window whose id is "12345"/);
    assert.doesNotMatch(script, /front window/);
  });

  it("escapes the window id when it contains shell-hostile characters", () => {
    const script = buildGhosttyAppleScript({ text: "x", terminalRef: 'ghostty:win-evil"id\\here' });
    assert.match(script, /first window whose id is "evil\\"id\\\\here"/);
  });

  it("legacy target='front' still produces the front-window AppleScript", () => {
    const script = buildGhosttyAppleScript({ text: "hello", target: "front" });
    assert.equal(script, [
      'tell application "Ghostty"',
      '  input text "hello" to focused terminal of selected tab of front window',
      "end tell",
    ].join("\n"));
  });
});
