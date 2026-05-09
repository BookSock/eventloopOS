import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { triggerTerminalKeystroke, terminalSendEnabledFromEnv, type TerminalSendCommand } from "./terminal_send.js";

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

  it("respects EVENTLOOPOS_TERMINAL_SEND env kill switch", () => {
    assert.equal(terminalSendEnabledFromEnv({}), true);
    assert.equal(terminalSendEnabledFromEnv({ EVENTLOOPOS_TERMINAL_SEND: "0" }), false);
    assert.equal(terminalSendEnabledFromEnv({ EVENTLOOPOS_TERMINAL_SEND: "false" }), false);
    assert.equal(terminalSendEnabledFromEnv({ EVENTLOOPOS_TERMINAL_SEND: "1" }), true);
  });
});
