import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ORCHESTRATOR_URL,
  INSTALLATION_ID_KEY,
  ORCHESTRATOR_URL_KEY,
  createExtensionConfig,
  normalizeOrchestratorUrl
} from "../src/extension-config.js";

test("extension config defaults orchestrator URL when storage is unavailable", async () => {
  const config = createExtensionConfig();

  assert.deepEqual(await config.get(), { orchestratorUrl: DEFAULT_ORCHESTRATOR_URL });
  assert.equal(await config.getOrchestratorUrl(), DEFAULT_ORCHESTRATOR_URL);
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

  assert.deepEqual(await config.get(), { orchestratorUrl: "http://127.0.0.1:9999" });
});

test("extension config writes normalized orchestrator URL", async () => {
  const writes = [];
  const config = createExtensionConfig({
    storageArea: {
      get: async (defaults) => defaults,
      set: async (payload) => writes.push(payload)
    }
  });

  assert.deepEqual(await config.set({ orchestratorUrl: "https://queue.example.test/" }), {
    orchestratorUrl: "https://queue.example.test"
  });
  assert.deepEqual(writes, [{ [ORCHESTRATOR_URL_KEY]: "https://queue.example.test" }]);
});

test("normalizeOrchestratorUrl rejects invalid or risky protocols", () => {
  assert.throws(() => normalizeOrchestratorUrl(""), /non-empty URL/);
  assert.throws(() => normalizeOrchestratorUrl("not a url"), /valid URL/);
  assert.throws(() => normalizeOrchestratorUrl("file:///tmp/socket"), /http or https/);
});
