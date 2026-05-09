import { createExtensionConfig } from "./extension-config.js";
import { activeTabCaptureStatusMessage, mergeProviderPresetOrigins, routeHintsFromInputs, tabRegistryCaptureStatusMessage } from "./options-helpers.js";

const config = createExtensionConfig({ storageArea: chrome.storage?.local });

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#config-form");
  const input = document.querySelector("#orchestrator-url");
  const allowedOriginsInput = document.querySelector("#allowed-origins");
  const taskHintInput = document.querySelector("#task-hint");
  const projectHintInput = document.querySelector("#project-hint");
  const captureActiveTabButton = document.querySelector("#capture-active-tab");
  const captureTabsButton = document.querySelector("#capture-tab-registry");
  const applyPresetsButton = document.querySelector("#apply-provider-presets");
  const status = document.querySelector("#status");

  try {
    const current = await config.get();
    input.value = current.orchestratorUrl;
    allowedOriginsInput.value = current.allowedOrigins.join("\n");
  } catch (error) {
    setStatus(status, "error", error.message);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const next = await config.set({ orchestratorUrl: input.value, allowedOrigins: allowedOriginsInput.value });
      input.value = next.orchestratorUrl;
      allowedOriginsInput.value = next.allowedOrigins.join("\n");
      setStatus(status, "saved", "Saved");
    } catch (error) {
      setStatus(status, "error", error.message);
    }
  });

  captureActiveTabButton.addEventListener("click", async () => {
    try {
      setStatus(status, "pending", "Capturing current tab...");
      const response = await chrome.runtime.sendMessage({
        type: "eventloop.captureActiveTab",
        route_hints: routeHintsFromInputs(taskHintInput, projectHintInput)
      });
      if (response?.ok === false) {
        throw new Error(response.error?.message ?? response.error ?? "active tab capture failed");
      }
      setStatus(status, response?.skipped ? "error" : "saved", activeTabCaptureStatusMessage(response));
    } catch (error) {
      setStatus(status, "error", error.message);
    }
  });

  applyPresetsButton.addEventListener("click", () => {
    try {
      const merged = mergeProviderPresetOrigins(allowedOriginsInput.value);
      allowedOriginsInput.value = merged.value;
      const newCount = merged.added.length;
      setStatus(
        status,
        newCount === 0 ? "saved" : "pending",
        newCount === 0
          ? "Provider presets already present"
          : `Added ${newCount} provider preset${newCount === 1 ? "" : "s"} — press Save to apply.`
      );
    } catch (error) {
      setStatus(status, "error", error.message);
    }
  });

  captureTabsButton.addEventListener("click", async () => {
    try {
      setStatus(status, "pending", "Capturing allowed tabs...");
      const response = await chrome.runtime.sendMessage({
        type: "eventloop.captureTabRegistry",
        route_hints: routeHintsFromInputs(taskHintInput, projectHintInput)
      });
      if (response?.ok === false) {
        throw new Error(response.error?.message ?? response.error ?? "tab registry capture failed");
      }
      setStatus(
        status,
        response?.failed_count > 0 ? "error" : "saved",
        tabRegistryCaptureStatusMessage(response)
      );
    } catch (error) {
      setStatus(status, "error", error.message);
    }
  });
});

function setStatus(element, state, message) {
  element.dataset.state = state;
  element.textContent = message;
}
