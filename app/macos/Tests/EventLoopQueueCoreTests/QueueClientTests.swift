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
        let browserResource = try XCTUnwrap(loaded.first?.contextResources.first { $0.id == "ctx_browser_launch_doc" })
        XCTAssertEqual(browserResource.windowId, "1")
        XCTAssertEqual(browserResource.tabId, "7")
        XCTAssertEqual(browserResource.scrollY, 120)
        XCTAssertEqual(browserResource.textQuote, "Launch pricing note needs review later")
        XCTAssertEqual(browserResource.selectorHint, "[data-context-quote]")
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
                "restore_confidence": "high",
                "window_id": "1",
                "tab_id": "7",
                "scroll_y": 120,
                "text_quote": "Launch pricing note needs review later",
                "selector_hint": "[data-context-quote]"
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
        XCTAssertEqual(envelope.restorePlan.message?.resource.windowId, "1")
        XCTAssertEqual(envelope.restorePlan.message?.resource.tabId, "7")
        XCTAssertEqual(envelope.restorePlan.message?.resource.scrollY, 120)
        XCTAssertEqual(envelope.restorePlan.message?.resource.textQuote, "Launch pricing note needs review later")
        XCTAssertEqual(envelope.restorePlan.message?.resource.selectorHint, "[data-context-quote]")
    }

    func testContextRestoreRequestEnvelopeDecodesPendingBrowserRequest() throws {
        let data = """
        {
          "restore_request": {
            "id": "ctx_restore_123",
            "status": "pending",
            "resource": {
              "id": "ctx_browser_123",
              "kind": "browser_tab",
              "title": "Launch doc",
              "url": "https://example.test/launch",
              "restore_confidence": "high"
            },
            "result": {
              "ok": true,
              "tabId": 7,
              "url": "https://example.test/launch",
              "restoredScroll": true
            },
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
                  "restore_confidence": "high"
                }
              }
            }
          }
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(ContextRestoreRequestEnvelope.self, from: data)

        XCTAssertEqual(envelope.restoreRequest.id, "ctx_restore_123")
        XCTAssertEqual(envelope.restoreRequest.status, "pending")
        XCTAssertEqual(envelope.restoreRequest.resource.id, "ctx_browser_123")
        XCTAssertEqual(envelope.restoreRequest.restorePlan.kind, "browser_extension_message")
        XCTAssertEqual(envelope.restoreRequest.restorePlan.message?.type, "eventloop.restore")
        XCTAssertEqual(envelope.restoreRequest.result?.ok, true)
        XCTAssertEqual(envelope.restoreRequest.result?.tabId, 7)
        XCTAssertEqual(envelope.restoreRequest.result?.url, "https://example.test/launch")
        XCTAssertEqual(envelope.restoreRequest.result?.restoredScroll, true)
    }

    func testContextResourceEncodesSnakeCaseRestoreFields() throws {
        let resource = ReviewContextResource(
            id: "ctx_browser_123",
            kind: "browser_tab",
            title: "Launch doc",
            url: "https://example.test/launch",
            source: "chrome-extension",
            restoreConfidence: "high",
            windowId: "1",
            tabId: "7",
            scrollY: 120,
            textQuote: "Launch pricing note needs review later",
            selectorHint: "[data-context-quote]"
        )

        let data = try QueueCoders.makeEncoder().encode(resource)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(json?["restore_confidence"] as? String, "high")
        XCTAssertEqual(json?["window_id"] as? String, "1")
        XCTAssertEqual(json?["tab_id"] as? String, "7")
        XCTAssertEqual(json?["scroll_y"] as? Int, 120)
        XCTAssertEqual(json?["text_quote"] as? String, "Launch pricing note needs review later")
        XCTAssertEqual(json?["selector_hint"] as? String, "[data-context-quote]")
        XCTAssertNil(json?["restoreConfidence"])
        XCTAssertNil(json?["windowId"])
        XCTAssertNil(json?["tabId"])
        XCTAssertNil(json?["scrollY"])
        XCTAssertNil(json?["textQuote"])
        XCTAssertNil(json?["selectorHint"])
    }

    private func loadFixturePackets() throws -> [ReviewPacket] {
        let url = Bundle.module.url(forResource: "fake_orchestrator_queue", withExtension: "json")!
        let data = try Data(contentsOf: url)
        return try QueueCoders.makeDecoder().decode(QueueEnvelope.self, from: data).packets
    }
}
