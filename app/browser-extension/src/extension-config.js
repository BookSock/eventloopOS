export const DEFAULT_ORCHESTRATOR_URL = "http://127.0.0.1:4377";
export const ORCHESTRATOR_URL_KEY = "orchestratorUrl";
export const ALLOWED_ORIGINS_KEY = "allowedOrigins";
export const INSTALLATION_ID_KEY = "installationId";
export const RESTORE_REQUEST_LEASE_OWNER_PREFIX = "eventloop-browser-extension";
export const DEFAULT_ALLOWED_ORIGINS = ["file://*", "http://localhost:*", "http://127.0.0.1:*"];

export function createExtensionConfig({ storageArea, randomId = defaultRandomId } = {}) {
  let cachedInstallationId;

  async function get() {
    const stored = await getStoredConfig(storageArea);
    return {
      orchestratorUrl: normalizeOrchestratorUrl(stored[ORCHESTRATOR_URL_KEY] ?? DEFAULT_ORCHESTRATOR_URL),
      allowedOrigins: normalizeAllowedOrigins(stored[ALLOWED_ORIGINS_KEY] ?? DEFAULT_ALLOWED_ORIGINS)
    };
  }

  async function set(nextConfig) {
    const current = await get();
    const orchestratorUrl =
      nextConfig?.orchestratorUrl === undefined
        ? current.orchestratorUrl
        : normalizeOrchestratorUrl(nextConfig.orchestratorUrl);
    const allowedOrigins =
      nextConfig?.allowedOrigins === undefined
        ? current.allowedOrigins
        : normalizeAllowedOrigins(nextConfig.allowedOrigins);
    if (!storageArea?.set) {
      return { orchestratorUrl, allowedOrigins };
    }

    await storageArea.set({ [ORCHESTRATOR_URL_KEY]: orchestratorUrl, [ALLOWED_ORIGINS_KEY]: allowedOrigins });
    return { orchestratorUrl, allowedOrigins };
  }

  async function getOrchestratorUrl() {
    const config = await get();
    return config.orchestratorUrl;
  }

  async function getRestoreRequestLeaseOwner() {
    const installationId = await getInstallationId();
    return `${RESTORE_REQUEST_LEASE_OWNER_PREFIX}-${installationId}`;
  }

  async function getAllowedOrigins() {
    const config = await get();
    return config.allowedOrigins;
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

  return { get, set, getOrchestratorUrl, getRestoreRequestLeaseOwner, getAllowedOrigins };
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

export function normalizeAllowedOrigins(value) {
  const rawPatterns =
    typeof value === "string"
      ? value.split(/[\n,]+/)
      : Array.isArray(value)
        ? value
        : undefined;
  if (!rawPatterns) {
    throw new Error("allowedOrigins must be a list of origin patterns");
  }

  const normalized = [];
  const seen = new Set();
  for (const rawPattern of rawPatterns) {
    if (typeof rawPattern !== "string") {
      throw new Error("allowedOrigins entries must be strings");
    }
    const pattern = normalizeAllowedOriginPattern(rawPattern);
    if (!pattern) {
      continue;
    }
    if (!seen.has(pattern)) {
      normalized.push(pattern);
      seen.add(pattern);
    }
  }

  if (normalized.length === 0) {
    throw new Error("allowedOrigins must include at least one origin pattern");
  }
  return normalized;
}

export function isUrlAllowedByOrigins(url, allowedOrigins) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  const normalizedOrigins = normalizeAllowedOrigins(allowedOrigins);
  return normalizedOrigins.some((origin) => allowedOriginMatchesUrl(origin, parsedUrl));
}

function normalizeAllowedOriginPattern(value) {
  const trimmed = value.trim().toLowerCase().replace(/\/+$/, "");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "<all_urls>" || trimmed === "*://*/*" || trimmed === "http://*" || trimmed === "https://*") {
    throw new Error("allowedOrigins must not use broad all-site patterns");
  }
  if (trimmed === "file://*") {
    return "file://*";
  }

  const match = trimmed.match(/^(https?):\/\/([^/]+)$/);
  if (!match) {
    throw new Error(`allowed origin pattern is invalid: ${value}`);
  }

  const protocol = `${match[1]}:`;
  const hostPort = match[2];
  const colonIndex = hostPort.lastIndexOf(":");
  const host = colonIndex > 0 ? hostPort.slice(0, colonIndex) : hostPort;
  const port = colonIndex > 0 ? hostPort.slice(colonIndex + 1) : undefined;

  if (!isAllowedHostPattern(host)) {
    throw new Error(`allowed origin host is invalid: ${value}`);
  }
  if (port !== undefined && port !== "*" && !/^\d{1,5}$/.test(port)) {
    throw new Error(`allowed origin port is invalid: ${value}`);
  }

  return `${protocol}//${host}${port !== undefined ? `:${port}` : ""}`;
}

function allowedOriginMatchesUrl(origin, parsedUrl) {
  if (origin === "file://*") {
    return parsedUrl.protocol === "file:";
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return false;
  }

  const match = origin.match(/^(https?):\/\/([^/:]+)(?::([^/]+))?$/);
  if (!match) {
    return false;
  }
  const [, rawProtocol, hostPattern, portPattern] = match;
  if (`${rawProtocol}:` !== parsedUrl.protocol) {
    return false;
  }
  if (!hostMatches(hostPattern, parsedUrl.hostname)) {
    return false;
  }
  if (portPattern && portPattern !== "*" && portPattern !== parsedUrl.port) {
    return false;
  }
  return true;
}

function hostMatches(pattern, hostname) {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return hostname.endsWith(`.${suffix}`);
  }
  return pattern === hostname;
}

function isAllowedHostPattern(host) {
  if (host === "*" || host.length === 0) {
    return false;
  }
  const withoutWildcard = host.startsWith("*.") ? host.slice(2) : host;
  if (withoutWildcard === "localhost") {
    return true;
  }
  return /^[a-z0-9.-]+$/.test(withoutWildcard) && withoutWildcard.includes(".");
}

async function getStoredConfig(storageArea) {
  if (!storageArea?.get) {
    return {};
  }

  return await storageArea.get({
    [ORCHESTRATOR_URL_KEY]: DEFAULT_ORCHESTRATOR_URL,
    [ALLOWED_ORIGINS_KEY]: DEFAULT_ALLOWED_ORIGINS
  });
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
