#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const options = readOptions();
const messages = await listMessages(options);
const items = [];

for (const message of messages) {
  if (!message?.id) continue;
  const detail = await getMessage(options, message.id);
  items.push(messageToItem(detail, options));
}

process.stdout.write(`${JSON.stringify({ items })}\n`);

async function listMessages(options) {
  const stdout = await runGws(options, [
    "gmail",
    "users",
    "messages",
    "list",
    "--params",
    JSON.stringify({
      userId: options.userId,
      maxResults: options.limit,
      q: options.query,
    }),
  ]);
  return parseJsonObject(stdout).messages ?? [];
}

async function getMessage(options, id) {
  const stdout = await runGws(options, [
    "gmail",
    "users",
    "messages",
    "get",
    "--params",
    JSON.stringify({
      userId: options.userId,
      id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    }),
  ]);
  return parseJsonObject(stdout);
}

async function runGws(options, args) {
  const env = {
    ...process.env,
    ...(options.configDir ? { GOOGLE_WORKSPACE_CLI_CONFIG_DIR: options.configDir } : {}),
  };
  const { stdout } = await execFile(options.command, [...options.commandArgs, ...args], {
    timeout: options.timeoutMs,
    maxBuffer: options.maxBufferBytes,
    env,
  });
  return stdout;
}

function messageToItem(message, options) {
  const headers = Object.fromEntries(
    (message.payload?.headers ?? [])
      .filter((header) => typeof header?.name === "string")
      .map((header) => [header.name.toLowerCase(), String(header.value ?? "")])
  );
  const subject = headers.subject || "(no subject)";
  const from = headers.from || "unknown sender";
  const occurredAt = occurredAtForMessage(message, headers.date);
  const sourceId = `${options.userId}:${message.id}`;
  const url = `https://mail.google.com/mail/u/0/#inbox/${message.id}`;

  return {
    id: `gmail_${hash(sourceId)}`,
    source: "gmail",
    source_id: sourceId,
    type: "gmail.message",
    title: `Email from ${from}: ${subject}`,
    summary: message.snippet ?? subject,
    occurred_at: occurredAt,
    task_hint: options.taskHint,
    project_hint: options.projectHint,
    links: [
      {
        label: "Open Gmail",
        url,
      },
    ],
    resources: [
      {
        id: `ctx_gmail_${hash(sourceId)}`,
        kind: "browser_tab",
        title: subject,
        url,
        source: "gmail",
        captured_at: new Date().toISOString(),
        restore_confidence: "medium",
        text_quote: subject,
      },
    ],
    raw: {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds,
      internalDate: message.internalDate,
    },
  };
}

function occurredAtForMessage(message, dateHeader) {
  const internalMs = Number(message.internalDate);
  if (Number.isFinite(internalMs) && internalMs > 0) {
    return new Date(internalMs).toISOString();
  }
  const headerMs = Date.parse(dateHeader ?? "");
  if (Number.isFinite(headerMs)) {
    return new Date(headerMs).toISOString();
  }
  return new Date(0).toISOString();
}

function parseJsonObject(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("gws output did not contain JSON object");
  }
  return JSON.parse(output.slice(start, end + 1));
}

function readOptions() {
  return {
    command: process.env.EVENTLOOPOS_GMAIL_COMMAND?.trim() || "gws",
    commandArgs: jsonStringArray(process.env.EVENTLOOPOS_GMAIL_COMMAND_ARGS_JSON, []),
    configDir: optionalEnv(process.env.EVENTLOOPOS_GMAIL_CONFIG_DIR),
    userId: process.env.EVENTLOOPOS_GMAIL_USER_ID?.trim() || "me",
    query: process.env.EVENTLOOPOS_GMAIL_QUERY?.trim() || "in:inbox is:unread newer_than:7d",
    limit: positiveInt(process.env.EVENTLOOPOS_GMAIL_LIMIT, 10),
    taskHint: optionalEnv(process.env.EVENTLOOPOS_GMAIL_TASK_HINT),
    projectHint: optionalEnv(process.env.EVENTLOOPOS_GMAIL_PROJECT_HINT),
    timeoutMs: positiveInt(process.env.EVENTLOOPOS_GMAIL_TIMEOUT_MS, 15_000),
    maxBufferBytes: positiveInt(process.env.EVENTLOOPOS_GMAIL_MAX_BUFFER_BYTES, 1_000_000),
  };
}

function jsonStringArray(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function optionalEnv(value) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function positiveInt(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
