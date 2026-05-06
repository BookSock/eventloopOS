import Foundation

public struct ReviewPacket: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let reviewPacketId: String
    public let title: String
    public let summary: String
    public let source: String
    public let priority: Int
    public let recommendedAction: String
    public let createdAt: Date
    public let workspaceSnapshot: WorkspaceSnapshot?

    public init(
        id: String,
        reviewPacketId: String? = nil,
        title: String,
        summary: String,
        source: String,
        priority: Int,
        recommendedAction: String,
        createdAt: Date,
        workspaceSnapshot: WorkspaceSnapshot? = nil
    ) {
        self.id = id
        self.reviewPacketId = reviewPacketId ?? id
        self.title = title
        self.summary = summary
        self.source = source
        self.priority = priority
        self.recommendedAction = recommendedAction
        self.createdAt = createdAt
        self.workspaceSnapshot = workspaceSnapshot
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

struct QueueItemDTO: Codable, Equatable, Sendable {
    let id: String
    let reviewPacketId: String
    let priorityScore: Int
    let createdAt: Date
    let reviewPacket: ReviewPacketDTO

    enum CodingKeys: String, CodingKey {
        case id
        case reviewPacketId = "review_packet_id"
        case priorityScore = "priority_score"
        case createdAt = "created_at"
        case reviewPacket = "review_packet"
    }

    var packet: ReviewPacket {
        ReviewPacket(
            id: id,
            reviewPacketId: reviewPacketId,
            title: reviewPacket.title,
            summary: reviewPacket.summary,
            source: reviewPacket.primarySource,
            priority: priorityScore,
            recommendedAction: reviewPacket.recommendedAction.label,
            createdAt: createdAt,
            workspaceSnapshot: reviewPacket.workspaceSnapshot
        )
    }
}

struct ReviewPacketDTO: Codable, Equatable, Sendable {
    let id: String
    let title: String
    let summary: String
    let recommendedAction: ActionDTO
    let context: [ContextResourceDTO]

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case summary
        case recommendedAction = "recommended_action"
        case context
    }

    var primarySource: String {
        context.compactMap(\.url).first ?? id
    }

    var workspaceSnapshot: WorkspaceSnapshot? {
        context.compactMap(\.workspaceSnapshot).first
    }
}

struct ActionDTO: Codable, Equatable, Sendable {
    let label: String
}

struct ContextResourceDTO: Codable, Equatable, Sendable {
    let url: String?
    let kind: String?
    let snapshot: WorkspaceSnapshot?

    var workspaceSnapshot: WorkspaceSnapshot? {
        guard kind == "workspace_snapshot" else {
            return nil
        }
        return snapshot
    }
}
