import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveGhosttyWindowId, type RunOsascript } from "./ghostty_window_resolver.js";

export type ForegroundResolution = {
  codex_thread_id: string | null;
  ghostty_window_id: string | null;
  source: "title_resolver" | "codex_session" | "none";
};

export type ForegroundResolverOptions = {
  runOsascript: RunOsascript;
  codexHome?: string;
  now?: () => number;
  cacheTtlMs?: number;
  listRolloutFiles?: ListRolloutFiles;
};

export type RolloutFileEntry = { path: string; threadId: string; mtimeMs: number };
export type ListRolloutFiles = (codexHome: string) => Promise<RolloutFileEntry[]>;

const DEFAULT_CACHE_TTL_MS = 1_000;
const TASK_TAG_PATTERN = /\[task:([^\]]+)\]/i;
const ROLLOUT_FILE_PATTERN = /^rollout-.+-([0-9a-fA-F-]{36})\.jsonl$/;

type CacheEntry = { resolvedAt: number; result: ForegroundResolution };

let cache: CacheEntry | null = null;

export function _clearForegroundResolverCache(): void {
  cache = null;
}

export async function resolveForegroundCodex(options: ForegroundResolverOptions): Promise<ForegroundResolution> {
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (cache && now() - cache.resolvedAt < ttl) {
    return cache.result;
  }

  const front = await readGhosttyFrontWindow(options.runOsascript);
  if (!front) {
    const result: ForegroundResolution = { codex_thread_id: null, ghostty_window_id: null, source: "none" };
    cache = { resolvedAt: now(), result };
    return result;
  }

  const tagMatch = front.title.match(TASK_TAG_PATTERN);
  if (tagMatch) {
    const slug = tagMatch[1].trim();
    const resolution = await resolveGhosttyWindowId({
      taskSlug: slug,
      runOsascript: options.runOsascript,
      now: options.now,
    });
    const ghosttyWindowId = resolution.ghosttyTextId ?? front.id ?? null;
    const result: ForegroundResolution = {
      codex_thread_id: null,
      ghostty_window_id: ghosttyWindowId,
      source: "title_resolver",
    };
    cache = { resolvedAt: now(), result };
    return result;
  }

  const codexHome = options.codexHome ?? join(homedir(), ".codex");
  const lister = options.listRolloutFiles ?? defaultListRolloutFiles;
  const rollouts = await lister(codexHome).catch(() => [] as RolloutFileEntry[]);
  if (rollouts.length === 0) {
    const result: ForegroundResolution = {
      codex_thread_id: null,
      ghostty_window_id: front.id ?? null,
      source: front.id ? "title_resolver" : "none",
    };
    cache = { resolvedAt: now(), result };
    return result;
  }
  rollouts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = rollouts[0];
  const result: ForegroundResolution = {
    codex_thread_id: newest.threadId,
    ghostty_window_id: front.id ?? null,
    source: "codex_session",
  };
  cache = { resolvedAt: now(), result };
  return result;
}

type GhosttyFrontWindow = { id: string | null; title: string };

async function readGhosttyFrontWindow(runOsascript: RunOsascript): Promise<GhosttyFrontWindow | null> {
  // Bail if Ghostty isn't frontmost; anchor selection is meaningful only when
  // the user is actively in a Ghostty window.
  const frontAppScript = `tell application "System Events" to get name of first application process whose frontmost is true`;
  let frontApp = "";
  try {
    const { stdout } = await runOsascript(["-e", frontAppScript]);
    frontApp = (stdout ?? "").trim();
  } catch {
    return null;
  }
  if (!frontApp.toLowerCase().includes("ghostty")) {
    return null;
  }

  // Ghostty's AppleScript dictionary exposes id (text) and name (title) for the
  // frontmost window. Single line of output: "<id>\t<title>".
  const winScript = [
    "tell application \"Ghostty\"",
    "  if (count of windows) is 0 then return \"\"",
    "  set w to front window",
    "  return (id of w as text) & \"\\t\" & (name of w as text)",
    "end tell",
  ].join("\n");

  let stdout = "";
  try {
    const result = await runOsascript(["-e", winScript]);
    stdout = (result.stdout ?? "").replace(/\r?\n$/, "");
  } catch {
    return null;
  }
  if (!stdout) return null;
  const tabIndex = stdout.indexOf("\t");
  if (tabIndex === -1) {
    return { id: stdout || null, title: "" };
  }
  return {
    id: stdout.slice(0, tabIndex) || null,
    title: stdout.slice(tabIndex + 1),
  };
}

export const defaultListRolloutFiles: ListRolloutFiles = async (codexHome) => {
  const sessionsDir = join(codexHome, "sessions");
  const yearDirs = await safeReaddir(sessionsDir);
  const entries: RolloutFileEntry[] = [];
  for (const year of yearDirs) {
    const monthDirs = await safeReaddir(join(sessionsDir, year));
    for (const month of monthDirs) {
      const dayDirs = await safeReaddir(join(sessionsDir, year, month));
      for (const day of dayDirs) {
        const dayPath = join(sessionsDir, year, month, day);
        const files = await safeReaddir(dayPath);
        for (const file of files) {
          const match = file.match(ROLLOUT_FILE_PATTERN);
          if (!match) continue;
          const path = join(dayPath, file);
          try {
            const stats = await stat(path);
            entries.push({ path, threadId: match[1], mtimeMs: stats.mtimeMs });
          } catch {
            // file vanished mid-listing; skip.
          }
        }
      }
    }
  }
  return entries;
};

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}
