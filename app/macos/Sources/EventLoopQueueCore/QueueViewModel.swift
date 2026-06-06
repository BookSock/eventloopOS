import Foundation
#if canImport(Combine)
import Combine
#else
public protocol ObservableObject: AnyObject {}

@propertyWrapper
public struct Published<Value> {
    public var wrappedValue: Value

    public init(wrappedValue: Value) {
        self.wrappedValue = wrappedValue
    }
}
#endif

public enum ManualWorkspaceCaptureState: Equatable, Sendable {
    case idle
    case capturing
    case captured(WorkspaceSnapshot)
    case failed(String)
}

public struct PacketViewSnapshot: Equatable, Sendable {
    public let priority: Int
    public let priorityReasonsHash: Int
    public let contextResourceCount: Int

    public init(priority: Int, priorityReasonsHash: Int, contextResourceCount: Int) {
        self.priority = priority
        self.priorityReasonsHash = priorityReasonsHash
        self.contextResourceCount = contextResourceCount
    }

    public static func from(_ packet: ReviewPacket) -> PacketViewSnapshot {
        PacketViewSnapshot(
            priority: packet.priority,
            priorityReasonsHash: packet.priorityReasons.joined(separator: "|").hashValue,
            contextResourceCount: packet.contextResources.count
        )
    }
}

public enum PacketChangeBadge: Equatable, Sendable {
    case none
    case new
    case priorityIncreased(by: Int)
    case priorityDecreased(by: Int)
    case priorityReasonsChanged
    case contextChanged(addedResources: Int)
}

public struct PendingTerminalSendConfirmation: Equatable, Sendable {
    public let packetId: String
    public let terminalRef: String
    public let sessionId: String

    public init(packetId: String, terminalRef: String, sessionId: String) {
        self.packetId = packetId
        self.terminalRef = terminalRef
        self.sessionId = sessionId
    }
}

public enum TerminalSendConfirmScope: Equatable, Sendable {
    case oneShot
    case thisSession
    case rememberForRef
}

public enum AdvanceToast: Equatable, Sendable {
    case manualModeActive
    case noForegroundCodex
    case queueEmpty
    case actionComplete(String)
    case deferredUntil(Date)
    case enteredLimbo
    case taskCreated(taskId: String)
    case switchedToPaper(packetId: String, title: String, decision: String)
    case returnedToTask(taskId: String)
}

public enum VoiceCaptureState: Equatable, Sendable {
    case unavailable
    case idle
    case listening
    case captured(String)
    case failed(String)
}

public protocol VoiceTranscriptionService: Sendable {
    func transcribeOneUtterance() async throws -> String
    var maxRecordingSeconds: Double { get }
}

public extension VoiceTranscriptionService {
    var maxRecordingSeconds: Double { 6.0 }
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
            if let selectedPacketID, let packet = packets.first(where: { $0.id == selectedPacketID }) {
                viewedSnapshots[selectedPacketID] = PacketViewSnapshot.from(packet)
            }
        }
    }
    @Published public private(set) var viewedSnapshots: [String: PacketViewSnapshot] = [:]
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
    @Published public private(set) var masterCommandState: MasterCommandState
    @Published public private(set) var onboardingState: OnboardingState
    @Published public var auxiliarySheet: QueueAuxiliarySheet?
    @Published public private(set) var voiceCaptureState: VoiceCaptureState
    @Published public private(set) var voiceCaptureStartedAt: Date?
    @Published public private(set) var voiceCaptureMaxSeconds: Double = 6.0
    @Published public private(set) var readingQueueUnboundCount: Int = 0
    @Published public var pendingTerminalSendConfirmation: PendingTerminalSendConfirmation?
    @Published public private(set) var activityEvents: [ActivityEvent] = []
    @Published public private(set) var followsWindowExclusions: [FollowsWindowExclusion] = []
    @Published public private(set) var followsWindowSuggestions: [FollowsWindowSuggestion] = []
    @Published public private(set) var followsRulesState: FollowsRulesState = .idle
    @Published public private(set) var autoBindContinuousEnabled: Bool = false
    @Published public private(set) var lastAutoBindResult: CodexAutoBindResult?
    @Published public private(set) var advanceToast: AdvanceToast? {
        didSet {
            feedbackSequence += 1
        }
    }
    @Published public private(set) var feedbackSequence: Int = 0
    @Published public private(set) var currentTask: TaskRecord?
    @Published public private(set) var paperActionInFlight = false
    @Published public private(set) var paperActionInFlightStatus: String?

    private static let terminalSendConfirmedDefaultsKey = "eventLoopOS.terminalSendConfirmed.v1"
    private static let terminalSendRememberedRefsKey = "eventLoopOS.terminalSendRememberedRefs.v1"

    private let client: any QueueClient
    private let workspaceClient: any WorkspaceClient
    private let aeroSpaceClient: any AeroSpaceWorkspaceClient
    private let codexForegroundResolver: any CodexForegroundResolver
    private let limboWorkspaceId: String
    private let voiceTranscriptionService: VoiceTranscriptionService?
    private let userDefaults: UserDefaults
    private var terminalSendThisSessionConfirmed: Set<String> = []
    private var queueRefreshTask: Task<Void, Never>?
    private var leaseRenewalTask: Task<Void, Never>?
    private var contextRestoreRefreshTask: Task<Void, Never>?
    private var activityRefreshTask: Task<Void, Never>?
    private var autoBindLoopTask: Task<Void, Never>?
    private var autoRestoredContextPacketIds = Set<String>()
    private var workspaceRestoreInFlight = false
    private var lastWorkspaceRestore: RecentWorkspaceRestore?
    private let workspaceRestoreRepeatWindow: TimeInterval = 2.0

    public init(
        client: any QueueClient,
        workspaceClient: any WorkspaceClient = NoOpWorkspaceClient(),
        aeroSpaceClient: any AeroSpaceWorkspaceClient = NoOpAeroSpaceWorkspaceClient(),
        codexForegroundResolver: any CodexForegroundResolver = NoOpCodexForegroundResolver(),
        limboWorkspaceId: String = "limbo",
        initialPackets: [ReviewPacket] = [],
        voiceTranscriptionService: VoiceTranscriptionService? = nil,
        userDefaults: UserDefaults = .standard
    ) {
        self.client = client
        self.workspaceClient = workspaceClient
        self.aeroSpaceClient = aeroSpaceClient
        self.codexForegroundResolver = codexForegroundResolver
        self.limboWorkspaceId = limboWorkspaceId
        self.voiceTranscriptionService = voiceTranscriptionService
        self.userDefaults = userDefaults
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
        self.masterCommandState = .idle
        self.onboardingState = .idle
        self.auxiliarySheet = nil
        self.voiceCaptureState = voiceTranscriptionService == nil ? .unavailable : .idle
    }

    deinit {
        queueRefreshTask?.cancel()
        leaseRenewalTask?.cancel()
        contextRestoreRefreshTask?.cancel()
        activityRefreshTask?.cancel()
        autoBindLoopTask?.cancel()
    }

    public func changeBadge(for packet: ReviewPacket) -> PacketChangeBadge {
        guard let snapshot = viewedSnapshots[packet.id] else {
            return .new
        }
        let current = PacketViewSnapshot.from(packet)
        if current.priority > snapshot.priority {
            return .priorityIncreased(by: current.priority - snapshot.priority)
        }
        if current.priority < snapshot.priority {
            return .priorityDecreased(by: snapshot.priority - current.priority)
        }
        if current.priorityReasonsHash != snapshot.priorityReasonsHash {
            return .priorityReasonsChanged
        }
        if current.contextResourceCount > snapshot.contextResourceCount {
            return .contextChanged(addedResources: current.contextResourceCount - snapshot.contextResourceCount)
        }
        return .none
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

    public var canSaveSelectedTaskLayout: Bool {
        selectedTaskId != nil && mode == .eventLoop
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

    public func bootstrap() async {
        await syncManualModeFromServer()
        await loadQueue()
    }

    public func syncManualModeFromServer() async {
        do {
            let serverState = try await client.getManualMode()
            if serverState.active {
                applyLocalEnterManualMode()
            } else if mode == .manual {
                applyLocalReturnToEventLoopMode()
            }
        } catch {
            // Don't fail bootstrap on a manual-mode read failure; surface as activity later if needed.
        }
    }

    public func refreshQueue() async {
        do {
            packets = try await client.fetchQueue()
            if let selectedPacketID, packets.contains(where: { $0.id == selectedPacketID }) {
                self.selectedPacketID = selectedPacketID
            } else {
                selectedPacketID = packets.first?.id
            }
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
        await refreshReadingQueueCount()
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

    public func switchToPaper(packetId: String) async {
        guard packets.contains(where: { $0.id == packetId }) else {
            return
        }
        guard selectedPacketID != packetId else {
            return
        }

        do {
            try await saveSelectedTaskWorkspaceSnapshotIfNeeded()
        } catch {
            state = .failed(error.localizedDescription)
            return
        }

        selectedPacketID = packetId
        await syncSelectedCurrentTaskIfPossible()
        await loadTaskSessionsForSelectedPacketIfNeeded()
        await prepareSelectedWorkspaceRestore()
        await requestSelectedBrowserContextRestoresIfNeeded()
    }

    public func enterManualMode() async {
        let wasManual = mode == .manual
        applyLocalEnterManualMode()
        do {
            _ = try await client.setManualMode(active: true, reason: "user_hotkey")
        } catch {
            if !wasManual {
                applyLocalReturnToEventLoopMode()
            }
            state = .failed("Manual mode failed to engage on server: \(error.localizedDescription)")
        }
    }

    public func exitManualMode() async {
        applyLocalReturnToEventLoopMode()
        do {
            _ = try await client.setManualMode(active: false, reason: nil)
        } catch {
            state = .failed("Manual mode failed to disengage on server: \(error.localizedDescription)")
        }
    }

    private func applyLocalEnterManualMode() {
        mode = .manual
        shouldRestoreWorkspace = false
        workspaceRestoreState = .skippedManualMode
        advanceToast = .actionComplete("Manual Mode active. Ctrl-Option-M returns; Ctrl-Option-Shift-M keeps this layout.")
        if manualWorkspaceSnapshot == nil {
            manualWorkspaceCaptureState = .idle
        }
    }

    public func enterManualModeAndCaptureWorkspace() async {
        await enterManualMode()
        guard mode == .manual else { return }
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

    private func captureSelectedTaskWorkspaceSnapshot() async -> WorkspaceSnapshot? {
        guard selectedTaskId != nil else {
            return nil
        }
        do {
            return try await workspaceClient.capture()
        } catch {
            return nil
        }
    }

    private func saveSelectedTaskWorkspaceSnapshotIfNeeded() async throws {
        guard let taskId = selectedTaskId else {
            return
        }
        guard let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot() else {
            return
        }
        _ = try await client.saveTaskWorkspaceSnapshot(
            taskId: taskId,
            workspaceSnapshot: workspaceSnapshot,
            sourceQueueItemId: selectedPacketID
        )
    }

    private func syncSelectedCurrentTaskIfPossible() async {
        await syncCurrentTaskForPacketIfPossible(selectedPacketID)
    }

    private func syncCurrentTaskForPacketIfPossible(_ packetId: String?) async {
        guard let packetId,
              let taskId = packets.first(where: { $0.id == packetId })?.taskId else {
            return
        }
        do {
            let state = try await client.setCurrentTask(taskId: taskId)
            currentTask = state.task
        } catch {
            // Legacy or unbound papers may not have a task record yet; paper switching
            // and restore should still work.
        }
    }

    public func returnToEventLoopMode() async {
        let wasManual = mode == .manual
        applyLocalReturnToEventLoopMode()
        if wasManual {
            do {
                _ = try await client.setManualMode(active: false, reason: nil)
            } catch {
                state = .failed("Manual mode failed to disengage on server: \(error.localizedDescription)")
            }
        }
    }

    private func applyLocalReturnToEventLoopMode() {
        mode = .eventLoop
        shouldRestoreWorkspace = true
        advanceToast = .actionComplete("Returned to Event Loop.")
    }

    public func returnToEventLoopModeAndPrepareWorkspaceRestore() async {
        let wasManual = mode == .manual
        if wasManual {
            advanceToast = .actionComplete("Returning to Event Loop...")
            await captureManualWorkspaceSnapshot()
        }
        applyLocalReturnToEventLoopMode()
        if selectedWorkspaceSnapshot != nil {
            advanceToast = .actionComplete("Returned to Event Loop. Restoring selected paper...")
        }
        await prepareSelectedWorkspaceRestore()
        if wasManual {
            do {
                _ = try await client.setManualMode(active: false, reason: nil)
            } catch {
                state = .failed("Manual mode failed to disengage on server: \(error.localizedDescription)")
            }
        }
    }

    public func returnToEventLoopModeKeepingCurrentLayout() async {
        let wasManual = mode == .manual
        if wasManual {
            advanceToast = .actionComplete("Returning to Event Loop...")
            await captureManualWorkspaceSnapshot()
        }
        applyLocalReturnToEventLoopMode()
        workspaceRestoreState = .keptCurrentLayout
        advanceToast = .actionComplete("Returned to Event Loop. Kept current layout.")
        if wasManual {
            do {
                _ = try await client.setManualMode(active: false, reason: nil)
            } catch {
                state = .failed("Manual mode failed to disengage on server: \(error.localizedDescription)")
            }
        }
    }

    public func toggleManualMode() async {
        if mode == .eventLoop {
            await enterManualMode()
        } else {
            await returnToEventLoopMode()
        }
    }

    public func toggleManualModeAndPrepareWorkspaceRestoreIfNeeded() async {
        if mode == .eventLoop {
            await enterManualModeAndRestoreSavedWorkspaceIfAvailable()
        } else {
            await returnToEventLoopModeAndPrepareWorkspaceRestore()
        }
    }

    public func enterManualModeAndRestoreSavedWorkspaceIfAvailable() async {
        await enterManualMode()
        guard mode == .manual else { return }
        do {
            try await saveSelectedTaskWorkspaceSnapshotIfNeeded()
        } catch {
            state = .failed(error.localizedDescription)
        }
        if manualWorkspaceSnapshot != nil {
            await confirmManualWorkspaceRestore()
        }
    }

    private func beginPaperAction(_ status: String) -> Bool {
        guard !paperActionInFlight else {
            let currentStatus = paperActionInFlightStatus ?? "Working..."
            advanceToast = .actionComplete("\(currentStatus) Still running.")
            return false
        }
        paperActionInFlight = true
        paperActionInFlightStatus = status
        advanceToast = .actionComplete(status)
        return true
    }

    private func finishPaperAction() {
        paperActionInFlight = false
        paperActionInFlightStatus = nil
    }

    private func showNoSelectedPaperFeedback() {
        advanceToast = .actionComplete("No paper selected.")
    }

    private func beginMasterAction(_ status: String) -> Bool {
        guard masterCommandState != .sending else {
            advanceToast = .actionComplete("Master command still running.")
            return false
        }
        masterCommandState = .sending
        advanceToast = .actionComplete(status)
        return true
    }

    private func isQueueConflict(_ error: Error) -> Bool {
        if let queueError = error as? QueueClientError {
            return queueError.statusCode == 409
        }
        return false
    }

    private func queuePausedToast(for error: Error) -> AdvanceToast {
        if let queueError = error as? QueueClientError {
            if queueError.isManualModeConflict {
                return .actionComplete("Manual Mode active. Press Ctrl-Option-M to return.")
            }
            if queueError.isIdempotencyConflict {
                return .actionComplete("Already handling that request. Wait a second.")
            }
        }
        return .actionComplete("Queue paused. Try again.")
    }

    private func actionSavedQueuePausedToast(for error: Error) -> AdvanceToast {
        if let queueError = error as? QueueClientError {
            if queueError.isManualModeConflict {
                return .actionComplete("Action saved. Manual Mode active; no next paper claimed.")
            }
            if queueError.isIdempotencyConflict {
                return .actionComplete("Action saved. Still switching; wait a second.")
            }
        }
        return .actionComplete("Action saved. Queue paused; no next paper claimed.")
    }

    public func pullNextPaper() async {
        guard beginPaperAction("Switching papers...") else { return }
        defer { finishPaperAction() }
        await pullNextPaperUnguarded()
    }

    private func pullNextPaperUnguarded() async {
        if mode == .manual {
            await captureManualWorkspaceSnapshot()
            await returnToEventLoopMode()
        } else if manualWorkspaceSnapshot == nil {
            await captureManualWorkspaceSnapshot()
        }

        state = .loading
        do {
            let selectedID = selectedPacketID
            let leaseResult = try await leaseNextPaperPreservingSelection(selectedID: selectedID)
            let leasedPacket = leaseResult.packet

            packets = try await client.fetchQueue()
            selectedPacketID = leasedPacket?.id ?? packets.first?.id
            state = .loaded
            if let conflictError = leaseResult.conflictError {
                advanceToast = queuePausedToast(for: conflictError)
            } else if selectedPacketID == nil, packets.isEmpty {
                advanceToast = .queueEmpty
            } else if let packetId = selectedPacketID {
                advanceToast = switchToPaperToast(packetId: packetId)
            }
        } catch {
            state = .failed(error.localizedDescription)
            return
        }

        await loadTaskSessionsForSelectedPacketIfNeeded()
        await prepareSelectedWorkspaceRestore()
        await requestSelectedBrowserContextRestoresIfNeeded()
    }

    private func leaseNextPaperPreservingSelection(selectedID: String?) async throws -> (packet: ReviewPacket?, conflictError: Error?) {
        if let selectedID, packets.contains(where: { $0.id == selectedID }) {
            do {
                _ = try await client.renewLease(packetId: selectedID)
                return (selectedPacket, nil)
            } catch {
                do {
                    return (try await client.next(after: nil), nil)
                } catch {
                    guard isQueueConflict(error) else {
                        throw error
                    }
                    return (selectedPacket, error)
                }
            }
        }

        do {
            return (try await client.next(after: nil), nil)
        } catch {
            guard isQueueConflict(error) else {
                throw error
            }
            return (nil, error)
        }
    }

    public func advance() async {
        guard beginPaperAction("Switching papers...") else { return }
        defer { finishPaperAction() }

        if currentTask == nil, !packets.isEmpty, await fastAdvanceToQueuedPaperFromLimbo() {
            return
        }

        let snapshot: AdvanceServerSnapshot
        do {
            snapshot = try await loadAdvanceSnapshot()
        } catch {
            state = .failed(error.localizedDescription)
            return
        }

        let action = AdvanceCoordinator.nextAction(snapshot: snapshot)
        await execute(advanceAction: action, snapshot: snapshot)
    }

    private func fastAdvanceToQueuedPaperFromLimbo() async -> Bool {
        do {
            async let manualModeStateTask = client.getManualMode()
            async let currentTaskStateTask = client.getCurrentTask()
            async let queueTask = client.fetchQueue()

            let manualModeState = try await manualModeStateTask
            if manualModeState.active {
                advanceToast = .manualModeActive
                return true
            }

            let currentTaskState = try await currentTaskStateTask
            let queue = try await queueTask
            guard currentTaskState.task == nil, !queue.isEmpty else {
                currentTask = currentTaskState.task
                packets = queue
                return false
            }

            currentTask = nil
            packets = queue
            await pullNextPaperUnguarded()
            return true
        } catch {
            return false
        }
    }

    private func loadAdvanceSnapshot() async throws -> AdvanceServerSnapshot {
        async let manualModeStateTask = client.getManualMode()
        async let currentWorkspaceIdTask = focusedWorkspaceOrNil()
        async let currentTaskStateTask = client.getCurrentTask()
        async let allTasksTask = listTasksOrEmpty()
        async let queueTask = fetchQueueOrEmpty()
        async let foregroundTask = codexForegroundResolver.resolveForeground()
        async let workspacesTask = listWorkspacesOrEmpty()

        let manualModeState = try await manualModeStateTask
        let currentWorkspaceId = await currentWorkspaceIdTask
        let currentTaskState = try await currentTaskStateTask
        let allTasks = await allTasksTask
        let queue = await queueTask
        let foreground = await foregroundTask
        packets = queue

        var relevantTaskIds = Set<String>()
        if let currentTaskId = currentTaskState.task?.taskId {
            relevantTaskIds.insert(currentTaskId)
        }
        for packet in queue {
            if let taskId = packet.taskId {
                relevantTaskIds.insert(taskId)
            }
        }

        var tasksByWorkspace: [String: TaskRecord] = [:]
        var boundWorkspaceIds = Set(allTasks.compactMap(\.aerospaceWorkspaceId))
        for task in allTasks where relevantTaskIds.contains(task.taskId) {
            guard let workspaceId = await workspaceIdForTask(task) else { continue }
            if tasksByWorkspace[workspaceId] == nil {
                tasksByWorkspace[workspaceId] = task
            }
            boundWorkspaceIds.insert(workspaceId)
        }

        currentTask = currentTaskState.task
        let workspaces = await workspacesTask
        let resolvedLimboWorkspaceId = pickLimboWorkspace(in: workspaces, boundWorkspaceIds: boundWorkspaceIds) ?? limboWorkspaceId

        return AdvanceServerSnapshot(
            manualModeActive: manualModeState.active,
            currentWorkspaceId: currentWorkspaceId,
            currentTask: currentTaskState.task,
            queue: queue,
            tasksByWorkspace: tasksByWorkspace,
            foreground: foreground,
            limboWorkspaceId: resolvedLimboWorkspaceId
        )
    }

    private func focusedWorkspaceOrNil() async -> String? {
        do {
            return try await aeroSpaceClient.focusedWorkspace()
        } catch {
            return nil
        }
    }

    private func listTasksOrEmpty() async -> [TaskRecord] {
        (try? await client.listTasks()) ?? []
    }

    private func fetchQueueOrEmpty() async -> [ReviewPacket] {
        (try? await client.fetchQueue()) ?? []
    }

    private func listWorkspacesOrEmpty() async -> [String] {
        (try? await aeroSpaceClient.listWorkspaces()) ?? []
    }

    private func workspaceIdForTask(_ task: TaskRecord) async -> String? {
        if let workspaceId = task.aerospaceWorkspaceId, !workspaceId.isEmpty {
            return workspaceId
        }
        guard let envelope = try? await client.getTaskWithLayout(taskId: task.taskId) else {
            return nil
        }
        return envelope.layout?.layout.activeWorkspace
    }

    private func pickLimboWorkspace(in workspaces: [String], boundWorkspaceIds: Set<String>) -> String? {
        return workspaces.first { workspace in
            !boundWorkspaceIds.contains(workspace)
        }
    }

    private func execute(advanceAction: AdvanceAction, snapshot: AdvanceServerSnapshot) async {
        switch advanceAction {
        case .toastManualModeActive:
            advanceToast = .manualModeActive
        case .toastNoForegroundCodex:
            if !snapshot.queue.isEmpty {
                await pullNextPaperUnguarded()
                return
            }
            advanceToast = .noForegroundCodex
        case let .createTaskFromForeground(anchor, workspaceId, terminalRef):
            await runCreateTaskFromForeground(anchor: anchor, workspaceId: workspaceId, terminalRef: terminalRef)
        case let .saveLayoutAndPullPaper(currentTaskId, nextPacketId, nextWorkspaceId):
            await runSaveLayoutAndSwitch(
                currentTaskId: currentTaskId,
                workspaceId: nextWorkspaceId,
                packetId: nextPacketId,
                toastForSwitch: switchToPaperToast(packetId: nextPacketId)
                    ?? .actionComplete("Showing next paper.")
            )
        case let .saveLayoutAndEnterLimbo(currentTaskId, limboWorkspaceId):
            await runSaveLayoutAndSwitch(
                currentTaskId: currentTaskId,
                workspaceId: limboWorkspaceId,
                packetId: nil,
                toastForSwitch: .enteredLimbo,
                clearCurrentTask: true
            )
        case let .markPaperDoneAndPullNext(packetId, nextPacketId, nextWorkspaceId):
            await runMarkPaperDoneAndSwitch(
                packetId: packetId,
                workspaceId: nextWorkspaceId,
                nextSelectionPacketId: nextPacketId,
                toast: switchToPaperToast(packetId: nextPacketId)
                    ?? .actionComplete("Showing next paper."),
                snapshot: snapshot
            )
        case let .markPaperDoneAndReturnToTask(packetId, taskId, taskWorkspaceId):
            await runMarkPaperDoneAndSwitch(
                packetId: packetId,
                workspaceId: taskWorkspaceId,
                nextSelectionPacketId: nil,
                toast: .returnedToTask(taskId: taskId),
                snapshot: snapshot,
                returnToTaskId: taskId
            )
        case let .markPaperDoneAndEnterLimbo(packetId, limboWorkspaceId):
            await runMarkPaperDoneAndSwitch(
                packetId: packetId,
                workspaceId: limboWorkspaceId,
                nextSelectionPacketId: nil,
                toast: .enteredLimbo,
                snapshot: snapshot,
                clearCurrentTask: true
            )
        }
    }

    private func runCreateTaskFromForeground(anchor: TaskAnchor, workspaceId: String, terminalRef: String?) async {
        do {
            let captured = try await workspaceClient.capture()
            let layout = WorkspaceSnapshot(
                backend: captured.backend,
                windows: captured.windows,
                activeWorkspace: captured.activeWorkspace ?? workspaceId,
                focusedWindowId: captured.focusedWindowId
            )
            let key = "mac_advance_create_task_\(anchor.kind.rawValue)_\(anchor.id)_\(workspaceId)"
            let result = try await client.createTask(
                primaryAnchor: anchor,
                capturedLayout: layout,
                autoPaperIdleSeconds: nil,
                terminalRef: terminalRef,
                idempotencyKey: key
            )
            _ = try await client.setCurrentTask(taskId: result.task.taskId)
            currentTask = result.task
            advanceToast = .taskCreated(taskId: result.task.taskId)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func runSaveLayoutAndSwitch(
        currentTaskId: String,
        workspaceId: String,
        packetId: String?,
        toastForSwitch: AdvanceToast,
        clearCurrentTask: Bool = false
    ) async {
        do {
            let captured = try await workspaceClient.capture()
            _ = try await client.updateTaskLayout(taskId: currentTaskId, layout: captured)
            try await restorePaperWorkspaceOrSwitch(packetId: packetId, fallbackWorkspaceId: workspaceId)
            if clearCurrentTask {
                _ = try await client.setCurrentTask(taskId: nil)
                currentTask = nil
            }
            if let packetId, packets.contains(where: { $0.id == packetId }) {
                selectedPacketID = packetId
                if !clearCurrentTask {
                    await syncCurrentTaskForPacketIfPossible(packetId)
                }
            }
            advanceToast = switchToPaperToast(packetId: packetId) ?? toastForSwitch
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func runMarkPaperDoneAndSwitch(
        packetId: String,
        workspaceId: String,
        nextSelectionPacketId: String?,
        toast: AdvanceToast,
        snapshot _: AdvanceServerSnapshot,
        returnToTaskId: String? = nil,
        clearCurrentTask: Bool = false
    ) async {
        do {
            let captured = try await workspaceClient.capture()
            _ = try await client.complete(packetId: packetId, workspaceSnapshot: captured)
            try await restorePaperWorkspaceOrSwitch(packetId: nextSelectionPacketId, fallbackWorkspaceId: workspaceId)
            if let returnToTaskId {
                let state = try await client.setCurrentTask(taskId: returnToTaskId)
                currentTask = state.task
            } else if clearCurrentTask {
                _ = try await client.setCurrentTask(taskId: nil)
                currentTask = nil
            }
            packets = (try? await client.fetchQueue()) ?? packets.filter { $0.id != packetId }
            if let nextSelectionPacketId, packets.contains(where: { $0.id == nextSelectionPacketId }) {
                selectedPacketID = nextSelectionPacketId
                if returnToTaskId == nil && !clearCurrentTask {
                    await syncCurrentTaskForPacketIfPossible(nextSelectionPacketId)
                }
            }
            advanceToast = switchToPaperToast(packetId: nextSelectionPacketId) ?? toast
        } catch {
            if await recoverFromQueueActionConflict(error) { return }
            state = .failed(error.localizedDescription)
        }
    }

    private func restorePaperWorkspaceOrSwitch(packetId: String?, fallbackWorkspaceId: String) async throws {
        if let packetId,
           let snapshot = packets.first(where: { $0.id == packetId })?.workspaceSnapshot {
            let response = try await workspaceClient.restore(
                snapshot: snapshot,
                currentWindows: nil,
                idempotencyKey: "mac_advance_restore_\(packetId)_\(UUID().uuidString)"
            )
            workspaceRestoreState = .executed(response.receipt)
            return
        }

        try await aeroSpaceClient.switchTo(workspace: fallbackWorkspaceId)
    }

    public func doneAndNext() async {
        guard let packetId = selectedPacketID else {
            showNoSelectedPaperFeedback()
            return
        }
        guard beginPaperAction("Completing paper...") else { return }
        defer { finishPaperAction() }
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.complete(packetId: packetId, workspaceSnapshot: workspaceSnapshot)
            try await loadNextAfterQueueAction(successToast: .actionComplete("Done. Next paper ready."))
        } catch {
            if await recoverFromQueueActionConflict(error) { return }
            state = .failed(error.localizedDescription)
        }
    }

    public func deferSelectedPacket(until dueAt: Date) async {
        guard let packetId = selectedPacketID else {
            showNoSelectedPaperFeedback()
            return
        }
        guard beginPaperAction("Deferring paper...") else { return }
        defer { finishPaperAction() }
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.deferPacket(packetId: packetId, until: dueAt, workspaceSnapshot: workspaceSnapshot)
            try await loadNextAfterQueueAction(successToast: .deferredUntil(dueAt))
        } catch {
            if await recoverFromQueueActionConflict(error) { return }
            state = .failed(error.localizedDescription)
        }
    }

    public func deferSelectedPacketForOneHour(now: Date = Date()) async {
        await deferSelectedPacket(until: now.addingTimeInterval(60 * 60))
    }

    public func ignoreSelectedPacket() async {
        guard let packetId = selectedPacketID else {
            showNoSelectedPaperFeedback()
            return
        }
        guard beginPaperAction("Ignoring paper...") else { return }
        defer { finishPaperAction() }
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.ignorePacket(packetId: packetId, workspaceSnapshot: workspaceSnapshot)
            try await loadNextAfterQueueAction(successToast: .actionComplete("Ignored. Next paper ready."))
        } catch {
            if await recoverFromQueueActionConflict(error) { return }
            state = .failed(error.localizedDescription)
        }
    }

    public func executeRecommendedActionAndNext() async {
        guard let packetId = selectedPacketID else {
            showNoSelectedPaperFeedback()
            return
        }
        guard canExecuteSelectedRecommendedAction else {
            taskBindingState = .failed(selectedRecommendedActionBlockReason ?? "Recommended action is not ready")
            advanceToast = .actionComplete(Self.shortStatusMessage(selectedRecommendedActionBlockReason ?? "Recommended action is not ready"))
            return
        }

        if let session = selectedTaskSessions.first,
           let terminalRef = session.terminalRef,
           !isTerminalSendConfirmed(forRef: terminalRef) {
            pendingTerminalSendConfirmation = PendingTerminalSendConfirmation(
                packetId: packetId,
                terminalRef: terminalRef,
                sessionId: session.id
            )
            return
        }

        await runRecommendedActionAfterChecks(packetId: packetId)
    }

    public func confirmPendingTerminalSendAndProceed(scope: TerminalSendConfirmScope = .rememberForRef) async {
        guard let pending = pendingTerminalSendConfirmation else { return }
        switch scope {
        case .oneShot:
            // Allow this single send only; do not persist.
            break
        case .thisSession:
            terminalSendThisSessionConfirmed.insert(pending.terminalRef)
        case .rememberForRef:
            var remembered = rememberedTerminalRefs
            remembered.insert(pending.terminalRef)
            userDefaults.set(Array(remembered), forKey: Self.terminalSendRememberedRefsKey)
            // Keep the legacy global flag aligned for backwards compat.
            userDefaults.set(true, forKey: Self.terminalSendConfirmedDefaultsKey)
        }
        pendingTerminalSendConfirmation = nil
        await runRecommendedActionAfterChecks(packetId: pending.packetId)
    }

    public func cancelPendingTerminalSend() {
        pendingTerminalSendConfirmation = nil
    }

    public func isTerminalSendConfirmed(forRef terminalRef: String) -> Bool {
        if userDefaults.bool(forKey: Self.terminalSendConfirmedDefaultsKey) { return true }
        if terminalSendThisSessionConfirmed.contains(terminalRef) { return true }
        if rememberedTerminalRefs.contains(terminalRef) { return true }
        return false
    }

    public var rememberedTerminalRefs: Set<String> {
        let stored = userDefaults.array(forKey: Self.terminalSendRememberedRefsKey) as? [String] ?? []
        return Set(stored)
    }

    public func resetTerminalSendConfirmation() {
        userDefaults.removeObject(forKey: Self.terminalSendConfirmedDefaultsKey)
        userDefaults.removeObject(forKey: Self.terminalSendRememberedRefsKey)
        terminalSendThisSessionConfirmed.removeAll()
    }

    private func runRecommendedActionAfterChecks(packetId: String) async {
        guard beginPaperAction("Sending to agent...") else { return }
        defer { finishPaperAction() }
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.executeRecommendedAction(packetId: packetId, workspaceSnapshot: workspaceSnapshot)
            try await loadNextAfterQueueAction(successToast: .actionComplete("Sent to agent. Next paper ready."))
        } catch {
            if await recoverFromQueueActionConflict(error) { return }
            state = .failed(error.localizedDescription)
        }
    }

    private func recoverFromQueueActionConflict(_ error: Error) async -> Bool {
        guard isQueueConflict(error) else {
            return false
        }
        packets = (try? await client.fetchQueue()) ?? packets
        if let selectedPacketID, !packets.contains(where: { $0.id == selectedPacketID }) {
            self.selectedPacketID = packets.first?.id
        } else if selectedPacketID == nil {
            selectedPacketID = packets.first?.id
        }
        state = .loaded
        advanceToast = queuePausedToast(for: error)
        await loadTaskSessionsForSelectedPacketIfNeeded()
        return true
    }

    private func loadNextAfterQueueAction(successToast: AdvanceToast) async throws {
        let leasedPacket: ReviewPacket?
        do {
            leasedPacket = try await client.next(after: nil)
        } catch {
            guard isQueueConflict(error) else {
                throw error
            }
            packets = (try? await client.fetchQueue()) ?? packets
            selectedPacketID = packets.first?.id
            state = .loaded
            advanceToast = packets.isEmpty ? successToast : actionSavedQueuePausedToast(for: error)
            await loadTaskSessionsForSelectedPacketIfNeeded()
            await prepareSelectedWorkspaceRestore()
            await requestSelectedBrowserContextRestoresIfNeeded()
            return
        }
        packets = try await client.fetchQueue()
        selectedPacketID = leasedPacket?.id ?? packets.first?.id
        state = .loaded
        if selectedPacketID != nil || packets.isEmpty {
            advanceToast = successToast
        }
        await loadTaskSessionsForSelectedPacketIfNeeded()
        await prepareSelectedWorkspaceRestore()
        await requestSelectedBrowserContextRestoresIfNeeded()
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

    public func prepareSelectedPacketDetail() async {
        await prepareSelectedWorkspaceRestore()
        await requestSelectedBrowserContextRestoresIfNeeded()
        await loadLineageForSelectedPacket()
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
            do {
                try await saveSelectedTaskWorkspaceSnapshotIfNeeded()
            } catch {
                workspaceRestoreState = .failed(error.localizedDescription)
            }
            taskBindingState = .bound(binding)
        } catch {
            taskBindingState = .failed(error.localizedDescription)
        }
    }

    public func sendMasterCommand(text: String, taskHint: String? = nil) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            masterCommandState = .failed("Master command text is required")
            advanceToast = .actionComplete("Master command text is required.")
            return
        }

        guard beginMasterAction("Routing master command...") else { return }
        do {
            let result = try await client.sendMasterCommand(
                text: trimmed,
                taskHint: normalizedTaskHint(taskHint) ?? selectedTaskId
            )
            masterCommandState = .routed(result)
            advanceToast = .actionComplete(Self.masterCommandRoutedStatus(result))
            await refreshQueue()
            await loadTaskSessions()
            if let queuedPacket = result.queuedPacket {
                if !packets.contains(where: { $0.id == queuedPacket.id }) {
                    packets.append(queuedPacket)
                    packets.sort { $0.priority > $1.priority }
                }
                selectedPacketID = queuedPacket.id
                await loadTaskSessionsForSelectedPacketIfNeeded()
                await prepareSelectedWorkspaceRestore()
                await requestSelectedBrowserContextRestoresIfNeeded()
            }
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Master command failed: \(Self.shortStatusMessage(error.localizedDescription))")
        }
    }

    public func startMasterTask(
        text: String,
        taskHint: String? = nil,
        cwd: String? = nil,
        model: String? = nil
    ) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            masterCommandState = .failed("Master task prompt is required")
            advanceToast = .actionComplete("Master task prompt is required.")
            return
        }

        guard beginMasterAction("Starting task...") else { return }
        var workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()
        if workspaceSnapshot == nil {
            workspaceSnapshot = try? await workspaceClient.capture()
        }
        do {
            let started = try await client.startMasterTask(
                text: trimmed,
                taskHint: normalizedTaskHint(taskHint),
                cwd: normalizedTaskHint(cwd),
                model: normalizedTaskHint(model),
                workspaceSnapshot: workspaceSnapshot
            )
            masterCommandState = .started(started)
            advanceToast = .actionComplete("Started task \(started.taskId).")
            await loadTaskSessions()
            await refreshQueue()
            if let startedPaper = packets.first(where: { $0.taskId == started.taskId }) {
                selectedPacketID = startedPaper.id
            }
            await prepareSelectedWorkspaceRestore()
            await requestSelectedBrowserContextRestoresIfNeeded()
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Start task failed: \(Self.shortStatusMessage(error.localizedDescription))")
        }
    }

    public func previewFanOut(message: String, taskHintSubstring: String?, taskIdPattern: String?, idempotencyKey: String) async -> MasterFanOutResult? {
        guard beginMasterAction("Previewing fan-out...") else { return nil }
        do {
            let result = try await client.masterFanOut(
                message: message,
                taskHintSubstring: taskHintSubstring,
                taskIdPattern: taskIdPattern,
                taskIds: [],
                dryRun: true,
                idempotencyKey: idempotencyKey
            )
            masterCommandState = .idle
            advanceToast = .actionComplete("Fan-out preview: \(result.matchedCount) matches.")
            return result
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Fan-out preview failed: \(Self.shortStatusMessage(error.localizedDescription))")
            return nil
        }
    }

    public func executeFanOut(message: String, taskHintSubstring: String?, taskIdPattern: String?, idempotencyKey: String) async -> MasterFanOutResult? {
        guard beginMasterAction("Broadcasting fan-out...") else { return nil }
        do {
            let result = try await client.masterFanOut(
                message: message,
                taskHintSubstring: taskHintSubstring,
                taskIdPattern: taskIdPattern,
                taskIds: [],
                dryRun: false,
                idempotencyKey: idempotencyKey
            )
            masterCommandState = .idle
            advanceToast = .actionComplete("Fan-out delivered to \(result.deliveredCount) sessions.")
            await refreshQueue()
            await loadTaskSessions()
            return result
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Fan-out failed: \(Self.shortStatusMessage(error.localizedDescription))")
            return nil
        }
    }

    public func bumpQueuePaperPriority(packetId: String, delta: Int, reason: String? = nil) async {
        guard beginMasterAction("Updating priority...") else { return }
        do {
            _ = try await client.bumpQueueItemPriority(
                packetId: packetId,
                delta: delta,
                score: nil,
                reason: reason ?? "manual_priority_bump"
            )
            masterCommandState = .idle
            advanceToast = .actionComplete("Priority updated.")
            await refreshQueue()
            selectedPacketID = packetId
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Priority update failed: \(Self.shortStatusMessage(error.localizedDescription))")
        }
    }

    public func refreshActivity(limit: Int = 30) async {
        do {
            let result = try await client.fetchActivity(limit: limit)
            activityEvents = result.events
        } catch {
            // Silent: activity feed is informational.
        }
    }

    public func refreshFollowsRules() async {
        followsRulesState = .loading
        do {
            let result = try await client.fetchFollowsWindowExclusions()
            followsWindowExclusions = result.exclusions
            followsWindowSuggestions = await captureFollowsRuleSuggestions(exclusions: result.exclusions)
            followsRulesState = .loaded
        } catch {
            followsRulesState = .failed(error.localizedDescription)
        }
    }

    public func addFollowsRule(appBundle: String?, titleSubstring: String?) async {
        let normalizedAppBundle = normalizedOptional(appBundle)
        let normalizedTitleSubstring = normalizedOptional(titleSubstring)
        guard normalizedAppBundle != nil || normalizedTitleSubstring != nil else {
            followsRulesState = .failed("App bundle or title substring is required")
            return
        }

        followsRulesState = .saving
        do {
            _ = try await client.addFollowsWindowExclusion(
                appBundle: normalizedAppBundle,
                titleSubstring: normalizedTitleSubstring
            )
            await refreshFollowsRules()
        } catch {
            followsRulesState = .failed(error.localizedDescription)
        }
    }

    public func deleteFollowsRule(id: String) async {
        followsRulesState = .saving
        do {
            _ = try await client.deleteFollowsWindowExclusion(id: id)
            followsWindowExclusions.removeAll { $0.exclusionId == id }
            followsWindowSuggestions = await captureFollowsRuleSuggestions(exclusions: followsWindowExclusions)
            followsRulesState = .loaded
        } catch {
            followsRulesState = .failed(error.localizedDescription)
        }
    }

    public func refreshReadingQueueCount() async {
        do {
            let result = try await client.fetchReadingQueue()
            readingQueueUnboundCount = result.count
        } catch {
            // Silent: this is informational. State stays as last known.
        }
    }

    public func promoteReadingQueue(contextIds: [String] = []) async {
        guard beginMasterAction("Promoting reading papers...") else { return }
        do {
            let result = try await client.promoteReadingQueueContexts(ids: contextIds)
            masterCommandState = .idle
            advanceToast = .actionComplete("Promoted \(result.promoted.count) reading papers.")
            await refreshQueue()
            if let firstNew = result.promoted.first(where: { !$0.idempotent && $0.queueItemId != nil })?.queueItemId {
                selectedPacketID = firstNew
            }
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Reading queue promote failed: \(Self.shortStatusMessage(error.localizedDescription))")
        }
    }

    public func bindSelectedTerminalRef(_ terminalRef: String) async {
        guard let session = selectedTaskSessions.first ?? taskSessions.first(where: { $0.taskId == selectedTaskId }) else {
            taskBindingState = .failed("No bound task session for this paper.")
            return
        }
        guard let taskId = session.taskId ?? selectedTaskId else {
            taskBindingState = .failed("No task id resolved for this session.")
            return
        }
        taskBindingState = .loading
        do {
            let binding = try await client.bindTaskSession(sessionId: session.id, taskId: taskId, terminalRef: terminalRef)
            if let refreshed = try? await client.fetchTaskSessions() {
                taskSessions = refreshed
            }
            taskBindingState = .bound(binding)
        } catch {
            taskBindingState = .failed(error.localizedDescription)
        }
    }

    public func startVoiceCapture() async -> String? {
        guard let service = voiceTranscriptionService else {
            voiceCaptureState = .unavailable
            return nil
        }
        voiceCaptureState = .listening
        voiceCaptureStartedAt = Date()
        voiceCaptureMaxSeconds = service.maxRecordingSeconds
        defer {
            voiceCaptureStartedAt = nil
        }
        do {
            let transcript = try await service.transcribeOneUtterance()
            let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                voiceCaptureState = .failed("Voice capture returned no text.")
                return nil
            }
            voiceCaptureState = .captured(trimmed)
            return trimmed
        } catch {
            voiceCaptureState = .failed(error.localizedDescription)
            return nil
        }
    }

    public func resetVoiceCapture() {
        voiceCaptureState = voiceTranscriptionService == nil ? .unavailable : .idle
    }

    public func presentMasterCommand() {
        auxiliarySheet = .masterCommand
    }

    public func presentOnboarding() {
        auxiliarySheet = .onboarding
    }

    public func presentActivity() {
        auxiliarySheet = .activity
        Task { await refreshActivity() }
        startAutomaticActivityRefresh()
    }

    public func presentFollowsRules() {
        auxiliarySheet = .followsRules
        Task { await refreshFollowsRules() }
    }

    public func dismissActivitySheetIfNeeded() {
        stopAutomaticActivityRefresh()
    }

    public func startAutomaticActivityRefresh(intervalNanoseconds: UInt64 = 5_000_000_000) {
        stopAutomaticActivityRefresh()
        activityRefreshTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    return
                }
                guard !Task.isCancelled, let self else { return }
                guard self.auxiliarySheet == .activity else {
                    self.activityRefreshTask = nil
                    return
                }
                await self.refreshActivity()
            }
        }
    }

    public func stopAutomaticActivityRefresh() {
        activityRefreshTask?.cancel()
        activityRefreshTask = nil
    }

    public func runCodexAutoBindOnce() async {
        do {
            let result = try await client.runCodexAutoBind()
            lastAutoBindResult = result
            await loadTaskSessions()
        } catch {
            taskBindingState = .failed("Auto-bind failed: \(error.localizedDescription)")
        }
    }

    public func setAutoBindContinuous(_ enabled: Bool, intervalNanoseconds: UInt64 = 30_000_000_000) {
        if enabled == autoBindContinuousEnabled { return }
        autoBindContinuousEnabled = enabled
        autoBindLoopTask?.cancel()
        autoBindLoopTask = nil
        guard enabled else { return }
        autoBindLoopTask = Task { @MainActor [weak self] in
            await self?.runCodexAutoBindOnce()
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: intervalNanoseconds)
                } catch {
                    return
                }
                guard !Task.isCancelled, let self else { return }
                guard self.autoBindContinuousEnabled else { return }
                await self.runCodexAutoBindOnce()
            }
        }
    }

    public func dismissAuxiliarySheet() {
        auxiliarySheet = nil
        stopAutomaticActivityRefresh()
    }

    private func normalizedOptional(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func captureFollowsRuleSuggestions(exclusions: [FollowsWindowExclusion]) async -> [FollowsWindowSuggestion] {
        let followsCandidates = (try? await client.fetchFollowsWindows(minWorkspaceCount: 2))?.windows ?? []
        var suggestions = followsCandidates.compactMap { candidate -> FollowsWindowSuggestion? in
            guard !isFollowsCandidateAlreadyExcluded(candidate, exclusions: exclusions) else {
                return nil
            }
            let appName = normalizedOptional(candidate.titlePrefix)
                ?? normalizedOptional(candidate.appBundle)
                ?? "Window \(candidate.windowId)"
            let workspace = candidate.knownWorkspaces.isEmpty ? "known follows window" : candidate.knownWorkspaces.joined(separator: ", ")
            return FollowsWindowSuggestion(
                appName: appName,
                appBundle: normalizedOptional(candidate.appBundle),
                title: normalizedOptional(candidate.titlePrefix),
                workspace: workspace,
                isCurrentFollowsCandidate: true
            )
        }
        var seen = Set(suggestions.map { followsSuggestionIdentity(appBundle: $0.appBundle, appName: $0.appName, title: $0.title) })

        guard let snapshot = try? await workspaceClient.capture(),
              let activeWorkspace = snapshot.activeWorkspace?.trimmingCharacters(in: .whitespacesAndNewlines),
              !activeWorkspace.isEmpty
        else {
            return suggestions
        }

        let activeDesktopSuggestions = snapshot.windows.compactMap { window -> FollowsWindowSuggestion? in
            guard window.workspace == activeWorkspace,
                  isFollowsRuleSuggestionEligible(window),
                  !isWindowAlreadyExcluded(window, exclusions: exclusions)
            else {
                return nil
            }

            let appBundle = normalizedOptional(window.appBundleId) ?? normalizedOptional(window.app)
            let title = normalizedOptional(window.title)
            let suggestion = FollowsWindowSuggestion(
                appName: window.app,
                appBundle: appBundle,
                title: title,
                workspace: window.workspace
            )
            guard seen.insert(followsSuggestionIdentity(appBundle: suggestion.appBundle, appName: suggestion.appName, title: suggestion.title)).inserted else {
                return nil
            }
            return suggestion
        }
        suggestions.append(contentsOf: activeDesktopSuggestions)
        return suggestions
    }

    private func followsSuggestionIdentity(appBundle: String?, appName: String, title: String?) -> String {
        [
            normalizedOptional(appBundle)?.lowercased() ?? appName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            normalizedOptional(title)?.lowercased() ?? "",
        ].joined(separator: "|")
    }

    private func isFollowsRuleSuggestionEligible(_ window: WorkspaceWindow) -> Bool {
        let app = window.app.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let bundle = window.appBundleId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        guard !app.isEmpty else {
            return false
        }
        let blockedApps: Set<String> = [
            "aerospace",
            "eventloopos queue",
            "eventloopqueueapp",
            "tailscale",
            "finder",
        ]
        let blockedBundles: Set<String> = [
            "com.eventloopos.queue",
            "com.nikitavoloboev.aerospace",
            "io.tailscale.ipn.macos",
            "com.apple.finder",
        ]
        return !blockedApps.contains(app) && !blockedBundles.contains(bundle)
    }

    private func isWindowAlreadyExcluded(_ window: WorkspaceWindow, exclusions: [FollowsWindowExclusion]) -> Bool {
        let windowBundle = (normalizedOptional(window.appBundleId) ?? normalizedOptional(window.app))?.lowercased()
        let title = normalizedOptional(window.title)?.lowercased() ?? ""
        return exclusions.contains { exclusion in
            if let appBundle = normalizedOptional(exclusion.appBundle)?.lowercased(),
               let windowBundle,
               appBundle == windowBundle {
                return true
            }
            if let titleSubstring = normalizedOptional(exclusion.titleSubstring)?.lowercased(), title.contains(titleSubstring) {
                return true
            }
            return false
        }
    }

    private func isFollowsCandidateAlreadyExcluded(_ candidate: FollowsWindowRecord, exclusions: [FollowsWindowExclusion]) -> Bool {
        let candidateBundle = normalizedOptional(candidate.appBundle)?.lowercased()
        let title = normalizedOptional(candidate.titlePrefix)?.lowercased() ?? ""
        return exclusions.contains { exclusion in
            if let appBundle = normalizedOptional(exclusion.appBundle)?.lowercased(),
               let candidateBundle,
               appBundle == candidateBundle {
                return true
            }
            if let titleSubstring = normalizedOptional(exclusion.titleSubstring)?.lowercased(), title.contains(titleSubstring) {
                return true
            }
            return false
        }
    }

    public func scanOnboarding() async {
        onboardingState = .scanning
        do {
            let scan = try await client.fetchOnboardingScan()
            onboardingState = .loaded(scan)
        } catch {
            onboardingState = .failed(error.localizedDescription)
        }
    }

    public func approveOnboardingProposal(id: String, queuePaper: Bool = false) async {
        await approveOnboardingProposal(OnboardingApprovalRequest(proposalId: id, queuePaper: queuePaper))
    }

    public func approveOnboardingProposal(_ request: OnboardingApprovalRequest) async {
        let request = normalizedOnboardingApprovalRequest(request)
        let label = request.taskId ?? request.proposalId
        onboardingState = .approving(label)
        do {
            let result = try await client.approveOnboardingProposal(request)
            onboardingState = .approved(result)
            await loadTaskSessions()
            await refreshQueue()
            if let queuedPaperId = result.queuedPaper?.id, packets.contains(where: { $0.id == queuedPaperId }) {
                selectedPacketID = queuedPaperId
            }
            await prepareSelectedWorkspaceRestore()
            await requestSelectedBrowserContextRestoresIfNeeded()
        } catch {
            onboardingState = .failed(error.localizedDescription)
        }
    }

    private func normalizedOnboardingApprovalRequest(_ request: OnboardingApprovalRequest) -> OnboardingApprovalRequest {
        let normalizedTaskId = request.taskId.flatMap { raw -> String? in
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return normalizedTaskIdForApproval(trimmed, fallback: request.proposalId)
        }
        return OnboardingApprovalRequest(
            proposalId: request.proposalId,
            taskId: normalizedTaskId,
            windowIds: request.windowIds,
            taskSessionIds: request.taskSessionIds,
            browserContextIds: request.browserContextIds,
            queuePaper: request.queuePaper,
            actorId: request.actorId
        )
    }

    public func approveOnboardingDraft(
        proposal: OnboardingTaskProposal,
        taskId: String,
        windowIds: [Int],
        taskSessionIds: [String],
        browserContextIds: [String],
        queuePaper: Bool = false
    ) async {
        await approveOnboardingProposal(OnboardingApprovalRequest(
            proposalId: proposal.id,
            taskId: normalizedTaskIdForApproval(taskId, fallback: proposal.taskId),
            windowIds: windowIds,
            taskSessionIds: taskSessionIds,
            browserContextIds: browserContextIds,
            queuePaper: queuePaper
        ))
    }

    private func normalizedTaskIdForApproval(_ raw: String, fallback: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return fallback }
        let lowered = trimmed.lowercased()
        let suffix = lowered.hasPrefix("task_") ? String(lowered.dropFirst(5)) : lowered
        let pieces = suffix.split { character in
            !(character.isLetter || character.isNumber)
        }
        let slug = pieces.joined(separator: "_")
        return slug.isEmpty ? fallback : "task_\(slug)"
    }

    public func approveAllOnboardingProposals(queuePaper: Bool = true) async {
        guard case let .loaded(scan) = onboardingState else {
            onboardingState = .failed("Load an onboarding scan before approving all proposals")
            return
        }
        guard !scan.proposals.isEmpty else {
            onboardingState = .failed("No onboarding proposals to approve")
            return
        }

        let approvals = scan.proposals.map { proposal in
            OnboardingApprovalRequest(proposalId: proposal.id, queuePaper: queuePaper)
        }
        await approveOnboardingRequests(approvals)
    }

    public func approveOnboardingRequests(_ requests: [OnboardingApprovalRequest]) async {
        guard !requests.isEmpty else {
            onboardingState = .failed("No onboarding proposals to approve")
            return
        }

        onboardingState = .approving("all")
        let approvals = requests.map(normalizedOnboardingApprovalRequest)
        let idempotencyKey = "mac_onboarding_batch_\(UUID().uuidString)"

        do {
            let batchResult = try await batchApproveWithRetry(
                approvals: approvals,
                idempotencyKey: idempotencyKey,
                maxAttempts: 3
            )
            await loadTaskSessions()
            await refreshQueue()
            if let firstQueuedPaperId = batchResult.results.compactMap(\.queuedPaper?.id).first,
               packets.contains(where: { $0.id == firstQueuedPaperId }) {
                selectedPacketID = firstQueuedPaperId
            }
            if let lastEntry = batchResult.results.last {
                let request = approvals.first { $0.proposalId == lastEntry.proposalId }
                onboardingState = .approved(OnboardingApprovalResult(
                    ok: lastEntry.ok,
                    taskId: lastEntry.taskId ?? request?.taskId ?? request?.proposalId ?? "",
                    proposalId: lastEntry.proposalId,
                    bindings: [],
                    browserContextBindings: [],
                    queuedPaper: lastEntry.queuedPaper,
                    warnings: []
                ))
            }
            await prepareSelectedWorkspaceRestore()
            await requestSelectedBrowserContextRestoresIfNeeded()
        } catch {
            onboardingState = .failed(error.localizedDescription)
        }
    }

    private func batchApproveWithRetry(
        approvals: [OnboardingApprovalRequest],
        idempotencyKey: String,
        maxAttempts: Int
    ) async throws -> OnboardingApprovalBatchResult {
        var lastError: Error = QueueClientError.invalidResponse
        for attempt in 1...maxAttempts {
            do {
                return try await client.batchApproveOnboardingProposals(
                    approvals: approvals,
                    idempotencyKey: idempotencyKey
                )
            } catch {
                lastError = error
                if attempt == maxAttempts || !isTransientBatchError(error) {
                    throw error
                }
                let delayNs = UInt64(200_000_000) * UInt64(1 << (attempt - 1))
                try? await Task.sleep(nanoseconds: delayNs)
            }
        }
        throw lastError
    }

    private func isTransientBatchError(_ error: Error) -> Bool {
        if let queueError = error as? QueueClientError {
            if let status = queueError.statusCode {
                return status == 408 || status == 425 || status == 429 || (500...599).contains(status)
            }
            return queueError == .invalidResponse
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            return true
        }
        return false
    }

    public func renewSelectedLease() async {
        guard let packetId = selectedPacketID else {
            return
        }

        do {
            _ = try await client.renewLease(packetId: packetId)
        } catch {
            if isQueueConflict(error) {
                return
            }
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
            if response.executeSupported && !response.plan.commands.isEmpty {
                let restored = await executeWorkspaceRestore(snapshot: snapshot, idempotencyPrefix: "mac_workspace_restore")
                if restored {
                    await syncSelectedCurrentTaskIfPossible()
                    showSelectedPaperBriefingIfMatching(snapshot: snapshot)
                }
            }
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
            advanceToast = .manualModeActive
            return
        }

        let restored = await executeWorkspaceRestore(
            snapshot: snapshot,
            idempotencyPrefix: "mac_workspace_restore",
            startToast: workspaceRestoreStartToast(snapshot: snapshot)
        )
        if restored {
            await syncSelectedCurrentTaskIfPossible()
            showSelectedPaperBriefingIfMatching(snapshot: snapshot)
        }
    }

    @discardableResult
    private func executeWorkspaceRestore(
        snapshot: WorkspaceSnapshot,
        idempotencyPrefix: String,
        startToast: AdvanceToast = .actionComplete("Restoring workspace...")
    ) async -> Bool {
        guard !workspaceRestoreInFlight else {
            workspaceRestoreState = .alreadyRestoring
            advanceToast = Self.workspaceRestoreInFlightToast(startToast: startToast)
            return false
        }

        if let recent = lastWorkspaceRestore,
           recent.idempotencyPrefix == idempotencyPrefix,
           recent.snapshot == snapshot,
           Date().timeIntervalSince(recent.completedAt) < workspaceRestoreRepeatWindow {
            workspaceRestoreState = .alreadyRestored(recent.receipt)
            advanceToast = .actionComplete("Workspace already restored.")
            return true
        }

        workspaceRestoreInFlight = true
        workspaceRestoreState = .restoring
        advanceToast = startToast
        defer {
            workspaceRestoreInFlight = false
        }

        do {
            let response = try await workspaceClient.restore(
                snapshot: snapshot,
                currentWindows: nil,
                idempotencyKey: "\(idempotencyPrefix)_\(UUID().uuidString)"
            )
            workspaceRestoreState = .executed(response.receipt)
            lastWorkspaceRestore = RecentWorkspaceRestore(
                idempotencyPrefix: idempotencyPrefix,
                snapshot: snapshot,
                completedAt: Date(),
                receipt: response.receipt
            )
            advanceToast = .actionComplete("Workspace restored.")
            return true
        } catch {
            if let queueError = error as? QueueClientError, queueError.isIdempotencyConflict {
                workspaceRestoreState = .alreadyRestoring
                advanceToast = .actionComplete("Workspace restore already running.")
                return false
            }
            workspaceRestoreState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Workspace restore failed: \(Self.shortStatusMessage(error.localizedDescription))")
            return false
        }
    }

    private static func workspaceRestoreInFlightToast(startToast: AdvanceToast) -> AdvanceToast {
        switch startToast {
        case let .actionComplete(message) where message.hasPrefix("Restoring paper:"):
            return .actionComplete(message)
        default:
            return .actionComplete("Workspace restore already running...")
        }
    }

    private func workspaceRestoreStartToast(snapshot: WorkspaceSnapshot) -> AdvanceToast {
        guard selectedWorkspaceSnapshot == snapshot,
              let packetId = selectedPacketID else {
            return .actionComplete("Restoring workspace...")
        }

        return .actionComplete("Restoring paper: \(paperTitleForFeedback(packetId: packetId))...")
    }

    public func confirmSelectedWorkspaceRestore() async {
        guard let snapshot = selectedWorkspaceSnapshot else {
            workspaceRestoreState = .failed("Selected packet has no workspace snapshot")
            advanceToast = .actionComplete("Selected paper has no saved workspace.")
            return
        }

        await confirmWorkspaceRestore(snapshot: snapshot)
    }

    private func switchToPaperToast(packetId: String?) -> AdvanceToast? {
        guard let packetId else {
            return nil
        }
        guard let packet = packets.first(where: { $0.id == packetId }) else {
            return .switchedToPaper(packetId: packetId, title: packetId, decision: "Review this paper.")
        }

        let briefing = QueuePaperBriefingPresentation(
            packet: packet,
            selectedTaskSessions: packet.id == selectedPacketID ? selectedTaskSessions : []
        )
        return .switchedToPaper(packetId: packetId, title: briefing.title, decision: briefing.decision)
    }

    private func paperTitleForFeedback(packetId: String) -> String {
        guard let packet = packets.first(where: { $0.id == packetId }) else {
            return packetId
        }
        let title = QueuePaperBriefingPresentation(
            packet: packet,
            selectedTaskSessions: packet.id == selectedPacketID ? selectedTaskSessions : []
        ).title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? packetId : title
    }

    private func showSelectedPaperBriefingIfMatching(snapshot: WorkspaceSnapshot) {
        guard selectedWorkspaceSnapshot == snapshot,
              let toast = switchToPaperToast(packetId: selectedPacketID) else {
            return
        }
        advanceToast = toast
    }

    public func saveSelectedTaskLayout() async {
        guard let taskId = selectedTaskId else {
            workspaceRestoreState = .failed("Selected packet has no task id")
            return
        }
        guard mode == .eventLoop else {
            workspaceRestoreState = .skippedManualMode
            return
        }

        do {
            let captured = try await workspaceClient.capture()
            _ = try await client.updateTaskLayout(taskId: taskId, layout: captured)
            workspaceRestoreState = .savedTaskLayout(taskId)
        } catch {
            workspaceRestoreState = .failed(error.localizedDescription)
        }
    }

    public func confirmManualWorkspaceRestore() async {
        guard let snapshot = manualWorkspaceSnapshot else {
            workspaceRestoreState = .failed("No manual workspace snapshot saved")
            advanceToast = .actionComplete("No manual workspace saved.")
            return
        }

        let idempotencyPrefix = "mac_manual_workspace_restore"
        let startedInManualMode = mode == .manual && !shouldRestoreWorkspace
        guard !workspaceRestoreInFlight else {
            workspaceRestoreState = .alreadyRestoring
            advanceToast = .actionComplete("Manual Mode active. Manual workspace restore already running...")
            return
        }

        if let recent = lastWorkspaceRestore,
           recent.idempotencyPrefix == idempotencyPrefix,
           recent.snapshot == snapshot,
           Date().timeIntervalSince(recent.completedAt) < workspaceRestoreRepeatWindow {
            mode = .manual
            shouldRestoreWorkspace = false
            workspaceRestoreState = .alreadyRestored(recent.receipt)
            advanceToast = .actionComplete("Manual Mode active. Manual workspace already restored.")
            return
        }

        workspaceRestoreInFlight = true
        defer {
            workspaceRestoreInFlight = false
        }

        do {
            advanceToast = .actionComplete("Manual Mode active. Restoring manual workspace...")
            let response = try await workspaceClient.restore(
                snapshot: snapshot,
                currentWindows: nil,
                idempotencyKey: "\(idempotencyPrefix)_\(UUID().uuidString)"
            )
            lastWorkspaceRestore = RecentWorkspaceRestore(
                idempotencyPrefix: idempotencyPrefix,
                snapshot: snapshot,
                completedAt: Date(),
                receipt: response.receipt
            )
            guard !startedInManualMode || (mode == .manual && !shouldRestoreWorkspace) else {
                return
            }
            mode = .manual
            shouldRestoreWorkspace = false
            workspaceRestoreState = .executed(response.receipt)
            advanceToast = .actionComplete("Manual Mode active. Manual workspace restored.")
        } catch {
            guard !startedInManualMode || (mode == .manual && !shouldRestoreWorkspace) else {
                return
            }
            workspaceRestoreState = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Manual Mode active. Manual workspace restore failed: \(Self.shortStatusMessage(error.localizedDescription))")
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

    public func requestContextRestore(
        resource: ReviewContextResource,
        idempotencyKeyPrefix: String = "mac_context_restore"
    ) async {
        contextRestoreState = .planning(resource)
        do {
            let restoreRequest = try await client.requestContextRestore(
                resource: resource,
                idempotencyKey: "\(idempotencyKeyPrefix)_\(resource.id)_\(UUID().uuidString)"
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
        guard selectedPacketID != nil else {
            showNoSelectedPaperFeedback()
            return
        }
        guard beginPaperAction("Skipping paper...") else { return }
        defer { finishPaperAction() }

        do {
            try await saveSelectedTaskWorkspaceSnapshotIfNeeded()
            if let nextPacket = try await client.next(after: selectedPacketID) {
                selectedPacketID = nextPacket.id
                await loadTaskSessionsForSelectedPacketIfNeeded()
                await prepareSelectedWorkspaceRestore()
                await requestSelectedBrowserContextRestoresIfNeeded()
                advanceToast = switchToPaperToast(packetId: nextPacket.id)
            } else {
                advanceToast = .actionComplete("No other paper ready.")
            }
        } catch {
            if isQueueConflict(error) {
                packets = (try? await client.fetchQueue()) ?? packets
                selectedPacketID = packets.first?.id ?? selectedPacketID
                state = .loaded
                advanceToast = queuePausedToast(for: error)
                return
            }
            state = .failed(error.localizedDescription)
            advanceToast = .actionComplete("Skip failed: \(Self.shortStatusMessage(error.localizedDescription))")
        }
    }

    private func requestSelectedBrowserContextRestoresIfNeeded() async {
        guard shouldRestoreWorkspace, let packet = selectedPacket else {
            return
        }
        guard !autoRestoredContextPacketIds.contains(packet.id) else {
            return
        }
        let resources = packet.contextResources.filter { resource in
            resource.kind == "browser_tab" && resource.url != nil
        }
        guard !resources.isEmpty else {
            return
        }

        autoRestoredContextPacketIds.insert(packet.id)
        for resource in resources {
            await requestContextRestore(
                resource: resource,
                idempotencyKeyPrefix: "mac_auto_context_restore"
            )
        }
    }

    private func normalizedTaskHint(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private static func shortStatusMessage(_ value: String, maxLength: Int = 96) -> String {
        let normalized = userFacingQueueStatusDetail(value)
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.count > maxLength else {
            return normalized
        }
        let index = normalized.index(normalized.startIndex, offsetBy: maxLength)
        return "\(normalized[..<index])..."
    }

    private static func masterCommandRoutedStatus(_ result: MasterCommandResult) -> String {
        if let queuedPacket = result.queuedPacket {
            return "Master command queued: \(queuedPacket.title)"
        }
        if let targetTaskId = result.targetTaskId {
            return "Master command routed to \(targetTaskId)."
        }
        if let routeAction = result.routeAction {
            return "Master command routed: \(routeAction)."
        }
        return "Master command routed."
    }
}

private struct RecentWorkspaceRestore {
    let idempotencyPrefix: String
    let snapshot: WorkspaceSnapshot
    let completedAt: Date
    let receipt: WorkspaceRestoreReceipt
}
