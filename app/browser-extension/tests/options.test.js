import assert from "node:assert/strict";
import test from "node:test";
import { activeTabCaptureStatusMessage, routeHintsFromInputs, tabRegistryCaptureStatusMessage } from "../src/options-helpers.js";

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
