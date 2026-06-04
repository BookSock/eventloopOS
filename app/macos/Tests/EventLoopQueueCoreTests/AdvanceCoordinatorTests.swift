import XCTest
@testable import EventLoopQueueCore

final class AdvanceCoordinatorTests: XCTestCase {
    func testManualModeYieldsToast() {
        let snapshot = makeSnapshot(manualModeActive: true)
        XCTAssertEqual(AdvanceCoordinator.nextAction(snapshot: snapshot), .toastManualModeActive)
    }

    func testLimboWithCodexThreadCreatesCodexAnchorTask() {
        let snapshot = makeSnapshot(
            currentWorkspaceId: "limbo",
            foreground: AdvanceForegroundContext(codexThreadId: "thr_abc", ghosttyWindowId: "ghost-abc")
        )
        XCTAssertEqual(
            AdvanceCoordinator.nextAction(snapshot: snapshot),
            .createTaskFromForeground(
                anchor: TaskAnchor(kind: .codexThread, id: "thr_abc"),
                workspaceId: "limbo",
                terminalRef: "ghostty:win-ghost-abc"
            )
        )
    }

    func testLimboWithGhosttyOnlyCreatesGhosttyAnchorTask() {
        let snapshot = makeSnapshot(
            currentWorkspaceId: "1",
            foreground: AdvanceForegroundContext(ghosttyWindowId: "front-id")
        )
        XCTAssertEqual(
            AdvanceCoordinator.nextAction(snapshot: snapshot),
            .createTaskFromForeground(
                anchor: TaskAnchor(kind: .ghosttyWindow, id: "front-id"),
                workspaceId: "1",
                terminalRef: "ghostty:win-front-id"
            )
        )
    }

    func testLimboWithoutForegroundCodexToastsHelp() {
        let snapshot = makeSnapshot(
            currentWorkspaceId: "1",
            foreground: .none
        )
        XCTAssertEqual(AdvanceCoordinator.nextAction(snapshot: snapshot), .toastNoForegroundCodex)
    }

    func testStateBWithEmptyQueueEntersLimbo() {
        let task = makeTask(taskId: "task_a")
        let snapshot = makeSnapshot(
            currentWorkspaceId: "ws_a",
            currentTask: task,
            tasksByWorkspace: ["ws_a": task]
        )
        XCTAssertEqual(
            AdvanceCoordinator.nextAction(snapshot: snapshot),
            .saveLayoutAndEnterLimbo(currentTaskId: "task_a", limboWorkspaceId: "limbo")
        )
    }

    func testStateBWithPaperOnSiblingTaskSwitchesToSiblingDesktop() {
        let taskA = makeTask(taskId: "task_a")
        let taskB = makeTask(taskId: "task_b")
        let paper = makePacket(id: "pkt_for_b", taskId: "task_b")
        let snapshot = makeSnapshot(
            currentWorkspaceId: "ws_a",
            currentTask: taskA,
            queue: [paper],
            tasksByWorkspace: ["ws_a": taskA, "ws_b": taskB]
        )
        XCTAssertEqual(
            AdvanceCoordinator.nextAction(snapshot: snapshot),
            .saveLayoutAndPullPaper(
                currentTaskId: "task_a",
                nextPacketId: "pkt_for_b",
                nextWorkspaceId: "ws_b"
            )
        )
    }

    func testStateCWithRemainingPaperSwitchesToNext() {
        let taskA = makeTask(taskId: "task_a")
        let taskB = makeTask(taskId: "task_b")
        let openPaper = makePacket(id: "pkt_open", taskId: "task_a")
        let nextPaper = makePacket(id: "pkt_next", taskId: "task_b")
        let snapshot = makeSnapshot(
            currentWorkspaceId: "ws_a",
            currentTask: taskA,
            queue: [openPaper, nextPaper],
            tasksByWorkspace: ["ws_a": taskA, "ws_b": taskB]
        )
        XCTAssertEqual(
            AdvanceCoordinator.nextAction(snapshot: snapshot),
            .markPaperDoneAndPullNext(
                packetId: "pkt_open",
                nextPacketId: "pkt_next",
                nextWorkspaceId: "ws_b"
            )
        )
    }

    func testStateCWithNoMorePapersReturnsToTaskDesktop() {
        let taskA = makeTask(taskId: "task_a")
        let openPaper = makePacket(id: "pkt_only", taskId: "task_a")
        let snapshot = makeSnapshot(
            currentWorkspaceId: "ws_a",
            currentTask: taskA,
            queue: [openPaper],
            tasksByWorkspace: ["ws_a": taskA]
        )
        XCTAssertEqual(
            AdvanceCoordinator.nextAction(snapshot: snapshot),
            .markPaperDoneAndReturnToTask(
                packetId: "pkt_only",
                taskId: "task_a",
                taskWorkspaceId: "ws_a"
            )
        )
    }

    func testStateCFallsBackToLimboWhenTaskHasNoWorkspace() {
        let taskA = makeTask(taskId: "task_a")
        let openPaper = makePacket(id: "pkt_only", taskId: "task_a")
        let snapshot = makeSnapshot(
            currentWorkspaceId: nil,
            currentTask: taskA,
            queue: [openPaper],
            tasksByWorkspace: [:]
        )
        XCTAssertEqual(
            AdvanceCoordinator.nextAction(snapshot: snapshot),
            .markPaperDoneAndEnterLimbo(packetId: "pkt_only", limboWorkspaceId: "limbo")
        )
    }

    private func makeSnapshot(
        manualModeActive: Bool = false,
        currentWorkspaceId: String? = "1",
        currentTask: TaskRecord? = nil,
        queue: [ReviewPacket] = [],
        tasksByWorkspace: [String: TaskRecord] = [:],
        foreground: AdvanceForegroundContext = .none,
        limboWorkspaceId: String = "limbo"
    ) -> AdvanceServerSnapshot {
        AdvanceServerSnapshot(
            manualModeActive: manualModeActive,
            currentWorkspaceId: currentWorkspaceId,
            currentTask: currentTask,
            queue: queue,
            tasksByWorkspace: tasksByWorkspace,
            foreground: foreground,
            limboWorkspaceId: limboWorkspaceId
        )
    }

    private func makeTask(taskId: String) -> TaskRecord {
        TaskRecord(
            taskId: taskId,
            primaryAnchorKind: .codexThread,
            primaryAnchorId: "thr_\(taskId)",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makePacket(id: String, taskId: String) -> ReviewPacket {
        ReviewPacket(
            id: id,
            taskId: taskId,
            title: "Paper \(id)",
            summary: "Summary",
            source: "test",
            priority: 100,
            recommendedAction: "Done / Next",
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }
}
