import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export type CodexTaskMapEntry = { task_id: string; terminal_ref?: string };
export type CodexTaskMap = Record<string, CodexTaskMapEntry>;

export type CodexTaskMapResolverOptions = {
  inlineMap?: CodexTaskMap;
  mapPath?: string;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, text: string) => Promise<void>;
  renameFile?: (from: string, to: string) => Promise<void>;
  makeDirectory?: (path: string) => Promise<void>;
  onError?: (error: Error) => void;
};

export class CodexTaskMapResolver {
  private readonly inlineMap: CodexTaskMap;
  private readonly mapPath?: string;
  private readonly readTextFile: (path: string) => Promise<string>;
  private readonly writeTextFile: (path: string, text: string) => Promise<void>;
  private readonly renameFile: (from: string, to: string) => Promise<void>;
  private readonly makeDirectory: (path: string) => Promise<void>;
  private readonly onError?: (error: Error) => void;

  constructor(options: CodexTaskMapResolverOptions = {}) {
    this.inlineMap = options.inlineMap ?? {};
    this.mapPath = options.mapPath;
    this.readTextFile = options.readTextFile ?? ((path) => readFile(path, "utf8"));
    this.writeTextFile = options.writeTextFile ?? ((path, text) => writeFile(path, text, "utf8"));
    this.renameFile = options.renameFile ?? ((from, to) => rename(from, to));
    this.makeDirectory = options.makeDirectory ?? ((path) => mkdir(path, { recursive: true }).then(() => undefined));
    this.onError = options.onError;
  }

  async taskIdForThreadId(threadId: string): Promise<string | undefined> {
    const fileMap = await this.readFileMap();
    const entry = fileMap?.[threadId] ?? this.inlineMap[threadId];
    return entry?.task_id;
  }

  async entryForThreadId(threadId: string): Promise<CodexTaskMapEntry | undefined> {
    const fileMap = await this.readFileMap();
    return fileMap?.[threadId] ?? this.inlineMap[threadId];
  }

  async bindThreadToTask(threadId: string, taskId: string, terminalRef?: string): Promise<CodexTaskMap> {
    if (!this.mapPath) {
      throw new Error("Codex task map path is not configured");
    }

    const current = await this.readWritableFileMap();
    const existing = current[threadId];
    const nextEntry: CodexTaskMapEntry = {
      task_id: taskId,
      ...(terminalRef !== undefined ? { terminal_ref: terminalRef } : existing?.terminal_ref ? { terminal_ref: existing.terminal_ref } : {}),
    };
    const next = sortMap({ ...current, [threadId]: nextEntry });
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    const tmpPath = `${this.mapPath}.${process.pid}.${Date.now()}.tmp`;
    await this.makeDirectory(dirname(this.mapPath));
    await this.writeTextFile(tmpPath, serialized);
    await this.renameFile(tmpPath, this.mapPath);
    return next;
  }

  private async readFileMap(): Promise<CodexTaskMap | undefined> {
    if (!this.mapPath) return undefined;

    try {
      return parseCodexTaskMap(await this.readTextFile(this.mapPath), `Codex task map file ${this.mapPath}`);
    } catch (error) {
      if (isNotFoundError(error)) return {};
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.onError?.(normalized);
      return undefined;
    }
  }

  private async readWritableFileMap(): Promise<CodexTaskMap> {
    try {
      return parseCodexTaskMap(await this.readTextFile(this.mapPath ?? ""), `Codex task map file ${this.mapPath}`);
    } catch (error) {
      if (isNotFoundError(error)) return {};
      throw error;
    }
  }
}

export function parseCodexTaskMap(raw: string, label = "Codex task map"): CodexTaskMap {
  const parsed = parseJson(raw, label);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object mapping thread ids to task ids`);
  }

  const map: CodexTaskMap = {};
  for (const [threadId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!threadId) {
      throw new Error(`${label} entries must use non-empty thread ids`);
    }
    if (typeof value === "string") {
      if (!value) throw new Error(`${label} entry for ${threadId} must be a non-empty task id`);
      map[threadId] = { task_id: value };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (typeof obj.task_id !== "string" || !obj.task_id) {
        throw new Error(`${label} entry for ${threadId} must include a task_id string`);
      }
      const entry: CodexTaskMapEntry = { task_id: obj.task_id };
      if (typeof obj.terminal_ref === "string" && obj.terminal_ref) {
        entry.terminal_ref = obj.terminal_ref;
      }
      map[threadId] = entry;
      continue;
    }
    throw new Error(`${label} entry for ${threadId} must be a string or { task_id, terminal_ref? } object`);
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

function sortMap(map: CodexTaskMap): CodexTaskMap {
  return Object.fromEntries(Object.entries(map).sort(([left], [right]) => left.localeCompare(right)));
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
