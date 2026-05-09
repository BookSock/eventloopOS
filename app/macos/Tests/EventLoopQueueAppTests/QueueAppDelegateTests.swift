import EventLoopQueueCore
import XCTest
@testable import EventLoopQueueApp

@MainActor
final class QueueAppDelegateTests: XCTestCase {
    func testTerminationRestoresSavedManualWorkspace() async {
        let manualSnapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 42, app: "Finder", title: "Manual desk", workspace: "main")
            ],
            activeWorkspace: "main",
            focusedWindowId: 42
        )
        let workspaceClient = FakeWorkspaceClient(captureSnapshot: manualSnapshot)
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: []),
            workspaceClient: workspaceClient
        )
        await viewModel.enterManualModeAndCaptureWorkspace()
        viewModel.returnToEventLoopMode()

        let delegate = QueueAppDelegate()
        delegate.viewModel = viewModel

        let restored = await delegate.restoreManualWorkspaceBeforeTermination()

        XCTAssertTrue(restored)
        XCTAssertEqual(workspaceClient.workspaceRestoreSnapshots, [manualSnapshot])
        XCTAssertTrue(viewModel.isManualMode)
    }

    func testTerminationSkipsWhenNoManualWorkspaceSaved() async {
        let workspaceClient = FakeWorkspaceClient()
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: []),
            workspaceClient: workspaceClient
        )
        let delegate = QueueAppDelegate()
        delegate.viewModel = viewModel

        let restored = await delegate.restoreManualWorkspaceBeforeTermination()

        XCTAssertFalse(restored)
        XCTAssertTrue(workspaceClient.workspaceRestoreSnapshots.isEmpty)
    }
}
