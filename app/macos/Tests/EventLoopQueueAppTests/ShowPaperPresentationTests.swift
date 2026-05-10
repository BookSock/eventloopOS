import EventLoopQueueCore
import XCTest
@testable import EventLoopQueueApp

@MainActor
final class ShowPaperPresentationTests: XCTestCase {
    func testShouldPresentReturnsTrueForPlannedShowPaperPlan() {
        let resource = ReviewContextResource(
            id: "ctx_paper_1",
            kind: "paper",
            title: "Quick note"
        )
        let plan = ContextRestorePlan(
            kind: "show_paper",
            sideEffect: "local",
            executeSupported: false,
            target: nil,
            message: nil,
            url: nil,
            path: nil,
            line: nil,
            column: nil,
            paper: ContextRestorePaper(
                title: "Quick note",
                sourceKind: "note",
                bodyMarkdown: "Decide whether to bump pricing for Q3."
            )
        )
        let state: ContextRestoreState = .planned(resource, plan)

        XCTAssertTrue(ShowPaperPresentation.shouldPresent(for: state))
        XCTAssertEqual(ShowPaperPresentation.paper(from: state)?.bodyMarkdown, "Decide whether to bump pricing for Q3.")
    }

    func testShouldPresentReturnsFalseForOpenUrlPlan() {
        let resource = ReviewContextResource(id: "ctx_url_1", kind: "browser_tab", title: "Doc")
        let plan = ContextRestorePlan(
            kind: "open_url",
            sideEffect: "local",
            executeSupported: false,
            target: nil,
            message: nil,
            url: "https://example.test",
            path: nil,
            line: nil,
            column: nil
        )
        let state: ContextRestoreState = .planned(resource, plan)

        XCTAssertFalse(ShowPaperPresentation.shouldPresent(for: state))
        XCTAssertNil(ShowPaperPresentation.paper(from: state))
    }
}
