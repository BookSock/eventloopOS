import { createExtensionConfig } from "./extension-config.js";

const config = createExtensionConfig({ storageArea: chrome.storage?.local });

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#config-form");
  const input = document.querySelector("#orchestrator-url");
  const status = document.querySelector("#status");

  try {
    const current = await config.get();
    input.value = current.orchestratorUrl;
  } catch (error) {
    setStatus(status, "error", error.message);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const next = await config.set({ orchestratorUrl: input.value });
      input.value = next.orchestratorUrl;
      setStatus(status, "saved", "Saved");
    } catch (error) {
      setStatus(status, "error", error.message);
    }
  });
});

function setStatus(element, state, message) {
  element.dataset.state = state;
  element.textContent = message;
}
