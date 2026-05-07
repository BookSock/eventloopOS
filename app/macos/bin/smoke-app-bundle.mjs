import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const bundleIdentifier = "dev.eventloopos.queue.smoke";

export async function buildPackagedQueueAppBundle() {
  await spawnChecked("swift", ["build", "--product", "EventLoopQueueApp"]);
  const binPath = (await spawnChecked("swift", ["build", "--show-bin-path"])).stdout.trim();
  const appBundle = await packageAppBundle(path.join(binPath, "EventLoopQueueApp"));
  return {
    appBundle,
    executablePath: path.join(appBundle, "Contents", "MacOS", "EventLoopQueueApp"),
    cleanup: async () => {
      await rm(path.dirname(appBundle), { recursive: true, force: true });
    },
  };
}

export function openQueueApp(appBundle) {
  return spawn("open", ["-n", "-W", appBundle, "--args", "--test-mode"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EVENTLOOP_QUEUE_TEST_MODE: "1",
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

async function packageAppBundle(executablePath) {
  const bundleRoot = await mkdtemp(path.join(tmpdir(), "eventloopos-queue-app-"));
  const appBundle = path.join(bundleRoot, "EventLoopQueueApp.app");
  const contentsDir = path.join(appBundle, "Contents");
  const macosDir = path.join(contentsDir, "MacOS");
  await mkdir(macosDir, { recursive: true });
  await cp(executablePath, path.join(macosDir, "EventLoopQueueApp"));
  await writeFile(path.join(contentsDir, "Info.plist"), infoPlist(), "utf8");
  return appBundle;
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>EventLoopQueueApp</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleIdentifier}</string>
  <key>CFBundleName</key>
  <string>eventloopOS Queue</string>
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
</dict>
</plist>
`;
}
