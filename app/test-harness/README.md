# Test Harness

Deterministic scenario runner for MVP proof loops.

Scripts exposed for root `Makefile` wiring:

```bash
app/test-harness/bin/run-scenario seeded_queue
app/test-harness/bin/run-scenario mcp_poll_route_done
app/test-harness/bin/run-scenario mcp_source_poll_route_done
app/test-harness/bin/run-scenario generic_mcp_source_poll_route_done
app/test-harness/bin/run-scenario mcp_poll_all_route_done
app/test-harness/bin/run-scenario browser_context_store_only
app/test-harness/bin/run-scenario browser_context_ranked_search
app/test-harness/bin/self-test
```

`run-scenario` defaults to fixture mode so the harness passes before the orchestrator exists. To test a running orchestrator:

```bash
app/test-harness/bin/run-scenario seeded_queue --orchestrator-url http://127.0.0.1:3000
app/test-harness/bin/run-scenario mcp_poll_route_done --orchestrator-url http://127.0.0.1:3000
app/test-harness/bin/run-scenario generic_mcp_source_poll_route_done --orchestrator-url http://127.0.0.1:3000
app/test-harness/bin/run-scenario mcp_poll_all_route_done --orchestrator-url http://127.0.0.1:3000
app/test-harness/bin/run-scenario browser_context_store_only --orchestrator-url http://127.0.0.1:3000
app/test-harness/bin/run-scenario browser_context_ranked_search --orchestrator-url http://127.0.0.1:3000
```

Artifacts default to `artifacts/test-harness/<scenario>/` and include:

- `scenario-log.json`
- `observed.json`
- `summary.json` on pass
