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

    func testLoadQueueLeasesSelectedPacketBeforeRenewal() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)

        await viewModel.loadQueue()
        await viewModel.renewSelectedLease()

        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.renewedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
    }

    func testRefreshKeepsExistingLeasedSelection() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)

        await viewModel.loadQueue()
        await viewModel.loadQueue()

        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.renewedPacketIds, ["packet-blog-feedback"])
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
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback", "packet-ci-failed"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testExecuteRecommendedActionCompletesSelectedPacketAndAdvances() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()

        await viewModel.executeRecommendedActionAndNext()

        XCTAssertEqual(client.executedRecommendedActions, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testRecommendedActionAvailabilityFollowsSelectedPacket() async {
        let actionablePacket = ReviewPacket(
            id: "packet-route",
            title: "Route feedback",
            summary: "Human approved agent handoff.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let nonActionablePacket = ReviewPacket(
            id: "packet-done",
            title: "Ignore feedback",
            summary: "No agent handoff.",
            source: "manual://review",
            priority: 10,
            recommendedAction: "Ignore for now",
            recommendedActionType: "mark_done",
            createdAt: Date(timeIntervalSince1970: 1)
        )
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: [actionablePacket, nonActionablePacket]))

        await viewModel.loadQueue()

        XCTAssertTrue(viewModel.canExecuteSelectedRecommendedAction)
        viewModel.select(packetId: "packet-done")
        XCTAssertFalse(viewModel.canExecuteSelectedRecommendedAction)
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

    func testAutomaticQueueRefreshFindsNewPackets() async {
        let client = FakeQueueClient(packets: [])
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()

        viewModel.startAutomaticQueueRefresh(intervalNanoseconds: 1_000_000, maxRefreshes: 10)
        client.replacePackets([SeededQueue.packets[0]])

        for _ in 0..<50 where viewModel.packets.isEmpty {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        viewModel.stopAutomaticQueueRefresh()

        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-blog-feedback"])
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

    func testReturningToEventLoopModePlansSelectedWorkspaceRestore() async {
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
        viewModel.enterManualMode()

        await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
        XCTAssertEqual(viewModel.workspaceRestoreState, .planned(plan))
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [snapshot])
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

    func testPrepareContextRestorePlansSelectedResource() async {
        let resource = ReviewContextResource(
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            source: "chrome-extension",
            restoreConfidence: "high"
        )
        let plan = ContextRestorePlan(
            kind: "browser_extension_message",
            sideEffect: "local",
            executeSupported: false,
            target: "eventloopOS browser extension runtime",
            message: ContextRestoreMessage(type: "eventloop.restore", resource: resource),
            url: nil,
            path: nil,
            line: nil,
            column: nil
        )
        let client = FakeQueueClient(contextRestorePlanResult: .success(plan))
        let viewModel = QueueViewModel(client: client)

        await viewModel.prepareContextRestore(resource: resource)

        XCTAssertEqual(client.contextRestorePlanResources, [resource])
        XCTAssertEqual(viewModel.contextRestoreState, .planned(resource, plan))
    }

    func testRequestContextRestoreQueuesSelectedResourceForBrowserExtension() async {
        let resource = ReviewContextResource(
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            source: "chrome-extension",
            restoreConfidence: "high"
        )
        let plan = ContextRestorePlan(
            kind: "browser_extension_message",
            sideEffect: "local",
            executeSupported: false,
            target: "eventloopOS browser extension runtime",
            message: ContextRestoreMessage(type: "eventloop.restore", resource: resource),
            url: nil,
            path: nil,
            line: nil,
            column: nil
        )
        let restoreRequest = ContextRestoreRequest(
            id: "ctx_restore_123",
            status: "pending",
            resource: resource,
            restorePlan: plan
        )
        let client = FakeQueueClient(contextRestoreRequestResult: .success(restoreRequest))
        let viewModel = QueueViewModel(client: client)

        await viewModel.requestContextRestore(resource: resource)

        XCTAssertEqual(client.requestedContextRestoreResources, [resource])
        XCTAssertEqual(client.requestedContextRestoreIdempotencyKeys.count, 1)
        XCTAssertTrue(client.requestedContextRestoreIdempotencyKeys[0].hasPrefix("mac_context_restore_ctx_browser_123_"))
        XCTAssertEqual(viewModel.contextRestoreState, .requested(resource, restoreRequest))
    }

    func testRefreshContextRestoreRequestUpdatesRequestedState() async {
        let resource = ReviewContextResource(
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            source: "chrome-extension",
            restoreConfidence: "high"
        )
        let plan = ContextRestorePlan(
            kind: "browser_extension_message",
            sideEffect: "local",
            executeSupported: false,
            target: "eventloopOS browser extension runtime",
            message: ContextRestoreMessage(type: "eventloop.restore", resource: resource),
            url: nil,
            path: nil,
            line: nil,
            column: nil
        )
        let pendingRequest = ContextRestoreRequest(
            id: "ctx_restore_123",
            status: "pending",
            resource: resource,
            restorePlan: plan
        )
        let doneRequest = ContextRestoreRequest(
            id: "ctx_restore_123",
            status: "done",
            resource: resource,
            restorePlan: plan,
            result: ContextRestoreResult(
                ok: true,
                tabId: 7,
                url: "https://example.test/launch",
                restoredScroll: true
            )
        )
        let client = FakeQueueClient(
            contextRestoreRequestResult: .success(pendingRequest),
            contextRestoreStatusResult: .success(doneRequest)
        )
        let viewModel = QueueViewModel(client: client)

        await viewModel.requestContextRestore(resource: resource)
        await viewModel.refreshContextRestoreRequest()

        XCTAssertEqual(client.checkedContextRestoreIds, ["ctx_restore_123"])
        XCTAssertEqual(viewModel.contextRestoreState, .requested(resource, doneRequest))
    }

    func testAutomaticContextRestoreRefreshPollsUntilDone() async {
        let resource = ReviewContextResource(
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            source: "chrome-extension",
            restoreConfidence: "high"
        )
        let plan = ContextRestorePlan(
            kind: "browser_extension_message",
            sideEffect: "local",
            executeSupported: false,
            target: "eventloopOS browser extension runtime",
            message: ContextRestoreMessage(type: "eventloop.restore", resource: resource),
            url: nil,
            path: nil,
            line: nil,
            column: nil
        )
        let pendingRequest = ContextRestoreRequest(
            id: "ctx_restore_123",
            status: "pending",
            resource: resource,
            restorePlan: plan
        )
        let leasedRequest = ContextRestoreRequest(
            id: "ctx_restore_123",
            status: "leased",
            resource: resource,
            restorePlan: plan
        )
        let doneRequest = ContextRestoreRequest(
            id: "ctx_restore_123",
            status: "done",
            resource: resource,
            restorePlan: plan,
            result: ContextRestoreResult(
                ok: true,
                tabId: 7,
                url: "https://example.test/launch",
                restoredScroll: true
            )
        )
        let client = FakeQueueClient(
            contextRestoreRequestResult: .success(pendingRequest),
            contextRestoreStatusResults: [.success(leasedRequest), .success(doneRequest)]
        )
        let viewModel = QueueViewModel(client: client)

        await viewModel.requestContextRestore(resource: resource)
        viewModel.startAutomaticContextRestoreRefresh(intervalNanoseconds: 1_000_000, maxRefreshes: 2)

        for _ in 0..<200 where client.checkedContextRestoreIds.count < 2 {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        viewModel.stopAutomaticContextRestoreRefresh()

        XCTAssertEqual(client.checkedContextRestoreIds, ["ctx_restore_123", "ctx_restore_123"])
        XCTAssertEqual(viewModel.contextRestoreState, .requested(resource, doneRequest))
    }

    func testPrepareContextRestoreSurfacesFailure() async {
        let resource = ReviewContextResource(
            id: "ctx_unsupported",
            kind: "opaque",
            title: "Unsupported",
            url: nil,
            source: "test",
            restoreConfidence: nil
        )
        let client = FakeQueueClient(contextRestorePlanResult: .failure(QueueClientError.httpStatus(422)))
        let viewModel = QueueViewModel(client: client)

        await viewModel.prepareContextRestore(resource: resource)

        XCTAssertEqual(client.contextRestorePlanResources, [resource])
        XCTAssertEqual(viewModel.contextRestoreState, .failed(resource, "Queue request failed with HTTP 422"))
    }

    func testRequestContextRestoreSurfacesFailure() async {
        let resource = ReviewContextResource(
            id: "ctx_unsupported",
            kind: "opaque",
            title: "Unsupported",
            url: nil,
            source: "test",
            restoreConfidence: nil
        )
        let client = FakeQueueClient(contextRestoreRequestResult: .failure(QueueClientError.httpStatus(422)))
        let viewModel = QueueViewModel(client: client)

        await viewModel.requestContextRestore(resource: resource)

        XCTAssertEqual(client.requestedContextRestoreResources, [resource])
        XCTAssertEqual(viewModel.contextRestoreState, .failed(resource, "Queue request failed with HTTP 422"))
    }
}
