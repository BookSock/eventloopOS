import XCTest
@testable import EventLoopQueueCore

@MainActor
final class QueueViewModelAdvanceTests: XCTestCase {
    func testAdvanceFromLimboCreatesTaskAndSetsCurrent() async {
        let client = FakeQueueClient(packets: [])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [WorkspaceWindow(id: 1, app: "Ghostty", title: "codex", workspace: "1")],
                activeWorkspace: "1",
                focusedWindowId: 1
            )
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "1")
        let resolver = FakeCodexForegroundResolver(AdvanceForegroundContext(codexThreadId: "thr_xyz", ghosttyWindowId: "front-id"))
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )

        await viewModel.advance()

        XCTAssertEqual(client.createTaskRequests.count, 1)
        XCTAssertEqual(client.createTaskRequests.first?.primaryAnchor, TaskAnchor(kind: .codexThread, id: "thr_xyz"))
        XCTAssertEqual(client.createTaskRequests.first?.terminalRef, "ghostty:win-front-id")
        XCTAssertEqual(client.createTaskRequests.first?.capturedLayout.activeWorkspace, "1")
        XCTAssertEqual(client.setCurrentTaskRequests, ["task_fake_1"])
        XCTAssertNotNil(viewModel.currentTask)
        if case let .taskCreated(taskId) = viewModel.advanceToast {
            XCTAssertEqual(taskId, "task_fake_1")
        } else {
            XCTFail("expected taskCreated toast, got \(String(describing: viewModel.advanceToast))")
        }
    }

    func testRapidAdvanceDeduplicatesWhileInFlight() async {
        let client = FakeQueueClient(packets: [])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [WorkspaceWindow(id: 1, app: "Ghostty", title: "codex", workspace: "1")],
                activeWorkspace: "1",
                focusedWindowId: 1
            ),
            captureDelayNanoseconds: 100_000_000
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "1")
        let resolver = FakeCodexForegroundResolver(AdvanceForegroundContext(codexThreadId: "thr_xyz"))
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )

        let firstAdvance = Task { @MainActor in
            await viewModel.advance()
        }
        try? await Task.sleep(nanoseconds: 10_000_000)

        let secondAdvance = Task { @MainActor in
            await viewModel.advance()
        }

        await firstAdvance.value
        await secondAdvance.value

        XCTAssertEqual(client.createTaskRequests.count, 1)
        XCTAssertEqual(client.setCurrentTaskRequests, ["task_fake_1"])
        XCTAssertEqual(workspaceClient.workspaceCaptureCount, 1)
    }

    func testAdvanceSnapshotReadsRunConcurrently() async {
        let delay: UInt64 = 100_000_000
        let client = FakeQueueClient(packets: [])
        client.setReadDelayNanoseconds(delay)
        client.setManualModeFakeState(ManualModeState(active: true, updatedAt: Date()))
        let workspaceClient = FakeWorkspaceClient()
        let aero = FakeAeroSpaceWorkspaceClient(focused: "1", workspaces: ["1", "limbo"])
        aero.setReadDelayNanoseconds(delay)
        let resolver = FakeCodexForegroundResolver(.none, readDelayNanoseconds: delay)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )

        let started = DispatchTime.now().uptimeNanoseconds
        await viewModel.advance()
        let elapsed = DispatchTime.now().uptimeNanoseconds - started

        XCTAssertEqual(viewModel.advanceToast, .manualModeActive)
        XCTAssertLessThan(
            elapsed,
            450_000_000,
            "advance snapshot reads should overlap; elapsed \(elapsed)ns suggests serial reads"
        )
    }

    func testAdvanceFromStateBWithEmptyQueueEntersLimbo() async {
        let client = FakeQueueClient(packets: [])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [],
                activeWorkspace: "ws_a",
                focusedWindowId: nil
            )
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "ws_a")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver,
            limboWorkspaceId: "limbo"
        )

        let task = TaskRecord(
            taskId: "task_a",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_a",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        client.setFakeTasks([task])
        client.setFakeCurrentTask("task_a")
        client.setFakeTaskLayout(taskId: "task_a", layout: WorkspaceSnapshot(
            windows: [],
            activeWorkspace: "ws_a"
        ))

        await viewModel.advance()

        XCTAssertEqual(client.updateTaskLayoutRequests.count, 1)
        XCTAssertEqual(client.updateTaskLayoutRequests.first?.taskId, "task_a")
        XCTAssertEqual(aero.switchedWorkspaces, ["limbo"])
        XCTAssertEqual(client.setCurrentTaskRequests, [nil])
        XCTAssertEqual(viewModel.advanceToast, .enteredLimbo)
        XCTAssertNil(viewModel.currentTask)
    }

    func testAdvanceInManualModeShowsToastAndSkipsServerWork() async {
        let client = FakeQueueClient(packets: [])
        client.setManualModeFakeState(ManualModeState(active: true, updatedAt: Date()))
        let workspaceClient = FakeWorkspaceClient()
        let aero = FakeAeroSpaceWorkspaceClient(focused: "personal")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )

        await viewModel.advance()

        XCTAssertEqual(viewModel.advanceToast, .manualModeActive)
        XCTAssertEqual(client.createTaskRequests.count, 0)
        XCTAssertEqual(client.updateTaskLayoutRequests.count, 0)
        XCTAssertEqual(aero.switchedWorkspaces, [])
        XCTAssertEqual(client.setCurrentTaskRequests, [])
    }

    func testAdvanceCompletionConflictShowsActionableFeedback() async {
        let paper = ReviewPacket(
            id: "pkt_a",
            reviewPacketId: "rpkt_a",
            taskId: "task_a",
            title: "A paper",
            summary: "finish me",
            source: "manual",
            priority: 500,
            recommendedAction: "review",
            createdAt: Date(timeIntervalSince1970: 1)
        )
        let client = FakeQueueClient(packets: [paper])
        client.setQueueActionError(QueueClientError.httpStatusMessage(
            409,
            "manual_mode_active: queue is paused while manual mode is active"
        ))
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [],
                activeWorkspace: "ws_a",
                focusedWindowId: nil
            )
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "ws_a")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver,
            limboWorkspaceId: "limbo"
        )

        let taskA = TaskRecord(
            taskId: "task_a",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_a",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        client.setFakeTasks([taskA])
        client.setFakeCurrentTask("task_a")
        client.setFakeTaskLayout(taskId: "task_a", layout: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_a"))
        await viewModel.loadQueue()

        await viewModel.advance()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "pkt_a")
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Manual Mode active. Press Ctrl-Option-M to return."))
        XCTAssertEqual(client.completedPacketIds, [])
        XCTAssertEqual(aero.switchedWorkspaces, [])
    }

    func testLoadAdvanceSnapshotPopulatesTasksByWorkspaceViaGetTaskWithLayout() async {
        let paperForB = ReviewPacket(
            id: "pkt_b",
            reviewPacketId: "rpkt_b",
            taskId: "task_b",
            title: "B paper",
            summary: "switch me",
            source: "manual",
            priority: 500,
            recommendedAction: "review",
            createdAt: Date(timeIntervalSince1970: 1)
        )
        let client = FakeQueueClient(packets: [paperForB])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [],
                activeWorkspace: "ws_a",
                focusedWindowId: nil
            )
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "ws_a")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver,
            limboWorkspaceId: "limbo"
        )

        let taskA = TaskRecord(
            taskId: "task_a",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_a",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        let taskB = TaskRecord(
            taskId: "task_b",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_b",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        let taskUnused = TaskRecord(
            taskId: "task_unused",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_unused",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        client.setFakeTasks([taskA, taskB, taskUnused])
        client.setFakeCurrentTask("task_a")
        client.setFakeTaskLayout(taskId: "task_a", layout: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_a"))
        client.setFakeTaskLayout(taskId: "task_b", layout: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_b"))
        client.setFakeTaskLayout(taskId: "task_unused", layout: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_unused"))

        await viewModel.advance()

        XCTAssertEqual(aero.switchedWorkspaces, ["ws_b"], "advance must resolve task_b's workspace via getTaskWithLayout")
        if case let .switchedToPaper(packetId, title, decision) = viewModel.advanceToast {
            XCTAssertEqual(packetId, "pkt_b")
            XCTAssertEqual(title, "B paper")
            XCTAssertEqual(decision, "switch me")
        } else {
            XCTFail("expected switchedToPaper toast, got \(String(describing: viewModel.advanceToast))")
        }
    }

    func testAdvanceToQueuedPaperRestoresSavedWorkspaceAndFocus() async {
        let paperWorkspace = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 101, app: "Ghostty", title: "codex email", workspace: "ws_b")],
            activeWorkspace: "ws_b",
            focusedWindowId: 101
        )
        let paperForB = ReviewPacket(
            id: "pkt_b",
            reviewPacketId: "rpkt_b",
            taskId: "task_b",
            title: "B paper",
            summary: "switch me",
            source: "manual",
            priority: 500,
            recommendedAction: "review",
            createdAt: Date(timeIntervalSince1970: 1),
            workspaceSnapshot: paperWorkspace
        )
        let client = FakeQueueClient(packets: [paperForB])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [],
                activeWorkspace: "ws_a",
                focusedWindowId: nil
            )
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "ws_a")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver,
            limboWorkspaceId: "limbo"
        )

        let taskA = TaskRecord(
            taskId: "task_a",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_a",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        let taskB = TaskRecord(
            taskId: "task_b",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_b",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        client.setFakeTasks([taskA, taskB])
        client.setFakeCurrentTask("task_a")
        client.setFakeTaskLayout(taskId: "task_a", layout: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_a"))
        client.setFakeTaskLayout(taskId: "task_b", layout: paperWorkspace)

        await viewModel.advance()

        XCTAssertEqual(client.setCurrentTaskRequests, ["task_b"])
        XCTAssertEqual(viewModel.currentTask?.taskId, "task_b")
        XCTAssertEqual(aero.switchedWorkspaces, [])
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [paperWorkspace])
        XCTAssertTrue(workspaceClient.restoreIdempotencyKeys.first?.hasPrefix("mac_paper_restore_pkt_b_") ?? false)
        XCTAssertEqual(viewModel.selectedPacketID, "pkt_b")
        if case let .switchedToPaper(packetId, title, decision) = viewModel.advanceToast {
            XCTAssertEqual(packetId, "pkt_b")
            XCTAssertEqual(title, "B paper")
            XCTAssertEqual(decision, "switch me")
        } else {
            XCTFail("expected switchedToPaper toast, got \(String(describing: viewModel.advanceToast))")
        }
    }

    func testRestoreHotkeyDuringAdvancePaperSwitchDoesNotStartSecondRestore() async {
        let paperWorkspace = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 101, app: "Ghostty", title: "codex email", workspace: "ws_b")],
            activeWorkspace: "ws_b",
            focusedWindowId: 101
        )
        let paperForB = ReviewPacket(
            id: "pkt_b",
            reviewPacketId: "rpkt_b",
            taskId: "task_b",
            title: "B paper",
            summary: "switch me",
            source: "manual",
            priority: 500,
            recommendedAction: "review",
            createdAt: Date(timeIntervalSince1970: 1),
            workspaceSnapshot: paperWorkspace
        )
        let client = FakeQueueClient(packets: [paperForB])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_a"),
            restoreDelayNanoseconds: 1_000_000_000
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "ws_a")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver,
            limboWorkspaceId: "limbo"
        )

        let taskA = TaskRecord(
            taskId: "task_a",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_a",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        let taskB = TaskRecord(
            taskId: "task_b",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_b",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        client.setFakeTasks([taskA, taskB])
        client.setFakeCurrentTask("task_a")
        client.setFakeTaskLayout(taskId: "task_a", layout: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_a"))
        client.setFakeTaskLayout(taskId: "task_b", layout: paperWorkspace)
        await viewModel.loadQueue()

        let switchTask = Task { @MainActor in
            await viewModel.advance()
        }
        for _ in 0..<100 where workspaceClient.workspaceRestoreSnapshots.isEmpty {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [paperWorkspace])
        XCTAssertEqual(viewModel.workspaceRestoreState, .restoring)

        await viewModel.confirmSelectedWorkspaceRestore()

        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [paperWorkspace])
        XCTAssertEqual(viewModel.workspaceRestoreState, .alreadyRestoring)
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Restoring paper: B paper..."))

        await switchTask.value

        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [paperWorkspace])
        XCTAssertEqual(viewModel.selectedPacketID, "pkt_b")
        XCTAssertEqual(viewModel.currentTask?.taskId, "task_b")
        if case let .switchedToPaper(packetId, title, decision) = viewModel.advanceToast {
            XCTAssertEqual(packetId, "pkt_b")
            XCTAssertEqual(title, "B paper")
            XCTAssertEqual(decision, "switch me")
        } else {
            XCTFail("expected switchedToPaper toast, got \(String(describing: viewModel.advanceToast))")
        }
    }

    func testRestoreHotkeyAfterAdvancePaperSwitchReusesRecentRestore() async {
        let paperWorkspace = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 101, app: "Ghostty", title: "codex email", workspace: "ws_b")],
            activeWorkspace: "ws_b",
            focusedWindowId: 101
        )
        let paperForB = ReviewPacket(
            id: "pkt_b",
            reviewPacketId: "rpkt_b",
            taskId: "task_b",
            title: "B paper",
            summary: "switch me",
            source: "manual",
            priority: 500,
            recommendedAction: "review",
            createdAt: Date(timeIntervalSince1970: 1),
            workspaceSnapshot: paperWorkspace
        )
        let client = FakeQueueClient(packets: [paperForB])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_a")
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "ws_a")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver,
            limboWorkspaceId: "limbo"
        )

        let taskA = TaskRecord(
            taskId: "task_a",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_a",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        let taskB = TaskRecord(
            taskId: "task_b",
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_b",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        client.setFakeTasks([taskA, taskB])
        client.setFakeCurrentTask("task_a")
        client.setFakeTaskLayout(taskId: "task_a", layout: WorkspaceSnapshot(windows: [], activeWorkspace: "ws_a"))
        client.setFakeTaskLayout(taskId: "task_b", layout: paperWorkspace)
        await viewModel.loadQueue()

        await viewModel.advance()
        await viewModel.confirmSelectedWorkspaceRestore()

        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [paperWorkspace])
        XCTAssertEqual(viewModel.workspaceRestoreState, .alreadyRestored(WorkspaceRestoreReceipt(commands: [], skipped: [])))
        XCTAssertEqual(viewModel.advanceToast, .actionComplete("Paper already restored: B paper."))
        XCTAssertTrue(workspaceClient.restoreIdempotencyKeys.first?.hasPrefix("mac_paper_restore_pkt_b_") ?? false)
    }

    func testAdvanceFromLimboWithoutForegroundCodexShowsToast() async {
        let client = FakeQueueClient(packets: [])
        let workspaceClient = FakeWorkspaceClient()
        let aero = FakeAeroSpaceWorkspaceClient(focused: "1")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )

        await viewModel.advance()

        XCTAssertEqual(viewModel.advanceToast, .noForegroundCodex)
        XCTAssertEqual(client.createTaskRequests.count, 0)
        XCTAssertEqual(client.setCurrentTaskRequests, [])
    }

    func testAdvanceFromLimboWithQueuedPaperPullsNextPaper() async {
        let paperWorkspace = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 101, app: "Google Chrome", title: "Demo", workspace: "demo-launch")],
            activeWorkspace: "demo-launch",
            focusedWindowId: 101
        )
        let paper = ReviewPacket(
            id: "pkt_demo",
            reviewPacketId: "rpkt_demo",
            taskId: "task_demo",
            title: "Demo paper",
            summary: "switch me",
            source: "manual",
            priority: 500,
            recommendedAction: "review",
            createdAt: Date(timeIntervalSince1970: 1),
            workspaceSnapshot: paperWorkspace
        )
        let client = FakeQueueClient(packets: [paper])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [],
                activeWorkspace: "1",
                focusedWindowId: nil
            ),
            planEnvelope: WorkspaceRestorePlanEnvelope(
                plan: WorkspaceRestorePlan(
                    commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "demo-launch"])],
                    skipped: []
                ),
                executeSupported: true
            )
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "1")
        let resolver = FakeCodexForegroundResolver(.none)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )
        client.setFakeTasks([
            TaskRecord(
                taskId: "task_demo",
                primaryAnchorKind: .codexThread,
                primaryAnchorId: "thr_demo",
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            ),
        ])

        await viewModel.advance()

        XCTAssertEqual(viewModel.selectedPacketID, "pkt_demo")
        XCTAssertEqual(client.setCurrentTaskRequests, ["task_demo"])
        XCTAssertEqual(viewModel.currentTask?.taskId, "task_demo")
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [paperWorkspace])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(client.createTaskRequests.count, 0)
    }

    func testAdvanceFromLimboWithLoadedQueueSkipsSlowForegroundResolve() async {
        let paperWorkspace = WorkspaceSnapshot(
            windows: [WorkspaceWindow(id: 101, app: "Google Chrome", title: "Demo", workspace: "demo-launch")],
            activeWorkspace: "demo-launch",
            focusedWindowId: 101
        )
        let paper = ReviewPacket(
            id: "pkt_demo",
            reviewPacketId: "rpkt_demo",
            taskId: "task_demo",
            title: "Demo paper",
            summary: "switch me",
            source: "manual",
            priority: 500,
            recommendedAction: "review",
            createdAt: Date(timeIntervalSince1970: 1),
            workspaceSnapshot: paperWorkspace
        )
        let client = FakeQueueClient(packets: [paper])
        let workspaceClient = FakeWorkspaceClient(
            captureSnapshot: WorkspaceSnapshot(
                windows: [],
                activeWorkspace: "1",
                focusedWindowId: nil
            ),
            planEnvelope: WorkspaceRestorePlanEnvelope(
                plan: WorkspaceRestorePlan(
                    commands: [WorkspaceCommand(command: "aerospace", args: ["workspace", "demo-launch"])],
                    skipped: []
                ),
                executeSupported: true
            )
        )
        let aero = FakeAeroSpaceWorkspaceClient(focused: "1")
        let resolver = FakeCodexForegroundResolver(.none, readDelayNanoseconds: 500_000_000)
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )

        await viewModel.loadQueue()
        await viewModel.advance()

        XCTAssertEqual(resolver.resolveCount, 0)
        XCTAssertEqual(viewModel.selectedPacketID, "pkt_demo")
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [paperWorkspace])
        XCTAssertEqual(client.createTaskRequests.count, 0)
    }
}
