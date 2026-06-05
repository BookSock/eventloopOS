import Foundation

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
    private var nextLeaseError: Error?
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
    private var batchApprovalCalls: [(approvals: [OnboardingApprovalRequest], idempotencyKey: String)] = []
    private var batchApprovalFailureCount: Int = 0
    private var manualModeFakeState: ManualModeState = ManualModeState(active: false, updatedAt: Date(timeIntervalSince1970: 0))
    private var manualModeFakeError: Error?
    private var manualModeSetCalls: [(active: Bool, reason: String?)] = []
    private var manualModeGetCallCount: Int = 0
    private var readDelayNanoseconds: UInt64 = 0
    private var masterActionDelayNanoseconds: UInt64 = 0
    private var readingQueueContexts: [ReadingQueueContext] = []
    private var fakeActivityEvents: [ActivityEvent] = []
    private var fakeActivityFetchCount: Int = 0
    private var followsWindows: [FollowsWindowRecord] = []
    private var followsWindowExclusions: [FollowsWindowExclusion] = []
    private var fakeAutoBindRunCount: Int = 0
    private let masterCommandResult: MasterCommandResult?
    private var tasks: [TaskRecord] = []
    private var taskLayouts: [String: WorkspaceSnapshot] = [:]
    private var currentTaskId: String?
    private var currentTaskEnteredAt: Date?
    private var createTaskCalls: [(primaryAnchor: TaskAnchor, capturedLayout: WorkspaceSnapshot, terminalRef: String?, idempotencyKey: String)] = []
    private var setCurrentTaskCalls: [String?] = []
    private var updateTaskLayoutCalls: [(taskId: String, layout: WorkspaceSnapshot)] = []
    private var fakeNow: Date = Date(timeIntervalSince1970: 1_778_070_000)

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

    public var batchApprovalRequests: [(approvals: [OnboardingApprovalRequest], idempotencyKey: String)] {
        lock.withLock { batchApprovalCalls }
    }

    public var manualModeSetRequests: [(active: Bool, reason: String?)] {
        lock.withLock { manualModeSetCalls }
    }

    public var manualModeGetRequestCount: Int {
        lock.withLock { manualModeGetCallCount }
    }

    public func setManualModeFakeState(_ state: ManualModeState) {
        lock.withLock { manualModeFakeState = state }
    }

    public func setManualModeFakeError(_ error: Error?) {
        lock.withLock { manualModeFakeError = error }
    }

    public func setReadDelayNanoseconds(_ delay: UInt64) {
        lock.withLock { readDelayNanoseconds = delay }
    }

    public func setMasterActionDelayNanoseconds(_ delay: UInt64) {
        lock.withLock { masterActionDelayNanoseconds = delay }
    }

    public func setNextLeaseError(_ error: Error?) {
        lock.withLock { nextLeaseError = error }
    }

    public func setBatchApprovalFailureCount(_ count: Int) {
        lock.withLock { batchApprovalFailureCount = count }
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
        await sleepReadDelayIfNeeded()
        return lock.withLock { packets }
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
        try lock.withLock {
            if let error = nextLeaseError {
                nextLeaseError = nil
                throw error
            }
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
        await sleepMasterActionDelayIfNeeded()
        return lock.withLock {
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
        await sleepMasterActionDelayIfNeeded()
        return lock.withLock {
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
        try await approveOnboardingProposal(OnboardingApprovalRequest(proposalId: id, queuePaper: queuePaper))
    }

    public func approveOnboardingProposal(_ request: OnboardingApprovalRequest) async throws -> OnboardingApprovalResult {
        try lock.withLock {
            guard let proposal = onboardingScan.proposals.first(where: { $0.id == request.proposalId || $0.taskId == request.proposalId }) else {
                throw QueueClientError.packetNotFound(request.proposalId)
            }
            let approvedTaskId = request.taskId ?? proposal.taskId
            let selectedWindows = request.windowIds.map { ids in
                proposal.windows.filter { ids.contains($0.id) }
            } ?? proposal.windows
            let selectedSessions = request.taskSessionIds.map { ids in
                proposal.taskSessions.filter { ids.contains($0.id) }
            } ?? proposal.taskSessions
            let selectedBrowserContexts = request.browserContextIds.map { ids in
                proposal.browserContexts.filter { ids.contains($0.id) }
            } ?? proposal.browserContexts

            approvedOnboardingIds.append(request.proposalId)
            for session in selectedSessions {
                _ = try bindTaskSessionInLock(sessionId: session.id, taskId: approvedTaskId)
            }
            let queuedPaper: OnboardingQueuedPaper?
            if request.queuePaper {
                let workspaceSnapshot = selectedWindows.isEmpty
                    ? nil
                    : WorkspaceSnapshot(
                        windows: selectedWindows.map { window in
                            WorkspaceWindow(
                                id: window.id,
                                app: window.app,
                                title: window.title,
                                workspace: window.workspace
                            )
                        },
                        activeWorkspace: selectedWindows.first?.workspace,
                        focusedWindowId: selectedWindows.first?.id
                    )
                let packet = ReviewPacket(
                    id: "qit_onboarding_\(approvedTaskId)",
                    reviewPacketId: "pkt_onboarding_\(approvedTaskId)",
                    taskId: approvedTaskId,
                    title: "\(proposal.title) workbench",
                    summary: "Approved onboarding workbench is ready for human processing.",
                    decisionNeeded: "Review bound workbench and decide next action.",
                    source: "onboarding",
                    priority: 700,
                    riskLevel: "medium",
                    confidence: "high",
                    riskTags: ["onboarding_workbench"],
                    contextResources: selectedBrowserContexts.map { context in
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
                taskId: approvedTaskId,
                proposalId: proposal.id,
                bindings: taskBindings.filter { $0.taskId == approvedTaskId },
                browserContextBindings: selectedBrowserContexts.map { context in
                    OnboardingBrowserContextBinding(
                        browserContextId: context.id,
                        eventId: "evt_onboarding_context_bind_\(context.id)",
                        taskId: approvedTaskId
                    )
                },
                queuedPaper: queuedPaper,
                warnings: []
            )
        }
    }

    public func batchApproveOnboardingProposals(
        approvals: [OnboardingApprovalRequest],
        idempotencyKey: String
    ) async throws -> OnboardingApprovalBatchResult {
        let shouldFail: Bool = lock.withLock {
            batchApprovalCalls.append((approvals: approvals, idempotencyKey: idempotencyKey))
            if batchApprovalFailureCount > 0 {
                batchApprovalFailureCount -= 1
                return true
            }
            return false
        }
        if shouldFail {
            throw QueueClientError.httpStatus(503)
        }
        var entries: [OnboardingApprovalBatchEntry] = []
        for approval in approvals {
            do {
                let result = try await approveOnboardingProposal(approval)
                entries.append(OnboardingApprovalBatchEntry(
                    ok: true,
                    proposalId: result.proposalId ?? approval.proposalId,
                    taskId: result.taskId,
                    queuedPaper: result.queuedPaper
                ))
            } catch {
                entries.append(OnboardingApprovalBatchEntry(
                    ok: false,
                    proposalId: approval.proposalId,
                    errorCode: "approval_failed",
                    errorMessage: error.localizedDescription
                ))
            }
        }
        return OnboardingApprovalBatchResult(ok: true, results: entries)
    }

    public func setManualMode(active: Bool, reason: String?) async throws -> ManualModeState {
        try lock.withLock {
            manualModeSetCalls.append((active: active, reason: reason))
            if let manualModeFakeError {
                throw manualModeFakeError
            }
            let now = Date()
            let entered = active ? (manualModeFakeState.active ? manualModeFakeState.enteredAt : now) : nil
            manualModeFakeState = ManualModeState(
                active: active,
                enteredAt: entered,
                reason: active ? reason : nil,
                updatedAt: now
            )
            return manualModeFakeState
        }
    }

    public func getManualMode() async throws -> ManualModeState {
        await sleepReadDelayIfNeeded()
        return try lock.withLock {
            manualModeGetCallCount += 1
            if let manualModeFakeError {
                throw manualModeFakeError
            }
            return manualModeFakeState
        }
    }

    public func masterFanOut(
        message: String,
        taskHintSubstring: String? = nil,
        taskIdPattern: String? = nil,
        taskIds: [String] = [],
        dryRun: Bool = false,
        idempotencyKey: String
    ) async throws -> MasterFanOutResult {
        await sleepMasterActionDelayIfNeeded()
        return lock.withLock {
            let allTaskIds = Set(taskSessions.compactMap { $0.taskId })
            var matchedTaskIds: Set<String> = []
            if !taskIds.isEmpty {
                for id in taskIds where allTaskIds.contains(id) { matchedTaskIds.insert(id) }
            }
            if let needle = taskHintSubstring?.lowercased() {
                for id in allTaskIds where id.lowercased().contains(needle) { matchedTaskIds.insert(id) }
            }
            if let pattern = taskIdPattern, let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                for id in allTaskIds where regex.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil {
                    matchedTaskIds.insert(id)
                }
            }
            let matches = matchedTaskIds.sorted().map { taskId -> MasterFanOutMatch in
                let session = taskSessions.first(where: { $0.taskId == taskId })
                return MasterFanOutMatch(taskId: taskId, taskSessionId: session?.id)
            }
            if dryRun {
                return MasterFanOutResult(
                    ok: true,
                    dryRun: true,
                    matchedCount: matches.count,
                    deliveredCount: 0,
                    preview: matches,
                    delivered: [],
                    skipped: [],
                    fanOutId: nil
                )
            }
            var delivered: [MasterFanOutDelivery] = []
            var skipped: [MasterFanOutSkip] = []
            for match in matches {
                if let sessionId = match.taskSessionId {
                    delivered.append(MasterFanOutDelivery(taskId: match.taskId, taskSessionId: sessionId))
                    masterCommands.append((text: message, taskHint: match.taskId))
                } else {
                    skipped.append(MasterFanOutSkip(taskId: match.taskId, reason: "no_bound_session"))
                }
            }
            return MasterFanOutResult(
                ok: true,
                dryRun: false,
                matchedCount: matches.count,
                deliveredCount: delivered.count,
                preview: matches,
                delivered: delivered,
                skipped: skipped,
                fanOutId: "fake_fan_\(idempotencyKey)"
            )
        }
    }

    public func bumpQueueItemPriority(packetId: String, delta: Int? = nil, score: Int? = nil, reason: String? = nil) async throws -> QueueActionResult {
        await sleepMasterActionDelayIfNeeded()
        return try lock.withLock {
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

    public func autoPromoteReadingQueue(minAgeSeconds: Int) async throws -> ReadingQueuePromoteResult {
        // Fake stub: same as promoting all unbound. Tests can layer behavior on top.
        return try await promoteReadingQueueContexts(ids: [])
    }

    public func fetchActivity(limit: Int = 30) async throws -> ActivityFeedResult {
        lock.withLock {
            fakeActivityFetchCount += 1
            return ActivityFeedResult(count: fakeActivityEvents.count, events: Array(fakeActivityEvents.prefix(limit)))
        }
    }

    public func setFakeActivity(_ events: [ActivityEvent]) {
        lock.withLock { fakeActivityEvents = events }
    }

    public var activityFetchCount: Int {
        lock.withLock { fakeActivityFetchCount }
    }

    public func fetchFollowsWindowExclusions() async throws -> FollowsWindowExclusionsListResult {
        lock.withLock {
            FollowsWindowExclusionsListResult(exclusions: followsWindowExclusions)
        }
    }

    public func fetchFollowsWindows(minWorkspaceCount: Int? = nil) async throws -> FollowsWindowsListResult {
        lock.withLock {
            let windows = followsWindows.filter { record in
                guard let minWorkspaceCount else { return true }
                return record.knownWorkspaces.count >= minWorkspaceCount
            }
            return FollowsWindowsListResult(windows: windows, count: windows.count)
        }
    }

    public func addFollowsWindowExclusion(appBundle: String?, titleSubstring: String?) async throws -> FollowsWindowExclusionMutationResult {
        lock.withLock {
            let exclusion = FollowsWindowExclusion(
                exclusionId: "fwex_fake_\(followsWindowExclusions.count + 1)",
                appBundle: appBundle,
                titleSubstring: titleSubstring,
                createdAt: Date(timeIntervalSince1970: Double(followsWindowExclusions.count))
            )
            followsWindowExclusions.append(exclusion)
            return FollowsWindowExclusionMutationResult(exclusion: exclusion)
        }
    }

    public func deleteFollowsWindowExclusion(id: String) async throws -> FollowsWindowExclusionMutationResult {
        try lock.withLock {
            guard let index = followsWindowExclusions.firstIndex(where: { $0.exclusionId == id }) else {
                throw QueueClientError.httpStatus(404)
            }
            let removed = followsWindowExclusions.remove(at: index)
            return FollowsWindowExclusionMutationResult(exclusion: removed)
        }
    }

    public func setFakeFollowsWindowExclusions(_ exclusions: [FollowsWindowExclusion]) {
        lock.withLock { followsWindowExclusions = exclusions }
    }

    public func setFakeFollowsWindows(_ windows: [FollowsWindowRecord]) {
        lock.withLock { followsWindows = windows }
    }

    public func runCodexAutoBind() async throws -> CodexAutoBindResult {
        lock.withLock {
            fakeAutoBindRunCount += 1
            return CodexAutoBindResult(
                scannedWindowCount: 0,
                matchedCount: 0,
                bound: [],
                skipped: []
            )
        }
    }

    public var autoBindRunCount: Int {
        lock.withLock { fakeAutoBindRunCount }
    }

    public var createTaskRequests: [(primaryAnchor: TaskAnchor, capturedLayout: WorkspaceSnapshot, terminalRef: String?, idempotencyKey: String)] {
        lock.withLock { createTaskCalls }
    }

    public var setCurrentTaskRequests: [String?] {
        lock.withLock { setCurrentTaskCalls }
    }

    public var updateTaskLayoutRequests: [(taskId: String, layout: WorkspaceSnapshot)] {
        lock.withLock { updateTaskLayoutCalls }
    }

    public func setFakeTasks(_ tasks: [TaskRecord]) {
        lock.withLock { self.tasks = tasks }
    }

    public func setFakeCurrentTask(_ taskId: String?) {
        lock.withLock {
            self.currentTaskId = taskId
            self.currentTaskEnteredAt = taskId == nil ? nil : Date()
        }
    }

    public func setFakeTaskLayout(taskId: String, layout: WorkspaceSnapshot) {
        lock.withLock { taskLayouts[taskId] = layout }
    }

    public func createTask(
        primaryAnchor: TaskAnchor,
        capturedLayout: WorkspaceSnapshot,
        autoPaperIdleSeconds: Int?,
        terminalRef: String?,
        idempotencyKey: String
    ) async throws -> CreateTaskResult {
        lock.withLock {
            createTaskCalls.append((primaryAnchor: primaryAnchor, capturedLayout: capturedLayout, terminalRef: terminalRef, idempotencyKey: idempotencyKey))
            let now = Date()
            let existing = tasks.first { $0.primaryAnchorKind == primaryAnchor.kind && $0.primaryAnchorId == primaryAnchor.id }
            if let existing {
                taskLayouts[existing.taskId] = capturedLayout
                return CreateTaskResult(
                    task: existing,
                    layout: TaskLayoutRecord(taskId: existing.taskId, layout: capturedLayout, updatedAt: now),
                    created: false,
                    current: currentTaskId == existing.taskId
                )
            }
            let taskId = "task_fake_\(tasks.count + 1)"
            let record = TaskRecord(
                taskId: taskId,
                primaryAnchorKind: primaryAnchor.kind,
                primaryAnchorId: primaryAnchor.id,
                createdAt: now,
                updatedAt: now,
                lastPaperEmittedAt: nil,
                autoPaperIdleSeconds: autoPaperIdleSeconds ?? 60
            )
            tasks.append(record)
            taskLayouts[taskId] = capturedLayout
            return CreateTaskResult(
                task: record,
                layout: TaskLayoutRecord(taskId: taskId, layout: capturedLayout, updatedAt: now),
                created: true,
                current: false
            )
        }
    }

    public func getCurrentTask() async throws -> CurrentTaskState {
        await sleepReadDelayIfNeeded()
        return lock.withLock {
            let task = currentTaskId.flatMap { id in tasks.first { $0.taskId == id } }
            return CurrentTaskState(task: task, enteredAt: currentTaskEnteredAt, updatedAt: currentTaskEnteredAt)
        }
    }

    public func setCurrentTask(taskId: String?) async throws -> CurrentTaskState {
        try lock.withLock {
            setCurrentTaskCalls.append(taskId)
            if let taskId, !tasks.contains(where: { $0.taskId == taskId }) {
                throw QueueClientError.packetNotFound(taskId)
            }
            currentTaskId = taskId
            currentTaskEnteredAt = taskId == nil ? nil : Date()
            let task = currentTaskId.flatMap { id in tasks.first { $0.taskId == id } }
            return CurrentTaskState(task: task, enteredAt: currentTaskEnteredAt, updatedAt: currentTaskEnteredAt)
        }
    }

    public func listTasks() async throws -> [TaskRecord] {
        await sleepReadDelayIfNeeded()
        return lock.withLock { tasks }
    }

    public func getTaskWithLayout(taskId: String) async throws -> TaskGetEnvelope {
        try lock.withLock {
            guard let record = tasks.first(where: { $0.taskId == taskId }) else {
                throw QueueClientError.packetNotFound(taskId)
            }
            let layoutRecord = taskLayouts[taskId].map { layout in
                TaskLayoutRecord(taskId: taskId, layout: layout, updatedAt: record.updatedAt)
            }
            return TaskGetEnvelope(task: record, layout: layoutRecord)
        }
    }

    public func updateTaskLayout(taskId: String, layout: WorkspaceSnapshot) async throws -> TaskRecord {
        try lock.withLock {
            updateTaskLayoutCalls.append((taskId: taskId, layout: layout))
            guard let index = tasks.firstIndex(where: { $0.taskId == taskId }) else {
                throw QueueClientError.packetNotFound(taskId)
            }
            taskLayouts[taskId] = layout
            return tasks[index]
        }
    }

    public func taskLayout(taskId: String) -> WorkspaceSnapshot? {
        lock.withLock { taskLayouts[taskId] }
    }

    public func promoteReadingQueueContexts(ids: [String]) async throws -> ReadingQueuePromoteResult {
        await sleepMasterActionDelayIfNeeded()
        return lock.withLock {
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

    private func sleepReadDelayIfNeeded() async {
        let delay = lock.withLock { readDelayNanoseconds }
        if delay > 0 {
            try? await Task.sleep(nanoseconds: delay)
        }
    }

    private func sleepMasterActionDelayIfNeeded() async {
        let delay = lock.withLock { masterActionDelayNanoseconds }
        if delay > 0 {
            try? await Task.sleep(nanoseconds: delay)
        }
    }
}
