import Foundation

public enum ActivityChipKind: String, CaseIterable, Identifiable, Sendable {
    case all
    case send
    case restore
    case deferOrSkip
    case errors

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: return "All"
        case .send: return "Send"
        case .restore: return "Restore"
        case .deferOrSkip: return "Defer"
        case .errors: return "Errors"
        }
    }

    public var accessibilityIdentifier: String {
        "activity-chip-\(rawValue)"
    }

    public func matches(eventType: String) -> Bool {
        switch self {
        case .all:
            return true
        case .send:
            return ActivityChipKind.sendTypes.contains(eventType)
        case .restore:
            return ActivityChipKind.restoreTypes.contains(eventType)
        case .deferOrSkip:
            return ActivityChipKind.deferTypes.contains(eventType)
        case .errors:
            return ActivityChipKind.errorTypes.contains(eventType)
        }
    }

    private static let sendTypes: Set<String> = [
        "master_fan_out",
        "task_followup_attempted",
        "task_followup_sent",
        "voice_fan_out_detected",
        "voice_rerank",
        "terminal_keystroke_attempted",
    ]

    private static let restoreTypes: Set<String> = [
        "reading_queue_promoted",
        "reading_queue_auto_promoted",
        "onboarding_task_approved",
    ]

    private static let deferTypes: Set<String> = [
        "queue_item_deferred",
        "queue_item_ignored",
        "queue_item_priority_bumped",
    ]

    private static let errorTypes: Set<String> = [
        "task_followup_failed",
        "task_followup_blocked",
        "voice_rerank_no_match",
    ]
}

public func filterActivity(
    _ events: [ActivityEvent],
    chip: ActivityChipKind?,
    search: String
) -> [ActivityEvent] {
    let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
    let activeChip = chip ?? .all
    return events.filter { event in
        guard activeChip.matches(eventType: event.type) else { return false }
        if trimmed.isEmpty { return true }
        if event.summary.localizedCaseInsensitiveContains(trimmed) { return true }
        if event.type.localizedCaseInsensitiveContains(trimmed) { return true }
        if event.actor.localizedCaseInsensitiveContains(trimmed) { return true }
        if let taskId = event.taskId, taskId.localizedCaseInsensitiveContains(trimmed) { return true }
        if let sourceId = event.sourceId, sourceId.localizedCaseInsensitiveContains(trimmed) { return true }
        return false
    }
}
