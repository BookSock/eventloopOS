import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../../..", import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);
const sdkUrl = new URL("app/shared/dist/primitives.js", repoRoot);

export async function loadPrimitiveSdk(requiredExports = defaultPrimitiveSdkExports()) {
  try {
    const sdk = await import(sdkUrl.href);
    if (hasExports(sdk, requiredExports)) return sdk;
    throw new Error("app/shared/dist/primitives.js is missing required primitive SDK exports");
  } catch (firstError) {
    try {
      execFileSync("pnpm", ["--filter", "@eventloopos/shared", "build"], {
        cwd: repoRootPath,
        stdio: "ignore",
      });
      const sdk = await import(`${sdkUrl.href}?built=${Date.now()}`);
      if (hasExports(sdk, requiredExports)) return sdk;
      throw new Error("rebuilt app/shared/dist/primitives.js is missing required primitive SDK exports");
    } catch (secondError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`failed to load @eventloopos/shared/primitives SDK: ${firstMessage}; build failed: ${secondMessage}`);
    }
  }
}

export async function createPrimitiveExampleOperations({
  baseUrl = "http://127.0.0.1:4377",
  catalogPath = "docs/primitives.catalog.json",
  timeoutMs = 5_000,
} = {}) {
  const sdk = await loadPrimitiveSdk([
    "parsePrimitiveCatalog",
    "createPrimitiveOperationsClient",
  ]);
  const catalog = readPrimitiveCatalog(sdk, catalogPath);
  const ops = sdk.createPrimitiveOperationsClient({
    catalog,
    baseUrl,
    timeoutMs,
  });
  return { sdk, catalog, ops };
}

export async function createPrimitiveExampleOperationClient({
  baseUrl = "http://127.0.0.1:4377",
  catalogPath = "docs/primitives.catalog.json",
  timeoutMs = 5_000,
  fetch,
} = {}) {
  const sdk = await loadPrimitiveSdk([
    "parsePrimitiveCatalog",
    "buildPrimitiveApiIndex",
    "createPrimitiveOperationHttpClient",
  ]);
  const catalog = readPrimitiveCatalog(sdk, catalogPath);
  const client = sdk.createPrimitiveOperationHttpClient({
    catalog,
    baseUrl,
    timeoutMs,
    ...(fetch ? { fetch } : {}),
  });
  return { sdk, catalog, client };
}

export function readPrimitiveCatalog(sdk, catalogPath = "docs/primitives.catalog.json") {
  const resolved = path.resolve(repoRootPath, catalogPath);
  return sdk.parsePrimitiveCatalog(JSON.parse(fs.readFileSync(resolved, "utf8")));
}

function defaultPrimitiveSdkExports() {
  return [
    "parsePrimitiveCatalog",
    "summarizePrimitiveCatalog",
    "selectPrimitiveCapabilities",
    "selectPrimitiveSelfTestCommands",
    "selectPrimitiveLatencyBudgets",
    "buildPrimitiveProofPlan",
    "buildPrimitiveApiIndex",
    "createPrimitiveOperationHttpClient",
    "createPrimitiveOperationsClient",
  ];
}

function hasExports(sdk, names) {
  return names.every((name) => typeof sdk[name] === "function");
}
