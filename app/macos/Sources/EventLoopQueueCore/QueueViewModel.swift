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
    case enteredLimbo
    case taskCreated(taskId: String)
    case switchedToPaper(packetId: String)
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
    @Published public private(set) var autoBindContinuousEnabled: Bool = false
    @Published public private(set) var lastAutoBindResult: CodexAutoBindResult?
    @Published public private(set) var advanceToast: AdvanceToast?
    @Published public private(set) var currentTask: TaskRecord?

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
                selectedPacketID = nil
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
        await loadTaskSessionsForSelectedPacketIfNeeded()
        await prepareSelectedWorkspaceRestore()
        await requestSelectedBrowserContextRestoresIfNeeded()
    }

    public func enterManualMode() async {
        do {
            _ = try await client.setManualMode(active: true, reason: "user_hotkey")
        } catch {
            state = .failed("Manual mode failed to engage on server: \(error.localizedDescription)")
            return
        }
        applyLocalEnterManualMode()
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
    }

    public func returnToEventLoopModeAndPrepareWorkspaceRestore() async {
        let wasManual = mode == .manual
        if wasManual {
            await captureManualWorkspaceSnapshot()
        }
        applyLocalReturnToEventLoopMode()
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
            await captureManualWorkspaceSnapshot()
        }
        applyLocalReturnToEventLoopMode()
        workspaceRestoreState = .keptCurrentLayout
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
        do {
            try await saveSelectedTaskWorkspaceSnapshotIfNeeded()
        } catch {
            state = .failed(error.localizedDescription)
        }
        await enterManualMode()
        guard mode == .manual else { return }
        if manualWorkspaceSnapshot != nil {
            await confirmManualWorkspaceRestore()
        }
    }

    public func pullNextPaper() async {
        if mode == .manual {
            await captureManualWorkspaceSnapshot()
            await returnToEventLoopMode()
        } else if manualWorkspaceSnapshot == nil {
            await captureManualWorkspaceSnapshot()
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
        await requestSelectedBrowserContextRestoresIfNeeded()
    }

    public func advance() async {
        advanceToast = nil
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

    private func loadAdvanceSnapshot() async throws -> AdvanceServerSnapshot {
        let manualModeState = try await client.getManualMode()
        let currentWorkspaceId: String?
        do {
            currentWorkspaceId = try await aeroSpaceClient.focusedWorkspace()
        } catch {
            currentWorkspaceId = nil
        }
        let currentTaskState = try await client.getCurrentTask()
        let allTasks = (try? await client.listTasks()) ?? []
        let queue = (try? await client.fetchQueue()) ?? []
        let foreground = await codexForegroundResolver.resolveForeground()
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
        let resolvedLimboWorkspaceId = await pickLimboWorkspace(boundWorkspaceIds: boundWorkspaceIds) ?? limboWorkspaceId

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

    private func workspaceIdForTask(_ task: TaskRecord) async -> String? {
        if let workspaceId = task.aerospaceWorkspaceId, !workspaceId.isEmpty {
            return workspaceId
        }
        guard let envelope = try? await client.getTaskWithLayout(taskId: task.taskId) else {
            return nil
        }
        return envelope.layout?.layout.activeWorkspace
    }

    private func pickLimboWorkspace(boundWorkspaceIds: Set<String>) async -> String? {
        guard let workspaces = try? await aeroSpaceClient.listWorkspaces() else {
            return nil
        }
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
                await pullNextPaper()
                return
            }
            advanceToast = .noForegroundCodex
        case let .createTaskFromForeground(anchor, workspaceId):
            await runCreateTaskFromForeground(anchor: anchor, workspaceId: workspaceId)
        case let .saveLayoutAndPullPaper(currentTaskId, nextPacketId, nextWorkspaceId):
            await runSaveLayoutAndSwitch(
                currentTaskId: currentTaskId,
                workspaceId: nextWorkspaceId,
                packetId: nextPacketId,
                toastForSwitch: .switchedToPaper(packetId: nextPacketId)
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
                toast: .switchedToPaper(packetId: nextPacketId),
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

    private func runCreateTaskFromForeground(anchor: TaskAnchor, workspaceId: String) async {
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
            }
            advanceToast = toastForSwitch
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
                _ = try await client.setCurrentTask(taskId: returnToTaskId)
            } else if clearCurrentTask {
                _ = try await client.setCurrentTask(taskId: nil)
                currentTask = nil
            }
            packets = (try? await client.fetchQueue()) ?? packets.filter { $0.id != packetId }
            if let nextSelectionPacketId, packets.contains(where: { $0.id == nextSelectionPacketId }) {
                selectedPacketID = nextSelectionPacketId
            }
            advanceToast = toast
        } catch {
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
            return
        }
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.complete(packetId: packetId, workspaceSnapshot: workspaceSnapshot)
            try await loadNextAfterQueueAction()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func deferSelectedPacket(until dueAt: Date) async {
        guard let packetId = selectedPacketID else {
            return
        }
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.deferPacket(packetId: packetId, until: dueAt, workspaceSnapshot: workspaceSnapshot)
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
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.ignorePacket(packetId: packetId, workspaceSnapshot: workspaceSnapshot)
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
        let workspaceSnapshot = await captureSelectedTaskWorkspaceSnapshot()

        state = .loading
        do {
            _ = try await client.executeRecommendedAction(packetId: packetId, workspaceSnapshot: workspaceSnapshot)
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
            return
        }

        masterCommandState = .sending
        do {
            let result = try await client.sendMasterCommand(
                text: trimmed,
                taskHint: normalizedTaskHint(taskHint) ?? selectedTaskId
            )
            masterCommandState = .routed(result)
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
            return
        }

        masterCommandState = .sending
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
            await loadTaskSessions()
            await refreshQueue()
            if let startedPaper = packets.first(where: { $0.taskId == started.taskId }) {
                selectedPacketID = startedPaper.id
            }
            await prepareSelectedWorkspaceRestore()
            await requestSelectedBrowserContextRestoresIfNeeded()
        } catch {
            masterCommandState = .failed(error.localizedDescription)
        }
    }

    public func previewFanOut(message: String, taskHintSubstring: String?, taskIdPattern: String?, idempotencyKey: String) async -> MasterFanOutResult? {
        masterCommandState = .sending
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
            return result
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            return nil
        }
    }

    public func executeFanOut(message: String, taskHintSubstring: String?, taskIdPattern: String?, idempotencyKey: String) async -> MasterFanOutResult? {
        masterCommandState = .sending
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
            await refreshQueue()
            await loadTaskSessions()
            return result
        } catch {
            masterCommandState = .failed(error.localizedDescription)
            return nil
        }
    }

    public func bumpQueuePaperPriority(packetId: String, delta: Int, reason: String? = nil) async {
        masterCommandState = .sending
        do {
            _ = try await client.bumpQueueItemPriority(
                packetId: packetId,
                delta: delta,
                score: nil,
                reason: reason ?? "manual_priority_bump"
            )
            masterCommandState = .idle
            await refreshQueue()
            selectedPacketID = packetId
        } catch {
            masterCommandState = .failed(error.localizedDescription)
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

    public func refreshReadingQueueCount() async {
        do {
            let result = try await client.fetchReadingQueue()
            readingQueueUnboundCount = result.count
        } catch {
            // Silent: this is informational. State stays as last known.
        }
    }

    public func promoteReadingQueue(contextIds: [String] = []) async {
        masterCommandState = .sending
        do {
            let result = try await client.promoteReadingQueueContexts(ids: contextIds)
            masterCommandState = .idle
            await refreshQueue()
            if let firstNew = result.promoted.first(where: { !$0.idempotent && $0.queueItemId != nil })?.queueItemId {
                selectedPacketID = firstNew
            }
        } catch {
            masterCommandState = .failed(error.localizedDescription)
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
            switch queueError {
            case let .httpStatus(status):
                return status == 408 || status == 425 || status == 429 || (500...599).contains(status)
            case .invalidResponse:
                return true
            case .packetNotFound:
                return false
            }
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
                let executed = try await workspaceClient.restore(
                    snapshot: snapshot,
                    currentWindows: nil,
                    idempotencyKey: "mac_workspace_restore_\(UUID().uuidString)"
                )
                workspaceRestoreState = .executed(executed.receipt)
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
        do {
            try await saveSelectedTaskWorkspaceSnapshotIfNeeded()
            if let nextPacket = try await client.next(after: selectedPacketID) {
                selectedPacketID = nextPacket.id
                await loadTaskSessionsForSelectedPacketIfNeeded()
                await prepareSelectedWorkspaceRestore()
                await requestSelectedBrowserContextRestoresIfNeeded()
            }
        } catch {
            state = .failed(error.localizedDescription)
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
}
