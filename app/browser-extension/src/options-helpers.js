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
