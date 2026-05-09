export function handleRuntimeMessage(controller, message, sendResponse, options = {}) {
  if (message?.type === "eventloop.captureActiveTab") {
    controller.captureActiveTab(message.route_hints).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.type === "eventloop.captureTabRegistry") {
    controller.captureTabRegistry(message.route_hints).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.type === "eventloop.restore") {
    controller.restore(message.resource).then(sendResponse);
    return true;
  }

  if (message?.type === "eventloop.getConfig") {
    options.configStore.get().then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.type === "eventloop.setConfig") {
    options.configStore.set(message.config).then(sendResponse, (config) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  return false;
}
