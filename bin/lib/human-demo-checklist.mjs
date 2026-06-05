export const humanDemoPassFailLabels = Object.freeze([
  "Starting state on demo-customer with Queue visible",
  "Ctrl-Option-R restores Customer paper",
  "Moving shared TextEdit is remembered after 2-3 seconds",
  "Automated new scratch window is remembered by current paper",
  "Metrics paper brings same TextEdit to metrics position",
  "Customer paper brings same TextEdit back to customer position",
  "Background window containment proof passed",
  "Paper briefing strip shows current decision",
  "Rectangle hotkeys feel usable",
  "Manual Mode entry/return works",
  "Queue footer feedback is visible and current",
  "Queue/master latency readiness gate passed",
  "Workspace capture/restore-plan latency readiness gate passed",
  "Hotkey feedback latency readiness gate passed or skipped intentionally",
]);

export function renderHumanDemoPassFailTemplate() {
  return humanDemoPassFailLabels.map((label) => `- ${label}:`).join("\n");
}

export function renderFilledHumanDemoPassFail(value = "pass") {
  return humanDemoPassFailLabels.map((label) => `- ${label}: ${value}`).join("\n");
}
