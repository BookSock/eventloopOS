export const DEFAULT_ORCHESTRATOR_URL = "http://127.0.0.1:4377";
export const ORCHESTRATOR_URL_KEY = "orchestratorUrl";
export const INSTALLATION_ID_KEY = "installationId";
export const RESTORE_REQUEST_LEASE_OWNER_PREFIX = "eventloop-browser-extension";

export function createExtensionConfig({ storageArea, randomId = defaultRandomId } = {}) {
  let cachedInstallationId;

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

  async function getRestoreRequestLeaseOwner() {
    const installationId = await getInstallationId();
    return `${RESTORE_REQUEST_LEASE_OWNER_PREFIX}-${installationId}`;
  }

  async function getInstallationId() {
    if (cachedInstallationId) {
      return cachedInstallationId;
    }

    const stored = storageArea?.get ? await storageArea.get({ [INSTALLATION_ID_KEY]: undefined }) : {};
    const existing = normalizeInstallationId(stored[INSTALLATION_ID_KEY]);
    if (existing) {
      cachedInstallationId = existing;
      return cachedInstallationId;
    }

    cachedInstallationId = normalizeInstallationId(randomId()) ?? "ephemeral";
    if (storageArea?.set) {
      await storageArea.set({ [INSTALLATION_ID_KEY]: cachedInstallationId });
    }
    return cachedInstallationId;
  }

  return { get, set, getOrchestratorUrl, getRestoreRequestLeaseOwner };
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

function normalizeInstallationId(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

function defaultRandomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
