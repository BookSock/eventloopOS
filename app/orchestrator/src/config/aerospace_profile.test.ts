import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("eventloopOS AeroSpace floating profile", () => {
  const profile = readFileSync(findRepoFile("config/aerospace/eventloopos-floating.toml"), "utf8");
  const bindings = parseMainModeBindings(profile);

  it("opts into floating-first behavior for the eventloopOS AeroSpace fork", () => {
    assert.match(profile, /^experimental-force-floating-windows\s*=\s*true$/m);
    assert.equal(bindings.get("ctrl-alt-f"), "layout floating");
    assert.match(profile, /\[\[on-window-detected\]\]\s+run\s*=\s*"layout floating"/m);
  });

  it("keeps Rectangle-style muscle memory for common snap actions", () => {
    assert.match(bindings.get("ctrl-alt-left") ?? "", /macos-window-snap"\s+left-half/);
    assert.match(bindings.get("ctrl-alt-right") ?? "", /macos-window-snap"\s+right-half/);
    assert.match(bindings.get("ctrl-alt-up") ?? "", /macos-window-snap"\s+top-half/);
    assert.match(bindings.get("ctrl-alt-down") ?? "", /macos-window-snap"\s+bottom-half/);
    assert.match(bindings.get("ctrl-alt-c") ?? "", /macos-window-snap"\s+center/);
    assert.match(bindings.get("ctrl-alt-u") ?? "", /macos-window-snap"\s+top-left/);
    assert.match(bindings.get("ctrl-alt-i") ?? "", /macos-window-snap"\s+top-right/);
    assert.match(bindings.get("ctrl-alt-cmd-left") ?? "", /move-node-to-monitor .*prev/);
    assert.match(bindings.get("ctrl-alt-cmd-right") ?? "", /move-node-to-monitor .*next/);
  });

  it("does not shadow critical eventloopOS paper-loop hotkeys", () => {
    const eventloopOSHotkeys = [
      "ctrl-alt-j",
      "ctrl-alt-e",
      "ctrl-alt-enter",
      "ctrl-alt-h",
      "ctrl-alt-r",
      "ctrl-alt-k",
      "ctrl-alt-m",
      "ctrl-alt-shift-m",
    ];

    for (const hotkey of eventloopOSHotkeys) {
      assert.equal(bindings.has(hotkey), false, `${hotkey} must stay owned by eventloopOS`);
    }
  });

  it("moves Rectangle defaults that conflict with eventloopOS onto shifted chords", () => {
    assert.equal(bindings.has("ctrl-alt-enter"), false);
    assert.match(bindings.get("ctrl-alt-shift-enter") ?? "", /macos-window-snap"\s+maximize/);
    assert.equal(bindings.has("ctrl-alt-j"), false);
    assert.equal(bindings.has("ctrl-alt-k"), false);
    assert.match(bindings.get("ctrl-alt-shift-j") ?? "", /macos-window-snap"\s+bottom-left/);
    assert.match(bindings.get("ctrl-alt-shift-k") ?? "", /macos-window-snap"\s+bottom-right/);
  });
});

function parseMainModeBindings(toml: string): Map<string, string> {
  const bindings = new Map<string, string>();
  let inMainBinding = false;

  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("[")) {
      inMainBinding = line === "[mode.main.binding]";
      continue;
    }
    if (!inMainBinding) continue;
    const match = /^([A-Za-z0-9-]+)\s*=\s*(['"])(.*)\2$/.exec(line);
    if (match) bindings.set(match[1]!, match[3]!);
  }

  return bindings;
}

function findRepoFile(relativePath: string): string {
  let current = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, relativePath);
    if (existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }

  current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, relativePath);
    if (existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }

  throw new Error(`could not find ${relativePath}`);
}
