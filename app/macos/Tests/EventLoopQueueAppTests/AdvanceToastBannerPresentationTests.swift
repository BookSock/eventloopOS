import EventLoopQueueCore
import XCTest
@testable import EventLoopQueueApp

final class AdvanceToastBannerPresentationTests: XCTestCase {
    func testRepeatedSameToastHasVisiblePulseDelta() {
        let first = AdvanceToastBannerPresentation.make(
            toast: .actionComplete("Queue paused. Try again."),
            queueCount: 1,
            feedbackSequence: 2
        )
        let second = AdvanceToastBannerPresentation.make(
            toast: .actionComplete("Queue paused. Try again."),
            queueCount: 1,
            feedbackSequence: 3
        )

        XCTAssertEqual(first.message, second.message)
        XCTAssertEqual(first.icon, second.icon)
        XCTAssertNotEqual(first.pulseOpacity, second.pulseOpacity)
    }

    func testDeferredMessageReflectsQueueState() {
        let dueAt = Date(timeIntervalSince1970: 1_767_040_000)
        let empty = AdvanceToastBannerPresentation.make(
            toast: .deferredUntil(dueAt),
            queueCount: 0,
            feedbackSequence: 1
        )
        let nextReady = AdvanceToastBannerPresentation.make(
            toast: .deferredUntil(dueAt),
            queueCount: 2,
            feedbackSequence: 1
        )

        XCTAssertTrue(empty.message.contains("Queue empty."))
        XCTAssertTrue(nextReady.message.contains("Next paper ready."))
        XCTAssertEqual(empty.icon, "clock.fill")
        XCTAssertEqual(empty.foregroundRole, .success)
    }

    func testManualModeUsesWarningRole() {
        let presentation = AdvanceToastBannerPresentation.make(
            toast: .manualModeActive,
            queueCount: 1,
            feedbackSequence: 1
        )

        XCTAssertEqual(presentation.icon, "pause.circle.fill")
        XCTAssertEqual(presentation.foregroundRole, .warning)
    }
}
