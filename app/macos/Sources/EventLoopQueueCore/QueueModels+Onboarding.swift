import Foundation

public struct OnboardingScan: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let capturedAt: Date
    public let activeWorkspace: String?
    public let focusedWindowId: Int?
    public let summary: OnboardingScanSummary
    public let proposals: [OnboardingTaskProposal]
    public let ungroupedWindows: [OnboardingWindow]
    public let browserContexts: [OnboardingBrowserContext]
    public let taskSessions: [TaskSession]
    public let warnings: [String]

    public init(
        ok: Bool,
        capturedAt: Date,
        activeWorkspace: String? = nil,
        focusedWindowId: Int? = nil,
        summary: OnboardingScanSummary,
        proposals: [OnboardingTaskProposal],
        ungroupedWindows: [OnboardingWindow] = [],
        browserContexts: [OnboardingBrowserContext] = [],
        taskSessions: [TaskSession] = [],
        warnings: [String] = []
    ) {
        self.ok = ok
        self.capturedAt = capturedAt
        self.activeWorkspace = activeWorkspace
        self.focusedWindowId = focusedWindowId
        self.summary = summary
        self.proposals = proposals
        self.ungroupedWindows = ungroupedWindows
        self.browserContexts = browserContexts
        self.taskSessions = taskSessions
        self.warnings = warnings
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case capturedAt = "captured_at"
        case activeWorkspace = "active_workspace"
        case focusedWindowId = "focused_window_id"
        case summary
        case proposals
        case ungroupedWindows = "ungrouped_windows"
        case browserContexts = "browser_contexts"
        case taskSessions = "task_sessions"
        case warnings
    }
}

public struct OnboardingScanSummary: Decodable, Equatable, Sendable {
    public let windowCount: Int
    public let groupedWindowCount: Int
    public let ungroupedWindowCount: Int
    public let taskSessionCount: Int
    public let browserContextCount: Int
    public let proposalCount: Int

    public init(
        windowCount: Int,
        groupedWindowCount: Int,
        ungroupedWindowCount: Int,
        taskSessionCount: Int,
        browserContextCount: Int,
        proposalCount: Int
    ) {
        self.windowCount = windowCount
        self.groupedWindowCount = groupedWindowCount
        self.ungroupedWindowCount = ungroupedWindowCount
        self.taskSessionCount = taskSessionCount
        self.browserContextCount = browserContextCount
        self.proposalCount = proposalCount
    }

    enum CodingKeys: String, CodingKey {
        case windowCount = "window_count"
        case groupedWindowCount = "grouped_window_count"
        case ungroupedWindowCount = "ungrouped_window_count"
        case taskSessionCount = "task_session_count"
        case browserContextCount = "browser_context_count"
        case proposalCount = "proposal_count"
    }
}

public struct OnboardingTaskProposal: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let taskId: String
    public let title: String
    public let confidence: String
    public let reason: String
    public let windows: [OnboardingWindow]
    public let browserContexts: [OnboardingBrowserContext]
    public let taskSessions: [TaskSession]
    public let suggestedNextAction: String

    public init(
        id: String,
        taskId: String,
        title: String,
        confidence: String,
        reason: String,
        windows: [OnboardingWindow],
        browserContexts: [OnboardingBrowserContext] = [],
        taskSessions: [TaskSession] = [],
        suggestedNextAction: String
    ) {
        self.id = id
        self.taskId = taskId
        self.title = title
        self.confidence = confidence
        self.reason = reason
        self.windows = windows
        self.browserContexts = browserContexts
        self.taskSessions = taskSessions
        self.suggestedNextAction = suggestedNextAction
    }

    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case title
        case confidence
        case reason
        case windows
        case browserContexts = "browser_contexts"
        case taskSessions = "task_sessions"
        case suggestedNextAction = "suggested_next_action"
    }
}

public struct OnboardingWindow: Decodable, Equatable, Identifiable, Sendable {
    public let id: Int
    public let app: String
    public let title: String
    public let workspace: String
    public let taskHint: String?

    public init(id: Int, app: String, title: String, workspace: String, taskHint: String? = nil) {
        self.id = id
        self.app = app
        self.title = title
        self.workspace = workspace
        self.taskHint = taskHint
    }

    enum CodingKeys: String, CodingKey {
        case id
        case app
        case title
        case workspace
        case taskHint = "task_hint"
    }
}

public struct OnboardingBrowserContext: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let url: String?
    public let taskId: String?
    public let windowId: String?
    public let tabId: String?
    public let capturedAt: Date
    public let restoreConfidence: String

    public init(
        id: String,
        title: String,
        url: String? = nil,
        taskId: String? = nil,
        windowId: String? = nil,
        tabId: String? = nil,
        capturedAt: Date,
        restoreConfidence: String
    ) {
        self.id = id
        self.title = title
        self.url = url
        self.taskId = taskId
        self.windowId = windowId
        self.tabId = tabId
        self.capturedAt = capturedAt
        self.restoreConfidence = restoreConfidence
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case url
        case taskId = "task_id"
        case windowId = "window_id"
        case tabId = "tab_id"
        case capturedAt = "captured_at"
        case restoreConfidence = "restore_confidence"
    }
}

public struct OnboardingApprovalResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let taskId: String
    public let proposalId: String?
    public let bindings: [TaskBinding]
    public let browserContextBindings: [OnboardingBrowserContextBinding]
    public let queuedPaper: OnboardingQueuedPaper?
    public let warnings: [String]
    public let requestId: String?

    public init(
        ok: Bool,
        taskId: String,
        proposalId: String? = nil,
        bindings: [TaskBinding] = [],
        browserContextBindings: [OnboardingBrowserContextBinding] = [],
        queuedPaper: OnboardingQueuedPaper? = nil,
        warnings: [String] = [],
        requestId: String? = nil
    ) {
        self.ok = ok
        self.taskId = taskId
        self.proposalId = proposalId
        self.bindings = bindings
        self.browserContextBindings = browserContextBindings
        self.queuedPaper = queuedPaper
        self.warnings = warnings
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case taskId = "task_id"
        case proposalId = "proposal_id"
        case bindings
        case browserContextBindings = "browser_context_bindings"
        case queuedPaper = "queue_item"
        case warnings
        case requestId = "request_id"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decode(Bool.self, forKey: .ok)
        self.taskId = try container.decode(String.self, forKey: .taskId)
        self.proposalId = try container.decodeIfPresent(String.self, forKey: .proposalId)
        self.bindings = try container.decodeIfPresent([TaskBinding].self, forKey: .bindings) ?? []
        self.browserContextBindings = try container.decodeIfPresent([OnboardingBrowserContextBinding].self, forKey: .browserContextBindings) ?? []
        self.queuedPaper = try container.decodeIfPresent(OnboardingQueuedPaper.self, forKey: .queuedPaper)
        self.warnings = try container.decodeIfPresent([String].self, forKey: .warnings) ?? []
        self.requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
    }
}

public struct OnboardingQueuedPaper: Decodable, Equatable, Sendable {
    public let id: String
    public let reviewPacketId: String?
    public let taskId: String?
    public let state: String?
    public let priorityScore: Int?

    public init(
        id: String,
        reviewPacketId: String? = nil,
        taskId: String? = nil,
        state: String? = nil,
        priorityScore: Int? = nil
    ) {
        self.id = id
        self.reviewPacketId = reviewPacketId
        self.taskId = taskId
        self.state = state
        self.priorityScore = priorityScore
    }

    enum CodingKeys: String, CodingKey {
        case id
        case reviewPacketId = "review_packet_id"
        case taskId = "task_id"
        case state
        case priorityScore = "priority_score"
    }
}

public struct OnboardingBrowserContextBinding: Decodable, Equatable, Sendable {
    public let browserContextId: String
    public let eventId: String
    public let taskId: String

    public init(browserContextId: String, eventId: String, taskId: String) {
        self.browserContextId = browserContextId
        self.eventId = eventId
        self.taskId = taskId
    }

    enum CodingKeys: String, CodingKey {
        case browserContextId = "browser_context_id"
        case eventId = "event_id"
        case taskId = "task_id"
    }
}

public enum OnboardingState: Equatable, Sendable {
    case idle
    case scanning
    case loaded(OnboardingScan)
    case approving(String)
    case approved(OnboardingApprovalResult)
    case failed(String)
}

public struct CodexAutoBindResult: Decodable, Equatable, Sendable {
    public let scannedWindowCount: Int
    public let matchedCount: Int
    public let bound: [Bound]
    public let skipped: [Skipped]

    public struct Bound: Decodable, Equatable, Sendable {
        public let taskId: String
        public let taskSessionId: String
        public let terminalRef: String
        public let windowId: Int
        public let windowApp: String

        enum CodingKeys: String, CodingKey {
            case taskId = "task_id"
            case taskSessionId = "task_session_id"
            case terminalRef = "terminal_ref"
            case windowId = "window_id"
            case windowApp = "window_app"
        }
    }

    public struct Skipped: Decodable, Equatable, Sendable {
        public let taskId: String?
        public let windowId: Int?
        public let windowTitle: String?
        public let reason: String

        enum CodingKeys: String, CodingKey {
            case taskId = "task_id"
            case windowId = "window_id"
            case windowTitle = "window_title"
            case reason
        }
    }

    public init(scannedWindowCount: Int = 0, matchedCount: Int = 0, bound: [Bound] = [], skipped: [Skipped] = []) {
        self.scannedWindowCount = scannedWindowCount
        self.matchedCount = matchedCount
        self.bound = bound
        self.skipped = skipped
    }

    enum CodingKeys: String, CodingKey {
        case scannedWindowCount = "scanned_window_count"
        case matchedCount = "matched_count"
        case bound
        case skipped
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.scannedWindowCount = try container.decodeIfPresent(Int.self, forKey: .scannedWindowCount) ?? 0
        self.matchedCount = try container.decodeIfPresent(Int.self, forKey: .matchedCount) ?? 0
        self.bound = try container.decodeIfPresent([Bound].self, forKey: .bound) ?? []
        self.skipped = try container.decodeIfPresent([Skipped].self, forKey: .skipped) ?? []
    }
}
