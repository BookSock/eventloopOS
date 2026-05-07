import Foundation

public protocol QueueClient: Sendable {
    func fetchQueue() async throws -> [ReviewPacket]
    func complete(packetId: String) async throws -> QueueActionResult
    func executeRecommendedAction(packetId: String) async throws -> QueueActionResult
    func renewLease(packetId: String) async throws -> QueueActionResult
    func next(after packetId: String?) async throws -> ReviewPacket?
    func contextRestorePlan(resource: ReviewContextResource) async throws -> ContextRestorePlan
    func requestContextRestore(resource: ReviewContextResource, idempotencyKey: String) async throws -> ContextRestoreRequest
    func contextRestoreRequest(id: String) async throws -> ContextRestoreRequest
}

public enum QueueClientError: Error, Equatable, LocalizedError {
    case invalidResponse
    case httpStatus(Int)
    case packetNotFound(String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Invalid queue response"
        case let .httpStatus(status):
            "Queue request failed with HTTP \(status)"
        case let .packetNotFound(packetId):
            "Queue packet not found: \(packetId)"
        }
    }
}

public struct HTTPQueueClient: QueueClient {
    public let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = QueueCoders.makeDecoder()
        self.encoder = QueueCoders.makeEncoder()
    }

    public func fetchQueue() async throws -> [ReviewPacket] {
        let url = baseURL.appending(path: "queue")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(QueueEnvelope.self, from: data).packets
    }

    public func complete(packetId: String) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/done")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode([
            "action": "done",
            "actor_id": "mac_queue_app"
        ])

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueActionResult.self, from: data)
    }

    public func executeRecommendedAction(packetId: String) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/actions/recommended")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode([
            "actor_id": "mac_queue_app"
        ])

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueActionResult.self, from: data)
    }

    public func renewLease(packetId: String) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/lease/renew")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(LeaseNextRequest(leaseOwner: "mac_queue_app", leaseMs: 60_000))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueActionResult.self, from: data)
    }

    public func next(after packetId: String?) async throws -> ReviewPacket? {
        let url = baseURL.appending(path: "queue/lease-next")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(LeaseNextRequest(leaseOwner: "mac_queue_app", leaseMs: 60_000))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueNextEnvelope.self, from: data).packet
    }

    public func contextRestorePlan(resource: ReviewContextResource) async throws -> ContextRestorePlan {
        let url = baseURL.appending(path: "contexts/restore-plan")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(ContextRestorePlanRequest(resource: resource))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(ContextRestorePlanEnvelope.self, from: data).restorePlan
    }

    public func requestContextRestore(
        resource: ReviewContextResource,
        idempotencyKey: String
    ) async throws -> ContextRestoreRequest {
        let url = baseURL.appending(path: "contexts/restore-requests")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try encoder.encode(ContextRestorePlanRequest(resource: resource))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(ContextRestoreRequestEnvelope.self, from: data).restoreRequest
    }

    public func contextRestoreRequest(id: String) async throws -> ContextRestoreRequest {
        let url = baseURL.appending(path: "contexts/restore-requests/\(id)")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(ContextRestoreRequestEnvelope.self, from: data).restoreRequest
    }

    private func validate(response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw QueueClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw QueueClientError.httpStatus(httpResponse.statusCode)
        }
    }
}

private struct LeaseNextRequest: Encodable {
    let leaseOwner: String
    let leaseMs: Int

    enum CodingKeys: String, CodingKey {
        case leaseOwner = "lease_owner"
        case leaseMs = "lease_ms"
    }
}

private struct ContextRestorePlanRequest: Encodable {
    let resource: ReviewContextResource
}

public final class FakeQueueClient: QueueClient, @unchecked Sendable {
    private let lock = NSLock()
    private var packets: [ReviewPacket]
    private let contextRestorePlanResult: Result<ContextRestorePlan, Error>
    private let contextRestoreRequestResult: Result<ContextRestoreRequest, Error>
    private let contextRestoreStatusResult: Result<ContextRestoreRequest, Error>
    private var contextRestoreStatusResults: [Result<ContextRestoreRequest, Error>]
    private var completedIds: [String] = []
    private var leasedIds: Set<String> = []
    private var leaseOrder: [String] = []
    private var renewedIds: [String] = []
    private var contextRestoreResources: [ReviewContextResource] = []
    private var contextRestoreRequestResources: [ReviewContextResource] = []
    private var contextRestoreRequestIdempotencyKeys: [String] = []
    private var contextRestoreStatusIds: [String] = []
    private var executedRecommendedActionIds: [String] = []

    public init(
        packets: [ReviewPacket] = SeededQueue.packets,
        contextRestorePlanResult: Result<ContextRestorePlan, Error> = .success(
            ContextRestorePlan(
                kind: "open_url",
                sideEffect: "local",
                executeSupported: false,
                target: nil,
                message: nil,
                url: "https://example.test/context",
                path: nil,
                line: nil,
                column: nil
            )
        ),
        contextRestoreRequestResult: Result<ContextRestoreRequest, Error> = .success(
            ContextRestoreRequest(
                id: "ctx_restore_fake",
                status: "pending",
                resource: ReviewContextResource(
                    id: "ctx_browser_fake",
                    kind: "browser_tab",
                    title: "Fake browser tab",
                    url: "https://example.test/context",
                    restoreConfidence: "high"
                ),
                restorePlan: ContextRestorePlan(
                    kind: "browser_extension_message",
                    sideEffect: "local",
                    executeSupported: false,
                    target: "eventloopOS browser extension runtime",
                    message: nil,
                    url: nil,
                    path: nil,
                    line: nil,
                    column: nil
                )
            )
        ),
        contextRestoreStatusResult: Result<ContextRestoreRequest, Error>? = nil,
        contextRestoreStatusResults: [Result<ContextRestoreRequest, Error>] = []
    ) {
        self.packets = packets.sorted { $0.priority > $1.priority }
        self.contextRestorePlanResult = contextRestorePlanResult
        self.contextRestoreRequestResult = contextRestoreRequestResult
        self.contextRestoreStatusResult = contextRestoreStatusResult ?? contextRestoreRequestResult
        self.contextRestoreStatusResults = contextRestoreStatusResults
    }

    public var completedPacketIds: [String] {
        lock.withLock { completedIds }
    }

    public var leasedPacketIds: [String] {
        lock.withLock { leaseOrder }
    }

    public var renewedPacketIds: [String] {
        lock.withLock { renewedIds }
    }

    public var contextRestorePlanResources: [ReviewContextResource] {
        lock.withLock { contextRestoreResources }
    }

    public var requestedContextRestoreResources: [ReviewContextResource] {
        lock.withLock { contextRestoreRequestResources }
    }

    public var requestedContextRestoreIdempotencyKeys: [String] {
        lock.withLock { contextRestoreRequestIdempotencyKeys }
    }

    public var checkedContextRestoreIds: [String] {
        lock.withLock { contextRestoreStatusIds }
    }

    public var executedRecommendedActions: [String] {
        lock.withLock { executedRecommendedActionIds }
    }

    public func replacePackets(_ nextPackets: [ReviewPacket]) {
        lock.withLock {
            packets = nextPackets.sorted { $0.priority > $1.priority }
            leasedIds = leasedIds.intersection(Set(packets.map(\.id)))
        }
    }

    public func fetchQueue() async throws -> [ReviewPacket] {
        lock.withLock { packets }
    }

    public func complete(packetId: String) async throws -> QueueActionResult {
        try lock.withLock {
            guard let index = packets.firstIndex(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            packets.remove(at: index)
            leasedIds.remove(packetId)
            completedIds.append(packetId)
            return QueueActionResult(ok: true, completedPacketId: packetId, nextPacket: packets.first)
        }
    }

    public func executeRecommendedAction(packetId: String) async throws -> QueueActionResult {
        try lock.withLock {
            guard let index = packets.firstIndex(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            packets.remove(at: index)
            leasedIds.remove(packetId)
            executedRecommendedActionIds.append(packetId)
            return QueueActionResult(ok: true, completedPacketId: packetId, nextPacket: packets.first)
        }
    }

    public func renewLease(packetId: String) async throws -> QueueActionResult {
        try lock.withLock {
            guard packets.contains(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            guard leasedIds.contains(packetId) else {
                throw QueueClientError.httpStatus(409)
            }
            renewedIds.append(packetId)
            return QueueActionResult(ok: true, completedPacketId: nil, nextPacket: packets.first)
        }
    }

    public func next(after packetId: String?) async throws -> ReviewPacket? {
        lock.withLock {
            let candidates: [ReviewPacket]
            if let packetId, let index = packets.firstIndex(where: { $0.id == packetId }) {
                candidates = Array(packets.dropFirst(index + 1)) + Array(packets.prefix(index + 1))
            } else {
                candidates = packets
            }
            guard let packet = candidates.first(where: { !leasedIds.contains($0.id) }) else {
                return nil
            }
            leasedIds.insert(packet.id)
            leaseOrder.append(packet.id)
            return packet
        }
    }

    public func contextRestorePlan(resource: ReviewContextResource) async throws -> ContextRestorePlan {
        try lock.withLock {
            contextRestoreResources.append(resource)
            return try contextRestorePlanResult.get()
        }
    }

    public func requestContextRestore(
        resource: ReviewContextResource,
        idempotencyKey: String
    ) async throws -> ContextRestoreRequest {
        try lock.withLock {
            contextRestoreRequestResources.append(resource)
            contextRestoreRequestIdempotencyKeys.append(idempotencyKey)
            return try contextRestoreRequestResult.get()
        }
    }

    public func contextRestoreRequest(id: String) async throws -> ContextRestoreRequest {
        try lock.withLock {
            contextRestoreStatusIds.append(id)
            if !contextRestoreStatusResults.isEmpty {
                return try contextRestoreStatusResults.removeFirst().get()
            }
            return try contextRestoreStatusResult.get()
        }
    }
}
