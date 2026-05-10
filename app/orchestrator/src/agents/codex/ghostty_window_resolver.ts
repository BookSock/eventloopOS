// Bridge AeroSpace numeric window-id ↔ Ghostty AppleScript text window-id.
//
// AeroSpace's `window-id` and Ghostty's AppleScript `id` (per Ghostty.sdef:
// `<property name="id" type="text">`) live in disjoint namespaces. Auto-bind
// surfaces a [task:<slug>] window via AeroSpace, but the keystroke dispatcher
// (`first window whose id is "<n>"`) compares against Ghostty's text id. So
// the AeroSpace numeric id silently no-ops in the AppleScript filter.
//
// This resolver enumerates Ghostty windows directly and matches by title
// substring `[task:<slug>]`, returning the Ghostty text id that the
// dispatcher's filter understands. Per-slug results are cached for ~30s
// because auto-bind ticks every 30s and Ghostty enumeration shells out.

export type RunOsascript = (args: string[]) => Promise<{ stdout: string; stderr?: string }>;

export type ResolveGhosttyWindowOptions = {
  taskSlug: string;
  runOsascript: RunOsascript;
  now?: () => number;
  cacheTtlMs?: number;
};

export type GhosttyWindowResolution = {
  ghosttyTextId: string | null;
  matched: number;
  ambiguous: boolean;
  cached: boolean;
};

const DEFAULT_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  resolvedAt: number;
  result: Omit<GhosttyWindowResolution, "cached">;
};

const cache = new Map<string, CacheEntry>();

export function _clearGhosttyResolverCache(): void {
  cache.clear();
}

export async function resolveGhosttyWindowId(options: ResolveGhosttyWindowOptions): Promise<GhosttyWindowResolution> {
  const slug = options.taskSlug.trim();
  if (!slug) return { ghosttyTextId: null, matched: 0, ambiguous: false, cached: false };

  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheKey = slug;
  const cached = cache.get(cacheKey);
  if (cached && now() - cached.resolvedAt < ttl) {
    return { ...cached.result, cached: true };
  }

  // The slug arriving here is the human-readable substring of `[task:<slug>]`
  // — same shape that auto_bind matches against AeroSpace window titles. We
  // refuse anything that could break out of the AppleScript string literal
  // (`"`) or the surrounding tell-block; AppleScript escapes \\ and \".
  const escaped = appleScriptStringLiteral(`[task:${slug}]`);
  const script = `tell application "Ghostty" to get id of (every window whose name contains ${escaped})`;

  let stdout = "";
  try {
    const result = await options.runOsascript(["-e", script]);
    stdout = result.stdout ?? "";
  } catch {
    // Ghostty not running, AppleScript permission denied, or any other
    // osascript failure — caller's contract is "null means no match".
    const resolution: Omit<GhosttyWindowResolution, "cached"> = {
      ghosttyTextId: null,
      matched: 0,
      ambiguous: false,
    };
    cache.set(cacheKey, { resolvedAt: now(), result: resolution });
    return { ...resolution, cached: false };
  }

  const ids = parseAppleScriptIdList(stdout);
  let resolution: Omit<GhosttyWindowResolution, "cached">;
  if (ids.length === 0) {
    resolution = { ghosttyTextId: null, matched: 0, ambiguous: false };
  } else if (ids.length === 1) {
    resolution = { ghosttyTextId: ids[0], matched: 1, ambiguous: false };
  } else {
    resolution = { ghosttyTextId: ids[0], matched: ids.length, ambiguous: true };
  }
  cache.set(cacheKey, { resolvedAt: now(), result: resolution });
  return { ...resolution, cached: false };
}

// AppleScript renders a list as `a, b, c` on a single line; a single value
// renders as the bare value. Either way, splitting on `, ` and trimming
// gives us the raw ids.
export function parseAppleScriptIdList(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/,\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function appleScriptStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}
