#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const paths = readPaths();
const now = new Date().toISOString();
const items = [];

for (const path of paths) {
  const absolutePath = resolve(path);
  const text = await readFile(absolutePath, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseTodoLine(lines[index]);
    if (!parsed) continue;
    const sourceId = `${absolutePath}:${index + 1}:${parsed.text}`;
    items.push({
      id: `todo_${hash(sourceId)}`,
      source: "todo_md",
      source_id: sourceId,
      type: "todo_md.item",
      title: parsed.text,
      summary: parsed.text,
      occurred_at: now,
      project_hint: process.env.EVENTLOOPOS_TODO_MD_PROJECT_HINT,
      task_hint: parsed.taskHint ?? process.env.EVENTLOOPOS_TODO_MD_TASK_HINT,
      links: [
        {
          label: "Todo file",
          url: `file://${absolutePath}#L${index + 1}`,
        },
      ],
      resources: [
        {
          id: `ctx_todo_${hash(sourceId)}`,
          kind: "file",
          title: parsed.text,
          url: `file://${absolutePath}#L${index + 1}`,
          source: "todo_md",
          captured_at: now,
          restore_confidence: "medium",
          path: absolutePath,
          line: index + 1,
        },
      ],
    });
  }
}

process.stdout.write(`${JSON.stringify({ items })}\n`);

function readPaths() {
  const raw = process.env.EVENTLOOPOS_TODO_MD_PATHS;
  if (!raw?.trim()) {
    throw new Error("EVENTLOOPOS_TODO_MD_PATHS must be set to comma-separated todo markdown paths");
  }
  const paths = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (paths.length === 0) {
    throw new Error("EVENTLOOPOS_TODO_MD_PATHS did not contain any paths");
  }
  return paths;
}

function parseTodoLine(line) {
  const checkbox = /^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/.exec(line);
  const todo = /^\s*[-*]\s+(?:TODO|todo):\s+(.+?)\s*$/.exec(line);
  const text = checkbox?.[1] ?? todo?.[1];
  if (!text) return undefined;
  return {
    text,
    taskHint: taskHintFromText(text),
  };
}

function taskHintFromText(text) {
  const match = /\[task:([^\]]+)\]/i.exec(text);
  return match?.[1];
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
