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
            subtitle = actionableQueueFailureMessage(message)
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
            subtitle = actionableQueueFailureMessage(message)
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
    public let terminalLabel: String?

    public init(session: TaskSession) {
        let displayName = session.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = displayName?.isEmpty == false ? displayName! : session.id
        self.provider = taskSessionProviderLabel(session.provider)
        self.status = taskSessionStatusLabel(session.status)
        self.sessionId = session.id
        self.subtitle = "\(provider) | \(status) | \(session.id)"
        self.terminalLabel = TaskSessionTargetPresentation.terminalLabel(for: session.terminalRef)
        self.identityLabel = [
            session.taskId,
            "\(provider) \(status)",
            session.id,
            terminalLabel,
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

    private static func terminalLabel(for terminalRef: String?) -> String? {
        guard let trimmed = terminalRef?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        let lowered = trimmed.lowercased()
        if lowered == "ghostty:front" {
            return "Ghostty (front window)"
        }
        if lowered.hasPrefix("ghostty:") {
            return "Ghostty terminal \(trimmed.dropFirst("ghostty:".count))"
        }
        if lowered.hasPrefix("tmux:") {
            return "tmux pane \(trimmed.dropFirst("tmux:".count))"
        }
        if lowered.hasPrefix("kitty:") {
            return "Kitty terminal \(trimmed.dropFirst("kitty:".count))"
        }
        if lowered.hasPrefix("wezterm:") {
            return "WezTerm pane \(trimmed.dropFirst("wezterm:".count))"
        }
        return trimmed
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

public func actionableQueueFailureMessage(_ message: String) -> String {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    let detail = trimmed.isEmpty ? "No error detail." : trimmed
    let lowered = detail.lowercased()

    if lowered.contains("client/server versions don't match")
        || lowered.contains("server restart is required after each update")
        || lowered.contains("corrupted installation")
        || lowered.contains("cli/app hashes") {
        return "AeroSpace version mismatch. Restart AeroSpace, then refresh. If it still fails, reinstall AeroSpace so the CLI and app bundle match. Detail: \(detail)"
    }

    if lowered.contains("launchservices_server_ready=false")
        || lowered.contains("launchservices")
        || lowered.contains("direct binary launch")
        || lowered.contains("open -a aerospace") {
        return "AeroSpace launch needs approval. Run pnpm setup:prompt, re-grant AeroSpace Accessibility, open AeroSpace normally, then refresh. Detail: \(detail)"
    }

    if lowered.contains("aerospace") || lowered.contains("workspace restore") {
        return "AeroSpace unavailable. Launch AeroSpace, grant Accessibility in System Settings > Privacy & Security, then refresh. Detail: \(detail)"
    }

    if lowered.contains("screen recording") || lowered.contains("screencapture") || lowered.contains("could not create image from display") {
        return "Screen Recording missing. Run pnpm macos:permission-prompt, approve Terminal/eventloopOS in Screen & System Audio Recording, then refresh. Detail: \(detail)"
    }

    if lowered.contains("accessibility") || lowered.contains("system events") || lowered.contains("assistive") {
        return "Accessibility missing. Run pnpm macos:permission-prompt, approve Terminal/eventloopOS/AeroSpace in Accessibility, then refresh. Detail: \(detail)"
    }

    if lowered.contains("codex") && (lowered.contains("login") || lowered.contains("auth") || lowered.contains("not configured")) {
        return "Codex is not ready. Run pnpm codex:status-proof, then codex login if auth is missing. Detail: \(detail)"
    }

    if lowered.contains("codex")
        && (lowered.contains("thread not found")
            || lowered.contains("websocket is closed")
            || lowered.contains("stale")
            || lowered.contains("lost native thread")) {
        return "Codex thread is stale. Replace or rebind the task session, then send the followup again. Detail: \(detail)"
    }

    if lowered.contains("tailscale")
        || lowered.contains("tailnet")
        || lowered.contains("vnc")
        || lowered.contains("screen sharing")
        || lowered.contains("remote login") {
        return "Remote lab disconnected. Open Tailscale on the lab Mac, verify Remote Login and Screen Sharing, then run pnpm lab:wait-online:quick. Detail: \(detail)"
    }

    if lowered.contains("postgres")
        || lowered.contains("database_url")
        || lowered.contains("database url")
        || lowered.contains("migration mismatch")
        || lowered.contains("schema migration") {
        return "Postgres unavailable or schema mismatch. Start the configured database or run the migration repair proof, then refresh. Detail: \(detail)"
    }

    if lowered.contains("ghostty")
        || lowered.contains("terminal cleanup")
        || lowered.contains("terminate running processes")
        || lowered.contains("osascript") {
        return "Terminal cleanup needs attention. Close stuck Ghostty/Terminal prompts, then rerun cleanup or product readiness. Detail: \(detail)"
    }

    if isOrchestratorUnavailable(lowered) {
        return "Orchestrator unavailable. Start dev dogfood with pnpm dev:dogfood or set EVENTLOOPOS_ORCHESTRATOR_URL, then refresh. Detail: \(detail)"
    }

    if lowered.contains("http 500") || lowered.contains("http 502") || lowered.contains("http 503") || lowered.contains("http 504") {
        return "Orchestrator returned a server error. Check dogfood logs, run pnpm readiness:summary, then refresh. Detail: \(detail)"
    }

    return detail
}

private func isOrchestratorUnavailable(_ lowered: String) -> Bool {
    lowered.contains("connection refused")
        || lowered.contains("could not connect")
        || lowered.contains("couldn't connect")
        || lowered.contains("failed to connect")
        || lowered.contains("timed out")
        || lowered.contains("offline")
        || lowered.contains("network is down")
        || lowered.contains("cannot find the server")
        || lowered.contains("http 404")
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
