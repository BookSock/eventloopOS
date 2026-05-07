import { createExtensionController } from "./extension-controller.js";
import { handleRuntimeMessage } from "./message-router.js";
import { createChromeNativeBridge } from "./native-bridge.js";
import { createRestoreRequestPoller, ensureRestorePollAlarm, RESTORE_REQUEST_ALARM } from "./restore-request-poller.js";

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

const restoreRequestPoller = createRestoreRequestPoller({ controller });

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === RESTORE_REQUEST_ALARM) {
    restoreRequestPoller.pollOnce();
  }
});

ensureRestorePollAlarm(chrome.alarms).catch((error) => {
  console.warn("eventloopOS restore poll alarm setup failed", error);
});
