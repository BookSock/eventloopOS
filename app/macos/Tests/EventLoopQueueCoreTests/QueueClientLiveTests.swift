import XCTest
@testable import EventLoopQueueCore

final class QueueClientLiveTests: XCTestCase {
    func testLiveOrchestratorContextRestoreRequestRoundTrip() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let urlString = environment["EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL"],
              let baseURL = URL(string: urlString) else {
            throw XCTSkip("set EVENTLOOPOS_MACOS_LIVE_ORCHESTRATOR_URL to run live Mac client smoke")
        }

        let client = HTTPQueueClient(baseURL: baseURL)
        _ = try await client.fetchQueue()

        let resourceURL = environment["EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_URL"] ?? "https://example.test/macos-live-smoke"
        let resourceTitle = environment["EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_TITLE"] ?? "Mac client live smoke"
        let resourceQuote = environment["EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_QUOTE"] ?? "Mac client live smoke"
        let resourceScrollY = Int(environment["EVENTLOOPOS_MACOS_LIVE_RESTORE_RESOURCE_SCROLL_Y"] ?? "123") ?? 123

        let resource = ReviewContextResource(
            id: "ctx_macos_live_smoke",
            kind: "browser_tab",
            title: resourceTitle,
            url: resourceURL,
            source: "macos-live-smoke",
            restoreConfidence: "high",
            scrollY: resourceScrollY,
            textQuote: resourceQuote
        )
        let idempotencyKey = "macos_live_smoke_\(UUID().uuidString)"

        let requested = try await client.requestContextRestore(resource: resource, idempotencyKey: idempotencyKey)
        let fetched = try await client.contextRestoreRequest(id: requested.id)

        XCTAssertEqual(requested.status, "pending")
        XCTAssertEqual(fetched.id, requested.id)
        XCTAssertEqual(fetched.resource.title, resourceTitle)
        XCTAssertEqual(fetched.restorePlan.kind, "browser_extension_message")

        if let outputPath = environment["EVENTLOOPOS_MACOS_LIVE_RESTORE_REQUEST_ID_FILE"] {
            try requested.id.write(to: URL(fileURLWithPath: outputPath), atomically: true, encoding: .utf8)
        }
    }
}
