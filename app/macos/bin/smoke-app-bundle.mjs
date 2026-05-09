import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const defaultBundleIdentifier = "dev.eventloopos.queue.smoke";
const defaultExecutableName = "EventLoopQueueApp";
const defaultBundleName = "eventloopOS Queue";

export async function buildPackagedQueueAppBundle(options = {}) {
  const executableName = options.executableName ?? defaultExecutableName;
  const bundleIdentifier = options.bundleIdentifier ?? defaultBundleIdentifier;
  const bundleName = options.bundleName ?? defaultBundleName;
  await spawnChecked("swift", ["build", "--product", "EventLoopQueueApp"]);
  const binPath = (await spawnChecked("swift", ["build", "--show-bin-path"])).stdout.trim();
  const appBundle = await packageAppBundle(path.join(binPath, "EventLoopQueueApp"), {
    executableName,
    bundleIdentifier,
    bundleName,
  });
  return {
    appBundle,
    executablePath: path.join(appBundle, "Contents", "MacOS", executableName),
    processName: executableName,
    cleanup: async () => {
      await rm(path.dirname(appBundle), { recursive: true, force: true });
    },
  };
}

export function openQueueApp(appBundle, options = {}) {
  const appArgs = options.appArgs ?? ["--test-mode"];
  return spawn("open", ["-n", "-W", appBundle, "--args", ...appArgs], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function spawnChecked(file, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${file} ${args.join(" ")} exited with ${signal ?? code}\n${stdout}${stderr}`));
    });
  });
}

export async function terminateProcessByExecutablePath(executablePath) {
  const ps = await spawnChecked("ps", ["-axo", "pid=,command="]);
  const pids = ps.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(executablePath))
    .map((line) => Number.parseInt(line.split(/\s+/, 1)[0] ?? "", 10))
    .filter(Number.isFinite);

  if (pids.length === 0) {
    throw new Error(`EventLoopQueueApp process not found for bundle executable ${executablePath}`);
  }

  for (const pid of pids) {
    process.kill(pid, "SIGTERM");
  }
}

export async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("EventLoopQueueApp did not stop after SIGTERM"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function packageAppBundle(executablePath, options) {
  const bundleRoot = await mkdtemp(path.join(tmpdir(), "eventloopos-queue-app-"));
  const appBundle = path.join(bundleRoot, `${options.executableName}.app`);
  const contentsDir = path.join(appBundle, "Contents");
  const macosDir = path.join(contentsDir, "MacOS");
  await mkdir(macosDir, { recursive: true });
  await cp(executablePath, path.join(macosDir, options.executableName));
  await writeFile(path.join(contentsDir, "Info.plist"), infoPlist(options), "utf8");
  return appBundle;
}

function infoPlist(options) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${escapePlist(options.executableName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlist(options.bundleIdentifier)}</string>
  <key>CFBundleName</key>
  <string>${escapePlist(options.bundleName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>0</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>eventloopOS uses speech recognition to turn the mic button in the master command sheet into typed text.</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>eventloopOS records short voice notes for the master command sheet.</string>
</dict>
</plist>
`;
}

function escapePlist(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
