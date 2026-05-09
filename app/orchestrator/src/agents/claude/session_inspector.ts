import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ClaudeSessionInspection = {
  session_id: string;
  exists: boolean;
  rollout_path?: string;
  rollout_size_bytes?: number;
  last_event_at?: string;
  idle_seconds?: number;
  event_count?: number;
  recent_event_types?: string[];
  recent_summary?: string;
  cwd_hint?: string;
};

export type ClaudeSessionInspectorOptions = {
  claudeHome?: string;
  now?: Date;
  recentEventTypeLimit?: number;
};

export async function inspectClaudeSession(
  sessionId: string,
  options: ClaudeSessionInspectorOptions = {},
): Promise<ClaudeSessionInspection> {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return { session_id: sessionId, exists: false };
  }
  const claudeHome = options.claudeHome ?? join(homedir(), ".claude");
  const projectsDir = join(claudeHome, "projects");
  const found = await findRolloutPath(projectsDir, trimmed).catch(() => undefined);
  if (!found) {
    return { session_id: trimmed, exists: false };
  }

  let stats;
  try {
    stats = await stat(found.path);
  } catch {
    return { session_id: trimmed, exists: false };
  }

  let raw: string;
  try {
    raw = await readFile(found.path, "utf8");
  } catch {
    return {
      session_id: trimmed,
      exists: true,
      rollout_path: found.path,
      rollout_size_bytes: stats.size,
      cwd_hint: found.cwdHint,
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
    session_id: trimmed,
    exists: true,
    rollout_path: found.path,
    rollout_size_bytes: stats.size,
    last_event_at: lastEventAt,
    idle_seconds: idleSeconds,
    event_count: lines.length,
    recent_event_types: recent,
    recent_summary: recentSummary,
    cwd_hint: found.cwdHint,
  };
}

async function findRolloutPath(projectsDir: string, sessionId: string): Promise<{ path: string; cwdHint?: string } | undefined> {
  const projectDirs = await safeReaddir(projectsDir);
  for (const dir of projectDirs) {
    const dayPath = join(projectsDir, dir);
    const files = await safeReaddir(dayPath);
    const match = files.find((file) => file === `${sessionId}.jsonl`);
    if (match) {
      return { path: join(dayPath, match), cwdHint: decodeProjectDir(dir) };
    }
  }
  return undefined;
}

function decodeProjectDir(name: string): string | undefined {
  if (!name) return undefined;
  // Claude encodes / and . in the project cwd as dashes; decoding is lossy.
  // Return the encoded form as a hint.
  return name.replace(/^-/, "/").replaceAll("--", "/");
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
  if (!type) return undefined;
  if (type === "user") {
    const message = parsed.message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") return `user: ${content.slice(0, 80)}`;
    }
    return "user";
  }
  if (type === "assistant") {
    const message = parsed.message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (Array.isArray(content) && content.length > 0) {
        const first = content[0] as Record<string, unknown>;
        if (typeof first.text === "string") return `assistant: ${first.text.slice(0, 80)}`;
      }
    }
    return "assistant";
  }
  return type;
}
