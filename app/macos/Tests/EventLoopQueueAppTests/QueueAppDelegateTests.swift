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
        await viewModel.returnToEventLoopMode()

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

    func testHarnessWindowFlagCanBeRequestedByArgumentOrEnvironment() {
        XCTAssertTrue(QueueAppDelegate.shouldOpenHarnessWindow(
            arguments: ["EventLoopQueueApp", "--harness-window"],
            environment: [:]
        ))
        XCTAssertTrue(QueueAppDelegate.shouldOpenHarnessWindow(
            arguments: ["EventLoopQueueApp"],
            environment: ["EVENTLOOPOS_QUEUE_APP_HARNESS_WINDOW": "1"]
        ))
        XCTAssertFalse(QueueAppDelegate.shouldOpenHarnessWindow(
            arguments: ["EventLoopQueueApp"],
            environment: [:]
        ))
    }

    func testFocusExistingQueueWindowReturnsFalseWhenNoQueueWindowExists() {
        let delegate = QueueAppDelegate()

        XCTAssertFalse(delegate.focusExistingQueueWindow())
    }

    func testOpenFloatingQueueWindowReturnsFalseWithoutViewModel() {
        let delegate = QueueAppDelegate()

        XCTAssertFalse(delegate.openFloatingQueueWindow())
    }

    func testMasterCommandRequestReturnsFalseWithoutViewModel() {
        let delegate = QueueAppDelegate()

        XCTAssertFalse(delegate.presentMasterCommandFromGlobalHotkey())
    }

    func testHotkeysRequestReturnsFalseWithoutViewModel() {
        let delegate = QueueAppDelegate()

        XCTAssertFalse(delegate.presentHotkeysFromGlobalHotkey())
    }

    func testHarnessWindowIsConfiguredAsFloatingQueueSurface() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )

        QueueAppDelegate.configureHarnessWindow(window)

        XCTAssertEqual(window.title, "eventloopOS Queue")
        XCTAssertEqual(window.identifier?.rawValue, "eventloopos-queue-harness-window")
        XCTAssertEqual(window.level, .floating)
        XCTAssertEqual(window.minSize, NSSize(width: 760, height: 460))
    }

    func testPaperReminderHudCanBeDisabledByEnvironment() {
        XCTAssertTrue(PaperReminderHUDController.shouldEnable(environment: [:]))
        XCTAssertFalse(PaperReminderHUDController.shouldEnable(environment: [
            "EVENTLOOPOS_PAPER_REMINDER_DISABLED": "1",
        ]))
    }

    func testPaperReminderHudWindowIsNonActivatingFloatingOverlay() {
        XCTAssertGreaterThanOrEqual(PaperReminderHUDController.preferredContentSize.height, 116)

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 96),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        PaperReminderHUDController.configureWindow(panel)

        XCTAssertEqual(panel.title, "eventloopOS Paper Reminder")
        XCTAssertEqual(panel.identifier?.rawValue, "eventloopos-paper-reminder-hud")
        XCTAssertEqual(panel.level, .floating)
        XCTAssertTrue(panel.collectionBehavior.contains(.canJoinAllSpaces))
        XCTAssertTrue(panel.collectionBehavior.contains(.fullScreenAuxiliary))
        XCTAssertTrue(panel.hidesOnDeactivate == false)
        XCTAssertTrue(panel.ignoresMouseEvents)
        XCTAssertTrue(panel.styleMask.contains(.nonactivatingPanel))
    }

    func testPaperReminderHudOpenRequiresViewModelAndHonorsDisableFlag() {
        let delegate = QueueAppDelegate()

        XCTAssertFalse(delegate.openPaperReminderHUDIfAvailable(environment: [:]))

        let viewModel = QueueViewModel(client: FakeQueueClient(packets: []))
        delegate.viewModel = viewModel
        XCTAssertFalse(delegate.openPaperReminderHUDIfAvailable(environment: [
            "EVENTLOOPOS_PAPER_REMINDER_DISABLED": "1",
        ]))
        XCTAssertTrue(delegate.openPaperReminderHUDIfAvailable(environment: [:]))
    }
}
