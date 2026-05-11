import XCTest
@testable import EventLoopQueueCore

final class QueueMenuSummaryTests: XCTestCase {
    func testSummaryShowsEmptyQueueAndMode() {
        let summary = QueueMenuSummary(
            packets: [],
            selectedPacket: nil,
            queueState: .loaded,
            mode: .eventLoop,
            contextRestoreState: .idle
        )

        XCTAssertEqual(summary.title, "No queued work")
        XCTAssertEqual(summary.subtitle, "No selection")
        XCTAssertEqual(summary.modeLabel, "Event Loop")
        XCTAssertNil(summary.restoreLabel)
    }

    func testSummaryShowsSelectedPacketAndManualMode() {
        let packet = SeededQueue.packets[0]
        let summary = QueueMenuSummary(
            packets: SeededQueue.packets,
            selectedPacket: packet,
            queueState: .loaded,
            mode: .manual,
            contextRestoreState: .idle
        )

        XCTAssertEqual(summary.title, "3 queued items")
        XCTAssertEqual(summary.subtitle, packet.title)
        XCTAssertEqual(summary.modeLabel, "Manual Mode")
    }

    func testSummaryShowsRestoreStatus() {
        let resource = ReviewContextResource(
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            restoreConfidence: "high"
        )
        let request = ContextRestoreRequest(
            id: "ctx_restore_123",
            status: "leased",
            resource: resource,
            restorePlan: ContextRestorePlan(
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
        )

        let summary = QueueMenuSummary(
            packets: SeededQueue.packets,
            selectedPacket: SeededQueue.packets[0],
            queueState: .loaded,
            mode: .eventLoop,
            contextRestoreState: .requested(resource, request)
        )

        XCTAssertEqual(summary.restoreLabel, "Restore leased: Launch doc")
    }

    func testSummaryShowsManualWorkspaceCaptureStatus() {
        let snapshot = WorkspaceSnapshot(
            windows: [
                WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog"),
                WorkspaceWindow(id: 10, app: "Google Chrome", title: "Launch doc", workspace: "eventloop-blog")
            ]
        )
        let summary = QueueMenuSummary(
            packets: SeededQueue.packets,
            selectedPacket: SeededQueue.packets[0],
            queueState: .loaded,
            mode: .manual,
            contextRestoreState: .idle,
            manualWorkspaceCaptureState: .captured(snapshot)
        )

        XCTAssertEqual(summary.manualWorkspaceLabel, "Manual workspace saved: 2 windows")
    }

    func testSummaryShowsManualWorkspaceRestoreStatus() {
        let receipt = WorkspaceRestoreReceipt(
            commands: [
                WorkspaceExecutedCommand(command: "aerospace", args: ["workspace", "eventloop-blog"]),
                WorkspaceExecutedCommand(command: "open", args: ["-a", "Ghostty"])
            ],
            skipped: []
        )
        let summary = QueueMenuSummary(
            packets: SeededQueue.packets,
            selectedPacket: SeededQueue.packets[0],
            queueState: .loaded,
            mode: .manual,
            contextRestoreState: .idle,
            workspaceRestoreState: .executed(receipt)
        )

        XCTAssertEqual(summary.workspaceRestoreLabel, "Workspace restored: 2 commands")
    }

    func testSummaryShowsReturnedHereStatus() {
        let summary = QueueMenuSummary(
            packets: SeededQueue.packets,
            selectedPacket: SeededQueue.packets[0],
            queueState: .loaded,
            mode: .eventLoop,
            contextRestoreState: .idle,
            workspaceRestoreState: .keptCurrentLayout
        )

        XCTAssertEqual(summary.workspaceRestoreLabel, "Returned without moving windows")
    }

    func testSummaryShowsRecommendedActionBlockReason() {
        let summary = QueueMenuSummary(
            packets: SeededQueue.packets,
            selectedPacket: SeededQueue.packets[0],
            queueState: .loaded,
            mode: .eventLoop,
            contextRestoreState: .idle,
            recommendedActionBlockReason: "Bind a task session to task_blog_feedback before resuming agent"
        )

        XCTAssertEqual(
            summary.recommendedActionBlockReason,
            "Bind a task session to task_blog_feedback before resuming agent"
        )
    }
}
