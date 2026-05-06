import { createExtensionController } from "./extension-controller.js";
import { handleRuntimeMessage } from "./message-router.js";
import { createChromeNativeBridge } from "./native-bridge.js";

const controller = createExtensionController({
  chromeApi: chrome,
  nativeBridge: createChromeNativeBridge(chrome)
});

chrome.action?.onClicked?.addListener(async () => {
  await controller.captureActiveTab();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
  handleRuntimeMessage(controller, message, sendResponse)
);
