import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayStore } from "./gateway_store.js";
import type { Observability } from "./observability.js";
import { createRuntime } from "./runtime.js";
import type { WorkspaceController } from "./workspace/controller.js";

describe("runtime spine", () => {
  it("preserves injected primitives in a frozen flat record", () => {
    const store = {} as GatewayStore;
    const observability = {} as Observability;
    const workspace = {} as WorkspaceController;
    const now = () => new Date("2026-06-04T12:00:00.000Z");

    const runtime = createRuntime({
      store,
      observability,
      workspace,
      workspaceExecuteEnabled: false,
      terminalSendEnabled: true,
      codexHome: "/tmp/codex-home",
      now,
    });

    assert.equal(Object.isFrozen(runtime), true);
    assert.equal(runtime.store, store);
    assert.equal(runtime.observability, observability);
    assert.equal(runtime.workspace, workspace);
    assert.equal(runtime.workspaceExecuteEnabled, false);
    assert.equal(runtime.terminalSendEnabled, true);
    assert.equal(runtime.codexHome, "/tmp/codex-home");
    assert.equal(runtime.now, now);
    assert.deepEqual(runtime.now(), new Date("2026-06-04T12:00:00.000Z"));
  });

  it("uses a default clock when none is injected", () => {
    const runtime = createRuntime({
      store: {} as GatewayStore,
      observability: {} as Observability,
    });

    assert.ok(runtime.now() instanceof Date);
  });
});
