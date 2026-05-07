import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest is Chrome MV3 and points at browser-ready scripts", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const contentScript = await readFile(new URL("../src/content-script.js", import.meta.url), "utf8");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.equal(typeof manifest.key, "string");
  assert.equal(manifest.key.length > 0, true);
  assert.equal(manifest.options_ui.page, "options.html");
  assert.equal(manifest.options_ui.open_in_tab, false);
  assert.deepEqual(
    manifest.permissions.sort(),
    ["activeTab", "alarms", "nativeMessaging", "scripting", "storage", "tabs"].sort()
  );
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.host_permissions, ["file:///*", "http://localhost/*", "http://127.0.0.1/*"]);
  assert.equal(/\bimport\s+/.test(contentScript), false);
});
