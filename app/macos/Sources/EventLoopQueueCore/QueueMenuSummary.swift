import Foundation

public struct QueueMenuSummary: Equatable, Sendable {
    public let title: String
    public let subtitle: String
    public let modeLabel: String
    public let restoreLabel: String?
    public let workspaceRestoreLabel: String?
    public let manualWorkspaceLabel: String?
    public let recommendedActionBlockReason: String?

    public init(
        packets: [ReviewPacket],
        selectedPacket: ReviewPacket?,
        queueState: QueueState,
        mode: EventLoopMode,
        contextRestoreState: ContextRestoreState,
        workspaceRestoreState: WorkspaceRestoreState = .idle,
        manualWorkspaceCaptureState: ManualWorkspaceCaptureState = .idle,
        recommendedActionBlockReason: String? = nil
    ) {
        self.modeLabel = mode == .manual ? "Manual Mode" : "Event Loop"
        self.recommendedActionBlockReason = recommendedActionBlockReason

        switch queueState {
        case .loading:
            title = "Loading queue"
        case let .failed(message):
            title = "Queue error"
            subtitle = message
            restoreLabel = Self.restoreLabel(contextRestoreState)
            workspaceRestoreLabel = Self.workspaceRestoreLabel(workspaceRestoreState)
            manualWorkspaceLabel = Self.manualWorkspaceLabel(manualWorkspaceCaptureState)
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
        workspaceRestoreLabel = Self.workspaceRestoreLabel(workspaceRestoreState)
        manualWorkspaceLabel = Self.manualWorkspaceLabel(manualWorkspaceCaptureState)
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

    private static func workspaceRestoreLabel(_ state: WorkspaceRestoreState) -> String? {
        switch state {
        case .idle:
            return nil
        case .skippedManualMode:
            return "Workspace restore paused"
        case let .planned(plan):
            return "Workspace plan: \(plan.commands.count) commands"
        case let .executed(receipt):
            return "Workspace restored: \(receipt.commands.count) commands"
        case let .savedTaskLayout(taskId):
            return "Task layout saved: \(taskId)"
        case .keptCurrentLayout:
            return "Returned without moving windows"
        case .failed:
            return "Workspace restore failed"
        }
    }

    private static func manualWorkspaceLabel(_ state: ManualWorkspaceCaptureState) -> String? {
        switch state {
        case .idle:
            return nil
        case .capturing:
            return "Capturing manual workspace"
        case let .captured(snapshot):
            return "Manual workspace saved: \(snapshot.windows.count) windows"
        case .failed:
            return "Manual workspace capture failed"
        }
    }
}
