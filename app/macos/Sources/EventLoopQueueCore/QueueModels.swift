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
        column: Int? = nil
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

    public init(
        id: String,
        taskId: String? = nil,
        provider: String,
        status: String,
        name: String? = nil,
        preview: String? = nil,
        cwd: String? = nil
    ) {
        self.id = id
        self.taskId = taskId
        self.provider = provider
        self.status = status
        self.name = name
        self.preview = preview
        self.cwd = cwd
    }

    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case provider
        case status
        case name
        case preview
        case cwd
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
    let createdAt: Date
    let reviewPacket: ReviewPacketDTO

    enum CodingKeys: String, CodingKey {
        case id
        case reviewPacketId = "review_packet_id"
        case taskId = "task_id"
        case priorityScore = "priority_score"
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
                column: resource.column
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
