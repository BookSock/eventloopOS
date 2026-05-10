import Foundation

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
