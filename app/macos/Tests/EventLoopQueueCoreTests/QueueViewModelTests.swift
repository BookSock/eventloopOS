import XCTest
@testable import EventLoopQueueCore

@MainActor
final class QueueViewModelTests: XCTestCase {
    func testLoadQueueSelectsFirstPaperWithoutLeasing() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)

        await viewModel.loadQueue()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.count, 3)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.selectedPacket?.id, "packet-blog-feedback")
        XCTAssertEqual(client.leasedPacketIds, [])
    }

    func testHotkeyBackedActionsShowFeedbackWithoutSelectedPaper() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.selectedPacketID = nil

        await viewModel.doneAndNext()
        let firstFeedbackSequence = viewModel.feedbackSequence
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("No paper selected."))

        await viewModel.deferSelectedPacketForOneHour(now: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("No paper selected."))
        XCTAssertGreaterThan(viewModel.feedbackSequence, firstFeedbackSequence)

        await viewModel.executeRecommendedActionAndNext()
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("No paper selected."))

        await viewModel.moveToNext()
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("No paper selected."))

        XCTAssertEqual(client.completedPacketIds, [])
        XCTAssertEqual(client.deferredPacketIds, [])
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

    func testPullNextPaperTreatsLeaseNextConflictAsNonFatalWithExistingSelection() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")
        client.setNextLeaseError(QueueClientError.httpStatus(409))
        let beforeFeedbackSequence = viewModel.feedbackSequence

        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Queue paused. Try again."))
        XCTAssertGreaterThan(viewModel.feedbackSequence, beforeFeedbackSequence)
    }

    func testPullNextPaperShowsManualModeFeedbackForManualModeLeaseConflict() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")
        client.setNextLeaseError(QueueClientError.httpStatusMessage(
            409,
            "manual_mode_active: queue is paused while manual mode is active"
        ))

        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Manual Mode active. Press Ctrl-Option-M to return."))
    }

    func testRepeatedAdvanceToastAssignmentsIncrementFeedbackSequence() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")

        client.setNextLeaseError(QueueClientError.httpStatus(409))
        await viewModel.pullNextPaper()
        let firstFeedbackSequence = viewModel.feedbackSequence
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Queue paused. Try again."))

        client.setNextLeaseError(QueueClientError.httpStatus(409))
        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Queue paused. Try again."))
        XCTAssertGreaterThan(viewModel.feedbackSequence, firstFeedbackSequence)
    }

    func testPullNextPaperTreatsLeaseNextConflictAsNonFatalWithoutSelection() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()
        viewModel.selectedPacketID = nil
        client.setNextLeaseError(QueueClientError.httpStatus(409))

        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Queue paused. Try again."))
    }

    func testRenewSelectedLeaseIgnoresLeaseConflict() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-blog-feedback")

        await viewModel.renewSelectedLease()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
    }

    func testRapidDoneNextDeduplicatesWhileInFlight() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        client.setQueueActionDelayNanoseconds(200_000_000)
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: SeededQueue.blogFeedbackWorkspace,
            captureDelayNanoseconds: 100_000_000
        )
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)

        await viewModel.pullNextPaper()
        let captureCountBeforeDone = workspaceClient.workspaceCaptureCount

        let firstDone = Task { @MainActor in
            await viewModel.doneAndNext()
        }
        try? await Task.sleep(nanoseconds: 10_000_000)

        let secondDone = Task { @MainActor in
            await viewModel.doneAndNext()
        }

        await firstDone.value
        await secondDone.value

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, captureCountBeforeDone + 1)
        XCTAssertEqual(viewModel.state, .loaded)
    }

    func testRapidDoneNextShowsSpecificInFlightFeedback() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        client.setQueueActionDelayNanoseconds(200_000_000)
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: SeededQueue.blogFeedbackWorkspace,
            captureDelayNanoseconds: 100_000_000
        )
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)

        await viewModel.pullNextPaper()

        let firstDone = Task { @MainActor in
            await viewModel.doneAndNext()
        }
        try? await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Completing paper..."))
        let firstFeedbackSequence = viewModel.feedbackSequence

        let secondDone = Task { @MainActor in
            await viewModel.doneAndNext()
        }
        await secondDone.value

        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Completing paper... Still running."))
        XCTAssertGreaterThan(viewModel.feedbackSequence, firstFeedbackSequence)
        XCTAssertEqual(client.completedPacketIds, [])

        await firstDone.value

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Done. Next paper ready."))
    }

    func testRapidMoveToNextDeduplicatesWhileInFlight() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: SeededQueue.blogFeedbackWorkspace,
            captureDelayNanoseconds: 100_000_000
        )
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)

        await viewModel.pullNextPaper()
        let captureCountBeforeSkip = workspaceClient.workspaceCaptureCount

        let firstSkip = Task { @MainActor in
            await viewModel.moveToNext()
        }
        try? await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(viewModel.paperActionInFlight, true)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Skipping paper..."))
        let firstFeedbackSequence = viewModel.feedbackSequence

        let secondSkip = Task { @MainActor in
            await viewModel.moveToNext()
        }
        await secondSkip.value

        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Skipping paper... Still running."))
        XCTAssertGreaterThan(viewModel.feedbackSequence, firstFeedbackSequence)
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback"])

        await firstSkip.value

        XCTAssertEqual(client.completedPacketIds, [])
        XCTAssertEqual(client.leasedPacketIds, ["packet-blog-feedback", "packet-ci-failed"])
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, captureCountBeforeSkip + 1)
        XCTAssertEqual(viewModel.paperActionInFlight, false)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
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

    func testPullNextPaperShowsEmptyQueueToast() async {
        let client = FakeQueueClient(packets: [])
        let viewModel = QueueViewModel(client: client)

        await viewModel.pullNextPaper()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets, [])
        XCTAssertNil(viewModel.selectedPacketID)
        XCTAssertEqual(viewModel.advanceToast, .queueEmpty)
    }

    func testPullNextPaperRequestsBrowserContextRestore() async {
        let browserContext = ReviewContextResource(
            id: "browser_tab_77",
            kind: "browser_tab",
            title: "Blog draft",
            url: "https://example.test/blog-draft",
            source: "chrome-extension",
            restoreConfidence: "high",
            windowId: "4",
            tabId: "77"
        )
        let packet = ReviewPacket(
            id: "packet-blog",
            taskId: "task_blog",
            title: "Blog paper",
            summary: "Review blog.",
            source: "manual://blog",
            priority: 90,
            contextResources: [browserContext],
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(packets: [packet])
        let viewModel = QueueViewModel(client: client, workspaceClient: FakeWorkspaceClient())

        await viewModel.pullNextPaper()
        await viewModel.pullNextPaper()

        XCTAssertEqual(client.requestedContextRestoreResources, [browserContext])
        XCTAssertEqual(client.requestedContextRestoreIdempotencyKeys.count, 1)
        XCTAssertTrue(client.requestedContextRestoreIdempotencyKeys[0].hasPrefix("mac_auto_context_restore_browser_tab_77_"))
    }

    func testSelectedPaperDetailRequestsBrowserContextRestore() async {
        let browserContext = ReviewContextResource(
            id: "browser_tab_88",
            kind: "browser_tab",
            title: "Launch notes",
            url: "https://example.test/launch-notes",
            source: "chrome-extension",
            restoreConfidence: "high",
            windowId: "5",
            tabId: "88"
        )
        let packet = ReviewPacket(
            id: "packet-launch",
            taskId: "task_launch",
            title: "Launch paper",
            summary: "Review launch notes.",
            source: "manual://launch",
            priority: 90,
            contextResources: [browserContext],
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(packets: [packet])
        let viewModel = QueueViewModel(client: client, workspaceClient: FakeWorkspaceClient())

        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-launch")
        await viewModel.prepareSelectedPacketDetail()
        await viewModel.prepareSelectedPacketDetail()

        XCTAssertEqual(client.requestedContextRestoreResources, [browserContext])
        XCTAssertEqual(client.requestedContextRestoreIdempotencyKeys.count, 1)
        XCTAssertTrue(client.requestedContextRestoreIdempotencyKeys[0].hasPrefix("mac_auto_context_restore_browser_tab_88_"))
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
        await viewModel.enterManualMode()

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

    func testSwitchToPaperSavesCurrentWorkspaceAndRestoresNextPaper() async {
        let currentSnapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 51, app: "Ghostty", title: "Blog agent", workspace: "eventloop-blog")
            ],
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 51
        )
        let nextSnapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 61, app: "Google Chrome", title: "Inbox", workspace: "eventloop-email")
            ],
            activeWorkspace: "eventloop-email",
            focusedWindowId: 61
        )
        let packets = [
            ReviewPacket(
                id: "packet-blog",
                taskId: "task_blog",
                title: "Blog paper",
                summary: "Review blog.",
                source: "manual://blog",
                priority: 90,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 0),
                workspaceSnapshot: currentSnapshot
            ),
            ReviewPacket(
                id: "packet-email",
                taskId: "task_email",
                title: "Email paper",
                summary: "Review email.",
                source: "manual://email",
                priority: 80,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 1),
                workspaceSnapshot: nextSnapshot
            ),
        ]
        let client = FakeQueueClient(packets: packets)
        client.setFakeTasks([
            TaskRecord(
                taskId: "task_blog",
                primaryAnchorKind: .codexThread,
                primaryAnchorId: "thr_blog",
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            ),
            TaskRecord(
                taskId: "task_email",
                primaryAnchorKind: .codexThread,
                primaryAnchorId: "thr_email",
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            ),
        ])
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: currentSnapshot)
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)
        await viewModel.pullNextPaper()

        await viewModel.switchToPaper(packetId: "packet-email")

        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.count, 1)
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.taskId, "task_blog")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.sourceQueueItemId, "packet-blog")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.workspaceSnapshot, currentSnapshot)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-email")
        XCTAssertEqual(client.setCurrentTaskRequests, ["task_email"])
        XCTAssertEqual(viewModel.currentTask?.taskId, "task_email")
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [currentSnapshot, nextSnapshot])
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
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Done. Next paper ready."))
    }

    func testDoneAndNextTreatsNextLeaseConflictAsSavedActionFeedback() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()
        client.setNextLeaseError(QueueClientError.httpStatus(409))

        await viewModel.doneAndNext()

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Action saved. Queue paused; no next paper claimed."))
    }

    func testDoneAndNextShowsManualModeFeedbackForManualModeLeaseConflict() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()
        client.setNextLeaseError(QueueClientError.httpStatusMessage(
            409,
            "manual_mode_active: queue is paused while manual mode is active"
        ))

        await viewModel.doneAndNext()

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Action saved. Manual Mode active; no next paper claimed."))
    }

    func testDeferSelectedPacketShowsSuccessToastWhenNextPaperExists() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        let dueAt = Date(timeIntervalSince1970: 1_778_074_500)
        await viewModel.pullNextPaper()

        await viewModel.deferSelectedPacket(until: dueAt)

        XCTAssertEqual(client.deferredPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
        XCTAssertEqual(viewModel.advanceToast, .deferredUntil(dueAt))
    }

    func testDeferSelectedPacketTreatsNextLeaseConflictAsSavedActionFeedback() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        let dueAt = Date(timeIntervalSince1970: 1_778_074_500)
        await viewModel.pullNextPaper()
        client.setNextLeaseError(QueueClientError.httpStatus(409))

        await viewModel.deferSelectedPacket(until: dueAt)

        XCTAssertEqual(client.deferredPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Action saved. Queue paused; no next paper claimed."))
    }

    func testDeferSelectedPacketShowsEmptyQueueToastWhenNoNextPaper() async {
        let client = FakeQueueClient(packets: [SeededQueue.packets[0]])
        let viewModel = QueueViewModel(client: client)
        let dueAt = Date(timeIntervalSince1970: 1_778_074_500)
        await viewModel.pullNextPaper()

        await viewModel.deferSelectedPacket(until: dueAt)

        XCTAssertEqual(client.deferredPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets, [])
        XCTAssertNil(viewModel.selectedPacketID)
        XCTAssertEqual(viewModel.advanceToast, .deferredUntil(dueAt))
    }

    func testDoneAndNextRestoresNextTaskWorkspace() async {
        let firstSnapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 91, app: "Ghostty", title: "codex blog", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 91
        )
        let secondSnapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 101, app: "Google Chrome", title: "customer reply", workspace: "eventloop-email")],
            activeWorkspace: "eventloop-email",
            focusedWindowId: 101
        )
        let packets = [
            ReviewPacket(
                id: "packet-blog",
                taskId: "task_blog",
                title: "Blog paper",
                summary: "Review blog.",
                source: "manual://blog",
                priority: 90,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 0),
                workspaceSnapshot: firstSnapshot
            ),
            ReviewPacket(
                id: "packet-email",
                taskId: "task_email",
                title: "Email paper",
                summary: "Review email.",
                source: "manual://email",
                priority: 80,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 1),
                workspaceSnapshot: secondSnapshot
            ),
        ]
        let plan = WorkspaceRestorePlan(
            commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "eventloop-email"])],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: firstSnapshot,
            planEnvelope: WorkspaceRestorePlanEnvelope(plan: plan, executeSupported: false)
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: packets),
            workspaceClient: workspaceClient
        )

        await viewModel.pullNextPaper()
        await viewModel.doneAndNext()

        XCTAssertEqual(viewModel.selectedPacketID, "packet-email")
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [firstSnapshot, secondSnapshot])
        XCTAssertEqual(viewModel.workspaceRestoreState, .planned(plan))
    }

    func testDoneAndNextSavesCurrentTaskWorkspaceSnapshot() async {
        let taskSnapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 91, app: "Ghostty", title: "codex blog work", workspace: "eventloop-blog"),
                WorkspaceWindow(id: 92, app: "Google Chrome", title: "Blog draft", workspace: "eventloop-blog")
            ],
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 91
        )
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: taskSnapshot)
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)
        await viewModel.pullNextPaper()

        await viewModel.doneAndNext()

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(client.completedPacketWorkspaceSnapshots, [taskSnapshot])
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 2)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testSaveSelectedTaskLayoutCapturesCurrentDeskForPacketTask() async {
        let captured = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 71, app: "Ghostty", title: "Blog agent", workspace: "eventloop-blog"),
                WorkspaceWindow(id: 72, app: "Google Chrome", title: "Blog draft", workspace: "eventloop-blog")
            ],
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 71
        )
        let packet = ReviewPacket(
            id: "packet-blog",
            reviewPacketId: "review-blog",
            taskId: "task_blog",
            title: "Blog",
            summary: "Review blog",
            decisionNeeded: "Review",
            source: "test",
            priority: 700,
            riskLevel: "low",
            confidence: "high",
            riskTags: [],
            contextResources: [],
            recommendedAction: "Done",
            recommendedActionType: "mark_done",
            createdAt: Date(timeIntervalSince1970: 1_778_070_000)
        )
        let client = FakeQueueClient(packets: [packet])
        client.setFakeTasks([
            TaskRecord(
                taskId: "task_blog",
                primaryAnchorKind: .ghosttyWindow,
                primaryAnchorId: "71",
                createdAt: Date(timeIntervalSince1970: 1_778_070_000),
                updatedAt: Date(timeIntervalSince1970: 1_778_070_000)
            )
        ])
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: FakeWorkspaceClient(captureSnapshot: captured),
            initialPackets: [packet]
        )

        await viewModel.saveSelectedTaskLayout()

        XCTAssertEqual(client.updateTaskLayoutRequests.count, 1)
        XCTAssertEqual(client.updateTaskLayoutRequests.first?.taskId, "task_blog")
        XCTAssertEqual(client.updateTaskLayoutRequests.first?.layout, captured)
        XCTAssertEqual(viewModel.workspaceRestoreState, WorkspaceRestoreState.savedTaskLayout("task_blog"))
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

    func testMoveToNextRestoresNextTaskWorkspace() async {
        let firstSnapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 91, app: "Ghostty", title: "codex blog", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )
        let secondSnapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 101, app: "Google Chrome", title: "email", workspace: "eventloop-email")],
            activeWorkspace: "eventloop-email"
        )
        let packets = [
            ReviewPacket(
                id: "packet-blog",
                taskId: "task_blog",
                title: "Blog paper",
                summary: "Review blog.",
                source: "manual://blog",
                priority: 90,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 0),
                workspaceSnapshot: firstSnapshot
            ),
            ReviewPacket(
                id: "packet-email",
                taskId: "task_email",
                title: "Email paper",
                summary: "Review email.",
                source: "manual://email",
                priority: 80,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 1),
                workspaceSnapshot: secondSnapshot
            ),
        ]
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: packets),
            workspaceClient: workspaceClient
        )
        await viewModel.pullNextPaper()

        await viewModel.moveToNext()

        XCTAssertEqual(viewModel.selectedPacketID, "packet-email")
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [firstSnapshot, secondSnapshot])
    }

    func testMoveToNextSavesCurrentTaskWorkspaceSnapshotBeforeSwitching() async {
        let currentSnapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 51, app: "Ghostty", title: "Blog agent", workspace: "eventloop-blog")
            ],
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 51
        )
        let nextSnapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 61, app: "Google Chrome", title: "Inbox", workspace: "eventloop-email")
            ],
            activeWorkspace: "eventloop-email",
            focusedWindowId: 61
        )
        let packets = [
            ReviewPacket(
                id: "packet-blog",
                taskId: "task_blog",
                title: "Blog paper",
                summary: "Review blog.",
                source: "manual://blog",
                priority: 90,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 0),
                workspaceSnapshot: currentSnapshot
            ),
            ReviewPacket(
                id: "packet-email",
                taskId: "task_email",
                title: "Email paper",
                summary: "Review email.",
                source: "manual://email",
                priority: 80,
                recommendedAction: "Review",
                createdAt: Date(timeIntervalSince1970: 1),
                workspaceSnapshot: nextSnapshot
            ),
        ]
        let client = FakeQueueClient(packets: packets)
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: currentSnapshot)
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)
        await viewModel.pullNextPaper()

        await viewModel.moveToNext()

        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.count, 1)
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.taskId, "task_blog")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.sourceQueueItemId, "packet-blog")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.workspaceSnapshot, currentSnapshot)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-email")
    }

    func testMoveToNextKeepsSelectionWhenNoNextPacketIsAvailable() async {
        let client = FakeQueueClient(packets: [SeededQueue.packets[0]])
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        await viewModel.moveToNext()

        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("No other paper ready."))
    }

    func testMoveToNextTreatsLeaseConflictAsNonFatal() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()
        client.setNextLeaseError(QueueClientError.httpStatus(409))

        await viewModel.moveToNext()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Queue paused. Try again."))
    }

    func testMoveToNextShowsManualModeFeedbackForManualModeLeaseConflict() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()
        client.setNextLeaseError(QueueClientError.httpStatusMessage(
            409,
            "manual_mode_active: queue is paused while manual mode is active"
        ))

        await viewModel.moveToNext()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Manual Mode active. Press Ctrl-Option-M to return."))
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
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Sent to agent. Next paper ready."))
    }

    func testExecuteRecommendedActionTreatsNextLeaseConflictAsNonFatal() async {
        let routePacket = ReviewPacket(
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
        let followupPacket = ReviewPacket(
            id: "packet-followup",
            title: "Review followup",
            summary: "Next queued paper.",
            source: "manual://review",
            priority: 80,
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(packets: [routePacket, followupPacket])
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()
        client.setNextLeaseError(QueueClientError.httpStatus(409))

        await viewModel.executeRecommendedActionAndNext()

        XCTAssertEqual(client.executedRecommendedActions, ["packet-route"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-followup"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-followup")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Action saved. Queue paused; no next paper claimed."))
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
        viewModel.selectedPacketID = nil

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
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 401, app: "Ghostty", title: "Codex blog thread", workspace: "eventloop-blog")
            ],
            activeWorkspace: "eventloop-blog",
            focusedWindowId: 401
        )
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
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: snapshot)
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)
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
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.count, 1)
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.taskId, "task_blog_feedback")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.sourceQueueItemId, "packet-route")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.workspaceSnapshot, snapshot)
    }

    func testSendMasterCommandUsesSelectedTaskAsDefaultHint() async {
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

        await viewModel.sendMasterCommand(text: "Launch blog is now highest priority")

        XCTAssertEqual(client.sentMasterCommands.count, 1)
        XCTAssertEqual(client.sentMasterCommands.first?.text, "Launch blog is now highest priority")
        XCTAssertEqual(client.sentMasterCommands.first?.taskHint, "task_blog_feedback")
        guard case let .routed(result) = viewModel.masterCommandState else {
            return XCTFail("expected routed state")
        }
        XCTAssertEqual(result.targetTaskId, "task_blog_feedback")
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Master command routed to task_blog_feedback."))
    }

    func testSendMasterCommandSelectsQueuedPaperWhenHumanReviewCreated() async {
        let queuedPacket = ReviewPacket(
            id: "packet-master-note",
            taskId: "task_master_note",
            title: "Review master note",
            summary: "Master command needs human review.",
            source: "master",
            priority: 760,
            recommendedAction: "Work this paper, then Done / Next",
            recommendedActionType: "mark_done",
            createdAt: Date(timeIntervalSince1970: 1_778_070_000)
        )
        let client = FakeQueueClient(
            packets: [],
            masterCommandResult: MasterCommandResult(
                ok: true,
                requestId: "req_master_queued",
                eventId: "evt_master_queued",
                routeAction: "create_queue_item",
                targetTaskId: "task_master_note",
                queuedPacket: queuedPacket
            )
        )
        let viewModel = QueueViewModel(client: client)

        await viewModel.sendMasterCommand(text: "Start a paper for this note")

        XCTAssertEqual(viewModel.selectedPacketID, "packet-master-note")
        XCTAssertEqual(viewModel.selectedPacket?.title, "Review master note")
        guard case let .routed(result) = viewModel.masterCommandState else {
            return XCTFail("expected routed state")
        }
        XCTAssertEqual(result.queuedPacket, queuedPacket)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Master command queued: Review master note"))
    }

    func testMasterCommandFailureToastShowsServerMessageWithoutHTTPPrefix() async {
        let client = FakeQueueClient(
            packets: [],
            masterCommandError: QueueClientError.httpStatusMessage(
                409,
                "idempotency_conflict: duplicate idempotency key"
            )
        )
        let viewModel = QueueViewModel(client: client)

        await viewModel.sendMasterCommand(text: "Route launch note", taskHint: "task_launch")

        XCTAssertEqual(client.sentMasterCommands.count, 0)
        XCTAssertEqual(
            viewModel.masterCommandState,
            .failed("Queue request failed with HTTP 409: idempotency_conflict: duplicate idempotency key")
        )
        XCTAssertEqual(
            viewModel.advanceToast,
            .actionComplete("Master command failed: Request already handled or still running. Wait a second, then try again.")
        )
    }

    func testRapidMasterCommandDeduplicatesWhileSending() async {
        let client = FakeQueueClient(packets: [])
        client.setMasterActionDelayNanoseconds(200_000_000)
        let viewModel = QueueViewModel(client: client)

        let first = Task {
            await viewModel.sendMasterCommand(text: "Route launch note", taskHint: "task_launch")
        }
        try? await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(viewModel.masterCommandState, .sending)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Routing master command..."))

        await viewModel.sendMasterCommand(text: "Route launch note again", taskHint: "task_launch")

        XCTAssertEqual(client.sentMasterCommands.count, 0)
        XCTAssertEqual(viewModel.masterCommandState, .sending)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Master command still running."))

        await first.value

        XCTAssertEqual(client.sentMasterCommands.count, 1)
        XCTAssertEqual(client.sentMasterCommands.first?.text, "Route launch note")
        guard case let .routed(result) = viewModel.masterCommandState else {
            return XCTFail("expected routed state")
        }
        XCTAssertEqual(result.targetTaskId, "task_launch")
    }

    func testStartMasterTaskCreatesTaskSessionAndRefreshesSessions() async {
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 301, app: "Google Chrome", title: "Launch email", workspace: "eventloop-launch")
            ],
            activeWorkspace: "eventloop-launch",
            focusedWindowId: 301
        )
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "session_blog", provider: "fake", status: "idle"),
                TaskSession(id: "session_email", provider: "fake", status: "idle")
            ]
        )
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: snapshot)
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)

        await viewModel.startMasterTask(
            text: "Draft email to launch partners",
            taskHint: "Launch Partners",
            cwd: "/repo",
            model: "gpt-5.3-codex"
        )

        XCTAssertEqual(client.startedMasterTasks.count, 1)
        XCTAssertEqual(client.startedMasterTasks.first?.text, "Draft email to launch partners")
        XCTAssertEqual(client.startedMasterTasks.first?.taskHint, "Launch Partners")
        XCTAssertEqual(client.startedMasterTasks.first?.cwd, "/repo")
        XCTAssertEqual(client.startedMasterTasks.first?.model, "gpt-5.3-codex")
        guard case let .started(started) = viewModel.masterCommandState else {
            return XCTFail("expected started state")
        }
        XCTAssertEqual(started.taskId, "task_launch_partners")
        XCTAssertEqual(viewModel.taskSessions.last?.taskId, "task_launch_partners")
        XCTAssertEqual(client.startedMasterTasks.first?.workspaceSnapshot, snapshot)
        XCTAssertEqual(viewModel.selectedPacket?.taskId, "task_launch_partners")
        XCTAssertEqual(viewModel.selectedPacket?.workspaceSnapshot, snapshot)
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [snapshot])
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Started task task_launch_partners."))
    }

    func testBumpQueuePaperPriorityCallsClientAndRefreshes() async {
        let packet = ReviewPacket(
            id: "qit_blog",
            taskId: "task_blog",
            title: "Blog feedback",
            summary: "Need decision",
            source: "slack",
            priority: 500,
            recommendedAction: "Send back",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(packets: [packet])
        let viewModel = QueueViewModel(client: client)
        await viewModel.refreshQueue()

        await viewModel.bumpQueuePaperPriority(packetId: "qit_blog", delta: 250, reason: "user_priority_bump")

        XCTAssertEqual(viewModel.masterCommandState, .idle)
        XCTAssertEqual(viewModel.selectedPacket?.priority, 750)
        XCTAssertTrue(viewModel.selectedPacket?.priorityReasons.contains("user_priority_bump") ?? false)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Priority updated."))
    }

    func testPromoteReadingQueueAddsQueuePapers() async {
        let client = FakeQueueClient(packets: [])
        client.setReadingQueueContexts([
            ReadingQueueContext(
                id: "browser_tab:1",
                title: "Agents reshape OS",
                url: "https://example.test/agents",
                capturedAt: Date(timeIntervalSince1970: 0),
                eventId: "evt_capture_1",
                source: "browser"
            )
        ])
        let viewModel = QueueViewModel(client: client)
        await viewModel.refreshQueue()

        await viewModel.promoteReadingQueue()

        XCTAssertEqual(viewModel.masterCommandState, .idle)
        XCTAssertTrue(viewModel.packets.contains(where: { $0.taskId == "task_reading_queue" }))
        XCTAssertEqual(viewModel.selectedPacket?.taskId, "task_reading_queue")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Promoted 1 reading papers."))
    }

    func testBindSelectedTerminalRefForwardsToClient() async {
        let packet = ReviewPacket(
            id: "qit_blog",
            taskId: "task_blog",
            title: "Blog feedback",
            summary: "Need decision",
            source: "slack",
            priority: 500,
            recommendedAction: "Send back",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(
            packets: [packet],
            taskSessions: [
                TaskSession(id: "codex_thread_blog", taskId: "task_blog", provider: "codex", status: "idle")
            ]
        )
        let viewModel = QueueViewModel(client: client)
        await viewModel.refreshQueue()
        viewModel.selectedPacketID = "qit_blog"
        await viewModel.loadTaskSessions()

        await viewModel.bindSelectedTerminalRef("ghostty:front")

        let session = viewModel.taskSessions.first(where: { $0.id == "codex_thread_blog" })
        XCTAssertEqual(session?.terminalRef, "ghostty:front")
        if case let .bound(binding) = viewModel.taskBindingState {
            XCTAssertEqual(binding.taskSessionId, "codex_thread_blog")
        } else {
            XCTFail("expected bound state")
        }
    }

    func testRefreshActivityPopulatesEvents() async {
        let client = FakeQueueClient(packets: [])
        client.setFakeActivity([
            ActivityEvent(
                id: "act_1",
                type: "master_fan_out",
                occurredAt: Date(timeIntervalSince1970: 0),
                actor: "human",
                summary: "Master fan-out: 3 delivered"
            ),
            ActivityEvent(
                id: "act_2",
                type: "terminal_keystroke_attempted",
                occurredAt: Date(timeIntervalSince1970: 100),
                actor: "system",
                taskId: "task_blog",
                taskSessionId: "session_blog",
                summary: "Sent 1 keystroke command(s) to ghostty:front."
            ),
        ])
        let viewModel = QueueViewModel(client: client)

        await viewModel.refreshActivity()

        XCTAssertEqual(viewModel.activityEvents.count, 2)
        XCTAssertEqual(viewModel.activityEvents.first?.type, "master_fan_out")
        XCTAssertEqual(viewModel.activityEvents[1].taskId, "task_blog")
    }

    func testFollowsRulesRefreshAddAndDelete() async {
        let client = FakeQueueClient(packets: [])
        client.setFakeFollowsWindowExclusions([
            FollowsWindowExclusion(
                exclusionId: "fwex_existing",
                appBundle: "com.tinyspeck.slackmacgap",
                titleSubstring: nil
            )
        ])
        let viewModel = QueueViewModel(client: client)

        await viewModel.refreshFollowsRules()

        XCTAssertEqual(viewModel.followsRulesState, .loaded)
        XCTAssertEqual(viewModel.followsWindowExclusions.map(\.exclusionId), ["fwex_existing"])

        await viewModel.addFollowsRule(appBundle: "  ", titleSubstring: " Playwright ")

        XCTAssertEqual(viewModel.followsRulesState, .loaded)
        XCTAssertEqual(viewModel.followsWindowExclusions.count, 2)
        XCTAssertEqual(viewModel.followsWindowExclusions.last?.titleSubstring, "Playwright")
        XCTAssertNil(viewModel.followsWindowExclusions.last?.appBundle)

        await viewModel.deleteFollowsRule(id: "fwex_existing")

        XCTAssertEqual(viewModel.followsRulesState, .loaded)
        XCTAssertEqual(viewModel.followsWindowExclusions.map(\.exclusionId), ["fwex_fake_2"])
    }

    func testFollowsRulesSuggestsActiveDesktopWindowsWorthExcluding() async {
        let client = FakeQueueClient(packets: [])
        client.setFakeFollowsWindowExclusions([
            FollowsWindowExclusion(
                exclusionId: "fwex_notes",
                appBundle: "com.apple.TextEdit",
                titleSubstring: nil
            ),
            FollowsWindowExclusion(
                exclusionId: "fwex_report",
                appBundle: nil,
                titleSubstring: "Already ignored"
            ),
        ])
        client.setFakeFollowsWindows([
            FollowsWindowRecord(
                windowId: "sticky-slack",
                knownWorkspaces: ["eventloop-customer", "eventloop-ops"],
                appBundle: "com.tinyspeck.slackmacgap",
                titlePrefix: "team-eng | slack",
                slotWindowIds: ["sticky-slack-old", "sticky-slack"]
            ),
            FollowsWindowRecord(
                windowId: "sticky-notes",
                knownWorkspaces: ["eventloop-customer", "eventloop-ops"],
                appBundle: "com.apple.TextEdit",
                titlePrefix: "Customer notes"
            ),
        ])
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(
                    id: 201,
                    app: "Google Chrome",
                    title: "Playwright Report",
                    workspace: "eventloop-customer",
                    appBundleId: "com.google.Chrome"
                ),
                WorkspaceWindow(
                    id: 202,
                    app: "Slack",
                    title: "team-eng | slack",
                    workspace: "eventloop-customer",
                    appBundleId: "com.tinyspeck.slackmacgap"
                ),
                WorkspaceWindow(
                    id: 203,
                    app: "TextEdit",
                    title: "Customer notes",
                    workspace: "eventloop-customer",
                    appBundleId: "com.apple.TextEdit"
                ),
                WorkspaceWindow(
                    id: 204,
                    app: "Tailscale",
                    title: "Tailscale",
                    workspace: "eventloop-customer",
                    appBundleId: "io.tailscale.ipn.macos"
                ),
                WorkspaceWindow(
                    id: 205,
                    app: "Safari",
                    title: "Other workspace",
                    workspace: "manual",
                    appBundleId: "com.apple.Safari"
                ),
                WorkspaceWindow(
                    id: 206,
                    app: "Numbers",
                    title: "Already ignored budget",
                    workspace: "eventloop-customer",
                    appBundleId: "com.apple.iWork.Numbers"
                ),
            ],
            activeWorkspace: "eventloop-customer"
        )
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: snapshot)
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)

        await viewModel.refreshFollowsRules()

        XCTAssertEqual(viewModel.followsRulesState, .loaded)
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
        XCTAssertEqual(viewModel.followsWindowSuggestions.count, 2)
        XCTAssertEqual(viewModel.followsWindowSuggestions.first?.appName, "team-eng | slack")
        XCTAssertEqual(viewModel.followsWindowSuggestions.first?.appBundle, "com.tinyspeck.slackmacgap")
        XCTAssertEqual(viewModel.followsWindowSuggestions.first?.title, "team-eng | slack")
        XCTAssertEqual(viewModel.followsWindowSuggestions.first?.workspace, "eventloop-customer, eventloop-ops")
        XCTAssertEqual(viewModel.followsWindowSuggestions.first?.isCurrentFollowsCandidate, true)
        XCTAssertEqual(viewModel.followsWindowSuggestions.last?.appName, "Google Chrome")
        XCTAssertEqual(viewModel.followsWindowSuggestions.last?.appBundle, "com.google.Chrome")
        XCTAssertEqual(viewModel.followsWindowSuggestions.last?.title, "Playwright Report")
        XCTAssertEqual(viewModel.followsWindowSuggestions.last?.workspace, "eventloop-customer")
        XCTAssertEqual(viewModel.followsWindowSuggestions.last?.isCurrentFollowsCandidate, false)
    }

    func testAddFollowsRuleRequiresMatcher() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: []))

        await viewModel.addFollowsRule(appBundle: " ", titleSubstring: "")

        XCTAssertEqual(viewModel.followsRulesState, .failed("App bundle or title substring is required"))
        XCTAssertEqual(viewModel.followsWindowExclusions, [])
    }

    func testFirstTerminalSendShowsConfirmModalAndDoesNotExecute() async {
        let suiteName = "eventLoopOSTerminalSendTest_\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let packet = ReviewPacket(
            id: "qit_term",
            taskId: "task_term",
            title: "Term test",
            summary: "send",
            source: "test",
            priority: 500,
            recommendedAction: "Send to Agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(
            packets: [packet],
            taskSessions: [
                TaskSession(id: "session_term", taskId: "task_term", provider: "codex", status: "idle", terminalRef: "ghostty:front")
            ]
        )
        let viewModel = QueueViewModel(client: client, userDefaults: defaults)
        await viewModel.refreshQueue()
        viewModel.selectedPacketID = "qit_term"
        await viewModel.loadTaskSessions()

        await viewModel.executeRecommendedActionAndNext()

        XCTAssertNotNil(viewModel.pendingTerminalSendConfirmation)
        XCTAssertEqual(viewModel.pendingTerminalSendConfirmation?.terminalRef, "ghostty:front")
        XCTAssertEqual(client.executedRecommendedActions.count, 0, "should not execute until confirmed")

        await viewModel.confirmPendingTerminalSendAndProceed()
        XCTAssertNil(viewModel.pendingTerminalSendConfirmation)
        XCTAssertTrue(viewModel.isTerminalSendConfirmed(forRef: "ghostty:front"))

        defaults.removePersistentDomain(forName: suiteName)
    }

    func testThisSessionScopeOnlyAppliesUntilRestart() async {
        let suiteName = "eventLoopOSTerminalSendTest_\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let packet = ReviewPacket(
            id: "qit_term_session",
            taskId: "task_term_session",
            title: "Session scope",
            summary: "send",
            source: "test",
            priority: 500,
            recommendedAction: "Send",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(
            packets: [packet],
            taskSessions: [
                TaskSession(id: "session_term_session", taskId: "task_term_session", provider: "codex", status: "idle", terminalRef: "ghostty:front")
            ]
        )
        let viewModel = QueueViewModel(client: client, userDefaults: defaults)
        await viewModel.refreshQueue()
        viewModel.selectedPacketID = "qit_term_session"
        await viewModel.loadTaskSessions()

        await viewModel.executeRecommendedActionAndNext()
        XCTAssertNotNil(viewModel.pendingTerminalSendConfirmation)
        await viewModel.confirmPendingTerminalSendAndProceed(scope: .thisSession)

        XCTAssertTrue(viewModel.isTerminalSendConfirmed(forRef: "ghostty:front"))
        XCTAssertFalse(viewModel.rememberedTerminalRefs.contains("ghostty:front"))
        // Persistence flag stays off — scope did not write to defaults.
        XCTAssertFalse(defaults.bool(forKey: "eventLoopOS.terminalSendConfirmed.v1"))

        defaults.removePersistentDomain(forName: suiteName)
    }

    func testRememberForRefPersistsTerminalRefAcrossInstances() async {
        let suiteName = "eventLoopOSTerminalSendTest_\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let packet = ReviewPacket(
            id: "qit_term_remember",
            taskId: "task_term_remember",
            title: "Remember scope",
            summary: "send",
            source: "test",
            priority: 500,
            recommendedAction: "Send",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(
            packets: [packet],
            taskSessions: [
                TaskSession(id: "session_term_remember", taskId: "task_term_remember", provider: "codex", status: "idle", terminalRef: "ghostty:front")
            ]
        )
        let viewModel = QueueViewModel(client: client, userDefaults: defaults)
        await viewModel.refreshQueue()
        viewModel.selectedPacketID = "qit_term_remember"
        await viewModel.loadTaskSessions()

        await viewModel.executeRecommendedActionAndNext()
        await viewModel.confirmPendingTerminalSendAndProceed(scope: .rememberForRef)

        // Build a fresh viewmodel that shares the same UserDefaults — should treat
        // the terminal_ref as already confirmed.
        let viewModel2 = QueueViewModel(client: FakeQueueClient(packets: []), userDefaults: defaults)
        XCTAssertTrue(viewModel2.rememberedTerminalRefs.contains("ghostty:front"))
        XCTAssertTrue(viewModel2.isTerminalSendConfirmed(forRef: "ghostty:front"))

        defaults.removePersistentDomain(forName: suiteName)
    }

    func testTerminalSendDoesNotPromptAfterConfirmedFlag() async {
        let suiteName = "eventLoopOSTerminalSendTest_\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.set(true, forKey: "eventLoopOS.terminalSendConfirmed.v1")

        let packet = ReviewPacket(
            id: "qit_term2",
            taskId: "task_term2",
            title: "Term test 2",
            summary: "send",
            source: "test",
            priority: 500,
            recommendedAction: "Send to Agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(
            packets: [packet],
            taskSessions: [
                TaskSession(id: "session_term2", taskId: "task_term2", provider: "codex", status: "idle", terminalRef: "ghostty:front")
            ]
        )
        let viewModel = QueueViewModel(client: client, userDefaults: defaults)
        await viewModel.refreshQueue()
        viewModel.selectedPacketID = "qit_term2"
        await viewModel.loadTaskSessions()

        await viewModel.executeRecommendedActionAndNext()

        XCTAssertNil(viewModel.pendingTerminalSendConfirmation)
        XCTAssertEqual(client.executedRecommendedActions, ["qit_term2"])

        defaults.removePersistentDomain(forName: suiteName)
    }

    func testReadingQueueCountRefreshesOnQueueRefresh() async {
        let client = FakeQueueClient(packets: [])
        client.setReadingQueueContexts([
            ReadingQueueContext(
                id: "browser_tab:1",
                title: "Tab one",
                url: "https://example.test/one",
                capturedAt: Date(timeIntervalSince1970: 0),
                eventId: "evt_a",
                source: "browser"
            ),
            ReadingQueueContext(
                id: "browser_tab:2",
                title: "Tab two",
                url: "https://example.test/two",
                capturedAt: Date(timeIntervalSince1970: 0),
                eventId: "evt_b",
                source: "browser"
            ),
        ])
        let viewModel = QueueViewModel(client: client)
        await viewModel.refreshQueue()
        XCTAssertEqual(viewModel.readingQueueUnboundCount, 2)
    }

    func testChangeBadgeReportsNewWhenPacketUnseen() async {
        let packet = ReviewPacket(
            id: "qit_a",
            taskId: "task_a",
            title: "Unread",
            summary: "Never seen",
            source: "test",
            priority: 500,
            recommendedAction: "Action",
            recommendedActionType: "mark_done",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let selectedPacket = ReviewPacket(
            id: "qit_selected",
            taskId: "task_selected",
            title: "Selected",
            summary: "Already viewed",
            source: "test",
            priority: 600,
            recommendedAction: "Action",
            recommendedActionType: "mark_done",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: [selectedPacket, packet]))
        await viewModel.refreshQueue()

        XCTAssertEqual(viewModel.changeBadge(for: packet), .new)
    }

    func testChangeBadgeReportsPriorityChangeAfterBump() async {
        let packet = ReviewPacket(
            id: "qit_b",
            taskId: "task_b",
            title: "Bumpable",
            summary: "Will be bumped",
            source: "test",
            priority: 500,
            recommendedAction: "Mark done",
            recommendedActionType: "mark_done",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let client = FakeQueueClient(packets: [packet])
        let viewModel = QueueViewModel(client: client)
        await viewModel.refreshQueue()
        viewModel.selectedPacketID = "qit_b"
        XCTAssertEqual(viewModel.changeBadge(for: viewModel.selectedPacket!), .none)

        await viewModel.bumpQueuePaperPriority(packetId: "qit_b", delta: 200, reason: "test_priority_bump")
        let updated = viewModel.packets.first { $0.id == "qit_b" }!
        if case let .priorityIncreased(by) = viewModel.changeBadge(for: updated) {
            XCTAssertEqual(by, 200)
        } else {
            XCTFail("expected priorityIncreased badge after bump")
        }
    }

    func testPreviewFanOutReturnsMatchedTasksWithoutSending() async {
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "session_blog_email", taskId: "task_blog_email_draft", provider: "fake", status: "idle"),
                TaskSession(id: "session_blog_outreach", taskId: "task_blog_partner_email", provider: "fake", status: "idle"),
                TaskSession(id: "session_recruiting", taskId: "task_recruiting_review", provider: "fake", status: "idle"),
            ]
        )
        let viewModel = QueueViewModel(client: client)

        let result = await viewModel.previewFanOut(
            message: "use new sign off",
            taskHintSubstring: "blog",
            taskIdPattern: nil,
            idempotencyKey: "preview_blog_v1"
        )

        XCTAssertNotNil(result)
        XCTAssertEqual(result?.dryRun, true)
        XCTAssertEqual(result?.matchedCount, 2)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Fan-out preview: 2 matches."))
        XCTAssertEqual(client.sentMasterCommands.count, 0, "preview should not send any followups")
    }

    func testExecuteFanOutDeliversFollowupsToBoundSessions() async {
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "session_a", taskId: "task_blog_email", provider: "fake", status: "idle"),
                TaskSession(id: "session_b", taskId: "task_blog_outreach", provider: "fake", status: "idle"),
                TaskSession(id: "session_c", taskId: "task_pricing", provider: "fake", status: "idle"),
            ]
        )
        let viewModel = QueueViewModel(client: client)

        let result = await viewModel.executeFanOut(
            message: "Pause all blog work for 1h",
            taskHintSubstring: "blog",
            taskIdPattern: nil,
            idempotencyKey: "exec_blog_pause_v1"
        )

        XCTAssertEqual(result?.deliveredCount, 2)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Fan-out delivered to 2 sessions."))
        XCTAssertEqual(client.sentMasterCommands.count, 2)
        XCTAssertTrue(client.sentMasterCommands.allSatisfy { $0.text.contains("Pause all blog work") })
    }

    func testRapidExecuteFanOutDeduplicatesWhileSending() async {
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "session_a", taskId: "task_blog_email", provider: "fake", status: "idle"),
                TaskSession(id: "session_b", taskId: "task_blog_outreach", provider: "fake", status: "idle"),
            ]
        )
        client.setMasterActionDelayNanoseconds(200_000_000)
        let viewModel = QueueViewModel(client: client)

        let first = Task {
            await viewModel.executeFanOut(
                message: "Pause all blog work",
                taskHintSubstring: "blog",
                taskIdPattern: nil,
                idempotencyKey: "exec_blog_pause_v1"
            )
        }
        try? await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(viewModel.masterCommandState, .sending)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Broadcasting fan-out..."))

        let duplicate = await viewModel.executeFanOut(
            message: "Pause all blog work again",
            taskHintSubstring: "blog",
            taskIdPattern: nil,
            idempotencyKey: "exec_blog_pause_v2"
        )

        XCTAssertNil(duplicate)
        XCTAssertEqual(client.sentMasterCommands.count, 0)
        XCTAssertEqual(viewModel.masterCommandState, .sending)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Master command still running."))

        let result = await first.value

        XCTAssertEqual(result?.deliveredCount, 2)
        XCTAssertEqual(client.sentMasterCommands.count, 2)
        XCTAssertTrue(client.sentMasterCommands.allSatisfy { $0.text == "Pause all blog work" })
    }

    func testVoiceCaptureUnavailableWhenNoServiceInjected() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: []))
        XCTAssertEqual(viewModel.voiceCaptureState, .unavailable)
        let result = await viewModel.startVoiceCapture()
        XCTAssertNil(result)
        XCTAssertEqual(viewModel.voiceCaptureState, .unavailable)
    }

    func testVoiceCaptureCallsServiceAndReturnsTranscript() async {
        actor StubService: VoiceTranscriptionService {
            func transcribeOneUtterance() async throws -> String {
                "raise priority of seed blog"
            }
        }
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: []),
            voiceTranscriptionService: StubService()
        )
        XCTAssertEqual(viewModel.voiceCaptureState, .idle)
        let transcript = await viewModel.startVoiceCapture()
        XCTAssertEqual(transcript, "raise priority of seed blog")
        if case let .captured(value) = viewModel.voiceCaptureState {
            XCTAssertEqual(value, "raise priority of seed blog")
        } else {
            XCTFail("expected captured state")
        }
    }

    func testVoiceCaptureSurfacesFailureMessage() async {
        struct FailingService: VoiceTranscriptionService {
            func transcribeOneUtterance() async throws -> String {
                throw NSError(domain: "voice", code: 1, userInfo: [NSLocalizedDescriptionKey: "no microphone"])
            }
        }
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: []),
            voiceTranscriptionService: FailingService()
        )
        let transcript = await viewModel.startVoiceCapture()
        XCTAssertNil(transcript)
        if case let .failed(message) = viewModel.voiceCaptureState {
            XCTAssertEqual(message, "no microphone")
        } else {
            XCTFail("expected failed state")
        }
    }

    func testMasterCommandRejectsBlankText() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: []))

        await viewModel.sendMasterCommand(text: "   ")

        XCTAssertEqual(viewModel.masterCommandState, .failed("Master command text is required"))
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Master command text is required."))
    }

    func testAuxiliarySheetsCanBePresentedFromMenuCommands() {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: []))

        viewModel.presentMasterCommand()
        XCTAssertEqual(viewModel.auxiliarySheet, .masterCommand)

        viewModel.presentOnboarding()
        XCTAssertEqual(viewModel.auxiliarySheet, .onboarding)

        viewModel.presentFollowsRules()
        XCTAssertEqual(viewModel.auxiliarySheet, .followsRules)

        viewModel.dismissAuxiliarySheet()
        XCTAssertNil(viewModel.auxiliarySheet)
    }

    func testScanOnboardingLoadsCurrentDeskProposals() async {
        let client = FakeQueueClient(packets: [])
        let viewModel = QueueViewModel(client: client)

        await viewModel.scanOnboarding()

        guard case let .loaded(scan) = viewModel.onboardingState else {
            return XCTFail("expected loaded onboarding state")
        }
        XCTAssertEqual(scan.summary.proposalCount, 1)
        XCTAssertEqual(scan.proposals.first?.taskId, "task_blog_feedback")
        XCTAssertEqual(scan.proposals.first?.windows.count, 2)
    }

    func testApproveOnboardingProposalBindsSessionsAndRefreshes() async {
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "task_session_blog", provider: "fake", status: "idle", name: "Blog thread")
            ]
        )
        let scan = OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_070_000),
            summary: OnboardingScanSummary(
                windowCount: 1,
                groupedWindowCount: 1,
                ungroupedWindowCount: 0,
                taskSessionCount: 1,
                browserContextCount: 0,
                proposalCount: 1
            ),
            proposals: [
                OnboardingTaskProposal(
                    id: "onboard_blog",
                    taskId: "task_blog_feedback",
                    title: "Blog Feedback",
                    confidence: "high",
                    reason: "window title contains [task:...]",
                    windows: [
                        OnboardingWindow(id: 91, app: "Ghostty", title: "[task:blog feedback] codex", workspace: "eventloop-blog")
                    ],
                    taskSessions: [
                        TaskSession(id: "task_session_blog", provider: "fake", status: "idle", name: "Blog thread")
                    ],
                    suggestedNextAction: "Approve this task context."
                )
            ]
        )
        client.replaceOnboardingScan(scan)
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(client: client, workspaceClient: workspaceClient)

        await viewModel.approveOnboardingProposal(id: "onboard_blog", queuePaper: true)

        XCTAssertEqual(client.approvedOnboardingProposalIds, ["onboard_blog"])
        guard case let .approved(result) = viewModel.onboardingState else {
            return XCTFail("expected approved onboarding state")
        }
        XCTAssertEqual(result.taskId, "task_blog_feedback")
        XCTAssertEqual(result.bindings.first?.taskSessionId, "task_session_blog")
        XCTAssertEqual(result.queuedPaper?.id, "qit_onboarding_task_blog_feedback")
        XCTAssertEqual(viewModel.taskSessions.first?.taskId, "task_blog_feedback")
        XCTAssertTrue(viewModel.packets.contains { $0.id == "qit_onboarding_task_blog_feedback" })
        XCTAssertEqual(viewModel.selectedPacketID, "qit_onboarding_task_blog_feedback")
        XCTAssertEqual(viewModel.selectedPacket?.workspaceSnapshot?.activeWorkspace, "eventloop-blog")
        XCTAssertEqual(workspaceClient.restorePlanSnapshots.first?.activeWorkspace, "eventloop-blog")
    }

    func testApproveEditedOnboardingDraftSendsSelectedResources() async {
        let client = FakeQueueClient(packets: [])
        let scan = OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_070_000),
            summary: OnboardingScanSummary(
                windowCount: 2,
                groupedWindowCount: 2,
                ungroupedWindowCount: 0,
                taskSessionCount: 1,
                browserContextCount: 1,
                proposalCount: 1
            ),
            proposals: [
                OnboardingTaskProposal(
                    id: "onboard_blog",
                    taskId: "task_blog_feedback",
                    title: "Blog Feedback",
                    confidence: "medium",
                    reason: "window title",
                    windows: [
                        OnboardingWindow(id: 91, app: "Ghostty", title: "Blog agent", workspace: "eventloop-blog"),
                        OnboardingWindow(id: 92, app: "Spotify", title: "Music", workspace: "eventloop-blog")
                    ],
                    browserContexts: [
                        OnboardingBrowserContext(
                            id: "browser_tab:77",
                            title: "Blog draft",
                            url: "https://example.test/blog",
                            capturedAt: Date(timeIntervalSince1970: 1_778_070_000),
                            restoreConfidence: "high"
                        )
                    ],
                    taskSessions: [
                        TaskSession(id: "task_session_blog", provider: "fake", status: "idle", name: "Blog thread")
                    ],
                    suggestedNextAction: "Approve."
                )
            ]
        )
        client.replaceOnboardingScan(scan)
        let viewModel = QueueViewModel(client: client)
        await viewModel.scanOnboarding()

        let proposal = try! XCTUnwrap(scan.proposals.first)
        await viewModel.approveOnboardingDraft(
            proposal: proposal,
            taskId: "Launch Blog",
            windowIds: [91],
            taskSessionIds: ["task_session_blog"],
            browserContextIds: ["browser_tab:77"],
            queuePaper: true
        )

        XCTAssertEqual(client.approvedOnboardingProposalIds, ["onboard_blog"])
        XCTAssertEqual(client.boundTaskSessions.map(\.taskId), ["task_launch_blog"])
        XCTAssertEqual(viewModel.packets.map(\.taskId), ["task_launch_blog"])
        XCTAssertEqual(viewModel.selectedPacket?.workspaceSnapshot?.windows.map(\.id), [91])
        XCTAssertEqual(viewModel.selectedPacket?.contextResources.map(\.id), ["browser_tab:77"])
    }

    func testApproveAllOnboardingProposalsQueuesWorkbenchPapers() async {
        let scan = OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_070_000),
            activeWorkspace: "desk",
            focusedWindowId: 101,
            summary: OnboardingScanSummary(
                windowCount: 2,
                groupedWindowCount: 2,
                ungroupedWindowCount: 0,
                taskSessionCount: 0,
                browserContextCount: 0,
                proposalCount: 2
            ),
            proposals: [
                OnboardingTaskProposal(
                    id: "onboard_blog",
                    taskId: "task_blog",
                    title: "Blog",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 101, app: "Ghostty", title: "Blog", workspace: "blog")],
                    suggestedNextAction: "Approve this task context."
                ),
                OnboardingTaskProposal(
                    id: "onboard_email",
                    taskId: "task_email",
                    title: "Email",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 102, app: "Google Chrome", title: "Email", workspace: "email")],
                    suggestedNextAction: "Approve this task context."
                )
            ]
        )
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "session_blog", provider: "fake", status: "idle"),
                TaskSession(id: "session_email", provider: "fake", status: "idle")
            ]
        )
        client.replaceOnboardingScan(scan)
        let viewModel = QueueViewModel(client: client)
        await viewModel.scanOnboarding()

        await viewModel.approveAllOnboardingProposals(queuePaper: true)

        XCTAssertEqual(client.approvedOnboardingProposalIds, ["onboard_blog", "onboard_email"])
        XCTAssertEqual(viewModel.packets.map(\.taskId), ["task_blog", "task_email"])
        XCTAssertEqual(viewModel.selectedPacketID, "qit_onboarding_task_blog")
        XCTAssertEqual(viewModel.selectedWorkspaceSnapshot?.windows.map(\.id), [101])
    }

    func testApproveAllOnboardingProposalsTransitionsToApprovedTerminalState() async {
        let scan = OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_080_000),
            activeWorkspace: "desk",
            focusedWindowId: 201,
            summary: OnboardingScanSummary(
                windowCount: 3,
                groupedWindowCount: 3,
                ungroupedWindowCount: 0,
                taskSessionCount: 0,
                browserContextCount: 0,
                proposalCount: 3
            ),
            proposals: [
                OnboardingTaskProposal(
                    id: "onboard_a",
                    taskId: "task_a",
                    title: "A",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 201, app: "Ghostty", title: "A", workspace: "a")],
                    suggestedNextAction: "Approve."
                ),
                OnboardingTaskProposal(
                    id: "onboard_b",
                    taskId: "task_b",
                    title: "B",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 202, app: "Ghostty", title: "B", workspace: "b")],
                    suggestedNextAction: "Approve."
                ),
                OnboardingTaskProposal(
                    id: "onboard_c",
                    taskId: "task_c",
                    title: "C",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 203, app: "Ghostty", title: "C", workspace: "c")],
                    suggestedNextAction: "Approve."
                )
            ]
        )
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "session_blog", provider: "fake", status: "idle"),
                TaskSession(id: "session_email", provider: "fake", status: "idle")
            ]
        )
        client.replaceOnboardingScan(scan)
        let viewModel = QueueViewModel(client: client)
        await viewModel.scanOnboarding()

        await viewModel.approveAllOnboardingProposals(queuePaper: true)

        XCTAssertEqual(client.approvedOnboardingProposalIds, ["onboard_a", "onboard_b", "onboard_c"])
        XCTAssertEqual(viewModel.packets.count, 3)
        guard case .approved = viewModel.onboardingState else {
            XCTFail("expected onboardingState to be .approved after approve-all, got \(viewModel.onboardingState)")
            return
        }
    }

    func testApproveAllOnboardingProposalsCallsBatchEndpointOnce() async {
        let scan = OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_080_000),
            activeWorkspace: "desk",
            focusedWindowId: 301,
            summary: OnboardingScanSummary(
                windowCount: 3,
                groupedWindowCount: 3,
                ungroupedWindowCount: 0,
                taskSessionCount: 0,
                browserContextCount: 0,
                proposalCount: 3
            ),
            proposals: [
                OnboardingTaskProposal(
                    id: "onboard_a",
                    taskId: "task_a",
                    title: "A",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 301, app: "Ghostty", title: "A", workspace: "a")],
                    suggestedNextAction: "Approve."
                ),
                OnboardingTaskProposal(
                    id: "onboard_b",
                    taskId: "task_b",
                    title: "B",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 302, app: "Ghostty", title: "B", workspace: "b")],
                    suggestedNextAction: "Approve."
                ),
                OnboardingTaskProposal(
                    id: "onboard_c",
                    taskId: "task_c",
                    title: "C",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 303, app: "Ghostty", title: "C", workspace: "c")],
                    suggestedNextAction: "Approve."
                )
            ]
        )
        let client = FakeQueueClient(packets: [])
        client.replaceOnboardingScan(scan)
        let viewModel = QueueViewModel(client: client)
        await viewModel.scanOnboarding()

        await viewModel.approveAllOnboardingProposals(queuePaper: true)

        XCTAssertEqual(client.batchApprovalRequests.count, 1, "expected single batch call regardless of N proposals")
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.count, 3)
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.map(\.proposalId), ["onboard_a", "onboard_b", "onboard_c"])
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.allSatisfy(\.queuePaper), true)
    }

    func testApproveEditedOnboardingRequestsBatchesDrafts() async {
        let scan = OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_080_000),
            activeWorkspace: "desk",
            focusedWindowId: 501,
            summary: OnboardingScanSummary(
                windowCount: 2,
                groupedWindowCount: 2,
                ungroupedWindowCount: 0,
                taskSessionCount: 2,
                browserContextCount: 2,
                proposalCount: 2
            ),
            proposals: [
                OnboardingTaskProposal(
                    id: "onboard_blog",
                    taskId: "task_blog",
                    title: "Blog",
                    confidence: "medium",
                    reason: "window title",
                    windows: [
                        OnboardingWindow(id: 501, app: "Ghostty", title: "Blog", workspace: "blog"),
                        OnboardingWindow(id: 502, app: "Music", title: "Wrong", workspace: "blog")
                    ],
                    browserContexts: [
                        OnboardingBrowserContext(
                            id: "browser_tab:blog",
                            title: "Blog draft",
                            capturedAt: Date(timeIntervalSince1970: 1_778_080_000),
                            restoreConfidence: "high"
                        )
                    ],
                    taskSessions: [
                        TaskSession(id: "session_blog", provider: "fake", status: "idle")
                    ],
                    suggestedNextAction: "Approve."
                ),
                OnboardingTaskProposal(
                    id: "onboard_email",
                    taskId: "task_email",
                    title: "Email",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 601, app: "Google Chrome", title: "Email", workspace: "email")],
                    browserContexts: [
                        OnboardingBrowserContext(
                            id: "browser_tab:email",
                            title: "Email",
                            capturedAt: Date(timeIntervalSince1970: 1_778_080_000),
                            restoreConfidence: "high"
                        )
                    ],
                    taskSessions: [
                        TaskSession(id: "session_email", provider: "fake", status: "idle")
                    ],
                    suggestedNextAction: "Approve."
                )
            ]
        )
        let client = FakeQueueClient(
            packets: [],
            taskSessions: [
                TaskSession(id: "session_blog", provider: "fake", status: "idle"),
                TaskSession(id: "session_email", provider: "fake", status: "idle")
            ]
        )
        client.replaceOnboardingScan(scan)
        let viewModel = QueueViewModel(client: client)

        await viewModel.approveOnboardingRequests([
            OnboardingApprovalRequest(
                proposalId: "onboard_blog",
                taskId: "Launch Blog",
                windowIds: [501],
                taskSessionIds: ["session_blog"],
                browserContextIds: ["browser_tab:blog"],
                queuePaper: true
            ),
            OnboardingApprovalRequest(
                proposalId: "onboard_email",
                taskId: "Email Replies",
                windowIds: [601],
                taskSessionIds: ["session_email"],
                browserContextIds: ["browser_tab:email"],
                queuePaper: true
            )
        ])

        XCTAssertEqual(client.batchApprovalRequests.count, 1)
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.map(\.proposalId), ["onboard_blog", "onboard_email"])
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.map(\.taskId), ["task_launch_blog", "task_email_replies"])
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.first?.windowIds, [501])
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.first?.taskSessionIds, ["session_blog"])
        XCTAssertEqual(client.batchApprovalRequests.first?.approvals.first?.browserContextIds, ["browser_tab:blog"])
        XCTAssertEqual(client.boundTaskSessions.map(\.taskId), ["task_launch_blog", "task_email_replies"])
        XCTAssertEqual(viewModel.packets.map(\.taskId), ["task_launch_blog", "task_email_replies"])
    }

    func testApproveAllOnboardingProposalsRetriesTransientWithSameIdempotencyKey() async {
        let scan = OnboardingScan(
            ok: true,
            capturedAt: Date(timeIntervalSince1970: 1_778_080_000),
            activeWorkspace: "desk",
            focusedWindowId: 401,
            summary: OnboardingScanSummary(
                windowCount: 1,
                groupedWindowCount: 1,
                ungroupedWindowCount: 0,
                taskSessionCount: 0,
                browserContextCount: 0,
                proposalCount: 1
            ),
            proposals: [
                OnboardingTaskProposal(
                    id: "onboard_a",
                    taskId: "task_a",
                    title: "A",
                    confidence: "medium",
                    reason: "window title",
                    windows: [OnboardingWindow(id: 401, app: "Ghostty", title: "A", workspace: "a")],
                    suggestedNextAction: "Approve."
                )
            ]
        )
        let client = FakeQueueClient(packets: [])
        client.replaceOnboardingScan(scan)
        client.setBatchApprovalFailureCount(2)
        let viewModel = QueueViewModel(client: client)
        await viewModel.scanOnboarding()

        await viewModel.approveAllOnboardingProposals(queuePaper: true)

        XCTAssertEqual(client.batchApprovalRequests.count, 3)
        let keys = Set(client.batchApprovalRequests.map(\.idempotencyKey))
        XCTAssertEqual(keys.count, 1, "all retries should reuse the same idempotency key")
    }

    func testEnterManualModeCallsServerAndStaysInLoopOnFailure() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        client.setManualModeFakeError(QueueClientError.httpStatus(503))
        let viewModel = QueueViewModel(client: client)

        await viewModel.enterManualMode()

        XCTAssertEqual(client.manualModeSetRequests.count, 1)
        XCTAssertEqual(client.manualModeSetRequests.first?.active, true)
        XCTAssertEqual(client.manualModeSetRequests.first?.reason, "user_hotkey")
        XCTAssertEqual(viewModel.mode, .eventLoop, "server failure must not silently flip local mode")
        if case let .failed(message) = viewModel.state {
            XCTAssertTrue(message.contains("Manual mode failed"))
        } else {
            XCTFail("expected state to surface server failure")
        }
    }

    func testEnterManualModeFlipsLocalAfterServerSucceeds() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)

        await viewModel.enterManualMode()

        XCTAssertEqual(client.manualModeSetRequests.count, 1)
        XCTAssertEqual(client.manualModeSetRequests.first?.active, true)
        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
    }

    func testExitManualModePostsActiveFalseToServer() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.enterManualMode()

        await viewModel.exitManualMode()

        XCTAssertEqual(client.manualModeSetRequests.map(\.active), [true, false])
        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
    }

    func testBootstrapReadsManualModeStateFromServer() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        client.setManualModeFakeState(ManualModeState(
            active: true,
            enteredAt: Date(timeIntervalSince1970: 1_778_080_000),
            reason: "another_client",
            updatedAt: Date(timeIntervalSince1970: 1_778_080_001)
        ))
        let viewModel = QueueViewModel(client: client)

        await viewModel.bootstrap()

        XCTAssertGreaterThanOrEqual(client.manualModeGetRequestCount, 1)
        XCTAssertEqual(viewModel.mode, .manual, "bootstrap must reflect server-side manual flag in local UI")
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
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

    func testStopAutomaticLeaseRenewalCancelsPendingLoop() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.pullNextPaper()

        viewModel.startAutomaticLeaseRenewal(intervalNanoseconds: 50_000_000, maxRenewals: 100)

        try? await Task.sleep(nanoseconds: 5_000_000)
        viewModel.stopAutomaticLeaseRenewal()
        let stoppedRenewalCount = client.renewedPacketIds.count
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(client.renewedPacketIds.count, stoppedRenewalCount)
        XCTAssertEqual(stoppedRenewalCount, 0)
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
        XCTAssertEqual(client.leasedPacketIds, [])
    }

    func testStopAutomaticContextRestoreRefreshCancelsPendingLoop() async {
        let resource = ReviewContextResource(
            id: "ctx_browser_refresh_loop",
            kind: "browser_tab",
            title: "Refresh loop",
            url: "https://example.test/refresh-loop",
            restoreConfidence: "high"
        )
        let client = FakeQueueClient()
        let viewModel = QueueViewModel(client: client)
        await viewModel.requestContextRestore(resource: resource)

        viewModel.startAutomaticContextRestoreRefresh(intervalNanoseconds: 1_000_000, maxRefreshes: 100)

        for _ in 0..<50 where client.checkedContextRestoreIds.count < 2 {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        viewModel.stopAutomaticContextRestoreRefresh()
        let stopIssuedRefreshCount = client.checkedContextRestoreIds.count
        try? await Task.sleep(nanoseconds: 20_000_000)
        let drainedRefreshCount = client.checkedContextRestoreIds.count
        try? await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(client.checkedContextRestoreIds.count, drainedRefreshCount)
        XCTAssertLessThanOrEqual(drainedRefreshCount, stopIssuedRefreshCount + 1)
        XCTAssertLessThan(drainedRefreshCount, 100)
    }

    func testStopAutomaticActivityRefreshCancelsPendingLoop() async {
        let client = FakeQueueClient(packets: [])
        let viewModel = QueueViewModel(client: client)

        viewModel.presentActivity()
        viewModel.startAutomaticActivityRefresh(intervalNanoseconds: 1_000_000)

        for _ in 0..<50 where client.activityFetchCount < 2 {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        viewModel.stopAutomaticActivityRefresh()
        let stoppedRefreshCount = client.activityFetchCount
        try? await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(client.activityFetchCount, stoppedRefreshCount)
        XCTAssertGreaterThanOrEqual(stoppedRefreshCount, 1)
    }

    func testDisableAutoBindContinuousCancelsPendingLoop() async {
        let client = FakeQueueClient(packets: [])
        let viewModel = QueueViewModel(client: client)

        viewModel.setAutoBindContinuous(true, intervalNanoseconds: 1_000_000)

        for _ in 0..<50 where client.autoBindRunCount < 2 {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        viewModel.setAutoBindContinuous(false, intervalNanoseconds: 1_000_000)
        let stoppedRunCount = client.autoBindRunCount
        try? await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(client.autoBindRunCount, stoppedRunCount)
        XCTAssertGreaterThanOrEqual(stoppedRunCount, 1)
        XCTAssertFalse(viewModel.autoBindContinuousEnabled)
    }

    func testManualModePausesWorkspaceRestoreWithoutClearingQueue() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        await viewModel.enterManualMode()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.packets.count, 3)

        await viewModel.returnToEventLoopMode()

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
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient
        )

        await viewModel.pullNextPaper()
        await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.workspaceRestoreState, .executed(receipt))
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 2)
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.taskId, "task_blog_feedback")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.sourceQueueItemId, "packet-blog-feedback")
        XCTAssertEqual(client.taskWorkspaceSnapshotSaves.first?.workspaceSnapshot, snapshot)
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

        await viewModel.enterManualMode()
        await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()
        await viewModel.confirmManualWorkspaceRestore()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.workspaceRestoreState, .executed(receipt))
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [snapshot])
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
        XCTAssertTrue(workspaceClient.restoreIdempotencyKeys[0].hasPrefix("mac_manual_workspace_restore_"))
    }

    func testRapidManualWorkspaceRestoreDoesNotSendSecondRequest() async {
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
            ),
            restoreDelayNanoseconds: 100_000_000
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )

        await viewModel.enterManualMode()
        await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()

        let firstRestore = Task { @MainActor in
            await viewModel.confirmManualWorkspaceRestore()
        }
        try? await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Restoring manual workspace..."))

        let secondRestore = Task { @MainActor in
            await viewModel.confirmManualWorkspaceRestore()
        }

        await secondRestore.value

        XCTAssertEqual(viewModel.workspaceRestoreState, .alreadyRestoring)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Manual workspace restore already running..."))
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)

        await firstRestore.value

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.workspaceRestoreState, .executed(receipt))
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Manual workspace restored."))
    }

    func testImmediateManualWorkspaceRestoreRepeatReusesRecentReceipt() async {
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

        await viewModel.enterManualMode()
        await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()
        await viewModel.confirmManualWorkspaceRestore()
        await viewModel.confirmManualWorkspaceRestore()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.workspaceRestoreState, .alreadyRestored(receipt))
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Manual workspace already restored."))
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
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

    func testReturnToEventLoopKeepingCurrentLayoutDoesNotRestoreWorkspace() async {
        let manualSnapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 41, app: "Google Chrome", title: "Manual browsing", workspace: "manual")
            ],
            activeWorkspace: "manual",
            focusedWindowId: 41
        )
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: manualSnapshot)
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: workspaceClient
        )

        await viewModel.enterManualMode()
        await viewModel.returnToEventLoopModeKeepingCurrentLayout()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
        XCTAssertEqual(viewModel.manualWorkspaceSnapshot, manualSnapshot)
        XCTAssertEqual(viewModel.manualWorkspaceCaptureState, .captured(manualSnapshot))
        XCTAssertEqual(viewModel.workspaceRestoreState, .keptCurrentLayout)
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [])
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
        await viewModel.enterManualMode()

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

        await viewModel.enterManualMode()
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

    func testEventLoopModeExecutesWorkspaceRestoreWhenBackendAllowsExecution() async {
        let plan = WorkspaceRestorePlan(
            commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "eventloop-blog"])],
            skipped: []
        )
        let receipt = WorkspaceRestoreReceipt(
            commands: [WorkspaceExecutedCommand(command: "aerospace", args: ["workspace", "eventloop-blog"], stdout: "ok")],
            skipped: []
        )
        let workspaceClient = FakeWorkspaceClient(
            planEnvelope: WorkspaceRestorePlanEnvelope(plan: plan, executeSupported: true),
            restoreEnvelope: WorkspaceRestoreExecutionEnvelope(
                ok: true,
                plan: plan,
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

        await viewModel.prepareWorkspaceRestore(snapshot: snapshot)

        XCTAssertEqual(viewModel.workspaceRestoreState, .executed(receipt))
        XCTAssertEqual(workspaceClient.restorePlanSnapshots, [snapshot])
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [snapshot])
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
        XCTAssertTrue(workspaceClient.restoreIdempotencyKeys[0].hasPrefix("mac_workspace_restore_"))
    }

    func testSelectedWorkspaceRestoreAutoExecutionSetsCurrentTaskForSelectedPaper() async {
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )
        let plan = WorkspaceRestorePlan(
            commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "eventloop-blog"])],
            skipped: []
        )
        let packet = ReviewPacket(
            id: "packet-with-task-workspace",
            taskId: "task_blog",
            title: "Review with workspace",
            summary: "Needs workspace restore",
            source: "slack://thread/blog-feedback",
            priority: 90,
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0),
            workspaceSnapshot: snapshot
        )
        let client = FakeQueueClient(packets: [packet])
        client.setFakeTasks([
            TaskRecord(
                taskId: "task_blog",
                primaryAnchorKind: .codexThread,
                primaryAnchorId: "thr_blog",
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            ),
        ])
        let workspaceClient = FakeWorkspaceClient(
            planEnvelope: WorkspaceRestorePlanEnvelope(plan: plan, executeSupported: true)
        )
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-with-task-workspace")

        await viewModel.prepareSelectedWorkspaceRestore()

        XCTAssertEqual(client.setCurrentTaskRequests, ["task_blog"])
        XCTAssertEqual(viewModel.currentTask?.taskId, "task_blog")
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [snapshot])
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
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Selected paper has no saved workspace."))
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
        XCTAssertEqual(
            viewModel.advanceToast,
            .switchedToPaper(packetId: "packet-with-workspace", title: "Review with workspace", decision: "Review")
        )
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
    }

    func testSelectedWorkspaceRestoreSetsCurrentTaskForSelectedPaper() async {
        let snapshot = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog")],
            activeWorkspace: "eventloop-blog"
        )
        let packet = ReviewPacket(
            id: "packet-with-task-workspace",
            taskId: "task_blog",
            title: "Review with workspace",
            summary: "Needs workspace restore",
            source: "slack://thread/blog-feedback",
            priority: 90,
            recommendedAction: "Review",
            createdAt: Date(timeIntervalSince1970: 0),
            workspaceSnapshot: snapshot
        )
        let client = FakeQueueClient(packets: [packet])
        client.setFakeTasks([
            TaskRecord(
                taskId: "task_blog",
                primaryAnchorKind: .codexThread,
                primaryAnchorId: "thr_blog",
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            ),
        ])
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-with-task-workspace")

        await viewModel.confirmSelectedWorkspaceRestore()

        XCTAssertEqual(client.setCurrentTaskRequests, ["task_blog"])
        XCTAssertEqual(viewModel.currentTask?.taskId, "task_blog")
        XCTAssertEqual(
            viewModel.advanceToast,
            .switchedToPaper(packetId: "packet-with-task-workspace", title: "Review with workspace", decision: "Review")
        )
    }

    func testWorkspaceRestoreFailureToastShowsServerMessageWithoutHTTPPrefix() async {
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
        let workspaceClient = FakeWorkspaceClient(
            restoreError: QueueClientError.httpStatusMessage(422, "schema_error: snapshot is required")
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: [packet]),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-with-workspace")

        await viewModel.confirmSelectedWorkspaceRestore()

        XCTAssertEqual(viewModel.workspaceRestoreState, .failed("Queue request failed with HTTP 422: schema_error: snapshot is required"))
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Workspace restore failed: schema_error: snapshot is required"))
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)
    }

    func testRapidSelectedWorkspaceRestoreDeduplicatesWhileInFlight() async {
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
            ),
            restoreDelayNanoseconds: 100_000_000
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: [packet]),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-with-workspace")

        let firstRestore = Task { @MainActor in
            await viewModel.confirmSelectedWorkspaceRestore()
        }
        try? await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(viewModel.workspaceRestoreState, .restoring)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Restoring workspace..."))

        let secondRestore = Task { @MainActor in
            await viewModel.confirmSelectedWorkspaceRestore()
        }

        await secondRestore.value

        XCTAssertEqual(viewModel.workspaceRestoreState, .alreadyRestoring)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Workspace restore already running..."))
        XCTAssertEqual(workspaceClient.restoreIdempotencyKeys.count, 1)

        await firstRestore.value

        XCTAssertEqual(viewModel.workspaceRestoreState, .executed(receipt))
        XCTAssertEqual(
            viewModel.advanceToast,
            .switchedToPaper(packetId: "packet-with-workspace", title: "Review with workspace", decision: "Review")
        )
    }

    func testImmediateSelectedWorkspaceRestoreRepeatReusesRecentReceipt() async {
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
            client: FakeQueueClient(packets: [packet]),
            workspaceClient: workspaceClient
        )
        await viewModel.loadQueue()
        viewModel.select(packetId: "packet-with-workspace")

        await viewModel.confirmSelectedWorkspaceRestore()
        await viewModel.confirmSelectedWorkspaceRestore()

        XCTAssertEqual(viewModel.workspaceRestoreState, .alreadyRestored(receipt))
        XCTAssertEqual(
            viewModel.advanceToast,
            .switchedToPaper(packetId: "packet-with-workspace", title: "Review with workspace", decision: "Review")
        )
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
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Workspace restored."))
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

        await viewModel.enterManualMode()
        await viewModel.confirmWorkspaceRestore(snapshot: snapshot)

        XCTAssertEqual(viewModel.workspaceRestoreState, .skippedManualMode)
        XCTAssertEqual(viewModel.advanceToast, .manualModeActive)
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
