import Foundation

@MainActor
public final class QueueViewModel: ObservableObject {
    @Published public private(set) var packets: [ReviewPacket]
    @Published public var selectedPacketID: String?
    @Published public private(set) var state: QueueState
    @Published public private(set) var mode: EventLoopMode
    @Published public private(set) var shouldRestoreWorkspace: Bool
    @Published public private(set) var workspaceRestoreState: WorkspaceRestoreState

    private let client: any QueueClient
    private let workspaceClient: any WorkspaceClient
    private var leaseRenewalTask: Task<Void, Never>?

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
    }

    deinit {
        leaseRenewalTask?.cancel()
    }

    public var selectedPacket: ReviewPacket? {
        packets.first { $0.id == selectedPacketID }
    }

    public var hasPackets: Bool {
        !packets.isEmpty
    }

    public var isManualMode: Bool {
        mode == .manual
    }

    public func loadQueue() async {
        state = .loading
        do {
            packets = try await client.fetchQueue()
            selectedPacketID = packets.first?.id
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
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

    public func toggleManualMode() {
        if mode == .eventLoop {
            enterManualMode()
        } else {
            returnToEventLoopMode()
        }
    }

    public func doneAndNext() async {
        guard let packetId = selectedPacketID else {
            return
        }

        state = .loading
        do {
            _ = try await client.complete(packetId: packetId)
            packets = try await client.fetchQueue()
            selectedPacketID = packets.first?.id
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
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

    public func moveToNext() async {
        do {
            selectedPacketID = try await client.next(after: selectedPacketID)?.id
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
