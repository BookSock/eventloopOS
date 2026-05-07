export const DEFAULT_ORCHESTRATOR_URL = "http://127.0.0.1:4377";
export const ORCHESTRATOR_URL_KEY = "orchestratorUrl";

export function createExtensionConfig({ storageArea } = {}) {
  async function get() {
    const stored = await getStoredConfig(storageArea);
    return {
      orchestratorUrl: normalizeOrchestratorUrl(stored[ORCHESTRATOR_URL_KEY] ?? DEFAULT_ORCHESTRATOR_URL)
    };
  }

  async function set(nextConfig) {
    const orchestratorUrl = normalizeOrchestratorUrl(nextConfig?.orchestratorUrl);
    if (!storageArea?.set) {
      return { orchestratorUrl };
    }

    await storageArea.set({ [ORCHESTRATOR_URL_KEY]: orchestratorUrl });
    return { orchestratorUrl };
  }

  async function getOrchestratorUrl() {
    const config = await get();
    return config.orchestratorUrl;
  }

  return { get, set, getOrchestratorUrl };
}

export function normalizeOrchestratorUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("orchestratorUrl must be a non-empty URL");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("orchestratorUrl must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("orchestratorUrl must use http or https");
  }

  url.hash = "";
  url.search = "";
  return url.href.replace(/\/+$/, "");
}

async function getStoredConfig(storageArea) {
  if (!storageArea?.get) {
    return {};
  }

  return await storageArea.get({ [ORCHESTRATOR_URL_KEY]: DEFAULT_ORCHESTRATOR_URL });
}
