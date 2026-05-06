import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";

describe("orchestrator config schema", () => {
  it("accepts default config", () => {
    const result = loadConfig({});

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.host, "127.0.0.1");
      assert.equal(result.value.port, 4377);
      assert.equal(result.value.databaseUrl, undefined);
      assert.equal(result.value.taskSessions, "fake");
      assert.equal(result.value.mcpSources, "seeded");
      assert.equal(result.value.workspace, "aerospace");
      assert.equal(result.value.workspaceExecute, "disabled");
    }
  });

  it("accepts DATABASE_URL for persistent Postgres mode", () => {
    const result = loadConfig({
      DATABASE_URL: "postgres://eventloop:test@127.0.0.1:5432/eventloop",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.databaseUrl, "postgres://eventloop:test@127.0.0.1:5432/eventloop");
    }
  });

  it("rejects malformed port", () => {
    const result = loadConfig({
      ORCHESTRATOR_PORT: "not-a-port",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues, ["ORCHESTRATOR_PORT must be an integer between 1 and 65535"]);
    }
  });

  it("allows task sessions to be disabled", () => {
    const result = loadConfig({
      ORCHESTRATOR_TASK_SESSIONS: "off",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.taskSessions, "off");
    }
  });

  it("allows Codex app-server task sessions with optional task map", () => {
    const result = loadConfig({
      ORCHESTRATOR_TASK_SESSIONS: "codex_app_server",
      ORCHESTRATOR_CODEX_TASK_MAP: JSON.stringify({
        thread_blog: "task_blog_feedback",
      }),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.taskSessions, "codex_app_server");
      assert.deepEqual(result.value.codexTaskMap, { thread_blog: "task_blog_feedback" });
    }
  });

  it("rejects malformed Codex task map JSON", () => {
    const result = loadConfig({
      ORCHESTRATOR_CODEX_TASK_MAP: "{bad json",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues, ["ORCHESTRATOR_CODEX_TASK_MAP must be valid JSON"]);
    }
  });

  it("accepts MCP source config path", () => {
    const result = loadConfig({
      ORCHESTRATOR_MCP_SOURCES_PATH: "config/mcp-sources.json",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.mcpSources, "config");
      assert.equal(result.value.mcpSourcesPath, "config/mcp-sources.json");
    }
  });

  it("allows MCP sources to be disabled", () => {
    const result = loadConfig({
      ORCHESTRATOR_MCP_SOURCES: "off",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.mcpSources, "off");
    }
  });

  it("rejects config MCP source mode without path", () => {
    const result = loadConfig({
      ORCHESTRATOR_MCP_SOURCES: "config",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues, ["ORCHESTRATOR_MCP_SOURCES_PATH must be set when ORCHESTRATOR_MCP_SOURCES=config"]);
    }
  });

  it("rejects unknown task session mode", () => {
    const result = loadConfig({
      ORCHESTRATOR_TASK_SESSIONS: "terminal",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues, ["ORCHESTRATOR_TASK_SESSIONS must be fake, codex_app_server, or off"]);
    }
  });

  it("allows workspace controller to be disabled", () => {
    const result = loadConfig({
      ORCHESTRATOR_WORKSPACE: "off",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.workspace, "off");
    }
  });

  it("rejects unknown workspace controller mode", () => {
    const result = loadConfig({
      ORCHESTRATOR_WORKSPACE: "spaces",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues, ["ORCHESTRATOR_WORKSPACE must be aerospace or off"]);
    }
  });

  it("allows workspace restore execution to be explicitly enabled", () => {
    const result = loadConfig({
      ORCHESTRATOR_WORKSPACE_EXECUTE: "enabled",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.workspaceExecute, "enabled");
    }
  });

  it("rejects unknown workspace execution mode", () => {
    const result = loadConfig({
      ORCHESTRATOR_WORKSPACE_EXECUTE: "maybe",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues, ["ORCHESTRATOR_WORKSPACE_EXECUTE must be disabled or enabled"]);
    }
  });
});
