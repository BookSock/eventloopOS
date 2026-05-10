// Codex app-server (Rust) shells out via rmcp; on auth refresh failure it
// emits a fatal-looking line that's confusing in dogfood. Translate the known
// failure modes into a one-line actionable message before logging.

export type FriendlyCodexStderr = {
  level: "warn" | "info";
  message: string;
};

const REFRESH_FAILED_PATTERN = /TokenRefreshFailed|invalid_grant|Invalid refresh token/i;
const TRANSPORT_CLOSED_PATTERN = /Transport channel closed/i;

export function translateCodexStderr(chunk: string): FriendlyCodexStderr | undefined {
  const trimmed = chunk.trim();
  if (!trimmed) return undefined;
  if (REFRESH_FAILED_PATTERN.test(trimmed)) {
    return {
      level: "warn",
      message:
        "[codex-bridge] Codex OAuth refresh token expired. Run 'codex login' to refresh. The orchestrator will continue without the WebSocket bridge — keystroke + queue paths still work.",
    };
  }
  if (TRANSPORT_CLOSED_PATTERN.test(trimmed)) {
    return {
      level: "warn",
      message:
        "[codex-bridge] Codex app-server transport closed unexpectedly. Run 'codex login' if this repeats. Keystroke + queue paths continue to work.",
    };
  }
  return undefined;
}
