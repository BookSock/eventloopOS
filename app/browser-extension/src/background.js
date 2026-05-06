import { createExtensionController } from "./extension-controller.js";
import { createChromeNativeBridge } from "./native-bridge.js";

const controller = createExtensionController({
  chromeApi: chrome,
  nativeBridge: createChromeNativeBridge(chrome)
});

chrome.action?.onClicked?.addListener(async () => {
  await controller.captureActiveTab();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "eventloop.captureActiveTab") {
    controller.captureActiveTab().then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.type === "eventloop.restore") {
    controller.restore(message.resource).then(sendResponse);
    return true;
  }

  return false;
});
