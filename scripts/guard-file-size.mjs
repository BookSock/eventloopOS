#!/usr/bin/env node
import { statSync, existsSync } from "node:fs";
import { extname } from "node:path";

const MAX_BYTES = 1024 * 1024;

const ALLOWED_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".icns",
  ".pdf",
]);

const ALLOWED_PATH_PREFIXES = [
  "external-resources/",
  "artifacts/",
];

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
  if (size <= MAX_BYTES) continue;
  if (ALLOWED_EXTS.has(extname(path).toLowerCase())) continue;
  if (ALLOWED_PATH_PREFIXES.some((p) => path.startsWith(p))) continue;
  offenders.push({ path, size });
}

if (offenders.length > 0) {
  console.error("file-size guard: rejected files larger than 1MB:");
  for (const o of offenders) {
    const mb = (o.size / 1024 / 1024).toFixed(2);
    console.error(`  ${o.path} (${mb} MB)`);
  }
  console.error(
    "\nIf this file is legitimate, add an allow-list entry in scripts/guard-file-size.mjs.",
  );
  process.exit(1);
}
