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
            advanceToast: nil,
            feedbackSequence: 7
        )

        XCTAssertTrue(text.contains("feedback=ready"))
        XCTAssertTrue(text.contains("feedback_seq=7"))
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

    func testHarnessStatusFilePathUsesArgumentBeforeEnvironment() {
        let path = QueueHarnessStatusFile.statusPath(
            arguments: ["EventLoopQueueApp", "--harness-status-path", "/tmp/from-arg.json"],
            environment: ["EVENTLOOPOS_QUEUE_HARNESS_STATUS_PATH": "/tmp/from-env.json"]
        )

        XCTAssertEqual(path, "/tmp/from-arg.json")
    }

    func testHarnessStatusFileWritesMachineReadableStatus() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("eventloopos-harness-status-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }

        QueueHarnessStatusFile.write(
            "eventloopOS harness status | feedback=Switching papers... | feedback_seq=42",
            feedbackSequence: 42,
            arguments: ["EventLoopQueueApp", "--harness-status-path", url.path],
            environment: [:],
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )

        let data = try Data(contentsOf: url)
        let record = try JSONDecoder().decode(QueueHarnessStatusFileRecord.self, from: data)
        XCTAssertEqual(record.kind, "eventloopos.queue_harness_status")
        XCTAssertEqual(record.feedbackSequence, 42)
        XCTAssertEqual(record.status, "eventloopOS harness status | feedback=Switching papers... | feedback_seq=42")
        XCTAssertFalse(record.updatedAt.isEmpty)
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
