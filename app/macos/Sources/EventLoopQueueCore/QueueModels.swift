import Foundation

public enum QueueAuxiliarySheet: String, Identifiable, Equatable, Sendable {
    case masterCommand
    case onboarding
    case activity

    public var id: String {
        rawValue
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
