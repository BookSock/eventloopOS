# Workspace Backend Adapter Guide

eventloopOS can use a replaceable workspace backend through the
`WorkspaceController` interface in `app/orchestrator/src/workspace/controller.ts`.
This is the seam for people who want the OS/window-control primitive without
taking the whole queue app.

Current limitation: the public HTTP snapshot schema is still
`backend: "aerospace"`. A non-AeroSpace backend can be used today, but it must
emit AeroSpace-compatible `WorkspaceSnapshot` objects and restore plans until
the schema is generalized.

## Contract

```ts
export type WorkspaceController = {
  status(): Promise<WorkspaceCapabilityStatus> | WorkspaceCapabilityStatus;
  capture(): Promise<WorkspaceSnapshot> | WorkspaceSnapshot;
  planRestore(snapshot: WorkspaceSnapshot, currentWindows?: AerospaceWindow[]): Promise<RestorePlan> | RestorePlan;
  executeRestorePlan?(plan: RestorePlan): Promise<RestoreExecutionReceipt> | RestoreExecutionReceipt;
};
```

Minimum backend behavior:

- `status()` reports availability without mutating the desktop.
- `capture()` returns the currently known windows, active workspace, and focused
  window if known.
- `planRestore()` returns a deterministic side-effect-free plan.
- `executeRestorePlan()` is optional. If absent, `/workspace/restore` remains
  unavailable even when `/workspace/restore-plan` works.

## Snapshot Shape

Today a compatible snapshot looks like:

```json
{
  "backend": "aerospace",
  "activeWorkspace": "paper-a",
  "focusedWindowId": 42,
  "windows": [
    {
      "id": 42,
      "app": "TextEdit",
      "appBundleId": "com.apple.TextEdit",
      "title": "Shared Note",
      "workspace": "paper-a",
      "monitorId": 1,
      "layout": "floating",
      "frame": { "x": 20, "y": 40, "width": 600, "height": 420 }
    }
  ]
}
```

Required fields per window:

- `id`
- `app`
- `title`
- `workspace`

Recommended fields:

- `appBundleId` for stable identity across localized app names
- `monitorId` for multi-monitor restore
- `layout` when the backend can express floating/tiling state
- `frame` when exact geometry restore is supported

## Fake Backend Example

```ts
import type { WorkspaceController } from "./workspace/controller.js";
import type { RestorePlan, WorkspaceSnapshot } from "./workspace/aerospace.js";
import { restoreWorkspacePlan } from "./workspace/aerospace.js";

class FakeWorkspaceController implements WorkspaceController {
  private snapshot: WorkspaceSnapshot = {
    backend: "aerospace",
    activeWorkspace: "fake-main",
    focusedWindowId: 101,
    windows: [
      {
        id: 101,
        app: "FakeApp",
        appBundleId: "dev.example.fake",
        title: "Fake Docs",
        workspace: "fake-main",
        layout: "floating",
        frame: { x: 20, y: 30, width: 640, height: 480 }
      }
    ]
  };

  status() {
    return {
      available: true,
      backend: "aerospace" as const,
      detail: "fake backend emitting AeroSpace-compatible snapshots",
      monitorCount: 1
    };
  }

  capture() {
    return this.snapshot;
  }

  planRestore(snapshot: WorkspaceSnapshot, currentWindows = this.snapshot.windows) {
    return restoreWorkspacePlan(snapshot, currentWindows);
  }

  executeRestorePlan(plan: RestorePlan) {
    return {
      commands: plan.commands.map((command) => ({ ...command, stdout: "ok\n", stderr: "" })),
      skipped: plan.skipped
    };
  }
}
```

## Server Wiring

Inject the backend through `createGatewayServer`:

```ts
const server = createGatewayServer({
  store,
  workspace: new FakeWorkspaceController(),
  workspaceExecuteEnabled: true,
  observability
});
```

Routes that now work:

- `GET /workspace/status`
- `POST /workspace/capture`
- `POST /workspace/restore-plan`
- `POST /workspace/restore` when `workspaceExecuteEnabled` is true and
  `executeRestorePlan` exists

## Safety Requirements

Adapters should keep these invariants:

- Planning must not mutate the OS.
- Execution must only execute commands created by the planner.
- Stale/missing windows should be skipped, not fatal.
- Restore should move windows before focusing the final workspace/window.
- Geometry restore should require stable identity, not only a title.

## Proof

`app/orchestrator/src/workspace/controller.test.ts` includes a fake backend
that drives the real HTTP workspace routes end to end. Run:

```sh
pnpm --dir app/orchestrator test
```

The test proves a non-default backend can satisfy the current controller
contract while making the remaining schema limitation explicit.
