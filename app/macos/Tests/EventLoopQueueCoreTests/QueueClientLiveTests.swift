import XCTest
@testable import EventLoopQueueCore

final class QueueClientLiveTests: XCTestCase {
    func testLiveOrchestratorContextRestoreRequestRoundTrip() async throws {
        guard let urlString = ProcessInfo.processInfo.environment["EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL"],
              let baseURL = URL(string: urlString) else {
            throw XCTSkip("set EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL to run live Mac client smoke")
        }

        let client = HTTPQueueClient(baseURL: baseURL)
        _ = try await client.fetchQueue()

        let resource = ReviewContextResource(
            id: "ctx_macos_live_smoke",
            kind: "browser_tab",
            title: "Mac client live smoke",
            url: "https://example.test/macos-live-smoke",
            source: "macos-live-smoke",
            restoreConfidence: "high",
            scrollY: 123,
            textQuote: "Mac client live smoke"
        )
        let idempotencyKey = "macos_live_smoke_\(UUID().uuidString)"

        let requested = try await client.requestContextRestore(resource: resource, idempotencyKey: idempotencyKey)
        let fetched = try await client.contextRestoreRequest(id: requested.id)

        XCTAssertEqual(requested.status, "pending")
        XCTAssertEqual(fetched.id, requested.id)
        XCTAssertEqual(fetched.resource.title, "Mac client live smoke")
        XCTAssertEqual(fetched.restorePlan.kind, "browser_extension_message")
    }
}
