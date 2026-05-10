import Foundation

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
