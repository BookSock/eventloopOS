import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest is Chrome MV3 and points at browser-ready scripts", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const contentScript = await readFile(new URL("../src/content-script.js", import.meta.url), "utf8");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "nativeMessaging", "scripting", "tabs"].sort());
  assert.equal(manifest.content_scripts[0].js[0], "src/content-script.js");
  assert.equal(/\bimport\s+/.test(contentScript), false);
});
