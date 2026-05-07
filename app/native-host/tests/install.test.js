import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HOST_NAME,
  buildChromeHostManifest,
  CHROME_BROWSER_FLAVORS,
  DEFAULT_BROWSER_EXTENSION_ID,
  chromeNativeMessagingHostsDir,
  chromeExtensionIdFromManifestKey,
  readChromeExtensionIdFromManifest,
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

test("derives stable Chrome extension id from browser extension manifest key", async () => {
  const extensionManifest = JSON.parse(await readFile(new URL("../../browser-extension/manifest.json", import.meta.url), "utf8"));
  const derived = await readChromeExtensionIdFromManifest();

  assert.equal(derived, DEFAULT_BROWSER_EXTENSION_ID);
  assert.equal(chromeExtensionIdFromManifestKey(extensionManifest.key), DEFAULT_BROWSER_EXTENSION_ID);
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

test("installs manifest using browser extension manifest id by default", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "eventloop-native-host-default-id-"));

  const result = await installChromeHostManifest({
    homeDir,
    hostPath: "/tmp/eventloop-native-host"
  });

  assert.equal(result.extensionId, DEFAULT_BROWSER_EXTENSION_ID);
  assert.deepEqual(result.manifest.allowed_origins, [`chrome-extension://${DEFAULT_BROWSER_EXTENSION_ID}/`]);
});

test("installs manifests under browser-specific macOS native messaging paths", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "eventloop-native-host-browser-"));

  const installed = await Promise.all(
    CHROME_BROWSER_FLAVORS.map((browser) =>
      installChromeHostManifest({
        extensionId,
        browser,
        homeDir,
        hostPath: "/tmp/eventloop-native-host"
      })
    )
  );

  assert.deepEqual(installed.map((result) => result.path), [
    join(homeDir, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", `${HOST_NAME}.json`),
    join(homeDir, "Library", "Application Support", "Google", "ChromeForTesting", "NativeMessagingHosts", `${HOST_NAME}.json`),
    join(homeDir, "Library", "Application Support", "Chromium", "NativeMessagingHosts", `${HOST_NAME}.json`)
  ]);
});

test("rejects unknown browser native messaging path flavor", () => {
  assert.throws(
    () => chromeNativeMessagingHostsDir("/tmp/home", "unknown"),
    /browser must be one of: chrome, chrome-for-testing, chromium/
  );
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
