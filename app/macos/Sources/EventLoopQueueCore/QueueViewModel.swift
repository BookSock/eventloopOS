import Foundation

@MainActor
public final class QueueViewModel: ObservableObject {
    @Published public private(set) var packets: [ReviewPacket]
    @Published public var selectedPacketID: String?
    @Published public private(set) var state: QueueState
    @Published public private(set) var mode: EventLoopMode
    @Published public private(set) var shouldRestoreWorkspace: Bool
    @Published public private(set) var workspaceRestoreState: WorkspaceRestoreState
    @Published public private(set) var contextRestoreState: ContextRestoreState

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
        self.contextRestoreState = .idle
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
        selectedPacket?.recommendedActionType == "resume_agent"
    }

    public var selectedWorkspaceSnapshot: WorkspaceSnapshot? {
        selectedPacket?.workspaceSnapshot
    }

    public var canRestoreSelectedWorkspace: Bool {
        shouldRestoreWorkspace && selectedWorkspaceSnapshot != nil
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
            let leasedPacketID = try await leasedSelectionID(preferredPacketID: selectedPacketID)
            packets = try await client.fetchQueue()
            if let leasedPacketID, packets.contains(where: { $0.id == leasedPacketID }) {
                selectedPacketID = leasedPacketID
            } else if let selectedPacketID, packets.contains(where: { $0.id == selectedPacketID }) {
                self.selectedPacketID = selectedPacketID
            } else {
                selectedPacketID = packets.first?.id
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
    }

    public func returnToEventLoopMode() {
        mode = .eventLoop
        shouldRestoreWorkspace = true
    }

    public func returnToEventLoopModeAndPrepareWorkspaceRestore() async {
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

    public func doneAndNext() async {
        guard let packetId = selectedPacketID else {
            return
        }

        state = .loading
        do {
            _ = try await client.complete(packetId: packetId)
            let leasedPacket = try await client.next(after: nil)
            packets = try await client.fetchQueue()
            selectedPacketID = leasedPacket?.id ?? packets.first?.id
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    public func executeRecommendedActionAndNext() async {
        guard let packetId = selectedPacketID else {
            return
        }

        state = .loading
        do {
            _ = try await client.executeRecommendedAction(packetId: packetId)
            let leasedPacket = try await client.next(after: nil)
            packets = try await client.fetchQueue()
            selectedPacketID = leasedPacket?.id ?? packets.first?.id
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func leasedSelectionID(preferredPacketID: String?) async throws -> String? {
        if let preferredPacketID {
            do {
                _ = try await client.renewLease(packetId: preferredPacketID)
                return preferredPacketID
            } catch {
                // Selection may be stale or not leased yet. Fall back to leasing the next ready item.
            }
        }

        return try await client.next(after: nil)?.id
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
            selectedPacketID = try await client.next(after: selectedPacketID)?.id
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
