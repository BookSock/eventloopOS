import Foundation

public protocol QueueClient: Sendable {
    func fetchQueue() async throws -> [ReviewPacket]
    func complete(packetId: String, workspaceSnapshot: WorkspaceSnapshot?) async throws -> QueueActionResult
    func deferPacket(packetId: String, until dueAt: Date, workspaceSnapshot: WorkspaceSnapshot?) async throws -> QueueActionResult
    func ignorePacket(packetId: String, workspaceSnapshot: WorkspaceSnapshot?) async throws -> QueueActionResult
    func executeRecommendedAction(packetId: String, workspaceSnapshot: WorkspaceSnapshot?) async throws -> QueueActionResult
    func renewLease(packetId: String) async throws -> QueueActionResult
    func next(after packetId: String?) async throws -> ReviewPacket?
    func contextRestorePlan(resource: ReviewContextResource) async throws -> ContextRestorePlan
    func requestContextRestore(resource: ReviewContextResource, idempotencyKey: String) async throws -> ContextRestoreRequest
    func contextRestoreRequest(id: String) async throws -> ContextRestoreRequest
    func fetchQueueLineage(packetId: String, limit: Int) async throws -> QueueLineage
    func fetchTaskSessions() async throws -> [TaskSession]
    func bindTaskSession(sessionId: String, taskId: String, terminalRef: String?) async throws -> TaskBinding
    func saveTaskWorkspaceSnapshot(taskId: String, workspaceSnapshot: WorkspaceSnapshot, sourceQueueItemId: String?) async throws -> TaskWorkspaceSnapshotSaveResult
    func sendMasterCommand(text: String, taskHint: String?) async throws -> MasterCommandResult
    func startMasterTask(text: String, taskHint: String?, cwd: String?, model: String?, workspaceSnapshot: WorkspaceSnapshot?) async throws -> TaskSessionStartResult
    func fetchOnboardingScan() async throws -> OnboardingScan
    func approveOnboardingProposal(id: String, queuePaper: Bool) async throws -> OnboardingApprovalResult
    func fetchReadingQueue() async throws -> ReadingQueueListResult
    func promoteReadingQueueContexts(ids: [String]) async throws -> ReadingQueuePromoteResult
    func bumpQueueItemPriority(packetId: String, delta: Int?, score: Int?, reason: String?) async throws -> QueueActionResult
}

public extension QueueClient {
    func complete(packetId: String) async throws -> QueueActionResult {
        try await complete(packetId: packetId, workspaceSnapshot: nil)
    }

    func deferPacket(packetId: String, until dueAt: Date) async throws -> QueueActionResult {
        try await deferPacket(packetId: packetId, until: dueAt, workspaceSnapshot: nil)
    }

    func ignorePacket(packetId: String) async throws -> QueueActionResult {
        try await ignorePacket(packetId: packetId, workspaceSnapshot: nil)
    }

    func executeRecommendedAction(packetId: String) async throws -> QueueActionResult {
        try await executeRecommendedAction(packetId: packetId, workspaceSnapshot: nil)
    }

    func approveOnboardingProposal(id: String) async throws -> OnboardingApprovalResult {
        try await approveOnboardingProposal(id: id, queuePaper: false)
    }

    func bindTaskSession(sessionId: String, taskId: String) async throws -> TaskBinding {
        try await bindTaskSession(sessionId: sessionId, taskId: taskId, terminalRef: nil)
    }

    func saveTaskWorkspaceSnapshot(taskId: String, workspaceSnapshot: WorkspaceSnapshot) async throws -> TaskWorkspaceSnapshotSaveResult {
        try await saveTaskWorkspaceSnapshot(taskId: taskId, workspaceSnapshot: workspaceSnapshot, sourceQueueItemId: nil)
    }
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

    public func complete(packetId: String, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/done")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(QueueDoneRequest(
            action: "done",
            actorId: "mac_queue_app",
            workspaceSnapshot: workspaceSnapshot
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueActionResult.self, from: data)
    }

    public func deferPacket(packetId: String, until dueAt: Date, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/defer")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(QueueDeferRequest(
            action: "defer",
            actorId: "mac_queue_app",
            dueAt: dueAt,
            workspaceSnapshot: workspaceSnapshot
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueActionResult.self, from: data)
    }

    public func ignorePacket(packetId: String, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/ignore")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(QueueIgnoreRequest(
            action: "ignore",
            actorId: "mac_queue_app",
            workspaceSnapshot: workspaceSnapshot
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueActionResult.self, from: data)
    }

    public func executeRecommendedAction(packetId: String, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/actions/recommended")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(QueueRecommendedActionRequest(
            actorId: "mac_queue_app",
            workspaceSnapshot: workspaceSnapshot
        ))

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
        request.httpBody = try encoder.encode(LeaseNextRequest(leaseOwner: "mac_queue_app", leaseMs: 60_000, excludeQueueItemId: packetId))

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

    public func fetchQueueLineage(packetId: String, limit: Int = 100) async throws -> QueueLineage {
        var components = URLComponents(url: baseURL.appending(path: "queue/\(packetId)/lineage"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        guard let url = components?.url else {
            throw QueueClientError.invalidResponse
        }
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(QueueLineageEnvelope.self, from: data).lineage
    }

    public func fetchTaskSessions() async throws -> [TaskSession] {
        let url = baseURL.appending(path: "task-sessions")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(TaskSessionsEnvelope.self, from: data).sessions
    }

    public func bindTaskSession(sessionId: String, taskId: String, terminalRef: String? = nil) async throws -> TaskBinding {
        let url = baseURL.appending(path: "task-sessions/\(sessionId)/task-binding")
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(TaskBindingRequest(taskId: taskId, terminalRef: terminalRef))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(TaskBindingEnvelope.self, from: data).binding
    }

    public func saveTaskWorkspaceSnapshot(
        taskId: String,
        workspaceSnapshot: WorkspaceSnapshot,
        sourceQueueItemId: String? = nil
    ) async throws -> TaskWorkspaceSnapshotSaveResult {
        let url = baseURL.appending(path: "tasks/\(taskId)/workspace-snapshot")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(TaskWorkspaceSnapshotSaveRequest(
            workspaceSnapshot: workspaceSnapshot,
            actorId: "mac_queue_app",
            sourceQueueItemId: sourceQueueItemId
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(TaskWorkspaceSnapshotSaveResult.self, from: data)
    }

    public func sendMasterCommand(text: String, taskHint: String? = nil) async throws -> MasterCommandResult {
        let idempotencyKey = "mac_master_route_\(UUID().uuidString)"
        let url = baseURL.appending(path: "voice/commands")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try encoder.encode(MasterCommandRequest(
            transcript: text,
            taskHint: taskHint,
            idempotencyKey: idempotencyKey,
            sourceId: idempotencyKey
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(MasterCommandResult.self, from: data)
    }

    public func startMasterTask(
        text: String,
        taskHint: String? = nil,
        cwd: String? = nil,
        model: String? = nil,
        workspaceSnapshot: WorkspaceSnapshot? = nil
    ) async throws -> TaskSessionStartResult {
        guard let taskId = normalizedTaskId(from: taskHint ?? text) else {
            throw QueueClientError.invalidResponse
        }
        let idempotencyKey = "mac_master_start_\(UUID().uuidString)"
        let url = baseURL.appending(path: "task-sessions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try encoder.encode(TaskSessionStartRequest(
            taskId: taskId,
            prompt: masterPromptForNewTask(text: text, taskId: taskId),
            cwd: cwd,
            model: model,
            queuePaper: true,
            workspaceSnapshot: workspaceSnapshot,
            idempotencyKey: idempotencyKey
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(TaskSessionStartEnvelope.self, from: data).started
    }

    public func fetchOnboardingScan() async throws -> OnboardingScan {
        let url = baseURL.appending(path: "onboarding/scan")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(OnboardingScan.self, from: data)
    }

    public func approveOnboardingProposal(id: String, queuePaper: Bool = false) async throws -> OnboardingApprovalResult {
        let url = baseURL.appending(path: "onboarding/approvals")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(OnboardingApprovalRequest(
            proposalId: id,
            queuePaper: queuePaper,
            actorId: "mac_queue_app"
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(OnboardingApprovalResult.self, from: data)
    }

    public func bumpQueueItemPriority(packetId: String, delta: Int? = nil, score: Int? = nil, reason: String? = nil) async throws -> QueueActionResult {
        let url = baseURL.appending(path: "queue/\(packetId)/priority")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(QueuePriorityRequest(
            delta: delta,
            score: score,
            reason: reason,
            actorId: "mac_queue_app"
        ))
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(QueueActionResult.self, from: data)
    }

    public func fetchReadingQueue() async throws -> ReadingQueueListResult {
        let url = baseURL.appending(path: "reading-queue")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(ReadingQueueListResult.self, from: data)
    }

    public func promoteReadingQueueContexts(ids: [String]) async throws -> ReadingQueuePromoteResult {
        let url = baseURL.appending(path: "reading-queue/promote")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(ReadingQueuePromoteRequest(
            contextIds: ids.isEmpty ? nil : ids,
            actorId: "mac_queue_app"
        ))
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(ReadingQueuePromoteResult.self, from: data)
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
    let excludeQueueItemId: String?

    init(leaseOwner: String, leaseMs: Int, excludeQueueItemId: String? = nil) {
        self.leaseOwner = leaseOwner
        self.leaseMs = leaseMs
        self.excludeQueueItemId = excludeQueueItemId
    }

    enum CodingKeys: String, CodingKey {
        case leaseOwner = "lease_owner"
        case leaseMs = "lease_ms"
        case excludeQueueItemId = "exclude_queue_item_id"
    }
}

private struct QueueDoneRequest: Encodable {
    let action: String
    let actorId: String
    let workspaceSnapshot: WorkspaceSnapshot?

    enum CodingKeys: String, CodingKey {
        case action
        case actorId = "actor_id"
        case workspaceSnapshot = "workspace_snapshot"
    }
}

private struct QueueDeferRequest: Encodable {
    let action: String
    let actorId: String
    let dueAt: Date
    let workspaceSnapshot: WorkspaceSnapshot?

    enum CodingKeys: String, CodingKey {
        case action
        case actorId = "actor_id"
        case dueAt = "due_at"
        case workspaceSnapshot = "workspace_snapshot"
    }
}

private struct QueueIgnoreRequest: Encodable {
    let action: String
    let actorId: String
    let workspaceSnapshot: WorkspaceSnapshot?

    enum CodingKeys: String, CodingKey {
        case action
        case actorId = "actor_id"
        case workspaceSnapshot = "workspace_snapshot"
    }
}

private struct QueueRecommendedActionRequest: Encodable {
    let actorId: String
    let workspaceSnapshot: WorkspaceSnapshot?

    enum CodingKeys: String, CodingKey {
        case actorId = "actor_id"
        case workspaceSnapshot = "workspace_snapshot"
    }
}

private struct ContextRestorePlanRequest: Encodable {
    let resource: ReviewContextResource
}

private struct TaskBindingRequest: Encodable {
    let taskId: String
    let terminalRef: String?

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case terminalRef = "terminal_ref"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(taskId, forKey: .taskId)
        if let terminalRef {
            try container.encode(terminalRef, forKey: .terminalRef)
        }
    }
}

private struct TaskWorkspaceSnapshotSaveRequest: Encodable {
    let workspaceSnapshot: WorkspaceSnapshot
    let actorId: String
    let sourceQueueItemId: String?

    enum CodingKeys: String, CodingKey {
        case workspaceSnapshot = "workspace_snapshot"
        case actorId = "actor_id"
        case sourceQueueItemId = "source_queue_item_id"
    }
}

private struct MasterCommandRequest: Encodable {
    let transcript: String
    let taskHint: String?
    let idempotencyKey: String
    let sourceId: String

    enum CodingKeys: String, CodingKey {
        case transcript
        case taskHint = "task_hint"
        case idempotencyKey = "idempotency_key"
        case sourceId = "source_id"
    }
}

private struct TaskSessionStartRequest: Encodable {
    let taskId: String
    let prompt: String
    let cwd: String?
    let model: String?
    let queuePaper: Bool
    let workspaceSnapshot: WorkspaceSnapshot?
    let idempotencyKey: String

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case prompt
        case cwd
        case model
        case queuePaper = "queue_paper"
        case workspaceSnapshot = "workspace_snapshot"
        case idempotencyKey = "idempotency_key"
    }
}

private struct OnboardingApprovalRequest: Encodable {
    let proposalId: String
    let queuePaper: Bool
    let actorId: String

    enum CodingKeys: String, CodingKey {
        case proposalId = "proposal_id"
        case queuePaper = "queue_paper"
        case actorId = "actor_id"
    }
}

private struct ReadingQueuePromoteRequest: Encodable {
    let contextIds: [String]?
    let actorId: String

    enum CodingKeys: String, CodingKey {
        case contextIds = "context_ids"
        case actorId = "actor_id"
    }
}

private struct QueuePriorityRequest: Encodable {
    let delta: Int?
    let score: Int?
    let reason: String?
    let actorId: String

    enum CodingKeys: String, CodingKey {
        case delta
        case score
        case reason
        case actorId = "actor_id"
    }
}

private func masterPromptForNewTask(text: String, taskId: String) -> String {
    [
        "[task:\(taskId.dropFirst("task_".count).replacingOccurrences(of: "_", with: " "))]",
        "You are background task agent controlled by eventloopOS.",
        "Work async. Use tests/proofs where possible. If human judgment needed, create waiting_approval or blocked status through eventloopOS agent run CLI.",
        "",
        text,
    ].joined(separator: "\n")
}

private func normalizedTaskId(from raw: String) -> String? {
    let lowered = raw.lowercased()
    let pieces = lowered
        .map { character -> Character in
            if character.isLetter || character.isNumber {
                return character
            }
            return "_"
        }
    let collapsed = String(pieces)
        .split(separator: "_")
        .prefix(8)
        .joined(separator: "_")
    guard !collapsed.isEmpty else {
        return nil
    }
    if collapsed.hasPrefix("task_") {
        return collapsed
    }
    return "task_\(collapsed)"
}

public final class FakeQueueClient: QueueClient, @unchecked Sendable {
    private let lock = NSLock()
    private var packets: [ReviewPacket]
    private let contextRestorePlanResult: Result<ContextRestorePlan, Error>
    private let contextRestoreRequestResult: Result<ContextRestoreRequest, Error>
    private let contextRestoreStatusResult: Result<ContextRestoreRequest, Error>
    private var contextRestoreStatusResults: [Result<ContextRestoreRequest, Error>]
    private var completedIds: [String] = []
    private var completedWorkspaceSnapshots: [WorkspaceSnapshot?] = []
    private var deferredIds: [String] = []
    private var deferredDueAts: [String: Date] = [:]
    private var deferredWorkspaceSnapshots: [WorkspaceSnapshot?] = []
    private var ignoredIds: [String] = []
    private var ignoredWorkspaceSnapshots: [WorkspaceSnapshot?] = []
    private var leasedIds: Set<String> = []
    private var leaseOrder: [String] = []
    private var renewedIds: [String] = []
    private var contextRestoreResources: [ReviewContextResource] = []
    private var contextRestoreRequestResources: [ReviewContextResource] = []
    private var contextRestoreRequestIdempotencyKeys: [String] = []
    private var contextRestoreStatusIds: [String] = []
    private let queueLineageResult: Result<QueueLineage, Error>?
    private var queueLineagePacketIds: [String] = []
    private var executedRecommendedActionIds: [String] = []
    private var executedRecommendedActionSnapshots: [WorkspaceSnapshot?] = []
    private var taskSessions: [TaskSession]
    private var taskBindings: [TaskBinding] = []
    private var savedTaskWorkspaceSnapshots: [(taskId: String, workspaceSnapshot: WorkspaceSnapshot, sourceQueueItemId: String?)] = []
    private var masterCommands: [(text: String, taskHint: String?)] = []
    private var masterTaskStarts: [(text: String, taskHint: String?, cwd: String?, model: String?, workspaceSnapshot: WorkspaceSnapshot?)] = []
    private var onboardingScan: OnboardingScan
    private var approvedOnboardingIds: [String] = []
    private var readingQueueContexts: [ReadingQueueContext] = []
    private let masterCommandResult: MasterCommandResult?

    public init(
        packets: [ReviewPacket] = SeededQueue.packets,
        taskSessions: [TaskSession] = [
            TaskSession(
                id: "task_session_blog",
                taskId: "task_blog_feedback",
                provider: "fake",
                status: "idle",
                name: "Blog feedback"
            )
        ],
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
        contextRestoreStatusResults: [Result<ContextRestoreRequest, Error>] = [],
        queueLineageResult: Result<QueueLineage, Error>? = nil,
        masterCommandResult: MasterCommandResult? = nil
    ) {
        self.packets = packets.sorted { $0.priority > $1.priority }
        self.taskSessions = taskSessions
        self.onboardingScan = FakeQueueClient.makeDefaultOnboardingScan(taskSessions: taskSessions)
        self.contextRestorePlanResult = contextRestorePlanResult
        self.contextRestoreRequestResult = contextRestoreRequestResult
        self.contextRestoreStatusResult = contextRestoreStatusResult ?? contextRestoreRequestResult
        self.contextRestoreStatusResults = contextRestoreStatusResults
        self.queueLineageResult = queueLineageResult
        self.masterCommandResult = masterCommandResult
    }

    public var completedPacketIds: [String] {
        lock.withLock { completedIds }
    }

    public var completedPacketWorkspaceSnapshots: [WorkspaceSnapshot?] {
        lock.withLock { completedWorkspaceSnapshots }
    }

    public var deferredPacketIds: [String] {
        lock.withLock { deferredIds }
    }

    public var deferredPacketDueAts: [String: Date] {
        lock.withLock { deferredDueAts }
    }

    public var deferredPacketWorkspaceSnapshots: [WorkspaceSnapshot?] {
        lock.withLock { deferredWorkspaceSnapshots }
    }

    public var ignoredPacketIds: [String] {
        lock.withLock { ignoredIds }
    }

    public var ignoredPacketWorkspaceSnapshots: [WorkspaceSnapshot?] {
        lock.withLock { ignoredWorkspaceSnapshots }
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

    public var requestedQueueLineagePacketIds: [String] {
        lock.withLock { queueLineagePacketIds }
    }

    public var executedRecommendedActions: [String] {
        lock.withLock { executedRecommendedActionIds }
    }

    public var executedRecommendedActionWorkspaceSnapshots: [WorkspaceSnapshot?] {
        lock.withLock { executedRecommendedActionSnapshots }
    }

    public var boundTaskSessions: [TaskBinding] {
        lock.withLock { taskBindings }
    }

    public var taskWorkspaceSnapshotSaves: [(taskId: String, workspaceSnapshot: WorkspaceSnapshot, sourceQueueItemId: String?)] {
        lock.withLock { savedTaskWorkspaceSnapshots }
    }

    public var sentMasterCommands: [(text: String, taskHint: String?)] {
        lock.withLock { masterCommands }
    }

    public var startedMasterTasks: [(text: String, taskHint: String?, cwd: String?, model: String?, workspaceSnapshot: WorkspaceSnapshot?)] {
        lock.withLock { masterTaskStarts }
    }

    public var approvedOnboardingProposalIds: [String] {
        lock.withLock { approvedOnboardingIds }
    }

    public func replacePackets(_ nextPackets: [ReviewPacket]) {
        lock.withLock {
            packets = nextPackets.sorted { $0.priority > $1.priority }
            leasedIds = leasedIds.intersection(Set(packets.map(\.id)))
        }
    }

    public func replaceOnboardingScan(_ scan: OnboardingScan) {
        lock.withLock {
            onboardingScan = scan
        }
    }

    public func fetchQueue() async throws -> [ReviewPacket] {
        lock.withLock { packets }
    }

    public func complete(packetId: String, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        try lock.withLock {
            guard let index = packets.firstIndex(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            packets.remove(at: index)
            leasedIds.remove(packetId)
            completedIds.append(packetId)
            completedWorkspaceSnapshots.append(workspaceSnapshot)
            return QueueActionResult(ok: true, completedPacketId: packetId, nextPacket: packets.first)
        }
    }

    public func deferPacket(packetId: String, until dueAt: Date, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        try lock.withLock {
            guard let index = packets.firstIndex(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            packets.remove(at: index)
            leasedIds.remove(packetId)
            deferredIds.append(packetId)
            deferredDueAts[packetId] = dueAt
            deferredWorkspaceSnapshots.append(workspaceSnapshot)
            return QueueActionResult(ok: true, completedPacketId: packetId, nextPacket: packets.first)
        }
    }

    public func ignorePacket(packetId: String, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        try lock.withLock {
            guard let index = packets.firstIndex(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            packets.remove(at: index)
            leasedIds.remove(packetId)
            ignoredIds.append(packetId)
            ignoredWorkspaceSnapshots.append(workspaceSnapshot)
            return QueueActionResult(ok: true, completedPacketId: packetId, nextPacket: packets.first)
        }
    }

    public func executeRecommendedAction(packetId: String, workspaceSnapshot: WorkspaceSnapshot? = nil) async throws -> QueueActionResult {
        try lock.withLock {
            guard let index = packets.firstIndex(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            packets.remove(at: index)
            leasedIds.remove(packetId)
            executedRecommendedActionIds.append(packetId)
            executedRecommendedActionSnapshots.append(workspaceSnapshot)
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

    public func fetchQueueLineage(packetId: String, limit _: Int = 100) async throws -> QueueLineage {
        try lock.withLock {
            queueLineagePacketIds.append(packetId)
            if let queueLineageResult {
                return try queueLineageResult.get()
            }
            guard packets.contains(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            return QueueLineage(
                relatedEventIds: [],
                activity: [],
                taskMessages: [],
                counts: QueueLineageCounts(events: 0, activity: 0, taskMessages: 0)
            )
        }
    }

    public func fetchTaskSessions() async throws -> [TaskSession] {
        lock.withLock { taskSessions }
    }

    public func bindTaskSession(sessionId: String, taskId: String, terminalRef: String? = nil) async throws -> TaskBinding {
        try lock.withLock {
            guard let index = taskSessions.firstIndex(where: { $0.id == sessionId }) else {
                throw QueueClientError.packetNotFound(sessionId)
            }
            let current = taskSessions[index]
            let updated = TaskSession(
                id: current.id,
                taskId: taskId,
                provider: current.provider,
                status: current.status,
                name: current.name,
                preview: current.preview,
                cwd: current.cwd,
                terminalRef: terminalRef ?? current.terminalRef
            )
            taskSessions[index] = updated
            let binding = TaskBinding(ok: true, taskSessionId: sessionId, taskId: taskId, session: updated)
            taskBindings.append(binding)
            return binding
        }
    }

    public func saveTaskWorkspaceSnapshot(
        taskId: String,
        workspaceSnapshot: WorkspaceSnapshot,
        sourceQueueItemId: String? = nil
    ) async throws -> TaskWorkspaceSnapshotSaveResult {
        lock.withLock {
            savedTaskWorkspaceSnapshots.append((taskId: taskId, workspaceSnapshot: workspaceSnapshot, sourceQueueItemId: sourceQueueItemId))
        }
        return TaskWorkspaceSnapshotSaveResult(ok: true, requestId: "req_fake_save_task_workspace")
    }

    public func sendMasterCommand(text: String, taskHint: String?) async throws -> MasterCommandResult {
        lock.withLock {
            masterCommands.append((text: text, taskHint: taskHint))
            if let masterCommandResult {
                return masterCommandResult
            }
            return MasterCommandResult(
                ok: true,
                requestId: "req_master_fake",
                eventId: "evt_master_fake",
                routeAction: "send_to_task",
                targetTaskId: taskHint,
                targetTaskSessionId: taskSessions.first(where: { $0.taskId == taskHint })?.id
            )
        }
    }

    public func startMasterTask(
        text: String,
        taskHint: String?,
        cwd: String?,
        model: String?,
        workspaceSnapshot: WorkspaceSnapshot?
    ) async throws -> TaskSessionStartResult {
        lock.withLock {
            masterTaskStarts.append((text: text, taskHint: taskHint, cwd: cwd, model: model, workspaceSnapshot: workspaceSnapshot))
            let taskId = normalizedTaskId(from: taskHint ?? text) ?? "task_master"
            let session = TaskSession(
                id: "task_session_master_\(masterTaskStarts.count)",
                taskId: taskId,
                provider: "fake",
                status: "idle",
                name: taskHint ?? "Master task",
                preview: text,
                cwd: cwd
            )
            taskSessions.append(session)
            packets.append(ReviewPacket(
                id: "packet_master_task_\(masterTaskStarts.count)",
                taskId: taskId,
                title: "Start \(taskHint ?? taskId)",
                summary: text,
                decisionNeeded: "Work this new master-started task or send instructions to its agent.",
                source: "master",
                priority: 760,
                priorityReasons: ["master_task_started"],
                contextResources: [],
                recommendedAction: "Route to task agent",
                recommendedActionType: "resume_agent",
                createdAt: Date(timeIntervalSince1970: 1_778_070_000),
                workspaceSnapshot: workspaceSnapshot
            ))
            packets.sort { $0.priority > $1.priority }
            return TaskSessionStartResult(ok: true, taskSessionId: session.id, taskId: taskId, session: session)
        }
    }

    public func fetchOnboardingScan() async throws -> OnboardingScan {
        lock.withLock { onboardingScan }
    }

    public func approveOnboardingProposal(id: String, queuePaper: Bool = false) async throws -> OnboardingApprovalResult {
        try lock.withLock {
            guard let proposal = onboardingScan.proposals.first(where: { $0.id == id || $0.taskId == id }) else {
                throw QueueClientError.packetNotFound(id)
            }
            approvedOnboardingIds.append(id)
            for session in proposal.taskSessions {
                _ = try bindTaskSessionInLock(sessionId: session.id, taskId: proposal.taskId)
            }
            let queuedPaper: OnboardingQueuedPaper?
            if queuePaper {
                let workspaceSnapshot = proposal.windows.isEmpty
                    ? nil
                    : WorkspaceSnapshot(
                        windows: proposal.windows.map { window in
                            WorkspaceWindow(
                                id: window.id,
                                app: window.app,
                                title: window.title,
                                workspace: window.workspace
                            )
                        },
                        activeWorkspace: proposal.windows.first?.workspace,
                        focusedWindowId: proposal.windows.first?.id
                    )
                let packet = ReviewPacket(
                    id: "qit_onboarding_\(proposal.taskId)",
                    reviewPacketId: "pkt_onboarding_\(proposal.taskId)",
                    taskId: proposal.taskId,
                    title: "\(proposal.title) workbench",
                    summary: "Approved onboarding workbench is ready for human processing.",
                    decisionNeeded: "Review bound workbench and decide next action.",
                    source: "onboarding",
                    priority: 700,
                    riskLevel: "medium",
                    confidence: "high",
                    riskTags: ["onboarding_workbench"],
                    contextResources: proposal.browserContexts.map { context in
                        ReviewContextResource(
                            id: context.id,
                            kind: "browser_tab",
                            title: context.title,
                            url: context.url,
                            source: "chrome-extension",
                            restoreConfidence: context.restoreConfidence,
                            windowId: context.windowId,
                            tabId: context.tabId
                        )
                    },
                    recommendedAction: "Work this paper, then Done / Next",
                    recommendedActionType: "mark_done",
                    createdAt: Date(timeIntervalSince1970: 1_778_070_000),
                    workspaceSnapshot: workspaceSnapshot
                )
                if !packets.contains(where: { $0.id == packet.id }) {
                    packets.append(packet)
                    packets.sort { $0.priority > $1.priority }
                }
                queuedPaper = OnboardingQueuedPaper(
                    id: packet.id,
                    reviewPacketId: packet.reviewPacketId,
                    taskId: packet.taskId,
                    state: "ready",
                    priorityScore: packet.priority
                )
            } else {
                queuedPaper = nil
            }

            return OnboardingApprovalResult(
                ok: true,
                taskId: proposal.taskId,
                proposalId: proposal.id,
                bindings: taskBindings.filter { $0.taskId == proposal.taskId },
                browserContextBindings: proposal.browserContexts.map { context in
                    OnboardingBrowserContextBinding(
                        browserContextId: context.id,
                        eventId: "evt_onboarding_context_bind_\(context.id)",
                        taskId: proposal.taskId
                    )
                },
                queuedPaper: queuedPaper,
                warnings: []
            )
        }
    }

    public func bumpQueueItemPriority(packetId: String, delta: Int? = nil, score: Int? = nil, reason: String? = nil) async throws -> QueueActionResult {
        try lock.withLock {
            guard let index = packets.firstIndex(where: { $0.id == packetId }) else {
                throw QueueClientError.packetNotFound(packetId)
            }
            let current = packets[index]
            let nextPriority: Int
            if let score {
                nextPriority = score
            } else if let delta {
                nextPriority = max(0, min(10_000, current.priority + delta))
            } else {
                nextPriority = current.priority
            }
            var reasons = current.priorityReasons
            let reasonTag = reason ?? "manual_priority_bump"
            if !reasons.contains(reasonTag) {
                reasons.append(reasonTag)
            }
            let updated = ReviewPacket(
                id: current.id,
                reviewPacketId: current.reviewPacketId,
                taskId: current.taskId,
                title: current.title,
                summary: current.summary,
                decisionNeeded: current.decisionNeeded,
                source: current.source,
                priority: nextPriority,
                priorityReasons: reasons,
                riskLevel: current.riskLevel,
                confidence: current.confidence,
                riskTags: current.riskTags,
                contextResources: current.contextResources,
                evidence: current.evidence,
                recommendedAction: current.recommendedAction,
                recommendedActionType: current.recommendedActionType,
                createdAt: current.createdAt,
                workspaceSnapshot: current.workspaceSnapshot
            )
            packets[index] = updated
            packets.sort { $0.priority > $1.priority }
            return QueueActionResult(ok: true, completedPacketId: updated.id, nextPacket: updated)
        }
    }

    public func fetchReadingQueue() async throws -> ReadingQueueListResult {
        lock.withLock {
            ReadingQueueListResult(
                contexts: readingQueueContexts,
                count: readingQueueContexts.count,
                requestId: nil
            )
        }
    }

    public func promoteReadingQueueContexts(ids: [String]) async throws -> ReadingQueuePromoteResult {
        lock.withLock {
            let target: [ReadingQueueContext]
            let missing: [String]
            if ids.isEmpty {
                target = readingQueueContexts
                missing = []
            } else {
                target = readingQueueContexts.filter { ids.contains($0.id) }
                missing = ids.filter { id in !readingQueueContexts.contains(where: { $0.id == id }) }
            }
            var promoted: [ReadingQueuePromotion] = []
            for context in target {
                let queueItemId = "qit_reading_queue_\(context.id)"
                let alreadyPromoted = packets.contains(where: { $0.id == queueItemId })
                if !alreadyPromoted {
                    let packet = ReviewPacket(
                        id: queueItemId,
                        reviewPacketId: "pkt_reading_queue_\(context.id)",
                        taskId: "task_reading_queue",
                        title: "Read: \(context.title)",
                        summary: context.url ?? "Captured tab.",
                        decisionNeeded: "Open or send to agent.",
                        source: "reading-queue",
                        priority: 600,
                        contextResources: [
                            ReviewContextResource(
                                id: context.id,
                                kind: "browser_tab",
                                title: context.title,
                                url: context.url,
                                source: "chrome-extension",
                                restoreConfidence: "medium"
                            )
                        ],
                        recommendedAction: "Open tab",
                        recommendedActionType: "open_link",
                        createdAt: context.capturedAt
                    )
                    packets.append(packet)
                    packets.sort { $0.priority > $1.priority }
                }
                promoted.append(ReadingQueuePromotion(
                    contextId: context.id,
                    queueItemId: queueItemId,
                    reviewPacketId: "pkt_reading_queue_\(context.id)",
                    eventId: context.eventId,
                    idempotent: alreadyPromoted
                ))
            }
            return ReadingQueuePromoteResult(
                ok: true,
                promoted: promoted,
                promotedCount: promoted.count,
                missingContextIds: missing,
                requestId: nil
            )
        }
    }

    public func setReadingQueueContexts(_ contexts: [ReadingQueueContext]) {
        lock.withLock { readingQueueContexts = contexts }
    }

    private func bindTaskSessionInLock(sessionId: String, taskId: String) throws -> TaskBinding {
        guard let index = taskSessions.firstIndex(where: { $0.id == sessionId }) else {
            throw QueueClientError.packetNotFound(sessionId)
        }
        let current = taskSessions[index]
        let updated = TaskSession(
            id: current.id,
            taskId: taskId,
            provider: current.provider,
            status: current.status,
            name: current.name,
            preview: current.preview,
            cwd: current.cwd,
            terminalRef: current.terminalRef
        )
        taskSessions[index] = updated
        let binding = TaskBinding(ok: true, taskSessionId: sessionId, taskId: taskId, session: updated)
        taskBindings.append(binding)
        return binding
    }

    private static func makeDefaultOnboardingScan(taskSessions: [TaskSession]) -> OnboardingScan {
        let proposal = OnboardingTaskProposal(
            id: "onboard_blog_feedback",
            taskId: "task_blog_feedback",
            title: "Blog Feedback",
            confidence: "medium",
            reason: "existing task session",
            windows: [
                OnboardingWindow(id: 91, app: "Ghostty", title: "[task:blog feedback] codex", workspace: "eventloop-blog"),
                OnboardingWindow(id: 92, app: "Google Chrome", title: "Blog draft", workspace: "eventloop-blog"),
            ],
            taskSessions: taskSessions.filter { $0.taskId == "task_blog_feedback" || $0.id == "task_session_blog" },
            suggestedNextAction: "Approve this task context, then let agents continue from it."
        )
        return OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_070_000),
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 91,
            summary: OnboardingScanSummary(
                windowCount: 2,
                groupedWindowCount: 2,
                ungroupedWindowCount: 0,
                taskSessionCount: taskSessions.count,
                browserContextCount: 0,
                proposalCount: 1
            ),
            proposals: [proposal],
            taskSessions: taskSessions,
            warnings: []
        )
    }
}
