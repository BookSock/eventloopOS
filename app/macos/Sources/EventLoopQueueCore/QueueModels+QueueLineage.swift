import Foundation

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

    enum WrappedCodingKeys: String, CodingKey {
        case event
    }

    public init(from decoder: Decoder) throws {
        let wrappedContainer = try decoder.container(keyedBy: WrappedCodingKeys.self)
        if wrappedContainer.contains(.event) {
            let eventDecoder = try wrappedContainer.superDecoder(forKey: .event)
            self = try QueueLineageEvent(from: eventDecoder)
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let title = try container.decodeIfPresent(String.self, forKey: .title) ?? id
        self.init(
            id: id,
            source: try container.decodeIfPresent(String.self, forKey: .source) ?? "unknown",
            sourceId: try container.decodeIfPresent(String.self, forKey: .sourceId) ?? id,
            type: try container.decodeIfPresent(String.self, forKey: .type) ?? "event",
            title: title,
            summary: try container.decodeIfPresent(String.self, forKey: .summary) ?? title,
            occurredAt: try container.decode(Date.self, forKey: .occurredAt),
            receivedAt: try container.decodeIfPresent(Date.self, forKey: .receivedAt),
            taskHint: try container.decodeIfPresent(String.self, forKey: .taskHint),
            projectHint: try container.decodeIfPresent(String.self, forKey: .projectHint)
        )
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
    public let recoveryHint: String?

    public init(
        id: String,
        durableId: String? = nil,
        taskSessionId: String,
        origin: String? = nil,
        status: String,
        eventIds: [String],
        textHash: String? = nil,
        textLength: Int? = nil,
        error: String? = nil,
        recoveryHint: String? = nil
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
        self.recoveryHint = recoveryHint
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
        case recoveryHint = "recovery_hint"
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
