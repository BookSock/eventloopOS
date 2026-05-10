import Foundation

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

public struct ManualModeState: Equatable, Sendable, Decodable {
    public let active: Bool
    public let enteredAt: Date?
    public let reason: String?
    public let updatedAt: Date

    public init(active: Bool, enteredAt: Date? = nil, reason: String? = nil, updatedAt: Date) {
        self.active = active
        self.enteredAt = enteredAt
        self.reason = reason
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case active
        case enteredAt = "entered_at"
        case reason
        case updatedAt = "updated_at"
    }
}

public struct ManualModeStateEnvelope: Decodable, Equatable, Sendable {
    public let manualMode: ManualModeState
    public let transitioned: Bool?
    public let requestId: String?

    public init(manualMode: ManualModeState, transitioned: Bool? = nil, requestId: String? = nil) {
        self.manualMode = manualMode
        self.transitioned = transitioned
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case manualMode = "manual_mode"
        case transitioned
        case requestId = "request_id"
    }
}
