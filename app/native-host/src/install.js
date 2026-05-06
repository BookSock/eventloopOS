import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HOST_NAME = "com.eventloopos.browser_context";

export function chromeNativeMessagingHostsDir(homeDir = process.env.HOME ?? "") {
  if (!homeDir) {
    throw new Error("HOME is required to install Chrome native messaging host");
  }
  return join(homeDir, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
}

export function defaultHostBinaryPath() {
  return realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "eventloop-native-host"));
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
  homeDir = process.env.HOME,
  hostPath = defaultHostBinaryPath(),
  dryRun = false
}) {
  const manifest = buildChromeHostManifest({ extensionId, hostPath });
  const dir = chromeNativeMessagingHostsDir(homeDir);
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
    dryRun
  };
}
