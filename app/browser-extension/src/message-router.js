export function handleRuntimeMessage(controller, message, sendResponse) {
  if (message?.type === "eventloop.captureActiveTab") {
    controller.captureActiveTab(message.route_hints).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.type === "eventloop.restore") {
    controller.restore(message.resource).then(sendResponse);
    return true;
  }

  return false;
}
