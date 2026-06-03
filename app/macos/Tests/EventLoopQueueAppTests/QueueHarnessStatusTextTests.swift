import EventLoopQueueCore
import XCTest
@testable import EventLoopQueueApp

final class QueueHarnessStatusTextTests: XCTestCase {
    func testStatusTextShowsReadyFeedbackByDefault() {
        let text = QueueHarnessStatusText.make(
            queueState: .loaded,
            queueCount: 2,
            selectedTaskId: nil,
            taskSessionCount: 0,
            summary: makeSummary(),
            advanceToast: nil
        )

        XCTAssertTrue(text.contains("feedback=ready"))
        XCTAssertTrue(text.contains("state=loaded"))
        XCTAssertTrue(text.contains("queue_count=2"))
        XCTAssertTrue(text.contains("selected_task=none"))
    }

    func testWorkspaceRestoreFeedbackIsVisibleInHarnessStatus() {
        let text = QueueHarnessStatusText.make(
            queueState: .loaded,
            queueCount: 1,
            selectedTaskId: "task_demo_customer",
            taskSessionCount: 0,
            summary: makeSummary(workspaceRestoreState: .keptCurrentLayout),
            advanceToast: nil
        )

        XCTAssertTrue(text.contains("feedback=Returned without moving windows"))
        XCTAssertTrue(text.contains("workspace=Returned without moving windows"))
        XCTAssertTrue(text.contains("selected_task=task_demo_customer"))
    }

    func testManualWorkspaceFeedbackIsVisibleInHarnessStatus() {
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 1, app: "TextEdit", title: "Shared Notes", workspace: "demo-customer"),
                WorkspaceWindow(id: 2, app: "Google Chrome", title: "Customer", workspace: "demo-customer")
            ]
        )
        let text = QueueHarnessStatusText.make(
            queueState: .loaded,
            queueCount: 1,
            selectedTaskId: "task_demo_customer",
            taskSessionCount: 0,
            summary: makeSummary(manualWorkspaceCaptureState: .captured(snapshot)),
            advanceToast: nil
        )

        XCTAssertTrue(text.contains("feedback=Manual workspace saved: 2 windows"))
        XCTAssertTrue(text.contains("manual=Manual workspace saved: 2 windows"))
    }

    func testAdvanceToastTakesFeedbackPriority() {
        let text = QueueHarnessStatusText.make(
            queueState: .loaded,
            queueCount: 1,
            selectedTaskId: "task_demo_customer",
            taskSessionCount: 0,
            summary: makeSummary(workspaceRestoreState: .keptCurrentLayout),
            advanceToast: .switchedToPaper(packetId: "qit_demo_metrics")
        )

        XCTAssertTrue(text.contains("feedback=Showing paper: qit_demo_metrics"))
        XCTAssertTrue(text.contains("workspace=Returned without moving windows"))
    }

    private func makeSummary(
        workspaceRestoreState: WorkspaceRestoreState = .idle,
        manualWorkspaceCaptureState: ManualWorkspaceCaptureState = .idle
    ) -> QueueMenuSummary {
        QueueMenuSummary(
            packets: SeededQueue.packets,
            selectedPacket: SeededQueue.packets.first,
            queueState: .loaded,
            mode: .eventLoop,
            contextRestoreState: .idle,
            workspaceRestoreState: workspaceRestoreState,
            manualWorkspaceCaptureState: manualWorkspaceCaptureState
        )
    }
}
