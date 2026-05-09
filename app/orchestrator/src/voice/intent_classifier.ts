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

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}
