import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const HOST_NAME = "com.eventloopos.browser_context";

export const CHROME_BROWSER_FLAVORS = ["chrome", "chrome-for-testing", "chromium"];
export const DEFAULT_BROWSER_EXTENSION_ID = "epgialcaigfckcecimolbgnfoalfmpbe";

export function chromeNativeMessagingHostsDir(homeDir = process.env.HOME ?? "", browser = "chrome") {
  if (!homeDir) {
    throw new Error("HOME is required to install Chrome native messaging host");
  }

  switch (browser) {
    case "chrome":
      return join(homeDir, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
    case "chrome-for-testing":
      return join(homeDir, "Library", "Application Support", "Google", "ChromeForTesting", "NativeMessagingHosts");
    case "chromium":
      return join(homeDir, "Library", "Application Support", "Chromium", "NativeMessagingHosts");
    default:
      throw new Error(`browser must be one of: ${CHROME_BROWSER_FLAVORS.join(", ")}`);
  }
}

export function defaultHostBinaryPath() {
  return realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "eventloop-native-host"));
}

export function defaultBrowserExtensionManifestPath() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "browser-extension", "manifest.json");
}

export function chromeExtensionIdFromManifestKey(key) {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new Error("Chrome extension manifest key is required to derive extension id");
  }

  let publicKey;
  try {
    publicKey = Buffer.from(key.trim(), "base64");
  } catch {
    throw new Error("Chrome extension manifest key must be base64");
  }
  if (publicKey.length === 0) {
    throw new Error("Chrome extension manifest key must be base64");
  }

  const digest = createHash("sha256").update(publicKey).digest().subarray(0, 16);
  return [...digest]
    .map((byte) =>
      [byte >> 4, byte & 0x0f]
        .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
        .join("")
    )
    .join("");
}

export async function readChromeExtensionIdFromManifest(manifestPath = defaultBrowserExtensionManifestPath()) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return chromeExtensionIdFromManifestKey(manifest.key);
}

export function buildChromeHostManifest({ extensionId, hostPath = defaultHostBinaryPath() }) {
  if (typeof extensionId !== "string" || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("extensionId must be 32 Chrome extension id characters a-p");
  }

  return {
    name: HOST_NAME,
    description: "eventloopOS browser context native messaging host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
}

export async function installChromeHostManifest({
  extensionId,
  extensionManifestPath = defaultBrowserExtensionManifestPath(),
  browser = "chrome",
  homeDir = process.env.HOME,
  hostPath = defaultHostBinaryPath(),
  dryRun = false
}) {
  const resolvedExtensionId = extensionId ?? await readChromeExtensionIdFromManifest(extensionManifestPath);
  const manifest = buildChromeHostManifest({ extensionId: resolvedExtensionId, hostPath });
  const dir = chromeNativeMessagingHostsDir(homeDir, browser);
  const path = join(dir, `${HOST_NAME}.json`);
  const body = `${JSON.stringify(manifest, null, 2)}\n`;

  if (!dryRun) {
    await mkdir(dir, { recursive: true });
    await writeFile(path, body, "utf8");
  }

  return {
    path,
    manifest,
    body,
    browser,
    extensionId: resolvedExtensionId,
    dryRun
  };
}
