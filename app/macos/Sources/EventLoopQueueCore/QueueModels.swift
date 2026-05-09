import Foundation

public struct ReviewPacket: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let reviewPacketId: String
    public let taskId: String?
    public let title: String
    public let summary: String
    public let decisionNeeded: String
    public let source: String
    public let priority: Int
    public let priorityReasons: [String]
    public let riskLevel: String
    public let confidence: String
    public let riskTags: [String]
    public let contextResources: [ReviewContextResource]
    public let evidence: [ReviewEvidence]
    public let recommendedAction: String
    public let recommendedActionType: String
    public let createdAt: Date
    public let workspaceSnapshot: WorkspaceSnapshot?

    public init(
        id: String,
        reviewPacketId: String? = nil,
        taskId: String? = nil,
        title: String,
        summary: String,
        decisionNeeded: String = "",
        source: String,
        priority: Int,
        priorityReasons: [String] = [],
        riskLevel: String = "medium",
        confidence: String = "medium",
        riskTags: [String] = [],
        contextResources: [ReviewContextResource] = [],
        evidence: [ReviewEvidence] = [],
        recommendedAction: String,
        recommendedActionType: String = "",
        createdAt: Date,
        workspaceSnapshot: WorkspaceSnapshot? = nil
    ) {
        self.id = id
        self.reviewPacketId = reviewPacketId ?? id
        self.taskId = taskId
        self.title = title
        self.summary = summary
        self.decisionNeeded = decisionNeeded
        self.source = source
        self.priority = priority
        self.priorityReasons = priorityReasons
        self.riskLevel = riskLevel
        self.confidence = confidence
        self.riskTags = riskTags
        self.contextResources = contextResources
        self.evidence = evidence
        self.recommendedAction = recommendedAction
        self.recommendedActionType = recommendedActionType
        self.createdAt = createdAt
        self.workspaceSnapshot = workspaceSnapshot
    }

    enum CodingKeys: String, CodingKey {
        case id
        case reviewPacketId
        case taskId
        case title
        case summary
        case decisionNeeded
        case source
        case priority
        case priorityReasons
        case riskLevel
        case confidence
        case riskTags
        case contextResources
        case evidence
        case recommendedAction
        case recommendedActionType
        case createdAt
        case workspaceSnapshot
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        self.id = id
        self.reviewPacketId = try container.decodeIfPresent(String.self, forKey: .reviewPacketId) ?? id
        self.taskId = try container.decodeIfPresent(String.self, forKey: .taskId)
        self.title = try container.decode(String.self, forKey: .title)
        self.summary = try container.decode(String.self, forKey: .summary)
        self.decisionNeeded = try container.decodeIfPresent(String.self, forKey: .decisionNeeded) ?? ""
        self.source = try container.decode(String.self, forKey: .source)
        self.priority = try container.decode(Int.self, forKey: .priority)
        self.priorityReasons = try container.decodeIfPresent([String].self, forKey: .priorityReasons) ?? []
        self.riskLevel = try container.decodeIfPresent(String.self, forKey: .riskLevel) ?? "medium"
        self.confidence = try container.decodeIfPresent(String.self, forKey: .confidence) ?? "medium"
        self.riskTags = try container.decodeIfPresent([String].self, forKey: .riskTags) ?? []
        self.contextResources = try container.decodeIfPresent([ReviewContextResource].self, forKey: .contextResources) ?? []
        self.evidence = try container.decodeIfPresent([ReviewEvidence].self, forKey: .evidence) ?? []
        self.recommendedAction = try container.decode(String.self, forKey: .recommendedAction)
        self.recommendedActionType = try container.decodeIfPresent(String.self, forKey: .recommendedActionType) ?? ""
        self.createdAt = try container.decode(Date.self, forKey: .createdAt)
        self.workspaceSnapshot = try container.decodeIfPresent(WorkspaceSnapshot.self, forKey: .workspaceSnapshot)
    }
}

public struct ReviewContextResource: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: String
    public let title: String
    public let url: String?
    public let source: String?
    public let restoreConfidence: String?
    public let windowId: String?
    public let tabId: String?
    public let scrollY: Int?
    public let textQuote: String?
    public let selectorHint: String?
    public let path: String?
    public let line: Int?
    public let column: Int?
    public let details: ReviewContextResourceDetails?

    public init(
        id: String,
        kind: String,
        title: String,
        url: String? = nil,
        source: String? = nil,
        restoreConfidence: String? = nil,
        windowId: String? = nil,
        tabId: String? = nil,
        scrollY: Int? = nil,
        textQuote: String? = nil,
        selectorHint: String? = nil,
        path: String? = nil,
        line: Int? = nil,
        column: Int? = nil,
        details: ReviewContextResourceDetails? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.url = url
        self.source = source
        self.restoreConfidence = restoreConfidence
        self.windowId = windowId
        self.tabId = tabId
        self.scrollY = scrollY
        self.textQuote = textQuote
        self.selectorHint = selectorHint
        self.path = path
        self.line = line
        self.column = column
        self.details = details
    }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case title
        case url
        case source
        case restoreConfidence = "restore_confidence"
        case windowId = "window_id"
        case tabId = "tab_id"
        case scrollY = "scroll_y"
        case textQuote = "text_quote"
        case selectorHint = "selector_hint"
        case path
        case line
        case column
        case details
    }
}

public struct ReviewContextResourceDetails: Codable, Equatable, Sendable {
    public let provider: String?
    public let confidenceReason: String?

    public init(provider: String? = nil, confidenceReason: String? = nil) {
        self.provider = provider
        self.confidenceReason = confidenceReason
    }

    enum CodingKeys: String, CodingKey {
        case provider
        case confidenceReason = "confidence_reason"
    }
}

public struct ReviewEvidence: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: String
    public let title: String
    public let url: String?

    public init(id: String, kind: String, title: String, url: String? = nil) {
        self.id = id
        self.kind = kind
        self.title = title
        self.url = url
    }
}

public struct QueueEnvelope: Decodable, Equatable, Sendable {
    public let packets: [ReviewPacket]

    public init(packets: [ReviewPacket]) {
        self.packets = packets
    }

    enum CodingKeys: String, CodingKey {
        case packets
        case items
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let packets = try container.decodeIfPresent([ReviewPacket].self, forKey: .packets) {
            self.packets = packets
            return
        }

        let items = try container.decode([QueueItemDTO].self, forKey: .items)
        self.packets = items.map(\.packet)
    }
}

public struct QueueActionResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let completedPacketId: String?
    public let nextPacket: ReviewPacket?

    public init(ok: Bool, completedPacketId: String?, nextPacket: ReviewPacket?) {
        self.ok = ok
        self.completedPacketId = completedPacketId
        self.nextPacket = nextPacket
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case completedPacketId
        case nextPacket
        case item
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? true

        if let completedPacketId = try container.decodeIfPresent(String.self, forKey: .completedPacketId) {
            self.completedPacketId = completedPacketId
            self.nextPacket = try container.decodeIfPresent(ReviewPacket.self, forKey: .nextPacket)
            return
        }

        if let item = try container.decodeIfPresent(QueueItemDTO.self, forKey: .item) {
            self.completedPacketId = item.id
            self.nextPacket = nil
            return
        }

        self.completedPacketId = nil
        self.nextPacket = try container.decodeIfPresent(ReviewPacket.self, forKey: .nextPacket)
    }
}

public struct QueueNextEnvelope: Decodable, Equatable, Sendable {
    public let packet: ReviewPacket?

    enum CodingKeys: String, CodingKey {
        case item
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.packet = try container.decodeIfPresent(QueueItemDTO.self, forKey: .item)?.packet
    }
}

public enum QueueState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(String)
}

public enum EventLoopMode: Equatable, Sendable {
    case eventLoop
    case manual
}

public struct TaskSessionsEnvelope: Decodable, Equatable, Sendable {
    public let sessions: [TaskSession]

    public init(sessions: [TaskSession]) {
        self.sessions = sessions
    }
}

public struct TaskSession: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let taskId: String?
    public let provider: String
    public let status: String
    public let name: String?
    public let preview: String?
    public let cwd: String?
    public let terminalRef: String?

    public init(
        id: String,
        taskId: String? = nil,
        provider: String,
        status: String,
        name: String? = nil,
        preview: String? = nil,
        cwd: String? = nil,
        terminalRef: String? = nil
    ) {
        self.id = id
        self.taskId = taskId
        self.provider = provider
        self.status = status
        self.name = name
        self.preview = preview
        self.cwd = cwd
        self.terminalRef = terminalRef
    }

    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case provider
        case status
        case name
        case preview
        case cwd
        case terminalRef = "terminal_ref"
    }
}

public struct TaskBindingEnvelope: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let binding: TaskBinding

    public init(ok: Bool, binding: TaskBinding) {
        self.ok = ok
        self.binding = binding
    }
}

public struct TaskBinding: Codable, Equatable, Sendable {
    public let ok: Bool
    public let taskSessionId: String
    public let taskId: String
    public let nativeThreadId: String?
    public let session: TaskSession?

    public init(
        ok: Bool,
        taskSessionId: String,
        taskId: String,
        nativeThreadId: String? = nil,
        session: TaskSession? = nil
    ) {
        self.ok = ok
        self.taskSessionId = taskSessionId
        self.taskId = taskId
        self.nativeThreadId = nativeThreadId
        self.session = session
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case taskSessionId = "task_session_id"
        case taskId = "task_id"
        case nativeThreadId = "native_thread_id"
        case session
    }
}

public enum TaskBindingState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case bound(TaskBinding)
    case failed(String)
}

public struct MasterCommandResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let requestId: String?
    public let eventId: String?
    public let routeAction: String?
    public let targetTaskId: String?
    public let targetTaskSessionId: String?
    public let queuedPacket: ReviewPacket?

    public init(
        ok: Bool,
        requestId: String? = nil,
        eventId: String? = nil,
        routeAction: String? = nil,
        targetTaskId: String? = nil,
        targetTaskSessionId: String? = nil,
        queuedPacket: ReviewPacket? = nil
    ) {
        self.ok = ok
        self.requestId = requestId
        self.eventId = eventId
        self.routeAction = routeAction
        self.targetTaskId = targetTaskId
        self.targetTaskSessionId = targetTaskSessionId
        self.queuedPacket = queuedPacket
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case requestId = "request_id"
        case event
        case routeDecision = "route_decision"
        case queueItem = "queue_item"
    }

    enum EventCodingKeys: String, CodingKey {
        case id
    }

    enum RouteDecisionCodingKeys: String, CodingKey {
        case action
        case targetTaskId = "target_task_id"
        case targetTaskSessionId = "target_task_session_id"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        self.requestId = try container.decodeIfPresent(String.self, forKey: .requestId)

        if let event = try? container.nestedContainer(keyedBy: EventCodingKeys.self, forKey: .event) {
            self.eventId = try event.decodeIfPresent(String.self, forKey: .id)
        } else {
            self.eventId = nil
        }

        if let routeDecision = try? container.nestedContainer(keyedBy: RouteDecisionCodingKeys.self, forKey: .routeDecision) {
            self.routeAction = try routeDecision.decodeIfPresent(String.self, forKey: .action)
            self.targetTaskId = try routeDecision.decodeIfPresent(String.self, forKey: .targetTaskId)
            self.targetTaskSessionId = try routeDecision.decodeIfPresent(String.self, forKey: .targetTaskSessionId)
        } else {
            self.routeAction = nil
            self.targetTaskId = nil
            self.targetTaskSessionId = nil
        }

        self.queuedPacket = try container.decodeIfPresent(QueueItemDTO.self, forKey: .queueItem)?.packet
    }
}

public struct TaskWorkspaceSnapshotSaveResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let requestId: String?

    public init(ok: Bool, requestId: String? = nil) {
        self.ok = ok
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case requestId = "request_id"
    }
}

public struct TaskSessionStartEnvelope: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let started: TaskSessionStartResult
    public let requestId: String?

    public init(ok: Bool, started: TaskSessionStartResult, requestId: String? = nil) {
        self.ok = ok
        self.started = started
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case started
        case requestId = "request_id"
    }
}

public struct TaskSessionStartResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let taskSessionId: String?
    public let taskId: String
    public let session: TaskSession?

    public init(ok: Bool, taskSessionId: String? = nil, taskId: String, session: TaskSession? = nil) {
        self.ok = ok
        self.taskSessionId = taskSessionId
        self.taskId = taskId
        self.session = session
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case taskSessionId = "task_session_id"
        case taskId = "task_id"
        case session
    }
}

public enum MasterCommandState: Equatable, Sendable {
    case idle
    case sending
    case routed(MasterCommandResult)
    case started(TaskSessionStartResult)
    case failed(String)
}

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

public struct ActivityEvent: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let type: String
    public let occurredAt: Date
    public let actor: String
    public let taskId: String?
    public let queueItemId: String?
    public let eventId: String?
    public let taskSessionId: String?
    public let sourceId: String?
    public let status: String?
    public let summary: String

    public init(
        id: String,
        type: String,
        occurredAt: Date,
        actor: String,
        taskId: String? = nil,
        queueItemId: String? = nil,
        eventId: String? = nil,
        taskSessionId: String? = nil,
        sourceId: String? = nil,
        status: String? = nil,
        summary: String
    ) {
        self.id = id
        self.type = type
        self.occurredAt = occurredAt
        self.actor = actor
        self.taskId = taskId
        self.queueItemId = queueItemId
        self.eventId = eventId
        self.taskSessionId = taskSessionId
        self.sourceId = sourceId
        self.status = status
        self.summary = summary
    }

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case occurredAt = "occurred_at"
        case actor
        case taskId = "task_id"
        case queueItemId = "queue_item_id"
        case eventId = "event_id"
        case taskSessionId = "task_session_id"
        case sourceId = "source_id"
        case status
        case summary
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.type = try container.decode(String.self, forKey: .type)
        self.occurredAt = try container.decode(Date.self, forKey: .occurredAt)
        let actorAny = try? container.decode(AnyDecodableActor.self, forKey: .actor)
        self.actor = actorAny?.normalized ?? "system"
        self.taskId = try container.decodeIfPresent(String.self, forKey: .taskId)
        self.queueItemId = try container.decodeIfPresent(String.self, forKey: .queueItemId)
        self.eventId = try container.decodeIfPresent(String.self, forKey: .eventId)
        self.taskSessionId = try container.decodeIfPresent(String.self, forKey: .taskSessionId)
        self.sourceId = try container.decodeIfPresent(String.self, forKey: .sourceId)
        self.status = try container.decodeIfPresent(String.self, forKey: .status)
        self.summary = try container.decode(String.self, forKey: .summary)
    }
}

private struct AnyDecodableActor: Decodable {
    let normalized: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let direct = try? container.decode(String.self) {
            self.normalized = direct
            return
        }
        if let nested = try? container.decode([String: String].self) {
            self.normalized = nested["type"] ?? nested["id"] ?? "system"
            return
        }
        self.normalized = "system"
    }
}

public struct ActivityFeedResult: Decodable, Equatable, Sendable {
    public let count: Int
    public let events: [ActivityEvent]

    public init(count: Int = 0, events: [ActivityEvent] = []) {
        self.count = count
        self.events = events
    }
}

public struct ReadingQueueContext: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let url: String?
    public let capturedAt: Date
    public let eventId: String
    public let source: String

    public init(
        id: String,
        title: String,
        url: String? = nil,
        capturedAt: Date,
        eventId: String,
        source: String
    ) {
        self.id = id
        self.title = title
        self.url = url
        self.capturedAt = capturedAt
        self.eventId = eventId
        self.source = source
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case url
        case capturedAt = "captured_at"
        case eventId = "event_id"
        case source
    }
}

public struct ReadingQueueListResult: Decodable, Equatable, Sendable {
    public let contexts: [ReadingQueueContext]
    public let count: Int
    public let requestId: String?

    public init(contexts: [ReadingQueueContext] = [], count: Int = 0, requestId: String? = nil) {
        self.contexts = contexts
        self.count = count
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case contexts
        case count
        case requestId = "request_id"
    }
}

public struct ReadingQueuePromotion: Decodable, Equatable, Sendable {
    public let contextId: String
    public let queueItemId: String?
    public let reviewPacketId: String?
    public let eventId: String
    public let idempotent: Bool

    public init(contextId: String, queueItemId: String? = nil, reviewPacketId: String? = nil, eventId: String, idempotent: Bool) {
        self.contextId = contextId
        self.queueItemId = queueItemId
        self.reviewPacketId = reviewPacketId
        self.eventId = eventId
        self.idempotent = idempotent
    }

    enum CodingKeys: String, CodingKey {
        case contextId = "context_id"
        case queueItemId = "queue_item_id"
        case reviewPacketId = "review_packet_id"
        case eventId = "event_id"
        case idempotent
    }
}

public struct MasterFanOutMatch: Decodable, Equatable, Sendable {
    public let taskId: String
    public let taskSessionId: String?
    public let matchedPacketId: String?
    public let matchedPacketTitle: String?

    public init(taskId: String, taskSessionId: String? = nil, matchedPacketId: String? = nil, matchedPacketTitle: String? = nil) {
        self.taskId = taskId
        self.taskSessionId = taskSessionId
        self.matchedPacketId = matchedPacketId
        self.matchedPacketTitle = matchedPacketTitle
    }

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case taskSessionId = "task_session_id"
        case matchedPacketId = "matched_packet_id"
        case matchedPacketTitle = "matched_packet_title"
    }
}

public struct MasterFanOutDelivery: Decodable, Equatable, Sendable {
    public let taskId: String
    public let taskSessionId: String

    public init(taskId: String, taskSessionId: String) {
        self.taskId = taskId
        self.taskSessionId = taskSessionId
    }

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case taskSessionId = "task_session_id"
    }
}

public struct MasterFanOutSkip: Decodable, Equatable, Sendable {
    public let taskId: String
    public let reason: String

    public init(taskId: String, reason: String) {
        self.taskId = taskId
        self.reason = reason
    }

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case reason
    }
}

public struct MasterFanOutResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let dryRun: Bool
    public let matchedCount: Int
    public let deliveredCount: Int
    public let preview: [MasterFanOutMatch]
    public let delivered: [MasterFanOutDelivery]
    public let skipped: [MasterFanOutSkip]
    public let fanOutId: String?

    public init(
        ok: Bool,
        dryRun: Bool,
        matchedCount: Int = 0,
        deliveredCount: Int = 0,
        preview: [MasterFanOutMatch] = [],
        delivered: [MasterFanOutDelivery] = [],
        skipped: [MasterFanOutSkip] = [],
        fanOutId: String? = nil
    ) {
        self.ok = ok
        self.dryRun = dryRun
        self.matchedCount = matchedCount
        self.deliveredCount = deliveredCount
        self.preview = preview
        self.delivered = delivered
        self.skipped = skipped
        self.fanOutId = fanOutId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case dryRun = "dry_run"
        case matchedCount = "matched_count"
        case deliveredCount = "delivered_count"
        case preview
        case delivered
        case skipped
        case fanOutId = "fan_out_id"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        self.dryRun = try container.decodeIfPresent(Bool.self, forKey: .dryRun) ?? false
        self.matchedCount = try container.decodeIfPresent(Int.self, forKey: .matchedCount) ?? 0
        self.deliveredCount = try container.decodeIfPresent(Int.self, forKey: .deliveredCount) ?? 0
        self.preview = try container.decodeIfPresent([MasterFanOutMatch].self, forKey: .preview) ?? []
        self.delivered = try container.decodeIfPresent([MasterFanOutDelivery].self, forKey: .delivered) ?? []
        self.skipped = try container.decodeIfPresent([MasterFanOutSkip].self, forKey: .skipped) ?? []
        self.fanOutId = try container.decodeIfPresent(String.self, forKey: .fanOutId)
    }
}

public struct ReadingQueuePromoteResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let promoted: [ReadingQueuePromotion]
    public let promotedCount: Int
    public let missingContextIds: [String]
    public let requestId: String?

    public init(ok: Bool, promoted: [ReadingQueuePromotion] = [], promotedCount: Int = 0, missingContextIds: [String] = [], requestId: String? = nil) {
        self.ok = ok
        self.promoted = promoted
        self.promotedCount = promotedCount
        self.missingContextIds = missingContextIds
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case promoted
        case promotedCount = "promoted_count"
        case missingContextIds = "missing_context_ids"
        case requestId = "request_id"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        self.promoted = try container.decodeIfPresent([ReadingQueuePromotion].self, forKey: .promoted) ?? []
        self.promotedCount = try container.decodeIfPresent(Int.self, forKey: .promotedCount) ?? promoted.count
        self.missingContextIds = try container.decodeIfPresent([String].self, forKey: .missingContextIds) ?? []
        self.requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
    }
}

public enum QueueAuxiliarySheet: String, Identifiable, Equatable, Sendable {
    case masterCommand
    case onboarding
    case activity

    public var id: String {
        rawValue
    }
}

public struct ContextRestorePlanEnvelope: Decodable, Equatable, Sendable {
    public let restorePlan: ContextRestorePlan

    public init(restorePlan: ContextRestorePlan) {
        self.restorePlan = restorePlan
    }

    enum CodingKeys: String, CodingKey {
        case restorePlan = "restore_plan"
    }
}

public struct ContextRestorePlan: Codable, Equatable, Sendable {
    public let kind: String
    public let sideEffect: String
    public let executeSupported: Bool
    public let target: String?
    public let message: ContextRestoreMessage?
    public let url: String?
    public let path: String?
    public let line: Int?
    public let column: Int?

    public init(
        kind: String,
        sideEffect: String,
        executeSupported: Bool,
        target: String?,
        message: ContextRestoreMessage?,
        url: String?,
        path: String?,
        line: Int?,
        column: Int?
    ) {
        self.kind = kind
        self.sideEffect = sideEffect
        self.executeSupported = executeSupported
        self.target = target
        self.message = message
        self.url = url
        self.path = path
        self.line = line
        self.column = column
    }

    enum CodingKeys: String, CodingKey {
        case kind
        case sideEffect = "side_effect"
        case executeSupported = "execute_supported"
        case target
        case message
        case url
        case path
        case line
        case column
    }
}

public struct ContextRestoreMessage: Codable, Equatable, Sendable {
    public let type: String
    public let resource: ReviewContextResource

    public init(type: String, resource: ReviewContextResource) {
        self.type = type
        self.resource = resource
    }
}

public enum ContextRestoreState: Equatable, Sendable {
    case idle
    case planning(ReviewContextResource)
    case planned(ReviewContextResource, ContextRestorePlan)
    case requested(ReviewContextResource, ContextRestoreRequest)
    case failed(ReviewContextResource, String)
}

public struct ContextRestoreRequestEnvelope: Decodable, Equatable, Sendable {
    public let restoreRequest: ContextRestoreRequest

    public init(restoreRequest: ContextRestoreRequest) {
        self.restoreRequest = restoreRequest
    }

    enum CodingKeys: String, CodingKey {
        case restoreRequest = "restore_request"
    }
}

public enum QueueLineageState: Equatable, Sendable {
    case idle
    case loading(String)
    case loaded(String, QueueLineage)
    case failed(String, String)
}

public struct QueueLineageEnvelope: Decodable, Equatable, Sendable {
    public let lineage: QueueLineage

    public init(lineage: QueueLineage) {
        self.lineage = lineage
    }
}

public struct QueueLineage: Codable, Equatable, Sendable {
    public let queueItem: QueueLineageQueueItem?
    public let relatedEventIds: [String]
    public let events: [QueueLineageEvent]
    public let activity: [QueueLineageActivity]
    public let taskMessages: [QueueLineageTaskMessage]
    public let counts: QueueLineageCounts

    public init(
        queueItem: QueueLineageQueueItem? = nil,
        relatedEventIds: [String],
        events: [QueueLineageEvent] = [],
        activity: [QueueLineageActivity],
        taskMessages: [QueueLineageTaskMessage],
        counts: QueueLineageCounts
    ) {
        self.queueItem = queueItem
        self.relatedEventIds = relatedEventIds
        self.events = events
        self.activity = activity
        self.taskMessages = taskMessages
        self.counts = counts
    }

    enum CodingKeys: String, CodingKey {
        case queueItem = "queue_item"
        case relatedEventIds = "related_event_ids"
        case events
        case activity
        case taskMessages = "task_messages"
        case counts
    }
}

public struct QueueLineageQueueItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let state: String?
    public let taskId: String?
    public let priorityScore: Int?
    public let createdAt: Date?
    public let updatedAt: Date?

    public init(
        id: String,
        state: String? = nil,
        taskId: String? = nil,
        priorityScore: Int? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.state = state
        self.taskId = taskId
        self.priorityScore = priorityScore
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case state
        case taskId = "task_id"
        case priorityScore = "priority_score"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct QueueLineageEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let source: String
    public let sourceId: String
    public let type: String
    public let title: String
    public let summary: String
    public let occurredAt: Date
    public let receivedAt: Date?
    public let taskHint: String?
    public let projectHint: String?

    public init(
        id: String,
        source: String,
        sourceId: String,
        type: String,
        title: String,
        summary: String,
        occurredAt: Date,
        receivedAt: Date? = nil,
        taskHint: String? = nil,
        projectHint: String? = nil
    ) {
        self.id = id
        self.source = source
        self.sourceId = sourceId
        self.type = type
        self.title = title
        self.summary = summary
        self.occurredAt = occurredAt
        self.receivedAt = receivedAt
        self.taskHint = taskHint
        self.projectHint = projectHint
    }

    enum CodingKeys: String, CodingKey {
        case id
        case source
        case sourceId = "source_id"
        case type
        case title
        case summary
        case occurredAt = "occurred_at"
        case receivedAt = "received_at"
        case taskHint = "task_hint"
        case projectHint = "project_hint"
    }
}

public struct QueueLineageActivity: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let type: String
    public let occurredAt: Date
    public let status: String?
    public let summary: String
    public let eventId: String?
    public let taskSessionId: String?

    public init(
        id: String,
        type: String,
        occurredAt: Date,
        status: String? = nil,
        summary: String,
        eventId: String? = nil,
        taskSessionId: String? = nil
    ) {
        self.id = id
        self.type = type
        self.occurredAt = occurredAt
        self.status = status
        self.summary = summary
        self.eventId = eventId
        self.taskSessionId = taskSessionId
    }

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case occurredAt = "occurred_at"
        case status
        case summary
        case eventId = "event_id"
        case taskSessionId = "task_session_id"
    }
}

public struct QueueLineageTaskMessage: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let durableId: String?
    public let taskSessionId: String
    public let origin: String?
    public let status: String
    public let eventIds: [String]
    public let textHash: String?
    public let textLength: Int?
    public let error: String?

    public init(
        id: String,
        durableId: String? = nil,
        taskSessionId: String,
        origin: String? = nil,
        status: String,
        eventIds: [String],
        textHash: String? = nil,
        textLength: Int? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.durableId = durableId
        self.taskSessionId = taskSessionId
        self.origin = origin
        self.status = status
        self.eventIds = eventIds
        self.textHash = textHash
        self.textLength = textLength
        self.error = error
    }

    enum CodingKeys: String, CodingKey {
        case id
        case durableId = "durable_id"
        case taskSessionId = "task_session_id"
        case origin
        case status
        case eventIds = "event_ids"
        case textHash = "text_hash"
        case textLength = "text_length"
        case error
    }
}

public struct QueueLineageCounts: Codable, Equatable, Sendable {
    public let events: Int
    public let activity: Int
    public let taskMessages: Int

    public init(events: Int, activity: Int, taskMessages: Int) {
        self.events = events
        self.activity = activity
        self.taskMessages = taskMessages
    }

    enum CodingKeys: String, CodingKey {
        case events
        case activity
        case taskMessages = "task_messages"
    }
}

public struct ContextRestoreRequest: Codable, Equatable, Sendable {
    public let id: String
    public let status: String
    public let resource: ReviewContextResource
    public let restorePlan: ContextRestorePlan
    public let result: ContextRestoreResult?

    public init(
        id: String,
        status: String,
        resource: ReviewContextResource,
        restorePlan: ContextRestorePlan,
        result: ContextRestoreResult? = nil
    ) {
        self.id = id
        self.status = status
        self.resource = resource
        self.restorePlan = restorePlan
        self.result = result
    }

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case resource
        case restorePlan = "restore_plan"
        case result
    }
}

public struct ContextRestoreResult: Codable, Equatable, Sendable {
    public let ok: Bool?
    public let tabId: Int?
    public let url: String?
    public let restoredScroll: Bool?
    public let restoredHighlight: Bool?
    public let highlightStrategy: String?
    public let error: ContextRestoreError?

    public init(
        ok: Bool?,
        tabId: Int?,
        url: String?,
        restoredScroll: Bool?,
        restoredHighlight: Bool? = nil,
        highlightStrategy: String? = nil,
        error: ContextRestoreError? = nil
    ) {
        self.ok = ok
        self.tabId = tabId
        self.url = url
        self.restoredScroll = restoredScroll
        self.restoredHighlight = restoredHighlight
        self.highlightStrategy = highlightStrategy
        self.error = error
    }
}

public struct ContextRestoreError: Codable, Equatable, Sendable {
    public let code: String?
    public let message: String?

    public init(code: String?, message: String?) {
        self.code = code
        self.message = message
    }
}

struct QueueItemDTO: Codable, Equatable, Sendable {
    let id: String
    let reviewPacketId: String
    let taskId: String?
    let priorityScore: Int
    let priorityReasons: [String]?
    let createdAt: Date
    let reviewPacket: ReviewPacketDTO

    enum CodingKeys: String, CodingKey {
        case id
        case reviewPacketId = "review_packet_id"
        case taskId = "task_id"
        case priorityScore = "priority_score"
        case priorityReasons = "priority_reasons"
        case createdAt = "created_at"
        case reviewPacket = "review_packet"
    }

    var packet: ReviewPacket {
        ReviewPacket(
            id: id,
            reviewPacketId: reviewPacketId,
            taskId: taskId,
            title: reviewPacket.title,
            summary: reviewPacket.summary,
            decisionNeeded: reviewPacket.decisionNeeded ?? "",
            source: reviewPacket.primarySource,
            priority: priorityScore,
            priorityReasons: priorityReasons ?? [],
            riskLevel: reviewPacket.riskLevel ?? "medium",
            confidence: reviewPacket.confidence ?? "medium",
            riskTags: reviewPacket.riskTags ?? [],
            contextResources: reviewPacket.contextResources,
            evidence: reviewPacket.evidenceResources,
            recommendedAction: reviewPacket.recommendedAction.label,
            recommendedActionType: reviewPacket.recommendedAction.type ?? "",
            createdAt: createdAt,
            workspaceSnapshot: reviewPacket.workspaceSnapshot
        )
    }
}

struct ReviewPacketDTO: Codable, Equatable, Sendable {
    let id: String
    let title: String
    let summary: String
    let decisionNeeded: String?
    let riskLevel: String?
    let confidence: String?
    let riskTags: [String]?
    let evidence: [EvidenceDTO]?
    let recommendedAction: ActionDTO
    let context: [ContextResourceDTO]

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case summary
        case decisionNeeded = "decision_needed"
        case riskLevel = "risk_level"
        case confidence
        case riskTags = "risk_tags"
        case evidence
        case recommendedAction = "recommended_action"
        case context
    }

    var primarySource: String {
        context.compactMap(\.url).first ?? id
    }

    var workspaceSnapshot: WorkspaceSnapshot? {
        context.compactMap(\.workspaceSnapshot).first
    }

    var contextResources: [ReviewContextResource] {
        context.enumerated().map { index, resource in
            ReviewContextResource(
                id: resource.id ?? "ctx_\(id)_\(index)",
                kind: resource.kind ?? "url",
                title: resource.title ?? resource.url ?? resource.kind ?? "Context",
                url: resource.url,
                source: resource.source,
                restoreConfidence: resource.restoreConfidence,
                windowId: resource.windowId,
                tabId: resource.tabId,
                scrollY: resource.scrollY,
                textQuote: resource.textQuote,
                selectorHint: resource.selectorHint,
                path: resource.path,
                line: resource.line,
                column: resource.column,
                details: resource.details
            )
        }
    }

    var evidenceResources: [ReviewEvidence] {
        (evidence ?? []).map { item in
            ReviewEvidence(
                id: item.id,
                kind: item.kind,
                title: item.title,
                url: item.url
            )
        }
    }
}

struct ActionDTO: Codable, Equatable, Sendable {
    let label: String
    let type: String?
}

struct ContextResourceDTO: Codable, Equatable, Sendable {
    let id: String?
    let url: String?
    let kind: String?
    let title: String?
    let source: String?
    let restoreConfidence: String?
    let windowId: String?
    let tabId: String?
    let scrollY: Int?
    let textQuote: String?
    let selectorHint: String?
    let path: String?
    let line: Int?
    let column: Int?
    let snapshot: WorkspaceSnapshot?
    let details: ReviewContextResourceDetails?

    enum CodingKeys: String, CodingKey {
        case id
        case url
        case kind
        case title
        case source
        case restoreConfidence = "restore_confidence"
        case windowId = "window_id"
        case tabId = "tab_id"
        case scrollY = "scroll_y"
        case textQuote = "text_quote"
        case selectorHint = "selector_hint"
        case path
        case line
        case column
        case snapshot
        case details
    }

    var workspaceSnapshot: WorkspaceSnapshot? {
        guard kind == "workspace_snapshot" else {
            return nil
        }
        return snapshot
    }
}

struct EvidenceDTO: Codable, Equatable, Sendable {
    let id: String
    let kind: String
    let title: String
    let url: String?
}
