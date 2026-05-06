import { readFile } from "node:fs/promises";

export type CodexTaskMap = Record<string, string>;

export type CodexTaskMapResolverOptions = {
  inlineMap?: CodexTaskMap;
  mapPath?: string;
  readTextFile?: (path: string) => Promise<string>;
  onError?: (error: Error) => void;
};

export class CodexTaskMapResolver {
  private readonly inlineMap: CodexTaskMap;
  private readonly mapPath?: string;
  private readonly readTextFile: (path: string) => Promise<string>;
  private readonly onError?: (error: Error) => void;

  constructor(options: CodexTaskMapResolverOptions = {}) {
    this.inlineMap = options.inlineMap ?? {};
    this.mapPath = options.mapPath;
    this.readTextFile = options.readTextFile ?? ((path) => readFile(path, "utf8"));
    this.onError = options.onError;
  }

  async taskIdForThreadId(threadId: string): Promise<string | undefined> {
    const fileMap = await this.readFileMap();
    return fileMap?.[threadId] ?? this.inlineMap[threadId];
  }

  private async readFileMap(): Promise<CodexTaskMap | undefined> {
    if (!this.mapPath) return undefined;

    try {
      return parseCodexTaskMap(await this.readTextFile(this.mapPath), `Codex task map file ${this.mapPath}`);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.onError?.(normalized);
      return undefined;
    }
  }
}

export function parseCodexTaskMap(raw: string, label = "Codex task map"): CodexTaskMap {
  const parsed = parseJson(raw, label);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object mapping thread ids to task ids`);
  }

  const map: CodexTaskMap = {};
  for (const [threadId, taskId] of Object.entries(parsed as Record<string, unknown>)) {
    if (!threadId || typeof taskId !== "string" || !taskId) {
      throw new Error(`${label} entries must be non-empty string task ids`);
    }
    map[threadId] = taskId;
  }
  return map;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}
