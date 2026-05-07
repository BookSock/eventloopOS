export const RESTORE_REQUEST_ALARM = "eventloop.restoreRequests.poll";
export const DEFAULT_ORCHESTRATOR_URL = "http://127.0.0.1:4377";

export function createRestoreRequestPoller({
  controller,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  orchestratorUrl = DEFAULT_ORCHESTRATOR_URL
}) {
  if (!controller?.restore) {
    throw new Error("controller.restore is required");
  }
  if (!fetchImpl) {
    throw new Error("fetch implementation is required");
  }

  const baseUrl = orchestratorUrl.replace(/\/+$/, "");

  async function pollOnce() {
    const next = await fetchJson(fetchImpl, `${baseUrl}/contexts/restore-requests/next`);
    const restoreRequest = next.restore_request;
    if (!restoreRequest) {
      return { ok: true, restored: false };
    }

    const message = restoreRequest.restore_plan?.message;
    let result;
    if (message?.type === "eventloop.restore" && message.resource) {
      try {
        result = await controller.restore(message.resource);
      } catch (error) {
        result = {
          ok: false,
          error: {
            code: "restore_failed",
            message: error.message
          }
        };
      }
    } else {
      result = {
        ok: false,
        error: {
          code: "unsupported_restore_request",
          message: "restore request missing eventloop.restore message"
        }
      };
    }

    await fetchJson(fetchImpl, `${baseUrl}/contexts/restore-requests/${encodeURIComponent(restoreRequest.id)}/done`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ result })
    });

    return {
      ok: result?.ok !== false,
      restored: true,
      restoreRequestId: restoreRequest.id,
      result
    };
  }

  return { pollOnce };
}

export async function ensureRestorePollAlarm(alarmsApi, options = {}) {
  if (!alarmsApi?.get || !alarmsApi?.create) {
    return false;
  }

  const name = options.name ?? RESTORE_REQUEST_ALARM;
  const periodInMinutes = options.periodInMinutes ?? 0.5;
  const existing = await alarmsApi.get(name);
  if (!existing) {
    await alarmsApi.create(name, { periodInMinutes });
  }
  return true;
}

async function fetchJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const body = await response.json();
  if (!response.ok) {
    const message = body?.error?.message ?? `request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}
