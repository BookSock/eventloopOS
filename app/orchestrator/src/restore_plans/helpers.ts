export function readUrl(resource: Record<string, unknown>): string | undefined {
  return typeof resource.url === "string" && resource.url ? resource.url : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringFromRecord(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function pickAnchor(details: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!isRecord(details)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (details[key] !== undefined && details[key] !== null) {
      out[key] = details[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
