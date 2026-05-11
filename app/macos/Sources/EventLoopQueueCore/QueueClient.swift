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
    func approveOnboardingProposal(_ request: OnboardingApprovalRequest) async throws -> OnboardingApprovalResult
    func batchApproveOnboardingProposals(approvals: [OnboardingApprovalRequest], idempotencyKey: String) async throws -> OnboardingApprovalBatchResult
    func setManualMode(active: Bool, reason: String?) async throws -> ManualModeState
    func getManualMode() async throws -> ManualModeState
    func fetchReadingQueue() async throws -> ReadingQueueListResult
    func promoteReadingQueueContexts(ids: [String]) async throws -> ReadingQueuePromoteResult
    func autoPromoteReadingQueue(minAgeSeconds: Int) async throws -> ReadingQueuePromoteResult
    func bumpQueueItemPriority(packetId: String, delta: Int?, score: Int?, reason: String?) async throws -> QueueActionResult
    func masterFanOut(message: String, taskHintSubstring: String?, taskIdPattern: String?, taskIds: [String], dryRun: Bool, idempotencyKey: String) async throws -> MasterFanOutResult
    func fetchActivity(limit: Int) async throws -> ActivityFeedResult
    func runCodexAutoBind() async throws -> CodexAutoBindResult
    func createTask(primaryAnchor: TaskAnchor, capturedLayout: WorkspaceSnapshot, autoPaperIdleSeconds: Int?, idempotencyKey: String) async throws -> CreateTaskResult
    func getCurrentTask() async throws -> CurrentTaskState
    func setCurrentTask(taskId: String?) async throws -> CurrentTaskState
    func listTasks() async throws -> [TaskRecord]
    func getTaskWithLayout(taskId: String) async throws -> TaskGetEnvelope
    func updateTaskLayout(taskId: String, layout: WorkspaceSnapshot) async throws -> TaskRecord
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

    func approveOnboardingProposal(id: String, queuePaper: Bool) async throws -> OnboardingApprovalResult {
        try await approveOnboardingProposal(OnboardingApprovalRequest(proposalId: id, queuePaper: queuePaper))
    }

    func bindTaskSession(sessionId: String, taskId: String) async throws -> TaskBinding {
        try await bindTaskSession(sessionId: sessionId, taskId: taskId, terminalRef: nil)
    }

    func saveTaskWorkspaceSnapshot(taskId: String, workspaceSnapshot: WorkspaceSnapshot) async throws -> TaskWorkspaceSnapshotSaveResult {
        try await saveTaskWorkspaceSnapshot(taskId: taskId, workspaceSnapshot: workspaceSnapshot, sourceQueueItemId: nil)
    }

    func setManualMode(active: Bool) async throws -> ManualModeState {
        try await setManualMode(active: active, reason: nil)
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
        try await approveOnboardingProposal(OnboardingApprovalRequest(
            proposalId: id,
            queuePaper: queuePaper,
            actorId: "mac_queue_app"
        ))
    }

    public func approveOnboardingProposal(_ approval: OnboardingApprovalRequest) async throws -> OnboardingApprovalResult {
        let url = baseURL.appending(path: "onboarding/approvals")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(approval)

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(OnboardingApprovalResult.self, from: data)
    }

    public func batchApproveOnboardingProposals(
        approvals: [OnboardingApprovalRequest],
        idempotencyKey: String
    ) async throws -> OnboardingApprovalBatchResult {
        let url = baseURL.appending(path: "onboarding/approvals/batch")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try encoder.encode(OnboardingApprovalBatchRequestBody(
            approvals: approvals,
            idempotencyKey: idempotencyKey
        ))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(OnboardingApprovalBatchResult.self, from: data)
    }

    public func setManualMode(active: Bool, reason: String? = nil) async throws -> ManualModeState {
        let url = baseURL.appending(path: "modes/manual")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(ManualModeRequestBody(active: active, reason: reason))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(ManualModeStateEnvelope.self, from: data).manualMode
    }

    public func getManualMode() async throws -> ManualModeState {
        let url = baseURL.appending(path: "modes/manual")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(ManualModeStateEnvelope.self, from: data).manualMode
    }

    public func masterFanOut(
        message: String,
        taskHintSubstring: String? = nil,
        taskIdPattern: String? = nil,
        taskIds: [String] = [],
        dryRun: Bool = false,
        idempotencyKey: String
    ) async throws -> MasterFanOutResult {
        let url = baseURL.appending(path: "master/fan-out")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(MasterFanOutRequest(
            message: message,
            selector: MasterFanOutRequest.Selector(
                taskIds: taskIds.isEmpty ? nil : taskIds,
                taskHintSubstring: taskHintSubstring,
                taskIdPattern: taskIdPattern
            ),
            dryRun: dryRun,
            idempotencyKey: idempotencyKey
        ))
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(MasterFanOutResult.self, from: data)
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

    public func fetchActivity(limit: Int = 30) async throws -> ActivityFeedResult {
        var components = URLComponents(url: baseURL.appending(path: "activity"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        guard let url = components?.url else { throw QueueClientError.invalidResponse }
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(ActivityFeedResult.self, from: data)
    }

    public func runCodexAutoBind() async throws -> CodexAutoBindResult {
        let url = baseURL.appending(path: "agents/codex/auto-bind")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(CodexAutoBindResult.self, from: data)
    }

    public func createTask(
        primaryAnchor: TaskAnchor,
        capturedLayout: WorkspaceSnapshot,
        autoPaperIdleSeconds: Int? = nil,
        idempotencyKey: String
    ) async throws -> CreateTaskResult {
        let url = baseURL.appending(path: "tasks")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try encoder.encode(CreateTaskRequest(
            primaryAnchor: primaryAnchor,
            capturedLayout: capturedLayout,
            autoPaperIdleSeconds: autoPaperIdleSeconds
        ))
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(CreateTaskResult.self, from: data)
    }

    public func getCurrentTask() async throws -> CurrentTaskState {
        let url = baseURL.appending(path: "tasks/current")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(CurrentTaskState.self, from: data)
    }

    public func setCurrentTask(taskId: String?) async throws -> CurrentTaskState {
        let url = baseURL.appending(path: "tasks/current")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(SetCurrentTaskRequest(taskId: taskId))
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(CurrentTaskState.self, from: data)
    }

    public func listTasks() async throws -> [TaskRecord] {
        let url = baseURL.appending(path: "tasks")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(TasksListEnvelope.self, from: data).tasks
    }

    public func getTaskWithLayout(taskId: String) async throws -> TaskGetEnvelope {
        let url = baseURL.appending(path: "tasks/\(taskId)")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(TaskGetEnvelope.self, from: data)
    }

    public func updateTaskLayout(taskId: String, layout: WorkspaceSnapshot) async throws -> TaskRecord {
        let url = baseURL.appending(path: "tasks/\(taskId)/layout")
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(layout)
        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(TaskLayoutUpdateEnvelope.self, from: data).task
    }

    public func autoPromoteReadingQueue(minAgeSeconds: Int) async throws -> ReadingQueuePromoteResult {
        let url = baseURL.appending(path: "reading-queue/auto-promote")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(["min_age_seconds": minAgeSeconds])
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

private struct OnboardingApprovalBatchRequestBody: Encodable {
    let approvals: [OnboardingApprovalRequest]
    let idempotencyKey: String?

    enum CodingKeys: String, CodingKey {
        case approvals
        case idempotencyKey = "idempotency_key"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(approvals, forKey: .approvals)
        if let idempotencyKey { try container.encode(idempotencyKey, forKey: .idempotencyKey) }
    }
}

private struct ManualModeRequestBody: Encodable {
    let active: Bool
    let reason: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(active, forKey: .active)
        if let reason { try container.encode(reason, forKey: .reason) }
    }

    enum CodingKeys: String, CodingKey {
        case active
        case reason
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

private struct MasterFanOutRequest: Encodable {
    let message: String
    let selector: Selector
    let dryRun: Bool
    let idempotencyKey: String

    struct Selector: Encodable {
        let taskIds: [String]?
        let taskHintSubstring: String?
        let taskIdPattern: String?

        enum CodingKeys: String, CodingKey {
            case taskIds = "task_ids"
            case taskHintSubstring = "task_hint_substring"
            case taskIdPattern = "task_id_pattern"
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            if let taskIds, !taskIds.isEmpty { try container.encode(taskIds, forKey: .taskIds) }
            if let taskHintSubstring { try container.encode(taskHintSubstring, forKey: .taskHintSubstring) }
            if let taskIdPattern { try container.encode(taskIdPattern, forKey: .taskIdPattern) }
        }
    }

    enum CodingKeys: String, CodingKey {
        case message
        case selector
        case dryRun = "dry_run"
        case idempotencyKey = "idempotency_key"
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

private struct CreateTaskRequest: Encodable {
    let primaryAnchor: TaskAnchor
    let capturedLayout: WorkspaceSnapshot
    let autoPaperIdleSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case primaryAnchor = "primary_anchor"
        case capturedLayout = "captured_layout"
        case autoPaperIdleSeconds = "auto_paper_idle_seconds"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(primaryAnchor, forKey: .primaryAnchor)
        try container.encode(capturedLayout, forKey: .capturedLayout)
        if let autoPaperIdleSeconds {
            try container.encode(autoPaperIdleSeconds, forKey: .autoPaperIdleSeconds)
        }
    }
}

private struct SetCurrentTaskRequest: Encodable {
    let taskId: String?

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(taskId, forKey: .taskId)
    }
}

private func masterPromptForNewTask(text: String, taskId: String) -> String {
    let spaced = taskId.dropFirst("task_".count).replacingOccurrences(of: "_", with: " ")
    return [
        "[task:\(slugifyTaskName(String(spaced)))]",
        "You are background task agent controlled by eventloopOS.",
        "Work async. Use tests/proofs where possible. If human judgment needed, create waiting_approval or blocked status through eventloopOS agent run CLI.",
        "",
        text,
    ].joined(separator: "\n")
}

public func slugifyTaskName(_ name: String) -> String {
    let lowered = name.lowercased()
    var dashed = ""
    var lastWasSpace = false
    for character in lowered {
        if character.isWhitespace {
            if !lastWasSpace {
                dashed.append("-")
                lastWasSpace = true
            }
        } else {
            dashed.append(character)
            lastWasSpace = false
        }
    }
    var scalars = ""
    for character in dashed {
        if character == "-" {
            scalars.append(character)
        } else if let ascii = character.asciiValue,
                  (ascii >= 0x30 && ascii <= 0x39) || (ascii >= 0x61 && ascii <= 0x7A) {
            scalars.append(character)
        }
    }
    while scalars.contains("--") {
        scalars = scalars.replacingOccurrences(of: "--", with: "-")
    }
    while scalars.hasPrefix("-") { scalars.removeFirst() }
    while scalars.hasSuffix("-") { scalars.removeLast() }
    return scalars
}

func normalizedTaskId(from raw: String) -> String? {
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
