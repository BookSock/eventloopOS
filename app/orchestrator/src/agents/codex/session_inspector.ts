import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type CodexSessionInspection = {
  thread_id: string;
  exists: boolean;
  rollout_path?: string;
  rollout_size_bytes?: number;
  last_event_at?: string;
  idle_seconds?: number;
  event_count?: number;
  recent_event_types?: string[];
  recent_summary?: string;
};

export type CodexSessionInspectorOptions = {
  codexHome?: string;
  now?: Date;
  recentEventTypeLimit?: number;
};

export async function inspectCodexSession(
  threadId: string,
  options: CodexSessionInspectorOptions = {},
): Promise<CodexSessionInspection> {
  const trimmed = threadId.trim();
  if (!trimmed) {
    return { thread_id: threadId, exists: false };
  }
  const codexHome = options.codexHome ?? join(homedir(), ".codex");
  const sessionsDir = join(codexHome, "sessions");
  const rolloutPath = await findRolloutPath(sessionsDir, trimmed).catch(() => undefined);
  if (!rolloutPath) {
    return { thread_id: trimmed, exists: false };
  }

  let stats;
  try {
    stats = await stat(rolloutPath);
  } catch {
    return { thread_id: trimmed, exists: false };
  }

  let raw: string;
  try {
    raw = await readFile(rolloutPath, "utf8");
  } catch {
    return {
      thread_id: trimmed,
      exists: true,
      rollout_path: rolloutPath,
      rollout_size_bytes: stats.size,
    };
  }
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const limit = options.recentEventTypeLimit ?? 5;
  const recent: string[] = [];
  let lastEventAt: string | undefined;
  let recentSummary: string | undefined;

  for (let i = lines.length - 1; i >= 0 && recent.length < limit; i -= 1) {
    const line = lines[i];
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed) continue;
    const type = typeof parsed.type === "string" ? parsed.type : undefined;
    if (type) recent.push(type);
    if (!lastEventAt && typeof parsed.timestamp === "string") {
      lastEventAt = parsed.timestamp;
    }
    if (!recentSummary) {
      recentSummary = summarizeLine(parsed);
    }
  }

  const now = options.now ?? new Date();
  const idleSeconds = lastEventAt ? Math.max(0, Math.round((now.getTime() - Date.parse(lastEventAt)) / 1000)) : undefined;

  return {
    thread_id: trimmed,
    exists: true,
    rollout_path: rolloutPath,
    rollout_size_bytes: stats.size,
    last_event_at: lastEventAt,
    idle_seconds: idleSeconds,
    event_count: lines.length,
    recent_event_types: recent,
    recent_summary: recentSummary,
  };
}

async function findRolloutPath(sessionsDir: string, threadId: string): Promise<string | undefined> {
  const yearDirs = await safeReaddir(sessionsDir);
  for (const year of yearDirs.sort().reverse()) {
    const monthDirs = await safeReaddir(join(sessionsDir, year));
    for (const month of monthDirs.sort().reverse()) {
      const dayDirs = await safeReaddir(join(sessionsDir, year, month));
      for (const day of dayDirs.sort().reverse()) {
        const dayPath = join(sessionsDir, year, month, day);
        const files = await safeReaddir(dayPath);
        const match = files.find((file) => file.endsWith(`-${threadId}.jsonl`));
        if (match) return join(dayPath, match);
      }
    }
  }
  return undefined;
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

function summarizeLine(parsed: Record<string, unknown>): string | undefined {
  const type = typeof parsed.type === "string" ? parsed.type : undefined;
  const payload = parsed.payload as Record<string, unknown> | undefined;
  if (!type) return undefined;
  if (type === "event_msg" && payload && typeof payload.type === "string") {
    const text = typeof payload.message === "string"
      ? payload.message
      : typeof payload.text === "string"
        ? payload.text
        : undefined;
    if (text) return `event_msg/${payload.type}: ${text.slice(0, 80)}`;
    return `event_msg/${payload.type}`;
  }
  if (type === "session_meta") {
    return "session_meta";
  }
  if (type === "user_input" && payload && typeof payload.text === "string") {
    return `user_input: ${payload.text.slice(0, 80)}`;
  }
  return type;
}
