import Foundation

public struct QueueMenuSummary: Equatable, Sendable {
    public let title: String
    public let subtitle: String
    public let modeLabel: String
    public let restoreLabel: String?

    public init(
        packets: [ReviewPacket],
        selectedPacket: ReviewPacket?,
        queueState: QueueState,
        mode: EventLoopMode,
        contextRestoreState: ContextRestoreState
    ) {
        self.modeLabel = mode == .manual ? "Manual Mode" : "Event Loop"

        switch queueState {
        case .loading:
            title = "Loading queue"
        case let .failed(message):
            title = "Queue error"
            subtitle = message
            restoreLabel = Self.restoreLabel(contextRestoreState)
            return
        case .idle, .loaded:
            if packets.isEmpty {
                title = "No queued work"
            } else if packets.count == 1 {
                title = "1 queued item"
            } else {
                title = "\(packets.count) queued items"
            }
        }

        subtitle = selectedPacket?.title ?? "No selection"
        restoreLabel = Self.restoreLabel(contextRestoreState)
    }

    private static func restoreLabel(_ state: ContextRestoreState) -> String? {
        switch state {
        case .idle:
            return nil
        case let .planning(resource):
            return "Planning restore: \(resource.title)"
        case let .planned(resource, _):
            return "Restore ready: \(resource.title)"
        case let .requested(resource, request):
            return request.status == "done" ? "Restore done: \(resource.title)" : "Restore \(request.status): \(resource.title)"
        case let .failed(resource, _):
            return "Restore failed: \(resource.title)"
        }
    }
}
