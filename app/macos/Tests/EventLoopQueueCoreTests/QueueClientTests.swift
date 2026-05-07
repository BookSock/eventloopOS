import XCTest
@testable import EventLoopQueueCore

final class QueueClientTests: XCTestCase {
    func testFakeQueueClientLoadsSeededPacketsFromFixtureJSON() async throws {
        let packets = try loadFixturePackets()
        let client = FakeQueueClient(packets: packets)

        let loaded = try await client.fetchQueue()

        XCTAssertEqual(loaded.map(\.id), ["qit_blog_feedback", "qit_ci_failed"])
        XCTAssertEqual(loaded.first?.reviewPacketId, "packet-blog-feedback")
        XCTAssertEqual(loaded.first?.taskId, "task_blog_feedback")
        XCTAssertEqual(loaded.first?.priority, 90)
        XCTAssertEqual(loaded.first?.decisionNeeded, "Choose whether launch positioning should lead with speed or reliability.")
        XCTAssertEqual(loaded.first?.riskLevel, "medium")
        XCTAssertEqual(loaded.first?.confidence, "high")
        XCTAssertEqual(loaded.first?.riskTags, ["external_send", "brand_voice"])
        XCTAssertEqual(loaded.first?.contextResources.first?.title, "Blog feedback thread")
        XCTAssertEqual(loaded.first?.contextResources.first?.restoreConfidence, "high")
        XCTAssertEqual(loaded.first?.contextResources.first?.details?.provider, "slack")
        XCTAssertEqual(loaded.first?.contextResources.first?.details?.confidenceReason, "slack_permalink")
        let browserResource = try XCTUnwrap(loaded.first?.contextResources.first { $0.id == "ctx_browser_launch_doc" })
        XCTAssertEqual(browserResource.windowId, "1")
        XCTAssertEqual(browserResource.tabId, "7")
        XCTAssertEqual(browserResource.scrollY, 120)
        XCTAssertEqual(browserResource.textQuote, "Launch pricing note needs review later")
        XCTAssertEqual(browserResource.selectorHint, "[data-context-quote]")
        XCTAssertEqual(browserResource.details?.confidenceReason, "browser_quote_fallback")
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

    func testFakeQueueClientDefersPacketAndReturnsNext() async throws {
        let client = FakeQueueClient(packets: try loadFixturePackets())
        let dueAt = Date(timeIntervalSince1970: 1_778_074_500)

        let result = try await client.deferPacket(packetId: "qit_blog_feedback", until: dueAt)
        let remaining = try await client.fetchQueue()

        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.completedPacketId, "qit_blog_feedback")
        XCTAssertEqual(result.nextPacket?.id, "qit_ci_failed")
        XCTAssertEqual(remaining.map(\.id), ["qit_ci_failed"])
        XCTAssertEqual(client.deferredPacketIds, ["qit_blog_feedback"])
        XCTAssertEqual(client.deferredPacketDueAts["qit_blog_feedback"], dueAt)
    }

    func testFakeQueueClientIgnoresPacketAndReturnsNext() async throws {
        let client = FakeQueueClient(packets: try loadFixturePackets())

        let result = try await client.ignorePacket(packetId: "qit_blog_feedback")
        let remaining = try await client.fetchQueue()

        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.completedPacketId, "qit_blog_feedback")
        XCTAssertEqual(result.nextPacket?.id, "qit_ci_failed")
        XCTAssertEqual(remaining.map(\.id), ["qit_ci_failed"])
        XCTAssertEqual(client.ignoredPacketIds, ["qit_blog_feedback"])
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

    func testWorkspaceCaptureEnvelopeDecodesSnapshot() throws {
        let data = """
        {
          "snapshot": {
            "backend": "aerospace",
            "windows": [
              { "id": 9, "app": "Ghostty", "title": "codex", "workspace": "eventloop-blog" }
            ],
            "activeWorkspace": "eventloop-blog",
            "focusedWindowId": 9
          }
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(WorkspaceCaptureEnvelope.self, from: data)

        XCTAssertEqual(envelope.snapshot.backend, "aerospace")
        XCTAssertEqual(envelope.snapshot.windows.first?.app, "Ghostty")
        XCTAssertEqual(envelope.snapshot.activeWorkspace, "eventloop-blog")
        XCTAssertEqual(envelope.snapshot.focusedWindowId, 9)
    }

    func testTaskSessionsEnvelopeDecodesSessions() throws {
        let data = """
        {
          "sessions": [
            {
              "id": "codex_thread_abc",
              "task_id": "task_blog_feedback",
              "provider": "codex",
              "status": "idle",
              "name": "Blog feedback",
              "preview": "Draft thread",
              "cwd": "/repo"
            }
          ],
          "count": 1
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(TaskSessionsEnvelope.self, from: data)

        XCTAssertEqual(envelope.sessions.first?.id, "codex_thread_abc")
        XCTAssertEqual(envelope.sessions.first?.taskId, "task_blog_feedback")
        XCTAssertEqual(envelope.sessions.first?.provider, "codex")
        XCTAssertEqual(envelope.sessions.first?.preview, "Draft thread")
    }

    func testTaskBindingEnvelopeDecodesBinding() throws {
        let data = """
        {
          "ok": true,
          "binding": {
            "ok": true,
            "task_session_id": "codex_thread_abc",
            "task_id": "task_blog_feedback",
            "native_thread_id": "thread_abc",
            "session": {
              "id": "codex_thread_abc",
              "task_id": "task_blog_feedback",
              "provider": "codex",
              "status": "running"
            }
          }
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(TaskBindingEnvelope.self, from: data)

        XCTAssertTrue(envelope.ok)
        XCTAssertEqual(envelope.binding.taskSessionId, "codex_thread_abc")
        XCTAssertEqual(envelope.binding.taskId, "task_blog_feedback")
        XCTAssertEqual(envelope.binding.nativeThreadId, "thread_abc")
        XCTAssertEqual(envelope.binding.session?.status, "running")
    }

    func testQueueLineageEnvelopeDecodesServerShapeWithoutRawTaskText() throws {
        let data = """
        {
          "lineage": {
            "queue_item": {
              "id": "qit_blog_feedback",
              "task_id": "task_blog_feedback",
              "state": "ready",
              "priority_score": 90,
              "created_at": "2026-05-06T12:00:00Z",
              "updated_at": "2026-05-06T12:01:00Z"
            },
            "related_event_ids": ["evt_review_1"],
            "events": [
              {
                "id": "evt_review_1",
                "source": "slack",
                "source_id": "slack:launch",
                "idempotency_key": "idem_evt_review_1",
                "occurred_at": "2026-05-06T12:00:00Z",
                "received_at": "2026-05-06T12:00:01Z",
                "actor": {"id": "u1", "type": "human"},
                "type": "slack_message",
                "title": "Launch feedback",
                "summary": "Blog needs launch details.",
                "raw_ref": {"id": "m1", "uri": "slack://m1", "media_type": "application/json"},
                "links": [],
                "resources": [],
                "task_hint": "task_blog_feedback"
              }
            ],
            "activity": [
              {
                "id": "actv_1",
                "type": "task_followup_sent",
                "occurred_at": "2026-05-06T12:05:00Z",
                "actor": "agent",
                "queue_item_id": "qit_blog_feedback",
                "event_id": "evt_review_1",
                "task_session_id": "task_session_blog",
                "status": "ok",
                "summary": "Task followup sent",
                "details": {}
              }
            ],
            "task_messages": [
              {
                "id": "task_msg_1",
                "durable_id": "task_msg_durable_1",
                "task_session_id": "task_session_blog",
                "origin": "queue_action",
                "status": "sent",
                "event_ids": ["evt_review_1"],
                "text_hash": "abc",
                "text_length": 42
              }
            ],
            "counts": {"events": 1, "activity": 1, "task_messages": 1}
          },
          "request_id": "req_1"
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(QueueLineageEnvelope.self, from: data)

        XCTAssertEqual(envelope.lineage.queueItem?.id, "qit_blog_feedback")
        XCTAssertEqual(envelope.lineage.queueItem?.state, "ready")
        XCTAssertEqual(envelope.lineage.relatedEventIds, ["evt_review_1"])
        XCTAssertEqual(envelope.lineage.events.first?.title, "Launch feedback")
        XCTAssertEqual(envelope.lineage.activity.first?.taskSessionId, "task_session_blog")
        XCTAssertEqual(envelope.lineage.taskMessages.first?.textLength, 42)
        XCTAssertEqual(envelope.lineage.counts.taskMessages, 1)
    }

    func testHTTPQueueClientFetchesQueueLineage() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/queue/qit_blog_feedback/lineage?limit=10")
            return """
            {
              "lineage": {
                "queue_item": {"id": "qit_blog_feedback", "state": "ready"},
                "related_event_ids": ["evt_review_1"],
                "events": [],
                "activity": [],
                "task_messages": [
                  {
                    "id": "task_msg_1",
                    "durable_id": "task_msg_durable_1",
                    "task_session_id": "task_session_blog",
                    "origin": "queue_action",
                    "status": "sent",
                    "event_ids": ["evt_review_1"],
                    "text_hash": "abc",
                    "text_length": 42
                  }
                ],
                "counts": {"events": 1, "activity": 0, "task_messages": 1}
              }
            }
            """
        }

        let lineage = try await client.fetchQueueLineage(packetId: "qit_blog_feedback", limit: 10)

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(lineage.queueItem?.id, "qit_blog_feedback")
        XCTAssertEqual(lineage.taskMessages.first?.textHash, "abc")
        XCTAssertEqual(lineage.counts.taskMessages, 1)
    }

    func testHTTPQueueClientFetchesTaskSessions() async throws {
        let (client, recorder) = makeHTTPClient { _ in
            """
            {
              "sessions": [
                {
                  "id": "task_session_blog",
                  "task_id": "task_blog_feedback",
                  "provider": "fake",
                  "status": "idle"
                }
              ],
              "count": 1
            }
            """
        }

        let sessions = try await client.fetchTaskSessions()

        XCTAssertEqual(recorder.requests.first?.url?.absoluteString, "http://127.0.0.1:4377/task-sessions")
        XCTAssertEqual(sessions.map(\.id), ["task_session_blog"])
        XCTAssertEqual(sessions.first?.taskId, "task_blog_feedback")
    }

    func testHTTPQueueClientBindsTaskSession() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/task-sessions/task_session_blog/task-binding")
            XCTAssertEqual(
                try JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: String],
                ["task_id": "task_blog_feedback"]
            )
            return """
            {
              "ok": true,
              "binding": {
                "ok": true,
                "task_session_id": "task_session_blog",
                "task_id": "task_blog_feedback",
                "session": {
                  "id": "task_session_blog",
                  "task_id": "task_blog_feedback",
                  "provider": "fake",
                  "status": "idle"
                }
              }
            }
            """
        }

        let binding = try await client.bindTaskSession(sessionId: "task_session_blog", taskId: "task_blog_feedback")

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(binding.taskSessionId, "task_session_blog")
        XCTAssertEqual(binding.taskId, "task_blog_feedback")
        XCTAssertEqual(binding.session?.taskId, "task_blog_feedback")
    }

    func testHTTPQueueClientDefersPacket() async throws {
        let dueAt = Date(timeIntervalSince1970: 1_778_074_500)
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/queue/qit_blog_feedback/defer")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: String])
            XCTAssertEqual(body["action"], "defer")
            XCTAssertEqual(body["actor_id"], "mac_queue_app")
            XCTAssertEqual(body["due_at"], "2026-05-06T13:35:00Z")
            return """
            {
              "ok": true,
              "item": {
                "id": "qit_blog_feedback",
                "review_packet_id": "packet-blog-feedback",
                "task_id": "task_blog_feedback",
                "state": "deferred",
                "priority_score": 90,
                "created_at": "2026-05-06T12:00:00Z",
                "updated_at": "2026-05-06T12:01:00Z",
                "due_at": "2026-05-06T13:35:00Z",
                "review_packet": {
                  "id": "packet-blog-feedback",
                  "task_id": "task_blog_feedback",
                  "title": "Review blog feedback draft",
                  "summary": "Human review needed.",
                  "decision_needed": "Approve angle.",
                  "recommended_action": {"label": "Review", "type": "mark_done"},
                  "risk_level": "medium",
                  "confidence": "high",
                  "risk_tags": [],
                  "evidence": [],
                  "context": []
                }
              }
            }
            """
        }

        let result = try await client.deferPacket(packetId: "qit_blog_feedback", until: dueAt)

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.completedPacketId, "qit_blog_feedback")
    }

    func testHTTPQueueClientIgnoresPacket() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/queue/qit_blog_feedback/ignore")
            XCTAssertEqual(
                try JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: String],
                ["action": "ignore", "actor_id": "mac_queue_app"]
            )
            return """
            {
              "ok": true,
              "item": {
                "id": "qit_blog_feedback",
                "review_packet_id": "packet-blog-feedback",
                "task_id": "task_blog_feedback",
                "state": "dead",
                "priority_score": 90,
                "created_at": "2026-05-06T12:00:00Z",
                "updated_at": "2026-05-06T12:01:00Z",
                "review_packet": {
                  "id": "packet-blog-feedback",
                  "task_id": "task_blog_feedback",
                  "title": "Review blog feedback draft",
                  "summary": "Human review needed.",
                  "decision_needed": "Approve angle.",
                  "recommended_action": {"label": "Review", "type": "mark_done"},
                  "risk_level": "medium",
                  "confidence": "high",
                  "risk_tags": [],
                  "evidence": [],
                  "context": []
                }
              }
            }
            """
        }

        let result = try await client.ignorePacket(packetId: "qit_blog_feedback")

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.completedPacketId, "qit_blog_feedback")
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

    func testHTTPWorkspaceClientCapturesWorkspaceSnapshot() async throws {
        let (client, recorder) = makeHTTPWorkspaceClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/workspace/capture")
            return """
            {
              "snapshot": {
                "backend": "aerospace",
                "windows": [
                  { "id": 9, "app": "Ghostty", "title": "codex", "workspace": "eventloop-blog" }
                ],
                "activeWorkspace": "eventloop-blog"
              }
            }
            """
        }

        let snapshot = try await client.capture()

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(snapshot.windows.map(\.id), [9])
        XCTAssertEqual(snapshot.activeWorkspace, "eventloop-blog")
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
              "restoredScroll": true,
              "restoredHighlight": true,
              "highlightStrategy": "text"
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
        XCTAssertEqual(envelope.restoreRequest.result?.restoredHighlight, true)
        XCTAssertEqual(envelope.restoreRequest.result?.highlightStrategy, "text")
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

    private func requestBodyData(_ request: URLRequest) -> Data {
        if let body = request.httpBody {
            return body
        }
        guard let stream = request.httpBodyStream else {
            return Data()
        }

        stream.open()
        defer { stream.close() }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 {
                break
            }
            data.append(buffer, count: read)
        }
        return data
    }

    private func makeHTTPClient(
        body: @escaping (URLRequest) throws -> String
    ) -> (HTTPQueueClient, HTTPClientRecorder) {
        let recorder = HTTPClientRecorder()
        MockURLProtocol.registry.setHandler { request in
            recorder.requests.append(request)
            let data = try body(request).data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return (HTTPQueueClient(baseURL: URL(string: "http://127.0.0.1:4377")!, session: session), recorder)
    }

    private func makeHTTPWorkspaceClient(
        body: @escaping (URLRequest) throws -> String
    ) -> (HTTPWorkspaceClient, HTTPClientRecorder) {
        let recorder = HTTPClientRecorder()
        MockURLProtocol.registry.setHandler { request in
            recorder.requests.append(request)
            let data = try body(request).data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return (HTTPWorkspaceClient(baseURL: URL(string: "http://127.0.0.1:4377")!, session: session), recorder)
    }
}

private final class HTTPClientRecorder: @unchecked Sendable {
    var requests: [URLRequest] = []
}

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    static let registry = MockURLProtocolRegistry()

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        do {
            guard let handler = Self.registry.handler() else {
                throw QueueClientError.invalidResponse
            }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private final class MockURLProtocolRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var currentHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    func setHandler(_ handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) {
        lock.withLock {
            currentHandler = handler
        }
    }

    func handler() -> ((URLRequest) throws -> (HTTPURLResponse, Data))? {
        lock.withLock {
            currentHandler
        }
    }
}
