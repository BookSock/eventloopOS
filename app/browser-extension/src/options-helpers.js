export function routeHintsFromInputs(taskHintInput, projectHintInput) {
  return Object.fromEntries(
    [
      ["task_hint", taskHintInput?.value],
      ["project_hint", projectHintInput?.value]
    ]
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""])
      .filter(([, value]) => value.length > 0)
  );
}

export function activeTabCaptureStatusMessage(response) {
  if (response?.skipped) {
    return "Current tab skipped";
  }
  const title = response?.resource?.title ?? response?.resource?.url ?? response?.resource?.id ?? "current tab";
  return `Captured current tab: ${title}`;
}

export function tabRegistryCaptureStatusMessage(response) {
  return `Captured ${response?.captured_count ?? 0}/${response?.attempted_count ?? 0} tabs; failed ${response?.failed_count ?? 0}; skipped ${response?.skipped_count ?? 0}`;
}

export const PROVIDER_PRESET_ORIGINS = [
  "https://*.slack.com/*",
  "https://app.slack.com/*",
  "https://mail.google.com/*",
  "https://docs.google.com/*",
  "https://www.notion.so/*",
  "https://*.notion.site/*",
  "https://github.com/*",
  "https://linear.app/*",
];

export function mergeProviderPresetOrigins(textValue) {
  const lines = (textValue ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const seen = new Set(lines);
  const added = [];
  for (const preset of PROVIDER_PRESET_ORIGINS) {
    if (!seen.has(preset)) {
      lines.push(preset);
      seen.add(preset);
      added.push(preset);
    }
  }
  return {
    value: lines.join("\n"),
    added,
  };
}
