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
