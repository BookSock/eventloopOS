import XCTest
@testable import EventLoopQueueCore

@MainActor
final class QueueViewModelTests: XCTestCase {
    func testLoadQueueSelectsFirstPacket() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))

        await viewModel.loadQueue()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.count, 3)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.selectedPacket?.title, "Review blog feedback draft")
    }

    func testSelectIgnoresUnknownPacket() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        viewModel.select(packetId: "packet-ci-failed")
        viewModel.select(packetId: "missing")

        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testDoneAndNextCompletesSelectedPacketAndAdvances() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()

        await viewModel.doneAndNext()

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testRenewSelectedLeaseKeepsSelectionLoaded() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        await viewModel.renewSelectedLease()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.packets.count, 3)
    }

    func testAutomaticLeaseRenewalKeepsSelectedPacketLeased() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()

        viewModel.startAutomaticLeaseRenewal(intervalNanoseconds: 1_000_000, maxRenewals: 2)

        for _ in 0..<50 where client.renewedPacketIds.count < 2 {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        viewModel.stopAutomaticLeaseRenewal()

        XCTAssertEqual(client.renewedPacketIds, ["packet-blog-feedback", "packet-blog-feedback"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
    }

    func testManualModePausesWorkspaceRestoreWithoutClearingQueue() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        viewModel.enterManualMode()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.packets.count, 3)

        viewModel.returnToEventLoopMode()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
    }

    func testManualModeSkipsWorkspaceRestorePlanning() async {
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )

        viewModel.enterManualMode()
        await viewModel.prepareWorkspaceRestore(snapshot: snapshot)

        XCTAssertEqual(viewModel.workspaceRestoreState, .skippedManualMode)
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [])
    }

    func testEventLoopModePlansWorkspaceRestore() async {
        let plan = WorkspaceRestorePlan(
            commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "eventloop-blog"])],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            planEnvelope: WorkspaceRestorePlanEnvelope(plan: plan, executeSupported: false)
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )

        await viewModel.prepareWorkspaceRestore(snapshot: snapshot)

        XCTAssertEqual(viewModel.workspaceRestoreState, .planned(plan))
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [snapshot])
    }

    func testSelectedWorkspaceRestoreRequiresPacketSnapshot() async {
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()

        XCTAssertNil(viewModel.selectedWorkspaceSnapshot)
        XCTAssertFalse(viewModel.canRestoreSelectedWorkspace)

        await viewModel.confirmSelectedWorkspaceRestore()

        XCTAssertEqual(viewModel.workspaceRestoreState, .failed("Selected packet has no workspace snapshot"))
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys, [])
    }

    func testSelectedWorkspaceRestorePlanningSkipsMissingSnapshot() async {
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()

        await viewModel.prepareSelectedWorkspaceRestore()

        XCTAssertEqual(viewModel.workspaceRestoreState, .idle)
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [])
    }

    func testSelectedWorkspaceRestorePlanningUsesPacketSnapshot() async {
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )
        let plan = WorkspaceRestorePlan(
            commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "eventloop-blog"])],
            skipped: []
        )
        let packet = ReviewPacket(
            id: "packet-with-workspace",
            title: "Review with workspace",
            summary: "Needs workspace restore",
            source: "slack://thread/blog-feedback",
            priority: 90,
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0),
            workspaceSnapshot: snapshot
        )
        let workspaceClient = FakeWorkspaceClient(
            planEnvelope: WorkspaceRestorePlanEnvelope(plan: plan, executeSupported: false)
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: [packet]),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()

        await viewModel.prepareSelectedWorkspaceRestore()

        XCTAssertEqual(viewModel.workspaceRestoreState, .planned(plan))
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [snapshot])
    }

    func testSelectedWorkspaceRestoreExecutesPacketSnapshot() async {
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )
        let packet = ReviewPacket(
            id: "packet-with-workspace",
            title: "Review with workspace",
            summary: "Needs workspace restore",
            source: "slack://thread/blog-feedback",
            priority: 90,
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0),
            workspaceSnapshot: snapshot
        )
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: [packet]),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()

        XCTAssertEqual(viewModel.selectedWorkspaceSnapshot, snapshot)
        XCTAssertTrue(viewModel.canRestoreSelectedWorkspace)

        await viewModel.confirmSelectedWorkspaceRestore()

        guard case .executed = viewModel.workspaceRestoreState else {
            XCTFail("expected executed workspace restore state")
            return
        }
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
    }

    func testConfirmWorkspaceRestoreExecutesWithIdempotencyKey() async {
        let receipt = WorkspaceRestoreReceipt(
            commands: [WorkspaceExecutedCommand(command: "aerospace", args: ["workspace", "eventloop-blog"], stdout: "ok")],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            restoreEnvelope: WorkspaceRestoreExecutionEnvelope(
                ok: true,
                plan: WorkspaceRestorePlan(commands: [], skipped: []),
                receipt: receipt,
                executeSupported: true,
                idempotencyKey: "idem_fake"
            )
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )

        await viewModel.confirmWorkspaceRestore(snapshot: snapshot)

        guard case let .executed(observedReceipt) = viewModel.workspaceRestoreState else {
            XCTFail("expected executed workspace restore state")
            return
        }
        XCTAssertEqual(observedReceipt, receipt)
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
        XCTAssertTrue(workspaceClient.restoreIdempotencyKeys[0].hasPrefix("mac_workspace_restore_"))
    }

    func testManualModeSkipsConfirmedWorkspaceRestore() async {
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")]
        )

        viewModel.enterManualMode()
        await viewModel.confirmWorkspaceRestore(snapshot: snapshot)

        XCTAssertEqual(viewModel.workspaceRestoreState, .skippedManualMode)
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys, [])
    }
}
