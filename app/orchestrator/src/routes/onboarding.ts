import { buildOnboardingScan } from "../onboarding/task_grouping.js";
import type { TaskSessionController } from "../task_sessions/types.js";
import type { WorkspaceController } from "../workspace/controller.js";
import type { RouteResult } from "./types.js";

export async function handleOnboardingRoute(input: {
  method: string | undefined;
  pathname: string;
  workspace?: WorkspaceController;
  taskSessions?: TaskSessionController;
  now: Date;
  requestId: string;
}): Promise<RouteResult | undefined> {
  if (input.method !== "GET" || input.pathname !== "/onboarding/scan") {
    return undefined;
  }

  const warnings: string[] = [];
  let snapshot;
  if (input.workspace) {
    try {
      snapshot = await input.workspace.capture();
    } catch (error) {
      warnings.push(`workspace capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!input.workspace) {
    warnings.push("workspace controller is not configured");
  }

  const taskSessions = input.taskSessions?.listSessions ? await Promise.resolve(input.taskSessions.listSessions()).catch((error) => {
    warnings.push(`task session listing failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }) : [];
  if (!input.taskSessions?.listSessions) {
    warnings.push("task session listing is not configured");
  }

  return {
    ok: true,
    status: 200,
    body: {
      ...buildOnboardingScan({
        snapshot,
        taskSessions,
        capturedAt: input.now.toISOString(),
        warnings,
      }),
      request_id: input.requestId,
    },
  };
}
