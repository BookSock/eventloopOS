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

public struct TaskSessionTargetPresentation: Equatable, Sendable {
    public let title: String
    public let subtitle: String
    public let detail: String?
    public let provider: String
    public let status: String
    public let sessionId: String
    public let identityLabel: String

    public init(session: TaskSession) {
        let displayName = session.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = displayName?.isEmpty == false ? displayName! : session.id
        self.provider = taskSessionProviderLabel(session.provider)
        self.status = taskSessionStatusLabel(session.status)
        self.sessionId = session.id
        self.subtitle = "\(provider) | \(status) | \(session.id)"
        self.identityLabel = [
            session.taskId,
            "\(provider) \(status)",
            session.id,
        ]
            .compactMap { value in
                let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed?.isEmpty == false ? trimmed : nil
            }
            .joined(separator: " | ")

        let preview = session.preview?.trimmingCharacters(in: .whitespacesAndNewlines)
        let cwd = session.cwd?.trimmingCharacters(in: .whitespacesAndNewlines)
        if preview?.isEmpty == false {
            self.detail = preview
        } else if cwd?.isEmpty == false {
            self.detail = cwd
        } else {
            self.detail = nil
        }
    }
}

public struct QueuePacketIdentityPresentation: Equatable, Sendable {
    public let packetId: String
    public let taskId: String?
    public let taskLabel: String
    public let workspaceLabel: String?
    public let sendBackLabel: String?

    public init(packet: ReviewPacket, selectedTaskSessions: [TaskSession] = []) {
        packetId = packet.reviewPacketId
        taskId = packet.taskId
        taskLabel = packet.taskId ?? "No task linked"

        if let snapshot = packet.workspaceSnapshot {
            let workspace = snapshot.activeWorkspace?.trimmingCharacters(in: .whitespacesAndNewlines)
            let workspaceName = workspace?.isEmpty == false ? workspace! : "captured workspace"
            workspaceLabel = "\(workspaceName) | \(snapshot.windows.count) windows"
        } else {
            workspaceLabel = nil
        }

        if let session = selectedTaskSessions.first {
            sendBackLabel = TaskSessionTargetPresentation(session: session).identityLabel
        } else if let taskId = packet.taskId {
            sendBackLabel = "Waiting for bound session | \(taskId)"
        } else {
            sendBackLabel = nil
        }
    }
}

private func taskSessionProviderLabel(_ provider: String) -> String {
    switch provider.lowercased() {
    case "codex":
        return "Codex"
    case "claude":
        return "Claude Code"
    case "fake":
        return "Fake"
    case "terminal":
        return "Terminal"
    case "composite":
        return "Composite"
    default:
        return provider.isEmpty ? "Agent" : provider
    }
}

private func taskSessionStatusLabel(_ status: String) -> String {
    status
        .split(separator: "_")
        .map { part in
            part.prefix(1).uppercased() + part.dropFirst().lowercased()
        }
        .joined(separator: " ")
}
