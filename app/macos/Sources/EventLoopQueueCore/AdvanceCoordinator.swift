import Foundation

public enum AdvanceState: Equatable, Sendable {
    case manualMode
    case onBoundDesktopWithPaper(taskId: String, packetId: String)
    case onBoundDesktop(taskId: String)
    case limbo
}

public struct AdvanceForegroundContext: Equatable, Sendable {
    public let codexThreadId: String?
    public let ghosttyWindowId: String?

    public init(codexThreadId: String? = nil, ghosttyWindowId: String? = nil) {
        self.codexThreadId = codexThreadId
        self.ghosttyWindowId = ghosttyWindowId
    }

    public static let none = AdvanceForegroundContext()
}

public struct AdvanceServerSnapshot: Equatable, Sendable {
    public let manualModeActive: Bool
    public let currentWorkspaceId: String?
    public let currentTask: TaskRecord?
    public let queue: [ReviewPacket]
    public let tasksByWorkspace: [String: TaskRecord]
    public let foreground: AdvanceForegroundContext
    public let limboWorkspaceId: String

    public init(
        manualModeActive: Bool,
        currentWorkspaceId: String?,
        currentTask: TaskRecord?,
        queue: [ReviewPacket],
        tasksByWorkspace: [String: TaskRecord],
        foreground: AdvanceForegroundContext,
        limboWorkspaceId: String
    ) {
        self.manualModeActive = manualModeActive
        self.currentWorkspaceId = currentWorkspaceId
        self.currentTask = currentTask
        self.queue = queue
        self.tasksByWorkspace = tasksByWorkspace
        self.foreground = foreground
        self.limboWorkspaceId = limboWorkspaceId
    }
}

public enum AdvanceAction: Equatable, Sendable {
    case toastManualModeActive
    case toastNoForegroundCodex
    case createTaskFromForeground(anchor: TaskAnchor, workspaceId: String, terminalRef: String?)
    case saveLayoutAndPullPaper(currentTaskId: String, nextPacketId: String, nextWorkspaceId: String)
    case saveLayoutAndEnterLimbo(currentTaskId: String, limboWorkspaceId: String)
    case markPaperDoneAndPullNext(packetId: String, nextPacketId: String, nextWorkspaceId: String)
    case markPaperDoneAndReturnToTask(packetId: String, taskId: String, taskWorkspaceId: String)
    case markPaperDoneAndEnterLimbo(packetId: String, limboWorkspaceId: String)
}

public enum AdvanceCoordinator {
    public static func classify(state snapshot: AdvanceServerSnapshot) -> AdvanceState {
        if snapshot.manualModeActive {
            return .manualMode
        }
        guard let currentTask = snapshot.currentTask else {
            return .limbo
        }
        let papersForCurrentTask = snapshot.queue.filter { $0.taskId == currentTask.taskId }
        if let paper = papersForCurrentTask.first {
            return .onBoundDesktopWithPaper(taskId: currentTask.taskId, packetId: paper.id)
        }
        return .onBoundDesktop(taskId: currentTask.taskId)
    }

    public static func nextAction(snapshot: AdvanceServerSnapshot) -> AdvanceAction {
        switch classify(state: snapshot) {
        case .manualMode:
            return .toastManualModeActive
        case .limbo:
            guard let workspaceId = snapshot.currentWorkspaceId else {
                return .toastNoForegroundCodex
            }
            if let codexThreadId = snapshot.foreground.codexThreadId {
                return .createTaskFromForeground(
                    anchor: TaskAnchor(kind: .codexThread, id: codexThreadId),
                    workspaceId: workspaceId,
                    terminalRef: terminalRef(fromGhosttyWindowId: snapshot.foreground.ghosttyWindowId)
                )
            }
            if let ghosttyWindowId = snapshot.foreground.ghosttyWindowId {
                return .createTaskFromForeground(
                    anchor: TaskAnchor(kind: .ghosttyWindow, id: ghosttyWindowId),
                    workspaceId: workspaceId,
                    terminalRef: terminalRef(fromGhosttyWindowId: ghosttyWindowId)
                )
            }
            return .toastNoForegroundCodex
        case let .onBoundDesktop(taskId):
            if let nextPaper = snapshot.queue.first,
               let workspaceId = workspaceFor(taskId: nextPaper.taskId, in: snapshot) {
                return .saveLayoutAndPullPaper(
                    currentTaskId: taskId,
                    nextPacketId: nextPaper.id,
                    nextWorkspaceId: workspaceId
                )
            }
            return .saveLayoutAndEnterLimbo(currentTaskId: taskId, limboWorkspaceId: snapshot.limboWorkspaceId)
        case let .onBoundDesktopWithPaper(taskId, packetId):
            let remainingPapers = snapshot.queue.filter { $0.id != packetId }
            if let nextPaper = remainingPapers.first,
               let workspaceId = workspaceFor(taskId: nextPaper.taskId, in: snapshot) {
                return .markPaperDoneAndPullNext(
                    packetId: packetId,
                    nextPacketId: nextPaper.id,
                    nextWorkspaceId: workspaceId
                )
            }
            if let workspaceId = workspaceFor(taskId: taskId, in: snapshot) {
                return .markPaperDoneAndReturnToTask(
                    packetId: packetId,
                    taskId: taskId,
                    taskWorkspaceId: workspaceId
                )
            }
            return .markPaperDoneAndEnterLimbo(packetId: packetId, limboWorkspaceId: snapshot.limboWorkspaceId)
        }
    }

    private static func workspaceFor(taskId: String?, in snapshot: AdvanceServerSnapshot) -> String? {
        guard let taskId else { return nil }
        for (workspace, task) in snapshot.tasksByWorkspace where task.taskId == taskId {
            return workspace
        }
        return nil
    }

    private static func terminalRef(fromGhosttyWindowId id: String?) -> String? {
        guard let id = id?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else {
            return nil
        }
        if id.hasPrefix("ghostty:") {
            return id
        }
        if id.hasPrefix("win-") {
            return "ghostty:\(id)"
        }
        return "ghostty:win-\(id)"
    }
}
