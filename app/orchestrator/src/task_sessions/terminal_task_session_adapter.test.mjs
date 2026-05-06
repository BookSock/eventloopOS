import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGhosttyAppleScript,
  buildTerminalSendPlan,
  buildTmuxSendPlan,
  sendTaskMessageToTerminal,
} from "./terminal_task_session_adapter.mjs";

const fixedClock = () => new Date("2026-05-06T21:15:00.000Z");

test("builds tmux send plan as argv arrays without shell interpolation", () => {
  const plan = buildTmuxSendPlan({
    targetPane: "%7",
    text: "hello; rm -rf /",
    submit: true,
  });

  assert.deepEqual(plan, [
    {
      file: "tmux",
      args: ["send-keys", "-t", "%7", "-l", "hello; rm -rf /"],
    },
    {
      file: "tmux",
      args: ["send-keys", "-t", "%7", "Enter"],
    },
  ]);
});

test("builds Ghostty AppleScript with escaped text for visible terminal input", () => {
  const script = buildGhosttyAppleScript({
    text: "quote \" and slash \\ stay literal",
  });

  assert.equal(script, [
    "tell application \"Ghostty\"",
    "  input text \"quote \\\" and slash \\\\ stay literal\" to focused terminal of selected tab of front window",
    "end tell",
  ].join("\n"));
});

test("sends terminal task followup through injected execFile adapter", async () => {
  const calls = [];
  const message = await sendTaskMessageToTerminal({
    session: {
      id: "task_session_tmux_blog",
      terminal_ref: "tmux:%blog",
    },
    mode: "followup",
    text: "Launch moved up. Include 2 week timing.",
    event_ids: ["evt_voice_priority"],
    idempotency_key: "idem_voice_priority",
    submit: true,
  }, {
    clock: fixedClock,
    execFile: async (file, args) => {
      calls.push({ file, args });
    },
  });

  assert.equal(message.status, "sent");
  assert.equal(message.sent_at, "2026-05-06T21:15:00.000Z");
  assert.equal(message.transport.kind, "tmux");
  assert.equal(message.transport.submit, true);
  assert.equal(message.transport.command_count, 2);
  assert.deepEqual(message.event_ids, ["evt_voice_priority"]);
  assert.equal(message.evidence[0].title, "Terminal task message sent");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    file: "tmux",
    args: [
      "send-keys",
      "-t",
      "%blog",
      "-l",
      "[eventloopOS followup]\nEvents: evt_voice_priority\n\nLaunch moved up. Include 2 week timing.",
    ],
  });
});

test("blocks terminal send when session has no terminal ref", async () => {
  const message = await sendTaskMessageToTerminal({
    session: {
      id: "task_session_no_terminal",
    },
    text: "No terminal target.",
    idempotency_key: "idem_no_terminal",
  }, {
    clock: fixedClock,
    execFile: async () => {
      throw new Error("should not execute");
    },
  });

  assert.equal(message.status, "blocked");
  assert.equal(message.sent_at, undefined);
  assert.equal(message.evidence[0].title, "Terminal task message blocked");
});

test("builds Ghostty send plan for front focused terminal", () => {
  const plan = buildTerminalSendPlan({
    terminalRef: "ghostty:front",
    text: "Visible followup",
    submit: false,
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].file, "osascript");
  assert.match(plan[0].args[1], /tell application "Ghostty"/);
  assert.match(plan[0].args[1], /input text "Visible followup"/);
});
