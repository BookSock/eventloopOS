import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_ORIGINS_KEY,
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_ORCHESTRATOR_URL,
  INSTALLATION_ID_KEY,
  ORCHESTRATOR_URL_KEY,
  createExtensionConfig,
  isUrlAllowedByOrigins,
  normalizeAllowedOrigins,
  normalizeOrchestratorUrl
} from "../src/extension-config.js";

test("extension config defaults orchestrator URL when storage is unavailable", async () => {
  const config = createExtensionConfig();

  assert.deepEqual(await config.get(), {
    orchestratorUrl: DEFAULT_ORCHESTRATOR_URL,
    allowedOrigins: DEFAULT_ALLOWED_ORIGINS
  });
  assert.equal(await config.getOrchestratorUrl(), DEFAULT_ORCHESTRATOR_URL);
  assert.deepEqual(await config.getAllowedOrigins(), DEFAULT_ALLOWED_ORIGINS);
});

test("extension config creates and persists stable restore lease owner", async () => {
  const writes = [];
  let stored = {};
  const config = createExtensionConfig({
    randomId: () => "Profile One: ABC",
    storageArea: {
      get: async (defaults) => ({ ...defaults, ...stored }),
      set: async (payload) => {
        writes.push(payload);
        stored = { ...stored, ...payload };
      }
    }
  });

  assert.equal(await config.getRestoreRequestLeaseOwner(), "eventloop-browser-extension-profile-one-abc");
  assert.equal(await config.getRestoreRequestLeaseOwner(), "eventloop-browser-extension-profile-one-abc");
  assert.deepEqual(writes, [{ [INSTALLATION_ID_KEY]: "profile-one-abc" }]);
});

test("extension config reuses stored restore lease owner", async () => {
  const config = createExtensionConfig({
    randomId: () => {
      throw new Error("random id should not be generated");
    },
    storageArea: {
      get: async (defaults) => ({ ...defaults, [INSTALLATION_ID_KEY]: "stored-profile-123" }),
      set: async () => {
        throw new Error("stored installation id should not be rewritten");
      }
    }
  });

  assert.equal(await config.getRestoreRequestLeaseOwner(), "eventloop-browser-extension-stored-profile-123");
});

test("extension config reads and normalizes stored orchestrator URL", async () => {
  const config = createExtensionConfig({
    storageArea: {
      get: async (defaults) => ({
        ...defaults,
        [ORCHESTRATOR_URL_KEY]: " http://127.0.0.1:9999/// "
      })
    }
  });

  assert.deepEqual(await config.get(), {
    orchestratorUrl: "http://127.0.0.1:9999",
    allowedOrigins: DEFAULT_ALLOWED_ORIGINS
  });
});

test("extension config writes normalized orchestrator URL and allowed origins", async () => {
  const writes = [];
  const config = createExtensionConfig({
    storageArea: {
      get: async (defaults) => defaults,
      set: async (payload) => writes.push(payload)
    }
  });

  assert.deepEqual(await config.set({
    orchestratorUrl: "https://queue.example.test/",
    allowedOrigins: "https://github.com/\nhttps://*.slack.com\nhttp://localhost:*"
  }), {
    orchestratorUrl: "https://queue.example.test",
    allowedOrigins: ["https://github.com", "https://*.slack.com", "http://localhost:*"]
  });
  assert.deepEqual(writes, [
    {
      [ORCHESTRATOR_URL_KEY]: "https://queue.example.test",
      [ALLOWED_ORIGINS_KEY]: ["https://github.com", "https://*.slack.com", "http://localhost:*"]
    }
  ]);
});

test("normalizeOrchestratorUrl rejects invalid or risky protocols", () => {
  assert.throws(() => normalizeOrchestratorUrl(""), /non-empty URL/);
  assert.throws(() => normalizeOrchestratorUrl("not a url"), /valid URL/);
  assert.throws(() => normalizeOrchestratorUrl("file:///tmp/socket"), /http or https/);
});

test("normalizeAllowedOrigins accepts newline or comma separated safe origins", () => {
  assert.deepEqual(
    normalizeAllowedOrigins(" https://github.com/\nhttps://*.slack.com, file://* , http://127.0.0.1:* "),
    ["https://github.com", "https://*.slack.com", "file://*", "http://127.0.0.1:*"]
  );
});

test("normalizeAllowedOrigins rejects invalid or overly broad origins", () => {
  assert.throws(() => normalizeAllowedOrigins(""), /at least one/);
  assert.throws(() => normalizeAllowedOrigins("<all_urls>"), /broad all-site/);
  assert.throws(() => normalizeAllowedOrigins("https://*"), /broad all-site/);
  assert.throws(() => normalizeAllowedOrigins("chrome://extensions"), /invalid/);
});

test("isUrlAllowedByOrigins matches exact hosts, wildcard subdomains, localhost, and file URLs", () => {
  const origins = ["https://github.com", "https://*.slack.com", "http://localhost:*", "file://*"];

  assert.equal(isUrlAllowedByOrigins("https://github.com/org/repo", origins), true);
  assert.equal(isUrlAllowedByOrigins("https://app.slack.com/client/T/C", origins), true);
  assert.equal(isUrlAllowedByOrigins("https://slack.com/client/T/C", origins), false);
  assert.equal(isUrlAllowedByOrigins("http://localhost:5173/fixture", origins), true);
  assert.equal(isUrlAllowedByOrigins("file:///tmp/context.html", origins), true);
  assert.equal(isUrlAllowedByOrigins("https://mail.google.com/mail/u/0", origins), false);
});
