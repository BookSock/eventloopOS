import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("prints Chrome native messaging host manifest with explicit extension id", async () => {
  const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const { stdout } = await execFileAsync("node", ["bin/print-chrome-host-manifest", extensionId], {
    cwd: new URL("..", import.meta.url)
  });
  const manifest = JSON.parse(stdout);

  assert.equal(manifest.name, "com.eventloopos.browser_context");
  assert.equal(manifest.type, "stdio");
  assert.equal(manifest.path.endsWith("eventloop-native-host"), true);
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
});
