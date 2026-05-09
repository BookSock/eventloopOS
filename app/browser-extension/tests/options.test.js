import assert from "node:assert/strict";
import test from "node:test";
import { activeTabCaptureStatusMessage, mergeProviderPresetOrigins, PROVIDER_PRESET_ORIGINS, routeHintsFromInputs, tabRegistryCaptureStatusMessage } from "../src/options-helpers.js";

test("options route hints trim task and project inputs", () => {
  assert.deepEqual(
    routeHintsFromInputs({ value: " blog launch " }, { value: " eventloopOS " }),
    { task_hint: "blog launch", project_hint: "eventloopOS" }
  );
});

test("options route hints omit blank inputs", () => {
  assert.deepEqual(
    routeHintsFromInputs({ value: " " }, { value: "" }),
    {}
  );
});

test("options active tab status names captured resource", () => {
  assert.equal(
    activeTabCaptureStatusMessage({ resource: { title: "Blog draft" } }),
    "Captured current tab: Blog draft"
  );
});

test("options active tab status handles skipped capture", () => {
  assert.equal(
    activeTabCaptureStatusMessage({ skipped: true }),
    "Current tab skipped"
  );
});

test("options tab registry status summarizes capture counts", () => {
  assert.equal(
    tabRegistryCaptureStatusMessage({ captured_count: 2, attempted_count: 3, failed_count: 1, skipped_count: 4 }),
    "Captured 2/3 tabs; failed 1; skipped 4"
  );
});

test("merge provider presets adds missing origins and reports added count", () => {
  const result = mergeProviderPresetOrigins("https://github.com/*\nhttps://app.slack.com/*");
  assert.ok(result.added.length > 0);
  assert.ok(!result.added.includes("https://app.slack.com/*"));
  for (const preset of PROVIDER_PRESET_ORIGINS) {
    assert.ok(result.value.includes(preset), `expected ${preset} in merged value`);
  }
});

test("merge provider presets is idempotent when all presets already exist", () => {
  const initial = PROVIDER_PRESET_ORIGINS.join("\n");
  const result = mergeProviderPresetOrigins(initial);
  assert.deepEqual(result.added, []);
  assert.equal(result.value.split("\n").filter(Boolean).length, PROVIDER_PRESET_ORIGINS.length);
});
