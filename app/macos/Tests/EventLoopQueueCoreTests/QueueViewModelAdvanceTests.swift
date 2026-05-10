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
        let resolver = FakeCodexForegroundResolver(AdvanceForegroundContext(codexThreadId: "thr_xyz"))
        let viewModel = QueueViewModel(
            client: client,
            workspaceClient: workspaceClient,
            aeroSpaceClient: aero,
            codexForegroundResolver: resolver
        )

        await viewModel.advance()

        XCTAssertEqual(client.createTaskRequests.count, 1)
        XCTAssertEqual(client.createTaskRequests.first?.primaryAnchor, TaskAnchor(kind: .codexThread, id: "thr_xyz"))
        XCTAssertEqual(client.createTaskRequests.first?.capturedLayout.activeWorkspace, "1")
        XCTAssertEqual(client.setCurrentTaskRequests, ["task_fake_1"])
        XCTAssertNotNil(viewModel.currentTask)
        if case let .taskCreated(taskId) = viewModel.advanceToast {
            XCTAssertEqual(taskId, "task_fake_1")
        } else {
            XCTFail("expected taskCreated toast, got \(String(describing: viewModel.advanceToast))")
        }
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
}
