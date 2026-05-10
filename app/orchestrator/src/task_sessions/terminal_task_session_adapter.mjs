import { isoNow, makeEvidenceRef } from "../agents/local_contracts.mjs";

export function buildTaskMessageText({ mode = "followup", text, event_ids = [] }) {
  const lines = [
    `[eventloopOS ${mode}]`,
    event_ids.length > 0 ? `Events: ${event_ids.join(", ")}` : "Events: none",
    "",
    text,
  ];
  return lines.join("\n");
}

export function buildTmuxSendPlan({ targetPane, text, submit = false }) {
  if (!targetPane) {
    throw new Error("targetPane is required");
  }
  const commands = [
    {
      file: "tmux",
      args: ["send-keys", "-t", targetPane, "-l", text],
    },
  ];
  if (submit) {
    commands.push({
      file: "tmux",
      args: ["send-keys", "-t", targetPane, "Enter"],
    });
  }
  return commands;
}

export function buildGhosttyAppleScript({ text, target = "front", targetApp = "Ghostty" }) {
  const terminalExpr = target === "front"
    ? "focused terminal of selected tab of front window"
    : `terminal id ${appleScriptString(target)}`;

  return [
    `tell application ${appleScriptString(targetApp)}`,
    `  input text ${appleScriptString(text)} to ${terminalExpr}`,
    "end tell",
  ].join("\n");
}

export { appleScriptString };

export function buildGhosttySendPlan({ text, target = "front", submit = false }) {
  const scriptText = submit ? `${text}\n` : text;
  return [
    {
      file: "osascript",
      args: ["-e", buildGhosttyAppleScript({ text: scriptText, target })],
    },
  ];
}

export async function sendTaskMessageToTerminal({
  session,
  mode = "followup",
  text,
  event_ids = [],
  idempotency_key,
  submit = false,
}, {
  execFile,
  clock = () => new Date(),
} = {}) {
  if (typeof execFile !== "function") {
    throw new Error("execFile adapter is required");
  }

  const now = isoNow(clock);
  const messageText = buildTaskMessageText({ mode, text, event_ids });
  const terminalRef = session?.terminal_ref;
  if (!session || !terminalRef) {
    return buildBlockedMessage({
      sessionId: session?.id ?? "missing",
      mode,
      text,
      event_ids,
      idempotency_key,
      now,
      reason: "missing_terminal_ref",
    });
  }

  const plan = buildTerminalSendPlan({ terminalRef, text: messageText, submit });
  for (const command of plan) {
    await execFile(command.file, command.args);
  }

  return {
    id: `task_msg_${stableId(idempotency_key ?? `${session.id}:${mode}:${now}`)}`,
    task_session_id: session.id,
    mode,
    text,
    event_ids,
    idempotency_key: idempotency_key ?? `terminal:${session.id}:${mode}:${stableId(text)}`,
    sent_at: now,
    status: "sent",
    evidence: [
      makeEvidenceRef({
        id: `ev_terminal_send_${stableId(session.id)}`,
        title: "Terminal task message sent",
        ref: terminalRef,
        captured_at: now,
      }),
    ],
    transport: {
      kind: terminalRef.startsWith("tmux:") ? "tmux" : "ghostty",
      submit,
      command_count: plan.length,
    },
  };
}

export function buildTerminalSendPlan({ terminalRef, text, submit = false }) {
  if (terminalRef.startsWith("tmux:")) {
    return buildTmuxSendPlan({
      targetPane: terminalRef.slice("tmux:".length),
      text,
      submit,
    });
  }

  if (terminalRef === "ghostty:front" || terminalRef.startsWith("ghostty:")) {
    const target = terminalRef === "ghostty:front" ? "front" : terminalRef.slice("ghostty:".length);
    return buildGhosttySendPlan({ text, target, submit });
  }

  throw new Error(`unsupported terminal_ref: ${terminalRef}`);
}

function buildBlockedMessage({ sessionId, mode, text, event_ids, idempotency_key, now, reason }) {
  return {
    id: `task_msg_blocked_${stableId(idempotency_key ?? sessionId)}`,
    task_session_id: sessionId,
    mode,
    text,
    event_ids,
    idempotency_key: idempotency_key ?? `blocked:${sessionId}:${mode}:${stableId(text)}`,
    status: "blocked",
    evidence: [
      makeEvidenceRef({
        id: `ev_terminal_blocked_${stableId(sessionId)}`,
        title: "Terminal task message blocked",
        ref: reason,
        captured_at: now,
      }),
    ],
  };
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function stableId(input) {
  return String(input).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
