import XCTest
@testable import EventLoopQueueCore

final class QueueClientTests: XCTestCase {
    func testFakeQueueClientLoadsSeededPacketsFromFixtureJSON() async throws {
        let packets = try loadFixturePackets()
        let client = FakeQueueClient(packets: packets)

        let loaded = try await client.fetchQueue()

        XCTAssertEqual(loaded.map(\.id), ["qit_blog_feedback", "qit_ci_failed"])
        XCTAssertEqual(loaded.first?.reviewPacketId, "packet-blog-feedback")
        XCTAssertEqual(loaded.first?.priority, 90)
        XCTAssertEqual(loaded.first?.decisionNeeded, "Choose whether launch positioning should lead with speed or reliability.")
        XCTAssertEqual(loaded.first?.riskLevel, "medium")
        XCTAssertEqual(loaded.first?.confidence, "high")
        XCTAssertEqual(loaded.first?.riskTags, ["external_send", "brand_voice"])
        XCTAssertEqual(loaded.first?.contextResources.first?.title, "Blog feedback thread")
        XCTAssertEqual(loaded.first?.contextResources.first?.restoreConfidence, "high")
        XCTAssertEqual(loaded.first?.evidence.first?.title, "Malis feedback in launch thread")
        XCTAssertEqual(loaded.first?.workspaceSnapshot?.backend, "aerospace")
        XCTAssertEqual(loaded.first?.workspaceSnapshot?.activeWorkspace, "eventloop-blog")
        XCTAssertEqual(loaded.first?.workspaceSnapshot?.windows.first?.title, "codex")
        XCTAssertNil(loaded.last?.workspaceSnapshot)
    }

    func testFakeQueueClientCompletesPacketAndReturnsNext() async throws {
        let client = FakeQueueClient(packets: try loadFixturePackets())

        let result = try await client.complete(packetId: "qit_blog_feedback")
        let remaining = try await client.fetchQueue()

        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.completedPacketId, "qit_blog_feedback")
        XCTAssertEqual(result.nextPacket?.id, "qit_ci_failed")
        XCTAssertEqual(remaining.map(\.id), ["qit_ci_failed"])
        XCTAssertEqual(client.completedPacketIds, ["qit_blog_feedback"])
    }

    func testFakeQueueClientRenewsSelectedPacketLease() async throws {
        let client = FakeQueueClient(packets: try loadFixturePackets())

        _ = try await client.next(after: nil)
        let result = try await client.renewLease(packetId: "qit_blog_feedback")

        XCTAssertTrue(result.ok)
        XCTAssertNil(result.completedPacketId)
        XCTAssertEqual(result.nextPacket?.id, "qit_blog_feedback")
    }

    func testFakeQueueClientRejectsRenewalBeforeLease() async throws {
        let client = FakeQueueClient(packets: try loadFixturePackets())

        do {
            _ = try await client.renewLease(packetId: "qit_blog_feedback")
            XCTFail("expected unleased renew to fail")
        } catch QueueClientError.httpStatus(409) {
            XCTAssertEqual(client.renewedPacketIds, [])
        }
    }

    func testConfigurationUsesFakeClientInTestMode() {
        let config = QueueAppConfiguration.parse(arguments: ["EventLoopQueueApp", "--test-mode"], environment: [:])

        XCTAssertEqual(config.clientMode, .fake)
    }

    func testConfigurationUsesExplicitOrchestratorURL() {
        let config = QueueAppConfiguration.parse(
            arguments: ["EventLoopQueueApp", "--orchestrator-url", "http://127.0.0.1:9999"],
            environment: [:]
        )

        XCTAssertEqual(config.clientMode, .http(URL(string: "http://127.0.0.1:9999")!))
    }

    func testWorkspaceStatusEnvelopeDecodesExecuteFlag() throws {
        let data = """
        {
          "status": {
            "available": false,
            "backend": "aerospace",
            "reason": "server_unavailable",
            "detail": "AeroSpace app is not running"
          },
          "execute_supported": false
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(WorkspaceStatusEnvelope.self, from: data)

        XCTAssertEqual(envelope.status.available, false)
        XCTAssertEqual(envelope.status.backend, "aerospace")
        XCTAssertEqual(envelope.status.reason, "server_unavailable")
        XCTAssertEqual(envelope.executeSupported, false)
    }

    func testWorkspaceRestoreExecutionEnvelopeDecodesReceipt() throws {
        let data = """
        {
          "ok": true,
          "plan": {
            "commands": [{ "command": "aerospace", "args": ["workspace", "eventloop-blog"] }],
            "skipped": []
          },
          "receipt": {
            "commands": [{ "command": "aerospace", "args": ["workspace", "eventloop-blog"], "stdout": "ok" }],
            "skipped": []
          },
          "execute_supported": true,
          "idempotency_key": "idem_workspace_restore"
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(WorkspaceRestoreExecutionEnvelope.self, from: data)

        XCTAssertTrue(envelope.ok)
        XCTAssertEqual(envelope.plan.commands.first?.args, ["workspace", "eventloop-blog"])
        XCTAssertEqual(envelope.receipt.commands.first?.stdout, "ok")
        XCTAssertEqual(envelope.idempotencyKey, "idem_workspace_restore")
    }

    func testContextRestorePlanEnvelopeDecodesBrowserExtensionMessage() throws {
        let data = """
        {
          "restore_plan": {
            "kind": "browser_extension_message",
            "side_effect": "local",
            "execute_supported": false,
            "target": "eventloopOS browser extension runtime",
            "message": {
              "type": "eventloop.restore",
              "resource": {
                "id": "ctx_browser_123",
                "kind": "browser_tab",
                "title": "Launch doc",
                "url": "https://example.test/launch",
                "source": "chrome-extension",
                "restore_confidence": "high"
              }
            }
          }
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(ContextRestorePlanEnvelope.self, from: data)

        XCTAssertEqual(envelope.restorePlan.kind, "browser_extension_message")
        XCTAssertEqual(envelope.restorePlan.sideEffect, "local")
        XCTAssertEqual(envelope.restorePlan.executeSupported, false)
        XCTAssertEqual(envelope.restorePlan.message?.type, "eventloop.restore")
        XCTAssertEqual(envelope.restorePlan.message?.resource.restoreConfidence, "high")
    }

    func testContextRestorePlanRequestEncodesSnakeCaseResourceFields() throws {
        let resource = ReviewContextResource(
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            source: "chrome-extension",
            restoreConfidence: "high"
        )

        let data = try QueueCoders.makeEncoder().encode(resource)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(json?["restore_confidence"] as? String, "high")
        XCTAssertNil(json?["restoreConfidence"])
    }

    private func loadFixturePackets() throws -> [ReviewPacket] {
        let url = Bundle.module.url(forResource: "fake_orchestrator_queue", withExtension: "json")!
        let data = try Data(contentsOf: url)
        return try QueueCoders.makeDecoder().decode(QueueEnvelope.self, from: data).packets
    }
}
