# Codex App Server Protocol Notes

Generated locally from installed Codex CLI on 2026-05-06:

```sh
codex app-server generate-ts --experimental --out external-resources/codex-app-server-protocol
```

Useful current protocol methods:

- `thread/list`: discover native Codex threads.
- `thread/read`: fetch thread details and turns.
- `turn/start`: send follow-up input to an existing thread.
- `thread/inject_items`: append raw Responses API items to a thread history.

Current CLI help also exposes:

```sh
codex app-server --listen stdio://|unix://|ws://IP:PORT|off
codex app-server proxy --sock <SOCKET_PATH>
```

MVP implication: orchestrator should keep a narrow `CodexNativeThreadClient` seam, then add a transport adapter for `thread/list`, `thread/read`, and `turn/start` instead of binding queue routing directly to Codex protocol details.

Implemented adapter seam:

- `app/orchestrator/src/task_sessions/codex_native_thread_controller.ts` maps native threads to task sessions.
- `app/orchestrator/src/task_sessions/codex_app_server_thread_client.ts` maps app-server request/response shapes into that native thread client.
- Thread-to-task routing can use hot-loaded `ORCHESTRATOR_CODEX_TASK_MAP_PATH`, `PUT /task-sessions/:id/task-binding`, inline `ORCHESTRATOR_CODEX_TASK_MAP`, or a thread title/preview marker like `[task:blog feedback]`.

Transport status:

- `app/orchestrator/src/task_sessions/codex_app_server_stdio.ts` implements newline-delimited JSON RPC over `codex app-server --listen stdio://`.
- `ORCHESTRATOR_TASK_SESSIONS=codex_app_server` wires this into daemon `/task-sessions`.
