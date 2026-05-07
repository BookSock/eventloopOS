import Foundation

public struct QueueWindowSidebarSummary: Equatable, Sendable {
    public let title: String
    public let subtitle: String
    public let systemImage: String
    public let showsProgress: Bool
    public let showsRetry: Bool
    public let showsPlaceholder: Bool

    public init(packets: [ReviewPacket], state: QueueState) {
        switch state {
        case .loading:
            title = "Loading queue"
            subtitle = packets.isEmpty ? "Waiting for orchestrator." : "Refreshing current work."
            systemImage = "arrow.clockwise"
            showsProgress = true
            showsRetry = false
            showsPlaceholder = packets.isEmpty
        case let .failed(message):
            title = "Queue unavailable"
            subtitle = message
            systemImage = "exclamationmark.triangle"
            showsProgress = false
            showsRetry = true
            showsPlaceholder = packets.isEmpty
        case .idle, .loaded:
            if packets.isEmpty {
                title = "No queued work"
                subtitle = "No human review needed right now."
                systemImage = "tray"
                showsProgress = false
                showsRetry = true
                showsPlaceholder = true
            } else {
                title = "\(packets.count) queued"
                subtitle = "Pick item or use Done / Next."
                systemImage = "list.bullet.rectangle"
                showsProgress = false
                showsRetry = false
                showsPlaceholder = false
            }
        }
    }
}

public struct QueueWindowDetailSummary: Equatable, Sendable {
    public let title: String
    public let subtitle: String
    public let systemImage: String
    public let showsProgress: Bool
    public let showsRetry: Bool

    public init(selectedPacket: ReviewPacket?, packets: [ReviewPacket], state: QueueState) {
        if let selectedPacket {
            title = selectedPacket.title
            subtitle = selectedPacket.summary
            systemImage = "checklist"
            showsProgress = false
            showsRetry = false
            return
        }

        switch state {
        case .loading:
            title = "Loading queue"
            subtitle = "Waiting for next human-blocked item."
            systemImage = "arrow.clockwise"
            showsProgress = true
            showsRetry = false
        case let .failed(message):
            title = "Queue unavailable"
            subtitle = message
            systemImage = "exclamationmark.triangle"
            showsProgress = false
            showsRetry = true
        case .idle, .loaded:
            if packets.isEmpty {
                title = "No human review needed"
                subtitle = "Agents can keep working in background."
                systemImage = "tray"
                showsProgress = false
                showsRetry = true
            } else {
                title = "No item selected"
                subtitle = "Select item from queue."
                systemImage = "list.bullet"
                showsProgress = false
                showsRetry = false
            }
        }
    }
}
