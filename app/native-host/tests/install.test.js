import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HOST_NAME,
  buildChromeHostManifest,
  chromeNativeMessagingHostsDir,
  installChromeHostManifest
} from "../src/install.js";

const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("builds Chrome native messaging manifest with strict extension id", () => {
  const manifest = buildChromeHostManifest({
    extensionId,
    hostPath: "/tmp/eventloop-native-host"
  });

  assert.deepEqual(manifest, {
    name: HOST_NAME,
    description: "eventloopOS browser context native messaging host",
    path: "/tmp/eventloop-native-host",
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  });

  assert.throws(
    () => buildChromeHostManifest({ extensionId: "not-valid", hostPath: "/tmp/host" }),
    /extensionId must be 32 Chrome extension id characters a-p/
  );
});

test("installs manifest under macOS Chrome native messaging path", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "eventloop-native-host-"));

  const result = await installChromeHostManifest({
    extensionId,
    homeDir,
    hostPath: "/tmp/eventloop-native-host"
  });

  assert.equal(
    result.path,
    join(chromeNativeMessagingHostsDir(homeDir), `${HOST_NAME}.json`)
  );
  assert.deepEqual(JSON.parse(await readFile(result.path, "utf8")), result.manifest);
});

test("dry run returns manifest body without writing", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "eventloop-native-host-dry-"));
  const result = await installChromeHostManifest({
    extensionId,
    homeDir,
    hostPath: "/tmp/eventloop-native-host",
    dryRun: true
  });

  assert.equal(result.dryRun, true);
  assert.match(result.body, /eventloopOS browser context native messaging host/);
});
