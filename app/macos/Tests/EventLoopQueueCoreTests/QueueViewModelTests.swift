import XCTest
@testable import EventLoopQueueCore

@MainActor
final class QueueViewModelTests: XCTestCase {
    func testLoadQueueShowsStackWithoutActivePaper() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)

        await viewModel.loadQueue()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.count, 3)
        XCTAssertNil(viewModel.selectedPacketID)
        XCTAssertNil(viewModel.selectedPacket)
        XCTAssertEqual(client.leasedPacketIds, [])
    }

    func testPullNextPaperLeasesSelectedPacketBeforeRenewal() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)

        await viewModel.pullNextPaper()
        await viewModel.renewSelectedLease()

        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.renewedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
    }

    func testPullNextPaperLeasesTopPacketAndPlansWorkspace() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let plan = WorkspaceRestorePlan(
            commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "eventloop-blog"])],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            planEnvelope: WorkspaceRestorePlanEnvelope(plan: plan, executeSupported: false)
        )
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)

        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.taskBindingState, .loaded)
        XCTAssertEqual(viewModel.selectedTaskSessions.map(\.id), ["task_session_blog"])
        XCTAssertEqual(viewModel.workspaceRestoreState, .planned(plan))
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [SeededQueue.blogFeedbackWorkspace])
    }

    func testFirstPullFromEventLoopCapturesManualWorkspaceBaselineOnce() async {
        let baselineSnapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 77, app: "Ghostty", title: "normal shell", workspace: "normal")],
            activeWorkspace: "normal"
        )
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: baselineSnapshot)
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )

        await viewModel.pullNextPaper()
        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.manualWorkspaceSnapshot, baselineSnapshot)
        XCTAssertEqual(viewModel.manualWorkspaceCaptureState, .captured(baselineSnapshot))
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
    }

    func testPullNextPaperReturnsFromManualModeAndCapturesManualWorkspace() async {
        let manualSnapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 77, app: "Ghostty", title: "manual shell", workspace: "manual")],
            activeWorkspace: "manual"
        )
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: manualSnapshot)
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )
        viewModel.enterManualMode()

        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
        XCTAssertEqual(viewModel.manualWorkspaceSnapshot, manualSnapshot)
        XCTAssertEqual(viewModel.manualWorkspaceCaptureState, .captured(manualSnapshot))
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [SeededQueue.blogFeedbackWorkspace])
    }

    func testRefreshKeepsExistingLeasedSelection() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)

        await viewModel.pullNextPaper()
        await viewModel.refreshQueue()

        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.renewedPacketIds, [])
    }

    func testSelectIgnoresUnknownPacket() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        viewModel.select(packetId: "packet-ci-failed")
        viewModel.select(packetId: "missing")

        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testSelectionChangeClearsTaskBindingStatus() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()
        await viewModel.loadTaskSessions()

        XCTAssertEqual(viewModel.taskBindingState, .loaded)

        viewModel.select(packetId: "packet-ci-failed")

        XCTAssertEqual(viewModel.taskBindingState, .idle)
    }

    func testSelectionChangeClearsContextRestoreStatus() async {
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
        let client = FakeQueueClient(packets: SeededQueue.packets, contextRestoreRequestResult: .success(restoreRequest))
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        await viewModel.requestContextRestore(resource: resource)

        XCTAssertEqual(viewModel.contextRestoreState, .requested(resource, restoreRequest))

        viewModel.select(packetId: "packet-ci-failed")

        XCTAssertEqual(viewModel.contextRestoreState, .idle)
    }

    func testLoadLineageForSelectedPacketUsesSelectedQueueItem() async {
        let lineage = makeLineage(queueItemId: "packet-blog-feedback")
        let client = FakeQueueClient(
            packets: SeededQueue.packets,
            queueLineageResult: .success(lineage)
        )
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")

        await viewModel.loadLineageForSelectedPacket(limit: 10)

        XCTAssertEqual(client.requestedQueueLineagePacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.queueLineageState, .loaded("packet-blog-feedback", lineage))
    }

    func testPrepareSelectedPacketDetailPlansWorkspaceAndLoadsLineage() async {
        let lineage = makeLineage(queueItemId: "packet-blog-feedback")
        let client = FakeQueueClient(
            packets: SeededQueue.packets,
            queueLineageResult: .success(lineage)
        )
        let plan = WorkspaceRestorePlan(
            commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "eventloop-blog"])],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            planEnvelope: WorkspaceRestorePlanEnvelope(plan: plan, executeSupported: false)
        )
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")

        await viewModel.prepareSelectedPacketDetail()

        XCTAssertEqual(viewModel.workspaceRestoreState, .planned(plan))
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [SeededQueue.blogFeedbackWorkspace])
        XCTAssertEqual(client.requestedQueueLineagePacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.queueLineageState, .loaded("packet-blog-feedback", lineage))
    }

    func testSelectionChangeClearsLineageState() async {
        let lineage = makeLineage(queueItemId: "packet-blog-feedback")
        let client = FakeQueueClient(
            packets: SeededQueue.packets,
            queueLineageResult: .success(lineage)
        )
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")
        await viewModel.loadLineageForSelectedPacket()

        viewModel.select(packetId: "packet-ci-failed")

        XCTAssertEqual(viewModel.queueLineageState, .idle)
    }

    func testLoadLineageFailureKeepsPacketIdForRetry() async {
        let client = FakeQueueClient(
            packets: SeededQueue.packets,
            queueLineageResult: .failure(QueueClientError.httpStatus(422))
        )
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")

        await viewModel.loadLineageForSelectedPacket()

        XCTAssertEqual(
            viewModel.queueLineageState,
            .failed("packet-blog-feedback", "Queue request failed with HTTP 422")
        )
    }

    func testDoneAndNextCompletesSelectedPacketAndAdvances() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        await viewModel.doneAndNext()

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback", "packet-ci-failed"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testDeferSelectedPacketAdvances() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        let dueAt = Date(timeIntervalSince1970: 1_778_074_500)
        await viewModel.pullNextPaper()

        await viewModel.deferSelectedPacket(until: dueAt)

        XCTAssertEqual(client.deferredPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.deferredPacketDueAts["packet-blog-feedback"], dueAt)
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback", "packet-ci-failed"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testIgnoreSelectedPacketAdvances() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        await viewModel.ignoreSelectedPacket()

        XCTAssertEqual(client.ignoredPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback", "packet-ci-failed"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testMoveToNextLeasesNextWithoutCompletingCurrentPacket() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        await viewModel.moveToNext()

        XCTAssertEqual(client.completedPacketIds, [])
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback", "packet-ci-failed"])
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-blog-feedback", "packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testMoveToNextKeepsSelectionWhenNoNextPacketIsAvailable() async {
        let client = FakeQueueClient(packets: [SeededQueue.packets[0]])
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        await viewModel.moveToNext()

        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
    }

    func testExecuteRecommendedActionCompletesSelectedPacketAndAdvances() async {
        let packet = ReviewPacket(
            id: "packet-route",
            taskId: "task_blog_feedback",
            title: "Route feedback",
            summary: "Human approved agent handoff.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(packets: [packet])
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        await viewModel.executeRecommendedActionAndNext()

        XCTAssertEqual(client.executedRecommendedActions, ["packet-route"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets, [])
        XCTAssertNil(viewModel.selectedPacketID)
    }

    func testRecommendedActionAvailabilityFollowsSelectedPacket() async {
        let actionablePacket = ReviewPacket(
            id: "packet-route",
            taskId: "task_blog_feedback",
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

        XCTAssertFalse(viewModel.canExecuteSelectedRecommendedAction)
        XCTAssertNil(viewModel.selectedRecommendedActionBlockReason)
        viewModel.select(packetId: "packet-route")
        XCTAssertFalse(viewModel.canExecuteSelectedRecommendedAction)
        XCTAssertEqual(
            viewModel.selectedRecommendedActionBlockReason,
            "Bind a task session to task_blog_feedback before resuming agent"
        )
        await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        XCTAssertTrue(viewModel.canExecuteSelectedRecommendedAction)
        viewModel.select(packetId: "packet-done")
        XCTAssertFalse(viewModel.canExecuteSelectedRecommendedAction)
    }

    func testExecuteRecommendedActionRequiresBoundTaskSession() async {
        let packet = ReviewPacket(
            id: "packet-route",
            taskId: "task_blog_feedback",
            title: "Route feedback",
            summary: "Human approved agent handoff.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(packets: [packet], taskSessions: [])
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        await viewModel.executeRecommendedActionAndNext()

        XCTAssertEqual(client.executedRecommendedActions, [])
        XCTAssertEqual(
            viewModel.taskBindingState,
            .failed("Bind a task session to task_blog_feedback before resuming agent")
        )
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-route"])
    }

    func testLoadTaskSessionsFindsSelectedTaskSessions() async {
        let packet = ReviewPacket(
            id: "packet-route",
            taskId: "task_blog_feedback",
            title: "Route feedback",
            summary: "Human approved agent handoff.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(
                packets: [packet],
                taskSessions: [
                    TaskSession(id: "task_session_blog", taskId: "task_blog_feedback", provider: "fake", status: "idle"),
                    TaskSession(id: "task_session_other", taskId: "task_other", provider: "fake", status: "idle")
                ]
            )
        )
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-route")

        await viewModel.loadTaskSessions()

        XCTAssertEqual(viewModel.taskBindingState, .loaded)
        XCTAssertEqual(viewModel.taskSessions.count, 2)
        XCTAssertEqual(viewModel.selectedTaskSessions.map(\.id), ["task_session_blog"])
    }

    func testLoadTaskSessionsForSelectedPacketIfNeededAutoLoadsTaskSessions() async {
        let packet = ReviewPacket(
            id: "packet-route",
            taskId: "task_blog_feedback",
            title: "Route feedback",
            summary: "Human approved agent handoff.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(
                packets: [packet],
                taskSessions: [
                    TaskSession(id: "task_session_blog", taskId: "task_blog_feedback", provider: "fake", status: "idle")
                ]
            )
        )
        await viewModel.pullNextPaper()

        await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()

        XCTAssertEqual(viewModel.taskBindingState, .loaded)
        XCTAssertEqual(viewModel.selectedTaskSessions.map(\.id), ["task_session_blog"])
    }

    func testLoadTaskSessionsForSelectedPacketIfNeededSkipsPacketsWithoutTaskId() async {
        let packet = ReviewPacket(
            id: "packet-route",
            title: "Route feedback",
            summary: "Human approved agent handoff.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: [packet]))
        await viewModel.loadQueue()

        await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()

        XCTAssertEqual(viewModel.taskBindingState, .idle)
        XCTAssertEqual(viewModel.taskSessions, [])
    }

    func testBindSelectedPacketToTaskSessionUsesSelectedTaskId() async {
        let packet = ReviewPacket(
            id: "packet-route",
            taskId: "task_blog_feedback",
            title: "Route feedback",
            summary: "Human approved agent handoff.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(
            packets: [packet],
            taskSessions: [
                TaskSession(id: "task_session_unbound", provider: "fake", status: "idle", name: "Unbound thread")
            ]
        )
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-route")

        await viewModel.bindSelectedPacket(toTaskSessionId: "task_session_unbound")

        XCTAssertEqual(client.boundTaskSessions.map(\.taskSessionId), ["task_session_unbound"])
        XCTAssertEqual(client.boundTaskSessions.map(\.taskId), ["task_blog_feedback"])
        XCTAssertEqual(viewModel.taskSessions.first?.taskId, "task_blog_feedback")
        XCTAssertEqual(
            viewModel.taskBindingState,
            .bound(TaskBinding(
                ok: true,
                taskSessionId: "task_session_unbound",
                taskId: "task_blog_feedback",
                session: TaskSession(
                    id: "task_session_unbound",
                    taskId: "task_blog_feedback",
                    provider: "fake",
                    status: "idle",
                    name: "Unbound thread"
                )
            ))
        )
    }

    func testRenewSelectedLeaseKeepsSelectionLoaded() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.pullNextPaper()

        await viewModel.renewSelectedLease()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.packets.count, 3)
    }

    func testAutomaticLeaseRenewalKeepsSelectedPacketLeased() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

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
        XCTAssertNil(viewModel.selectedPacketID)
        XCTAssertEqual(client.leasedPacketIds, [])
    }

    func testManualModePausesWorkspaceRestoreWithoutClearingQueue() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        viewModel.enterManualMode()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertNil(viewModel.selectedPacketID)
        XCTAssertEqual(viewModel.packets.count, 3)

        viewModel.returnToEventLoopMode()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
    }

    func testToggleEnteringManualModeDoesNotCaptureUntilReturn() async {
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog"),
                WorkspaceWindow(id: 10, app: "Google Chrome", title: "Launch doc", workspace: "eventloop-blog")
            ],
            activeWorkspace: "eventloop-blog"
        )
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: snapshot)
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )

        await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.workspaceRestoreState, .skippedManualMode)
        XCTAssertNil(viewModel.manualWorkspaceSnapshot)
        XCTAssertEqual(viewModel.manualWorkspaceCaptureState, .idle)
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 0)

        await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
        XCTAssertEqual(viewModel.manualWorkspaceSnapshot, snapshot)
        XCTAssertEqual(viewModel.manualWorkspaceCaptureState, .captured(snapshot))
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
    }

    func testToggleIntoManualModeRestoresSavedManualWorkspace() async {
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 9, app: "Ghostty", title: "normal shell", workspace: "normal"),
                WorkspaceWindow(id: 10, app: "Google Chrome", title: "Inbox", workspace: "normal")
            ],
            activeWorkspace: "normal"
        )
        let receipt = WorkspaceRestoreReceipt(
            commands: [
                WorkspaceExecutedCommand(command: "aerospace", args: ["workspace", "normal"], stdout: "ok")
            ],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: snapshot,
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

        await viewModel.pullNextPaper()
        await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.workspaceRestoreState, .executed(receipt))
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [snapshot])
    }

    func testRestoreManualWorkspaceUsesSavedSnapshotAndKeepsManualMode() async {
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "manual-workspace")
            ],
            activeWorkspace: "manual-workspace"
        )
        let receipt = WorkspaceRestoreReceipt(
            commands: [
                WorkspaceExecutedCommand(command: "aerospace", args: ["workspace", "manual-workspace"], stdout: "ok")
            ],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: snapshot,
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

        viewModel.enterManualMode()
        await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()
        await viewModel.confirmManualWorkspaceRestore()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.workspaceRestoreState, .executed(receipt))
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [snapshot])
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
        XCTAssertTrue(workspaceClient.restoreIdempotencyKeys[0].hasPrefix("mac_manual_workspace_restore_"))
    }

    func testRestoreManualWorkspaceRequiresSavedSnapshot() async {
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )

        await viewModel.confirmManualWorkspaceRestore()

        XCTAssertEqual(viewModel.workspaceRestoreState, .failed("No manual workspace snapshot saved"))
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [])
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
        viewModel.select(packetId: "packet-with-workspace")
        viewModel.enterManualMode()

        await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
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
        let packet = ReviewPacket(
            id: "packet-no-workspace",
            title: "Review without workspace",
            summary: "Needs review without restore",
            source: "slack://thread/blog-feedback",
            priority: 90,
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: [packet]),
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
        let packet = ReviewPacket(
            id: "packet-no-workspace",
            title: "Review without workspace",
            summary: "Needs review without restore",
            source: "slack://thread/blog-feedback",
            priority: 90,
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: [packet]),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-with-workspace")

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
        viewModel.select(packetId: "packet-with-workspace")

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
        viewModel.select(packetId: "packet-with-workspace")

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

    private func makeLineage(queueItemId: String) -> QueueLineage {
        QueueLineage(
            queueItem: QueueLineageQueueItem(id: queueItemId, state: "ready", taskId: "task_blog_feedback", priorityScore: 90),
            relatedEventIds: ["evt_review_1"],
            events: [
                QueueLineageEvent(
                    id: "evt_review_1",
                    source: "slack",
                    sourceId: "slack:launch",
                    type: "slack_message",
                    title: "Launch feedback",
                    summary: "Blog needs launch detail.",
                    occurredAt: Date(timeIntervalSince1970: 1_767_096_000)
                )
            ],
            activity: [
                QueueLineageActivity(
                    id: "actv_1",
                    type: "task_followup_sent",
                    occurredAt: Date(timeIntervalSince1970: 1_767_096_300),
                    status: "ok",
                    summary: "Task followup sent",
                    eventId: "evt_review_1",
                    taskSessionId: "task_session_blog"
                )
            ],
            taskMessages: [
                QueueLineageTaskMessage(
                    id: "task_msg_1",
                    durableId: "task_msg_durable_1",
                    taskSessionId: "task_session_blog",
                    origin: "queue_action",
                    status: "sent",
                    eventIds: ["evt_review_1"],
                    textHash: "abc",
                    textLength: 42
                )
            ],
            counts: QueueLineageCounts(events: 1, activity: 1, taskMessages: 1)
        )
    }
}
