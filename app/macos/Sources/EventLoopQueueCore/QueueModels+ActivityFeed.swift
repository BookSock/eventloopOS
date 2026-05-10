import Foundation

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
