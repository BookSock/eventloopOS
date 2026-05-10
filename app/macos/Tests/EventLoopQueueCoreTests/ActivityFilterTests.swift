import XCTest
@testable import EventLoopQueueCore

final class ActivityFilterTests: XCTestCase {
    private func makeEvent(
        id: String,
        type: String,
        summary: String = "",
        actor: String = "system",
        taskId: String? = nil,
        sourceId: String? = nil
    ) -> ActivityEvent {
        ActivityEvent(
            id: id,
            type: type,
            occurredAt: Date(timeIntervalSince1970: 0),
            actor: actor,
            taskId: taskId,
            sourceId: sourceId,
            summary: summary
        )
    }

    private func sampleEvents() -> [ActivityEvent] {
        [
            makeEvent(id: "1", type: "master_fan_out", summary: "Fan-out to slack agent", taskId: "task-7"),
            makeEvent(id: "2", type: "task_followup_sent", summary: "Sent followup to GitHub PR"),
            makeEvent(id: "3", type: "reading_queue_promoted", summary: "Promoted blog draft", sourceId: "browser-tab-12"),
            makeEvent(id: "4", type: "queue_item_deferred", summary: "Deferred packet"),
            makeEvent(id: "5", type: "queue_item_ignored", summary: "Ignored packet"),
            makeEvent(id: "6", type: "task_followup_failed", summary: "Followup failed: 404"),
            makeEvent(id: "7", type: "voice_rerank_no_match", summary: "No voice match"),
            makeEvent(id: "8", type: "queue_item_done", summary: "Done with packet"),
            makeEvent(id: "9", type: "onboarding_task_approved", summary: "Onboarding row approved"),
        ]
    }

    func testEmptyInputsReturnsEverythingUnderAll() {
        let result = filterActivity(sampleEvents(), chip: .all, search: "")
        XCTAssertEqual(result.map(\.id), ["1", "2", "3", "4", "5", "6", "7", "8", "9"])
    }

    func testNilChipBehavesAsAll() {
        let result = filterActivity(sampleEvents(), chip: nil, search: "")
        XCTAssertEqual(result.count, sampleEvents().count)
    }

    func testSendChipKeepsOnlySendTypes() {
        let result = filterActivity(sampleEvents(), chip: .send, search: "")
        XCTAssertEqual(result.map(\.id), ["1", "2"])
    }

    func testRestoreChipKeepsOnlyRestoreTypes() {
        let result = filterActivity(sampleEvents(), chip: .restore, search: "")
        XCTAssertEqual(result.map(\.id), ["3", "9"])
    }

    func testDeferChipKeepsOnlyDeferTypes() {
        let result = filterActivity(sampleEvents(), chip: .deferOrSkip, search: "")
        XCTAssertEqual(result.map(\.id), ["4", "5"])
    }

    func testErrorsChipKeepsOnlyErrorTypes() {
        let result = filterActivity(sampleEvents(), chip: .errors, search: "")
        XCTAssertEqual(result.map(\.id), ["6", "7"])
    }

    func testSearchOnlyMatchesSummarySubstring() {
        let result = filterActivity(sampleEvents(), chip: .all, search: "blog")
        XCTAssertEqual(result.map(\.id), ["3"])
    }

    func testSearchIsCaseInsensitive() {
        let result = filterActivity(sampleEvents(), chip: .all, search: "FOLLOWUP")
        XCTAssertEqual(result.map(\.id), ["2", "6"])
    }

    func testSearchMatchesEventType() {
        let result = filterActivity(sampleEvents(), chip: .all, search: "queue_item")
        XCTAssertEqual(result.map(\.id), ["4", "5", "8"])
    }

    func testSearchMatchesTaskIdAndSourceId() {
        let byTask = filterActivity(sampleEvents(), chip: .all, search: "task-7")
        XCTAssertEqual(byTask.map(\.id), ["1"])
        let bySource = filterActivity(sampleEvents(), chip: .all, search: "browser-tab-12")
        XCTAssertEqual(bySource.map(\.id), ["3"])
    }

    func testChipAndSearchCombineAsAnd() {
        let result = filterActivity(sampleEvents(), chip: .send, search: "GitHub")
        XCTAssertEqual(result.map(\.id), ["2"])
    }

    func testChipAndSearchYieldEmptyWhenNoOverlap() {
        let result = filterActivity(sampleEvents(), chip: .restore, search: "GitHub")
        XCTAssertEqual(result, [])
    }

    func testWhitespaceOnlySearchIsTreatedAsEmpty() {
        let result = filterActivity(sampleEvents(), chip: .send, search: "   ")
        XCTAssertEqual(result.map(\.id), ["1", "2"])
    }

    func testEmptyEventListReturnsEmpty() {
        XCTAssertEqual(filterActivity([], chip: .all, search: "anything"), [])
    }
}
