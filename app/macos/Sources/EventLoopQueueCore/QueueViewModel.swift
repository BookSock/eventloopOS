import Foundation

public enum ManualWorkspaceCaptureState: Equatable, Sendable {
    case idle
    case capturing
    case captured(WorkspaceSnapshot)
    case failed(String)
}

@MainActor
public final class QueueViewModel: ObservableObject {
    @Published public private(set) var packets: [ReviewPacket]
    @Published public var selectedPacketID: String? {
        didSet {
            guard oldValue != selectedPacketID else {
                return
            }
            taskBindingState = .idle
            contextRestoreState = .idle
            queueLineageState = .idle
        }
    }
    @Published public private(set) var state: QueueState
    @Published public private(set) var mode: EventLoopMode
    @Published public private(set) var shouldRestoreWorkspace: Bool
    @Published public private(set) var workspaceRestoreState: WorkspaceRestoreState
    @Published public private(set) var manualWorkspaceSnapshot: WorkspaceSnapshot?
    @Published public private(set) var manualWorkspaceCaptureState: ManualWorkspaceCaptureState
    @Published public private(set) var contextRestoreState: ContextRestoreState
    @Published public private(set) var queueLineageState: QueueLineageState
    @Published public private(set) var taskSessions: [TaskSession]
    @Published public private(set) var taskBindingState: TaskBindingState

    private let client: any QueueClient
    private let workspaceClient: any WorkspaceClient
    private var queueRefreshTask: Task<Void, Never>?
    private var leaseRenewalTask: Task<Void, Never>?
    private var contextRestoreRefreshTask: Task<Void, Never>?

    public init(
        client: any QueueClient,
        workspaceClient: any WorkspaceClient = NoOpWorkspaceClient(),
        initialPackets: [ReviewPacket] = []
    ) {
        self.client = client
        self.workspaceClient = workspaceClient
        self.packets = initialPackets
        self.selectedPacketID = initialPackets.first?.id
        self.state = .idle
        self.mode = .eventLoop
        self.shouldRestoreWorkspace = true
        self.workspaceRestoreState = .idle
        self.manualWorkspaceSnapshot = nil
        self.manualWorkspaceCaptureState = .idle
        self.contextRestoreState = .idle
        self.queueLineageState = .idle
        self.taskSessions = []
        self.taskBindingState = .idle
    }

    deinit {
        queueRefreshTask?.cancel()
        leaseRenewalTask?.cancel()
        contextRestoreRefreshTask?.cancel()
    }

    public var selectedPacket: ReviewPacket? {
        packets.first { $0.id == selectedPacketID }
    }

    public var canExecuteSelectedRecommendedAction: Bool {
        guard selectedPacket?.recommendedActionType == "resume_agent" else {
            return false
        }
        guard selectedTaskId != nil else {
            return false
        }
        return !selectedTaskSessions.isEmpty
    }

    public var selectedRecommendedActionBlockReason: String? {
        guard selectedPacket?.recommendedActionType == "resume_agent" else {
            return nil
        }
        guard let selectedTaskId else {
            return "Selected packet has no task id"
        }
        guard !selectedTaskSessions.isEmpty else {
            return "Bind a task session to \(selectedTaskId) before resuming agent"
        }
        return nil
    }

    public var selectedTaskId: String? {
        selectedPacket?.taskId
    }

    public var selectedTaskSessions: [TaskSession] {
        guard let selectedTaskId else {
            return []
        }
        return taskSessions.filter { $0.taskId == selectedTaskId }
    }

    public var canBindSelectedPacketToTaskSession: Bool {
        selectedTaskId != nil
    }

    public var selectedWorkspaceSnapshot: WorkspaceSnapshot? {
        selectedPacket?.workspaceSnapshot
    }

    public var canRestoreSelectedWorkspace: Bool {
        shouldRestoreWorkspace && selectedWorkspaceSnapshot != nil
    }

    public var canRestoreManualWorkspace: Bool {
        manualWorkspaceSnapshot != nil
    }

    public var hasPackets: Bool {
        !packets.isEmpty
    }

    public var isManualMode: Bool {
        mode == .manual
    }

    public func loadQueue() async {
        state = .loading
        await refreshQueue()
    }

    public func refreshQueue() async {
        do {
            packets = try await client.fetchQueue()
            if let selectedPacketID, packets.contains(where: { $0.id == selectedPacketID }) {
                self.selectedPacketID = selectedPacketID
            } else {
                selectedPacketID = nil
            }
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func startAutomaticQueueRefresh(
        intervalNanoseconds: UInt64 = 5_000_000_000,
        maxRefreshes: Int? = nil
    ) {
        stopAutomaticQueueRefresh()
        queueRefreshTask = Task { @MainActor [weak self] in
            var refreshCount = 0
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    return
                }
                guard !Task.isCancelled else {
                    return
                }
                await self?.refreshQueue()
                refreshCount += 1
                if let maxRefreshes, refreshCount >= maxRefreshes {
                    return
                }
            }
        }
    }

    public func stopAutomaticQueueRefresh() {
        queueRefreshTask?.cancel()
        queueRefreshTask = nil
    }

    public func select(packetId: String) {
        guard packets.contains(where: { $0.id == packetId }) else {
            return
        }
        selectedPacketID = packetId
    }

    public func enterManualMode() {
        mode = .manual
        shouldRestoreWorkspace = false
        workspaceRestoreState = .skippedManualMode
        manualWorkspaceSnapshot = nil
        manualWorkspaceCaptureState = .idle
    }

    public func enterManualModeAndCaptureWorkspace() async {
        enterManualMode()
        await captureManualWorkspaceSnapshot()
    }

    private func captureManualWorkspaceSnapshot() async {
        manualWorkspaceCaptureState = .capturing
        do {
            let snapshot = try await workspaceClient.capture()
            manualWorkspaceSnapshot = snapshot
            manualWorkspaceCaptureState = .captured(snapshot)
        } catch {
            manualWorkspaceSnapshot = nil
            manualWorkspaceCaptureState = .failed(error.localizedDescription)
        }
    }

    public func returnToEventLoopMode() {
        mode = .eventLoop
        shouldRestoreWorkspace = true
    }

    public func returnToEventLoopModeAndPrepareWorkspaceRestore() async {
        if mode == .manual {
            await captureManualWorkspaceSnapshot()
        }
        returnToEventLoopMode()
        await prepareSelectedWorkspaceRestore()
    }

    public func toggleManualMode() {
        if mode == .eventLoop {
            enterManualMode()
        } else {
            returnToEventLoopMode()
        }
    }

    public func toggleManualModeAndPrepareWorkspaceRestoreIfNeeded() async {
        if mode == .eventLoop {
            enterManualMode()
        } else {
            await returnToEventLoopModeAndPrepareWorkspaceRestore()
        }
    }

    public func pullNextPaper() async {
        if mode == .manual {
            await captureManualWorkspaceSnapshot()
            returnToEventLoopMode()
        }

        state = .loading
        do {
            let selectedID = selectedPacketID
            let leasedPacket: ReviewPacket?
            if let selectedID, packets.contains(where: { $0.id == selectedID }) {
                do {
                    _ = try await client.renewLease(packetId: selectedID)
                    leasedPacket = selectedPacket
                } catch {
                    leasedPacket = try await client.next(after: nil)
                }
            } else {
                leasedPacket = try await client.next(after: nil)
            }

            packets = try await client.fetchQueue()
            selectedPacketID = leasedPacket?.id ?? packets.first?.id
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
            return
        }

        await loadTaskSessionsForSelectedPacketIfNeeded()
        await prepareSelectedWorkspaceRestore()
    }

    public func doneAndNext() async {
        guard let packetId = selectedPacketID else {
            return
        }

        state = .loading
        do {
            _ = try await client.complete(packetId: packetId)
            try await loadNextAfterQueueAction()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func deferSelectedPacket(until dueAt: Date) async {
        guard let packetId = selectedPacketID else {
            return
        }

        state = .loading
        do {
            _ = try await client.deferPacket(packetId: packetId, until: dueAt)
            try await loadNextAfterQueueAction()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func deferSelectedPacketForOneHour(now: Date = Date()) async {
        await deferSelectedPacket(until: now.addingTimeInterval(60 * 60))
    }

    public func ignoreSelectedPacket() async {
        guard let packetId = selectedPacketID else {
            return
        }

        state = .loading
        do {
            _ = try await client.ignorePacket(packetId: packetId)
            try await loadNextAfterQueueAction()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func executeRecommendedActionAndNext() async {
        guard let packetId = selectedPacketID else {
            return
        }
        guard canExecuteSelectedRecommendedAction else {
            taskBindingState = .failed(selectedRecommendedActionBlockReason ?? "Recommended action is not ready")
            return
        }

        state = .loading
        do {
            _ = try await client.executeRecommendedAction(packetId: packetId)
            try await loadNextAfterQueueAction()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func loadNextAfterQueueAction() async throws {
        let leasedPacket = try await client.next(after: nil)
        packets = try await client.fetchQueue()
        selectedPacketID = leasedPacket?.id ?? packets.first?.id
        state = .loaded
    }

    public func loadTaskSessions() async {
        taskBindingState = .loading
        do {
            taskSessions = try await client.fetchTaskSessions()
            taskBindingState = .loaded
        } catch {
            taskBindingState = .failed(error.localizedDescription)
        }
    }

    public func loadTaskSessionsForSelectedPacketIfNeeded() async {
        guard selectedTaskId != nil, taskSessions.isEmpty else {
            return
        }

        await loadTaskSessions()
    }

    public func loadLineageForSelectedPacket(limit: Int = 100) async {
        guard let packetId = selectedPacketID else {
            queueLineageState = .idle
            return
        }

        queueLineageState = .loading(packetId)
        do {
            let lineage = try await client.fetchQueueLineage(packetId: packetId, limit: limit)
            guard selectedPacketID == packetId else {
                return
            }
            queueLineageState = .loaded(packetId, lineage)
        } catch {
            guard selectedPacketID == packetId else {
                return
            }
            queueLineageState = .failed(packetId, error.localizedDescription)
        }
    }

    public func bindSelectedPacket(toTaskSessionId taskSessionId: String) async {
        guard let taskId = selectedTaskId else {
            taskBindingState = .failed("Selected packet has no task id")
            return
        }

        taskBindingState = .loading
        do {
            let binding = try await client.bindTaskSession(sessionId: taskSessionId, taskId: taskId)
            taskSessions = try await client.fetchTaskSessions()
            taskBindingState = .bound(binding)
        } catch {
            taskBindingState = .failed(error.localizedDescription)
        }
    }

    public func renewSelectedLease() async {
        guard let packetId = selectedPacketID else {
            return
        }

        do {
            _ = try await client.renewLease(packetId: packetId)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func startAutomaticLeaseRenewal(
        intervalNanoseconds: UInt64 = 30_000_000_000,
        maxRenewals: Int? = nil
    ) {
        stopAutomaticLeaseRenewal()
        leaseRenewalTask = Task { @MainActor [weak self] in
            var renewalCount = 0
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    return
                }
                guard !Task.isCancelled else {
                    return
                }
                await self?.renewSelectedLease()
                renewalCount += 1
                if let maxRenewals, renewalCount >= maxRenewals {
                    return
                }
            }
        }
    }

    public func stopAutomaticLeaseRenewal() {
        leaseRenewalTask?.cancel()
        leaseRenewalTask = nil
    }

    public func startAutomaticContextRestoreRefresh(
        intervalNanoseconds: UInt64 = 2_000_000_000,
        maxRefreshes: Int? = nil
    ) {
        stopAutomaticContextRestoreRefresh()
        contextRestoreRefreshTask = Task { @MainActor [weak self] in
            var refreshCount = 0
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    return
                }
                guard !Task.isCancelled else {
                    return
                }
                let didRefresh = await self?.refreshContextRestoreRequestIfNeeded() ?? false
                if didRefresh {
                    refreshCount += 1
                }
                if let maxRefreshes, refreshCount >= maxRefreshes {
                    return
                }
            }
        }
    }

    public func stopAutomaticContextRestoreRefresh() {
        contextRestoreRefreshTask?.cancel()
        contextRestoreRefreshTask = nil
    }

    public func prepareWorkspaceRestore(snapshot: WorkspaceSnapshot) async {
        guard shouldRestoreWorkspace else {
            workspaceRestoreState = .skippedManualMode
            return
        }

        do {
            let response = try await workspaceClient.restorePlan(snapshot: snapshot, currentWindows: nil)
            workspaceRestoreState = .planned(response.plan)
        } catch {
            workspaceRestoreState = .failed(error.localizedDescription)
        }
    }

    public func prepareSelectedWorkspaceRestore() async {
        guard let snapshot = selectedWorkspaceSnapshot else {
            workspaceRestoreState = .idle
            return
        }

        await prepareWorkspaceRestore(snapshot: snapshot)
    }

    public func confirmWorkspaceRestore(snapshot: WorkspaceSnapshot) async {
        guard shouldRestoreWorkspace else {
            workspaceRestoreState = .skippedManualMode
            return
        }

        do {
            let response = try await workspaceClient.restore(
                snapshot: snapshot,
                currentWindows: nil,
                idempotencyKey: "mac_workspace_restore_\(UUID().uuidString)"
            )
            workspaceRestoreState = .executed(response.receipt)
        } catch {
            workspaceRestoreState = .failed(error.localizedDescription)
        }
    }

    public func confirmSelectedWorkspaceRestore() async {
        guard let snapshot = selectedWorkspaceSnapshot else {
            workspaceRestoreState = .failed("Selected packet has no workspace snapshot")
            return
        }

        await confirmWorkspaceRestore(snapshot: snapshot)
    }

    public func confirmManualWorkspaceRestore() async {
        guard let snapshot = manualWorkspaceSnapshot else {
            workspaceRestoreState = .failed("No manual workspace snapshot saved")
            return
        }

        do {
            let response = try await workspaceClient.restore(
                snapshot: snapshot,
                currentWindows: nil,
                idempotencyKey: "mac_manual_workspace_restore_\(UUID().uuidString)"
            )
            mode = .manual
            shouldRestoreWorkspace = false
            workspaceRestoreState = .executed(response.receipt)
        } catch {
            workspaceRestoreState = .failed(error.localizedDescription)
        }
    }

    public func prepareContextRestore(resource: ReviewContextResource) async {
        contextRestoreState = .planning(resource)
        do {
            let plan = try await client.contextRestorePlan(resource: resource)
            contextRestoreState = .planned(resource, plan)
        } catch {
            contextRestoreState = .failed(resource, error.localizedDescription)
        }
    }

    public func requestContextRestore(resource: ReviewContextResource) async {
        contextRestoreState = .planning(resource)
        do {
            let restoreRequest = try await client.requestContextRestore(
                resource: resource,
                idempotencyKey: "mac_context_restore_\(resource.id)_\(UUID().uuidString)"
            )
            contextRestoreState = .requested(resource, restoreRequest)
        } catch {
            contextRestoreState = .failed(resource, error.localizedDescription)
        }
    }

    public func refreshContextRestoreRequest() async {
        _ = await refreshContextRestoreRequestIfNeeded(allowTerminalRefresh: true)
    }

    @discardableResult
    public func refreshContextRestoreRequestIfNeeded(allowTerminalRefresh: Bool = false) async -> Bool {
        guard case let .requested(resource, restoreRequest) = contextRestoreState else {
            return false
        }
        guard allowTerminalRefresh || restoreRequest.status != "done" else {
            return false
        }

        do {
            let updated = try await client.contextRestoreRequest(id: restoreRequest.id)
            contextRestoreState = .requested(resource, updated)
            return true
        } catch {
            contextRestoreState = .failed(resource, error.localizedDescription)
            return true
        }
    }

    public func moveToNext() async {
        do {
            if let nextPacket = try await client.next(after: selectedPacketID) {
                selectedPacketID = nextPacket.id
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
