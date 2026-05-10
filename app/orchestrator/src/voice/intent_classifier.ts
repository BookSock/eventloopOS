import type { QueueItemWithPacket } from "../contracts.js";

export type VoiceIntent =
  | { kind: "note"; transcript: string }
  | {
    kind: "rerank";
    transcript: string;
    direction: "up" | "down" | "top";
    delta?: number;
    score?: number;
    target: string;
  }
  | {
    kind: "fan_out";
    transcript: string;
    selector: string;
    message: string;
  }
  | {
    kind: "defer";
    transcript: string;
    selector: string;
    defer_seconds: number;
  }
  | {
    kind: "pause";
    transcript: string;
    selector?: string;
    defer_seconds: number;
  }
  | {
    kind: "define_trigger";
    transcript: string;
    event_type: string;
    body_substring: string;
    target: "current_task";
  }
  | {
    kind: "stop_sharing";
    transcript: string;
    target_app_or_title: string;
  }
  | {
    kind: "wake_task";
    transcript: string;
    target: string;
  };

const RAISE_TOKENS = ["raise", "bump", "boost", "increase", "higher", "promote"];
const LOWER_TOKENS = ["lower", "deprioritize", "decrease", "demote", "less"];
const TOP_TOKENS = ["top", "first", "front", "head"];

export function classifyVoiceIntent(transcript: string): VoiceIntent {
  const cleaned = transcript.trim();
  if (!cleaned) {
    return { kind: "note", transcript: cleaned };
  }
  const lowered = cleaned.toLowerCase();

  const trigger = detectDefineTrigger(cleaned, lowered);
  if (trigger) return trigger;

  const stopSharing = detectStopSharing(cleaned, lowered);
  if (stopSharing) return stopSharing;

  const wakeTask = detectWakeTask(cleaned, lowered);
  if (wakeTask) return wakeTask;

  const pause = detectPause(cleaned, lowered);
  if (pause) return pause;

  const defer = detectDefer(cleaned, lowered);
  if (defer) return defer;

  const fanOut = detectFanOut(cleaned, lowered);
  if (fanOut) return fanOut;

  if (!hasPriorityTrigger(lowered)) {
    return { kind: "note", transcript: cleaned };
  }

  const direction = detectDirection(lowered);
  const target = extractTarget(lowered);
  if (!target) {
    return { kind: "note", transcript: cleaned };
  }

  if (direction === "top") {
    return {
      kind: "rerank",
      transcript: cleaned,
      direction,
      score: 1_000,
      target,
    };
  }

  return {
    kind: "rerank",
    transcript: cleaned,
    direction,
    delta: direction === "up" ? 250 : -250,
    target,
  };
}

const FAN_OUT_QUANTIFIERS = /\b(all|every|each|any)\b/;
const FAN_OUT_PATTERNS = [
  /\b(?:all|every|each|any)\s+(?:of\s+)?(?:the\s+)?(.+?)\s+(?:tasks?|papers?|threads?|agents?)\b\s*(?:should|need to|must|please|to)?\s*[:,]?\s*(.+)/i,
  /\b(?:tell|let|inform|broadcast(?: to)?)\s+(?:all|every|each|any)\s+(?:of\s+)?(?:the\s+)?(.+?)\s+(?:tasks?|papers?|threads?|agents?)\s+(?:to|that)\s+(.+)/i,
];

// Recognizes "if I get a slack message about X, paper this task"
// (and variants: "when I receive a slack message about X, paper that task").
const DEFINE_TRIGGER_PATTERN =
  /^(?:if|when|whenever)\s+(?:i|we)\s+(?:get|receive|see)\s+(?:a|an|the)?\s*(slack|gmail|email|github|browser)\s+(?:message|email|notification|event)\s+about\s+(.+?)\s*[,;]?\s*paper\s+(?:this|that|the\s+current)\s+task[.!?]?\s*$/i;

const DEFINE_TRIGGER_EVENT_TYPES: Record<string, string> = {
  slack: "slack.message",
  gmail: "gmail.message",
  email: "gmail.message",
  github: "github.notification",
  browser: "browser.review_requested",
};

const STOP_SHARING_PATTERNS = [
  /^(?:please\s+)?(?:stop\s+sharing|stop\s+following|unshare|unsync|detach)\s+(.+?)[.!?]?\s*$/i,
  /^(?:please\s+)?keep\s+(.+?)\s+(?:on|in)\s+(?:this|the current)\s+(?:desktop|workspace|space)[.!?]?\s*$/i,
];

function detectStopSharing(original: string, lowered: string): VoiceIntent | undefined {
  if (!/(stop\s+(?:sharing|following)|unshare|unsync|detach|keep\b)/i.test(lowered)) return undefined;
  for (const pattern of STOP_SHARING_PATTERNS) {
    const match = original.match(pattern);
    const target = (match?.[1] ?? "").trim().replace(/^(?:the|a|an)\s+/i, "").replace(/[.!?]+$/, "");
    if (!target) continue;
    return {
      kind: "stop_sharing",
      transcript: original.trim(),
      target_app_or_title: target,
    };
  }
  return undefined;
}

const WAKE_TASK_PATTERNS = [
  /^(?:please\s+)?(?:wake|resume|undormant|reactivate)\s+(?:the\s+)?(?:task|paper|thread)?\s*(.+?)[.!?]?\s*$/i,
  /^(?:please\s+)?(?:bring\s+back|start\s+showing)\s+(?:the\s+)?(.+?)\s+(?:task|paper|thread)[.!?]?\s*$/i,
];

function detectWakeTask(original: string, lowered: string): VoiceIntent | undefined {
  if (!/(wake|resume|undormant|reactivate|bring back|start showing)/i.test(lowered)) return undefined;
  for (const pattern of WAKE_TASK_PATTERNS) {
    const match = original.match(pattern);
    const target = (match?.[1] ?? "").trim().replace(/^(?:the|a|an)\s+/i, "").replace(/[.!?]+$/, "");
    if (!target) continue;
    return {
      kind: "wake_task",
      transcript: original.trim(),
      target: extractSelectorTokens(target) || target.toLowerCase(),
    };
  }
  return undefined;
}

function detectDefineTrigger(original: string, _lowered: string): VoiceIntent | undefined {
  const match = original.match(DEFINE_TRIGGER_PATTERN);
  if (!match) return undefined;
  const sourceWord = (match[1] ?? "").toLowerCase();
  const bodySubstring = (match[2] ?? "").trim();
  const eventType = DEFINE_TRIGGER_EVENT_TYPES[sourceWord];
  if (!eventType || !bodySubstring) return undefined;
  return {
    kind: "define_trigger",
    transcript: original.trim(),
    event_type: eventType,
    body_substring: bodySubstring,
    target: "current_task",
  };
}

function detectFanOut(original: string, lowered: string): VoiceIntent | undefined {
  if (!FAN_OUT_QUANTIFIERS.test(lowered)) return undefined;
  for (const pattern of FAN_OUT_PATTERNS) {
    const match = original.match(pattern);
    if (!match) continue;
    const selectorText = (match[1] ?? "").trim();
    const messageText = (match[2] ?? "").trim().replace(/[.!?,]+$/, "");
    if (!selectorText || !messageText) continue;
    return {
      kind: "fan_out",
      transcript: original.trim(),
      selector: extractSelectorTokens(selectorText),
      message: messageText,
    };
  }
  return undefined;
}

// Defer requires a verb at the start ("defer"/"snooze"/"hold off on"/"postpone") and an
// explicit `all|every|each` quantifier so we don't fire on plain notes like
// "we should defer talking to legal".
const DEFER_VERB = /^(?:please\s+)?(?:can you\s+)?(?:defer|snooze|postpone|hold off on)\b/i;
const DEFER_PATTERN = /^(?:please\s+)?(?:can you\s+)?(?:defer|snooze|postpone|hold off on)\s+(?:all|every|each)\s+(?:of\s+)?(?:the\s+)?(.+?)(?:\s+(?:tasks?|papers?|threads?|items?|agents?))?(?:\s+for\s+(.+?))?[.!?]?\s*$/i;

function detectDefer(original: string, lowered: string): VoiceIntent | undefined {
  if (!DEFER_VERB.test(lowered)) return undefined;
  const match = original.match(DEFER_PATTERN);
  if (!match) return undefined;
  const selectorRaw = (match[1] ?? "").trim();
  const selector = extractSelectorTokens(selectorRaw);
  if (!selector) return undefined;
  const durationToken = (match[2] ?? "").trim();
  const seconds = durationToken ? parseDurationToSeconds(durationToken) : 3600;
  return {
    kind: "defer",
    transcript: original.trim(),
    selector,
    defer_seconds: seconds ?? 3600,
  };
}

// Pause matches "pause everything|all|all tasks for Y" and "pause for Y".
// Selector is optional (missing means "all ready"). Like defer, we anchor on
// "pause" at the start of the utterance so a stray mention in a note doesn't fire.
const PAUSE_VERB = /^(?:please\s+)?(?:can you\s+)?(?:pause|stop|halt|wrap up)\b/i;
const PAUSE_PATTERNS: Array<{ regex: RegExp; selectorIndex: number; durationIndex: number }> = [
  // "pause everything for 30 minutes" / "stop everything for 1h"
  {
    regex: /^(?:please\s+)?(?:can you\s+)?(?:pause|stop|halt)\s+(everything|all|all\s+(?:tasks?|papers?|threads?|items?|agents?))(?:\s+for\s+(.+?))?[.!?]?\s*$/i,
    selectorIndex: 1,
    durationIndex: 2,
  },
  // "pause for 30 minutes"
  {
    regex: /^(?:please\s+)?(?:can you\s+)?(?:pause|stop|halt)(?:\s+for\s+(.+?))?[.!?]?\s*$/i,
    selectorIndex: 0,
    durationIndex: 1,
  },
  // "wrap up by 3pm" / "wrap up for 30 minutes"
  {
    regex: /^(?:please\s+)?(?:can you\s+)?wrap up(?:\s+(?:for|by)\s+(.+?))?[.!?]?\s*$/i,
    selectorIndex: 0,
    durationIndex: 1,
  },
];

function detectPause(original: string, lowered: string): VoiceIntent | undefined {
  if (!PAUSE_VERB.test(lowered)) return undefined;
  for (const candidate of PAUSE_PATTERNS) {
    const match = original.match(candidate.regex);
    if (!match) continue;
    const selectorRaw = candidate.selectorIndex > 0 ? (match[candidate.selectorIndex] ?? "").trim() : "";
    const durationToken = (match[candidate.durationIndex] ?? "").trim();
    // "everything" / "all" / "all tasks" all collapse to no specific selector.
    const isUniversalSelector = !selectorRaw || /^(everything|all)$/i.test(selectorRaw) || /^all\s+(tasks?|papers?|threads?|items?|agents?)$/i.test(selectorRaw);
    const selector = isUniversalSelector ? undefined : extractSelectorTokens(selectorRaw) || undefined;
    const seconds = durationToken ? parseDurationToSeconds(durationToken) : 3600;
    return {
      kind: "pause",
      transcript: original.trim(),
      selector,
      defer_seconds: seconds ?? 3600,
    };
  }
  return undefined;
}

// Parses common spoken duration phrases. Returns undefined when the token
// is not a recognized duration so callers can decide on a sensible default.
export function parseDurationToSeconds(input: string): number | undefined {
  const normalized = input.trim().toLowerCase().replace(/[.,!?]+$/, "");
  if (!normalized) return undefined;

  // Word-form numerics like "an hour", "one hour", "half an hour", "a couple of hours".
  if (/^(?:an?|one)\s+hour$/.test(normalized)) return 3600;
  if (/^half\s+an?\s+hour$/.test(normalized)) return 1800;
  if (/^a\s+couple\s+(?:of\s+)?hours?$/.test(normalized)) return 7200;
  if (/^a\s+few\s+hours?$/.test(normalized)) return 10800;
  if (/^(?:an?|one)\s+minute$/.test(normalized)) return 60;
  if (/^a\s+(?:bit|moment|sec|second)$/.test(normalized)) return 60;
  if (/^the\s+rest\s+of\s+the\s+day$/.test(normalized)) return 4 * 3600;
  if (/^tomorrow$/.test(normalized)) return 86400;
  if (/^tonight$/.test(normalized)) return 6 * 3600;
  if (/^a\s+day$/.test(normalized) || /^one\s+day$/.test(normalized)) return 86400;
  if (/^a\s+week$/.test(normalized) || /^one\s+week$/.test(normalized)) return 7 * 86400;

  // Compact forms: "30m", "1h", "2h30m", "90s", "2d".
  const compact = normalized.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/);
  if (compact) {
    return scaleNumeric(Number(compact[1]), compact[2]);
  }

  // "1 hour", "30 minutes", "2 days"
  const spaced = normalized.match(/^(\d+(?:\.\d+)?)\s+(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/);
  if (spaced) {
    return scaleNumeric(Number(spaced[1]), spaced[2]);
  }

  // Compound: "1h30m", "2 hours 15 minutes" — best-effort.
  let total = 0;
  let matched = false;
  const compound = normalized.matchAll(/(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)/g);
  for (const part of compound) {
    const scaled = scaleNumeric(Number(part[1]), part[2]);
    if (scaled === undefined) continue;
    total += scaled;
    matched = true;
  }
  return matched ? total : undefined;
}

function scaleNumeric(value: number, unit: string): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  switch (unit) {
    case "s":
    case "sec":
    case "secs":
    case "second":
    case "seconds":
      return Math.round(value);
    case "m":
    case "min":
    case "mins":
    case "minute":
    case "minutes":
      return Math.round(value * 60);
    case "h":
    case "hr":
    case "hrs":
    case "hour":
    case "hours":
      return Math.round(value * 3600);
    case "d":
    case "day":
    case "days":
      return Math.round(value * 86400);
    case "w":
    case "week":
    case "weeks":
      return Math.round(value * 7 * 86400);
    default:
      return undefined;
  }
}

const SELECTOR_STOP_WORDS = new Set([
  "a", "an", "the", "of", "to", "for", "with", "and", "or",
  "related", "about", "regarding", "concerning",
]);

function extractSelectorTokens(input: string): string {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SELECTOR_STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

function hasPriorityTrigger(lowered: string): boolean {
  if (/\bpriority\b/.test(lowered)) return true;
  if (/\brerank\b/.test(lowered)) return true;
  if (RAISE_TOKENS.some((token) => new RegExp(`\\b${token}\\b`).test(lowered))) return true;
  if (LOWER_TOKENS.some((token) => new RegExp(`\\b${token}\\b`).test(lowered))) return true;
  if (/\bto the (top|front)\b/.test(lowered)) return true;
  if (/\bmake .* (first|top)\b/.test(lowered)) return true;
  return false;
}

function detectDirection(lowered: string): "up" | "down" | "top" {
  if (/\bto the (top|front)\b/.test(lowered)) return "top";
  if (/\bmake .* (first|top)\b/.test(lowered)) return "top";
  if (TOP_TOKENS.some((token) => new RegExp(`\\bto ${token}\\b`).test(lowered))) return "top";
  if (LOWER_TOKENS.some((token) => new RegExp(`\\b${token}\\b`).test(lowered))) return "down";
  return "up";
}

const STOP_WORDS = new Set([
  "a", "an", "the", "to", "of", "and", "or", "for",
  "make", "set", "raise", "bump", "boost", "increase", "higher", "promote",
  "lower", "deprioritize", "decrease", "demote", "less",
  "priority", "queue", "paper", "task", "rerank", "first", "top", "front", "head",
  "please", "high", "low",
]);

function extractTarget(lowered: string): string {
  // Prefer text inside quotes if present.
  const quoted = lowered.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) {
    return (quoted[1] ?? quoted[2] ?? "").trim();
  }

  const tokens = lowered
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));

  return tokens.join(" ").trim();
}

export function pickRerankCandidate(
  intent: { target: string },
  items: QueueItemWithPacket[],
): { item: QueueItemWithPacket; score: number } | undefined {
  if (items.length === 0) return undefined;
  const targetTokens = tokenize(intent.target);
  if (targetTokens.length === 0) return undefined;

  let best: { item: QueueItemWithPacket; score: number } | undefined;
  for (const item of items) {
    const haystack = [
      item.task_id ?? "",
      item.review_packet?.title ?? "",
      item.review_packet?.summary ?? "",
    ].join(" ");
    const haystackTokens = tokenize(haystack);
    if (haystackTokens.length === 0) continue;
    const haystackSet = new Set(haystackTokens);

    let matches = 0;
    for (const token of targetTokens) {
      if (haystackSet.has(token)) matches += 1;
    }
    if (matches === 0) continue;
    const score = matches / targetTokens.length;
    if (!best || score > best.score) {
      best = { item, score };
    }
  }
  if (!best || best.score < 0.5) return undefined;
  return best;
}

// Returns every queue item whose task_id, title, or summary matches the selector
// above the same 0.5 score threshold used by pickRerankCandidate. Unlike rerank
// (which picks one), defer/pause want to act on the whole matched set.
export function pickDeferCandidates(
  selector: string,
  items: QueueItemWithPacket[],
): Array<{ item: QueueItemWithPacket; score: number }> {
  if (items.length === 0) return [];
  const targetTokens = tokenize(selector);
  if (targetTokens.length === 0) return [];

  const matches: Array<{ item: QueueItemWithPacket; score: number }> = [];
  for (const item of items) {
    const haystack = [
      item.task_id ?? "",
      item.review_packet?.title ?? "",
      item.review_packet?.summary ?? "",
    ].join(" ");
    const haystackTokens = tokenize(haystack);
    if (haystackTokens.length === 0) continue;
    const haystackSet = new Set(haystackTokens);

    let hits = 0;
    for (const token of targetTokens) {
      if (haystackSet.has(token)) hits += 1;
    }
    if (hits === 0) continue;
    const score = hits / targetTokens.length;
    if (score < 0.5) continue;
    matches.push({ item, score });
  }
  matches.sort((left, right) => right.score - left.score);
  return matches;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}
