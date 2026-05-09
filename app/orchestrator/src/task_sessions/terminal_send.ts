export type TerminalSendCommand = {
  file: string;
  args: string[];
};

export type TerminalSendExecutor = (command: TerminalSendCommand) => Promise<void>;

export type TerminalSendOptions = {
  terminalRef: string;
  text: string;
  submit?: boolean;
  enabled?: boolean;
  executor?: TerminalSendExecutor;
};

export type TerminalSendResult =
  | { ok: true; commandCount: number; transport: "ghostty" | "tmux" | "kitty" | "wezterm" | "unknown" }
  | { ok: false; reason: "disabled" | "no_terminal_ref" | "no_executor" | "build_failed" | "execute_failed"; error?: string };

export async function triggerTerminalKeystroke(options: TerminalSendOptions): Promise<TerminalSendResult> {
  if (options.enabled === false) {
    return { ok: false, reason: "disabled" };
  }
  if (!options.terminalRef) {
    return { ok: false, reason: "no_terminal_ref" };
  }
  if (!options.executor) {
    return { ok: false, reason: "no_executor" };
  }
  let plan: TerminalSendCommand[];
  try {
    plan = buildTerminalSendPlan({ terminalRef: options.terminalRef, text: options.text, submit: options.submit ?? false });
  } catch (caught) {
    return { ok: false, reason: "build_failed", error: caught instanceof Error ? caught.message : String(caught) };
  }
  for (const command of plan) {
    try {
      await options.executor(command);
    } catch (caught) {
      return { ok: false, reason: "execute_failed", error: caught instanceof Error ? caught.message : String(caught) };
    }
  }
  return {
    ok: true,
    commandCount: plan.length,
    transport: terminalTransport(options.terminalRef),
  };
}

export function terminalSendEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EVENTLOOPOS_TERMINAL_SEND;
  if (value === undefined) return true;
  return value !== "0" && value.toLowerCase() !== "false";
}

function buildTerminalSendPlan(input: { terminalRef: string; text: string; submit: boolean }): TerminalSendCommand[] {
  const lowered = input.terminalRef.toLowerCase();
  if (lowered.startsWith("tmux:")) {
    const targetPane = input.terminalRef.slice("tmux:".length);
    if (!targetPane) throw new Error("tmux terminalRef must include a target pane");
    const commands: TerminalSendCommand[] = [{ file: "tmux", args: ["send-keys", "-t", targetPane, "-l", input.text] }];
    if (input.submit) commands.push({ file: "tmux", args: ["send-keys", "-t", targetPane, "Enter"] });
    return commands;
  }
  if (lowered.startsWith("ghostty:")) {
    const target = input.terminalRef === "ghostty:front" ? "front" : input.terminalRef.slice("ghostty:".length);
    const scriptText = input.submit ? `${input.text}\n` : input.text;
    return [{ file: "osascript", args: ["-e", buildGhosttyAppleScript({ text: scriptText, target })] }];
  }
  throw new Error(`unsupported terminal_ref: ${input.terminalRef}`);
}

function buildGhosttyAppleScript(input: { text: string; target: string }): string {
  const terminalExpr = input.target === "front"
    ? "focused terminal of selected tab of front window"
    : `terminal id ${appleScriptString(input.target)}`;
  return [
    "tell application \"Ghostty\"",
    `  input text ${appleScriptString(input.text)} to ${terminalExpr}`,
    "end tell",
  ].join("\n");
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function terminalTransport(terminalRef: string): "ghostty" | "tmux" | "kitty" | "wezterm" | "unknown" {
  const lowered = terminalRef.toLowerCase();
  if (lowered.startsWith("ghostty:")) return "ghostty";
  if (lowered.startsWith("tmux:")) return "tmux";
  if (lowered.startsWith("kitty:")) return "kitty";
  if (lowered.startsWith("wezterm:")) return "wezterm";
  return "unknown";
}
