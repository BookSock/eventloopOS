#!/usr/bin/env node
import { readFileSync, statSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 0) process.exit(0);

const offenders = [];
for (const path of args) {
  if (!existsSync(path)) continue;
  let size;
  try {
    size = statSync(path).size;
  } catch {
    continue;
  }
  if (size === 0) continue;
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    continue;
  }
  const last = buf[buf.length - 1];
  if (last !== 0x0a) {
    offenders.push(path);
  }
}

if (offenders.length > 0) {
  console.error("newline-eof guard: files missing trailing newline (LF):");
  for (const p of offenders) console.error(`  ${p}`);
  console.error("\nFix: append a trailing newline (matches .gitattributes LF discipline).");
  process.exit(1);
}
