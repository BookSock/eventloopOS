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
        XCTAssertEqual(loaded.first?.evidence.first?.title, "Alex feedback in launch thread")
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
                "status": "failed",
                "event_ids": ["evt_review_1"],
                "text_hash": "abc",
                "text_length": 42,
                "error": "thread not found",
                "recovery_hint": "Codex thread is stale. Replace or rebind the task session, then send the followup again."
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
        XCTAssertEqual(envelope.lineage.taskMessages.first?.recoveryHint, "Codex thread is stale. Replace or rebind the task session, then send the followup again.")
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

    func testHTTPQueueClientExcludesCurrentPacketWhenLeasingNext() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/queue/lease-next")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            XCTAssertEqual(body["lease_owner"] as? String, "mac_queue_app")
            XCTAssertEqual(body["lease_ms"] as? Int, 60_000)
            XCTAssertEqual(body["exclude_queue_item_id"] as? String, "qit_blog_feedback")
            return """
            {
              "item": {
                "id": "qit_ci_failed",
                "review_packet_id": "pkt_ci_failed",
                "task_id": "task_ci",
                "priority_score": 800,
                "created_at": "2026-05-06T12:00:00.000Z",
                "review_packet": {
                  "id": "pkt_ci_failed",
                  "title": "CI failed",
                  "summary": "Fix failing build.",
                  "recommended_action": {"type": "mark_done", "label": "Done"},
                  "context": []
                }
              },
              "request_id": "req_next"
            }
            """
        }

        let packet = try await client.next(after: "qit_blog_feedback")

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(packet?.id, "qit_ci_failed")
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

    func testHTTPQueueClientSavesTaskWorkspaceSnapshot() async throws {
        var capturedBody: [String: Any]?
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/tasks/task_blog_feedback/workspace-snapshot")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            capturedBody = body
            XCTAssertEqual(body["actor_id"] as? String, "mac_queue_app")
            XCTAssertEqual(body["source_queue_item_id"] as? String, "qit_blog_feedback")
            return """
            {
              "ok": true,
              "workspace_snapshot": {
                "id": "twsp_task_blog_feedback",
                "task_id": "task_blog_feedback",
                "snapshot": {
                  "backend": "aerospace",
                  "windows": [],
                  "activeWorkspace": "eventloop-blog"
                },
                "captured_at": "2026-05-06T12:00:00Z",
                "updated_at": "2026-05-06T12:00:00Z"
              },
              "request_id": "req_save_workspace"
            }
            """
        }

        let result = try await client.saveTaskWorkspaceSnapshot(
            taskId: "task_blog_feedback",
            workspaceSnapshot: WorkspaceSnapshot(
                windows: [WorkspaceWindow(id: 91, app: "Ghostty", title: "Blog", workspace: "eventloop-blog")],
                activeWorkspace: "eventloop-blog",
                focusedWindowId: 91
            ),
            sourceQueueItemId: "qit_blog_feedback"
        )

        XCTAssertEqual(recorder.requests.count, 1)
        let workspaceSnapshot = try XCTUnwrap(capturedBody?["workspace_snapshot"] as? [String: Any])
        XCTAssertEqual(workspaceSnapshot["activeWorkspace"] as? String, "eventloop-blog")
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.requestId, "req_save_workspace")
    }

    func testHTTPQueueClientSendsMasterCommand() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/voice/commands")
            XCTAssertNotNil(request.value(forHTTPHeaderField: "Idempotency-Key"))
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: String])
            XCTAssertEqual(body["transcript"], "Make launch blog higher priority")
            XCTAssertEqual(body["task_hint"], "task_blog_feedback")
            XCTAssertEqual(body["idempotency_key"], body["source_id"])
            return """
            {
              "ok": true,
              "event": {"id": "evt_master_1"},
              "route_decision": {
                "action": "send_to_task",
                "target_task_id": "task_blog_feedback",
                "target_task_session_id": "task_session_blog"
              },
              "request_id": "req_master_1"
            }
            """
        }

        let result = try await client.sendMasterCommand(
            text: "Make launch blog higher priority",
            taskHint: "task_blog_feedback"
        )

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.requestId, "req_master_1")
        XCTAssertEqual(result.eventId, "evt_master_1")
        XCTAssertEqual(result.routeAction, "send_to_task")
        XCTAssertEqual(result.targetTaskId, "task_blog_feedback")
        XCTAssertEqual(result.targetTaskSessionId, "task_session_blog")
        XCTAssertNil(result.queuedPacket)
    }

    func testHTTPQueueClientDecodesMasterCommandQueuedPaper() async throws {
        let (client, _) = makeHTTPClient { _ in
            """
            {
              "ok": true,
              "event": {"id": "evt_master_queued"},
              "route_decision": {
                "action": "create_queue_item",
                "target_task_id": "task_master_note"
              },
              "queue_item": {
                "id": "qit_master_note",
                "review_packet_id": "pkt_master_note",
                "task_id": "task_master_note",
                "priority_score": 760,
                "priority_reasons": ["master_command"],
                "created_at": "2026-05-06T12:00:00.000Z",
                "review_packet": {
                  "id": "pkt_master_note",
                  "title": "Review master note",
                  "summary": "Master command needs human review.",
                  "primary_source": "master",
                  "risk_level": "medium",
                  "confidence": "medium",
                  "risk_tags": [],
                  "context": [],
                  "evidence": [],
                  "recommended_action": {
                    "label": "Work this paper, then Done / Next",
                    "type": "mark_done"
                  }
                }
              },
              "request_id": "req_master_queued"
            }
            """
        }

        let result = try await client.sendMasterCommand(text: "Start paper for this note")

        XCTAssertEqual(result.routeAction, "create_queue_item")
        XCTAssertEqual(result.queuedPacket?.id, "qit_master_note")
        XCTAssertEqual(result.queuedPacket?.taskId, "task_master_note")
        XCTAssertEqual(result.queuedPacket?.title, "Review master note")
    }

    func testHTTPQueueClientStartsMasterTask() async throws {
        var capturedRequestBody: [String: Any]?
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/task-sessions")
            XCTAssertNotNil(request.value(forHTTPHeaderField: "Idempotency-Key"))
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            capturedRequestBody = body
            XCTAssertEqual(body["task_id"] as? String, "task_blog_launch")
            XCTAssertEqual(body["cwd"] as? String, "/repo")
            XCTAssertEqual(body["model"] as? String, "gpt-5.3-codex")
            XCTAssertEqual(body["idempotency_key"] as? String, request.value(forHTTPHeaderField: "Idempotency-Key"))
            XCTAssertTrue((body["prompt"] as? String)?.contains("Draft blog launch paper") == true)
            return """
            {
              "ok": true,
              "started": {
                "ok": true,
                "task_session_id": "task_session_blog_launch",
                "task_id": "task_blog_launch",
                "session": {
                  "id": "task_session_blog_launch",
                  "task_id": "task_blog_launch",
                  "provider": "codex",
                  "status": "idle",
                  "name": "Blog launch"
                }
              },
              "request_id": "req_start_1"
            }
            """
        }

        let started = try await client.startMasterTask(
            text: "Draft blog launch paper",
            taskHint: "Blog Launch",
            cwd: "/repo",
            model: "gpt-5.3-codex",
            workspaceSnapshot: WorkspaceSnapshot(
                windows: [WorkspaceWindow(id: 501, app: "Google Chrome", title: "Blog draft", workspace: "blog")],
                activeWorkspace: "blog",
                focusedWindowId: 501
            )
        )

        XCTAssertEqual(recorder.requests.count, 1)
        let body = try XCTUnwrap(capturedRequestBody)
        XCTAssertEqual(body["queue_paper"] as? Bool, true)
        let workspaceSnapshot = try XCTUnwrap(body["workspace_snapshot"] as? [String: Any])
        XCTAssertEqual(workspaceSnapshot["activeWorkspace"] as? String ?? workspaceSnapshot["active_workspace"] as? String, "blog")
        XCTAssertTrue(started.ok)
        XCTAssertEqual(started.taskSessionId, "task_session_blog_launch")
        XCTAssertEqual(started.taskId, "task_blog_launch")
        XCTAssertEqual(started.session?.provider, "codex")
    }

    func testHTTPQueueClientFetchesOnboardingScan() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/onboarding/scan")
            return """
            {
              "ok": true,
              "captured_at": "2026-05-06T12:00:00Z",
              "active_workspace": "eventloop-blog",
              "focused_window_id": 91,
              "summary": {
                "window_count": 2,
                "grouped_window_count": 2,
                "ungrouped_window_count": 0,
                "task_session_count": 1,
                "browser_context_count": 1,
                "proposal_count": 1
              },
              "proposals": [
                {
                  "id": "onboard_blog",
                  "task_id": "task_blog_feedback",
                  "title": "Blog Feedback",
                  "confidence": "high",
                  "reason": "window title contains [task:...]",
                  "windows": [
                    {"id": 91, "app": "Ghostty", "title": "[task:blog feedback] codex", "workspace": "eventloop-blog", "task_hint": "blog feedback"}
                  ],
                  "browser_contexts": [
                    {
                      "id": "browser_tab:7",
                      "title": "Blog draft",
                      "url": "https://example.test/blog",
                      "task_id": "task_blog_feedback",
                      "window_id": "92",
                      "tab_id": "7",
                      "captured_at": "2026-05-06T12:00:00Z",
                      "restore_confidence": "high"
                    }
                  ],
                  "task_sessions": [
                    {"id": "task_session_blog", "task_id": "task_blog_feedback", "provider": "codex", "status": "idle"}
                  ],
                  "suggested_next_action": "Approve this task context."
                }
              ],
              "ungrouped_windows": [],
              "browser_contexts": [],
              "task_sessions": [],
              "warnings": [],
              "request_id": "req_scan"
            }
            """
        }

        let scan = try await client.fetchOnboardingScan()

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(scan.activeWorkspace, "eventloop-blog")
        XCTAssertEqual(scan.summary.proposalCount, 1)
        XCTAssertEqual(scan.proposals.first?.taskId, "task_blog_feedback")
        XCTAssertEqual(scan.proposals.first?.windows.first?.taskHint, "blog feedback")
        XCTAssertEqual(scan.proposals.first?.browserContexts.first?.tabId, "7")
    }

    func testHTTPQueueClientApprovesOnboardingProposal() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/onboarding/approvals")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            XCTAssertEqual(body["actor_id"] as? String, "mac_queue_app")
            XCTAssertEqual(body["proposal_id"] as? String, "onboard_blog")
            XCTAssertEqual(body["queue_paper"] as? Bool, true)
            return """
            {
              "ok": true,
              "task_id": "task_blog_feedback",
              "proposal_id": "onboard_blog",
              "bindings": [
                {
                  "ok": true,
                  "task_session_id": "task_session_blog",
                  "task_id": "task_blog_feedback"
                }
              ],
              "browser_context_bindings": [
                {
                  "browser_context_id": "browser_tab:77",
                  "event_id": "evt_onboarding_context_bind_task_blog_browser_tab_77",
                  "task_id": "task_blog_feedback"
                }
              ],
              "queue_item": {
                "id": "qit_onboarding_task_blog_feedback",
                "review_packet_id": "pkt_onboarding_task_blog_feedback",
                "task_id": "task_blog_feedback",
                "state": "ready",
                "priority_score": 700
              },
              "warnings": [],
              "request_id": "req_approve"
            }
            """
        }

        let result = try await client.approveOnboardingProposal(id: "onboard_blog", queuePaper: true)

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.taskId, "task_blog_feedback")
        XCTAssertEqual(result.proposalId, "onboard_blog")
        XCTAssertEqual(result.bindings.first?.taskSessionId, "task_session_blog")
        XCTAssertEqual(result.browserContextBindings.first?.browserContextId, "browser_tab:77")
        XCTAssertEqual(result.queuedPaper?.id, "qit_onboarding_task_blog_feedback")
        XCTAssertEqual(result.queuedPaper?.state, "ready")
    }

    func testHTTPQueueClientApprovesEditedOnboardingProposal() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/onboarding/approvals")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            XCTAssertEqual(body["proposal_id"] as? String, "onboard_blog")
            XCTAssertEqual(body["task_id"] as? String, "task_launch_blog")
            XCTAssertEqual(body["window_ids"] as? [Int], [101])
            XCTAssertEqual(body["task_session_ids"] as? [String], ["task_session_blog"])
            XCTAssertEqual(body["browser_context_ids"] as? [String], ["browser_tab:77"])
            XCTAssertEqual(body["queue_paper"] as? Bool, true)
            return """
            {
              "ok": true,
              "task_id": "task_launch_blog",
              "proposal_id": "onboard_blog",
              "bindings": [],
              "browser_context_bindings": [],
              "warnings": [],
              "request_id": "req_approve"
            }
            """
        }

        let result = try await client.approveOnboardingProposal(OnboardingApprovalRequest(
            proposalId: "onboard_blog",
            taskId: "task_launch_blog",
            windowIds: [101],
            taskSessionIds: ["task_session_blog"],
            browserContextIds: ["browser_tab:77"],
            queuePaper: true
        ))

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.taskId, "task_launch_blog")
    }

    func testHTTPQueueClientBatchApprovesOnboardingProposals() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/onboarding/approvals/batch")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "idem_batch_42")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            XCTAssertEqual(body["idempotency_key"] as? String, "idem_batch_42")
            let approvals = try XCTUnwrap(body["approvals"] as? [[String: Any]])
            XCTAssertEqual(approvals.count, 2)
            XCTAssertEqual(approvals[0]["proposal_id"] as? String, "onboard_a")
            XCTAssertEqual(approvals[0]["queue_paper"] as? Bool, true)
            XCTAssertEqual(approvals[1]["proposal_id"] as? String, "onboard_b")
            return """
            {
              "ok": true,
              "results": [
                {
                  "ok": true,
                  "proposal_id": "onboard_a",
                  "task_id": "task_a",
                  "queue_item": {
                    "id": "qit_a",
                    "review_packet_id": "pkt_a",
                    "task_id": "task_a",
                    "state": "ready",
                    "priority_score": 700
                  }
                },
                {
                  "ok": false,
                  "proposal_id": "onboard_b",
                  "error": { "code": "schema_error", "message": "bad" }
                }
              ],
              "request_id": "req_batch"
            }
            """
        }

        let approvals = [
            OnboardingApprovalRequest(proposalId: "onboard_a", queuePaper: true),
            OnboardingApprovalRequest(proposalId: "onboard_b", queuePaper: true)
        ]
        let result = try await client.batchApproveOnboardingProposals(approvals: approvals, idempotencyKey: "idem_batch_42")

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.results.count, 2)
        XCTAssertEqual(result.results[0].ok, true)
        XCTAssertEqual(result.results[0].queuedPaper?.id, "qit_a")
        XCTAssertEqual(result.results[1].ok, false)
        XCTAssertEqual(result.results[1].errorCode, "schema_error")
    }

    func testHTTPQueueClientPostsManualMode() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/modes/manual")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            XCTAssertEqual(body["active"] as? Bool, true)
            XCTAssertEqual(body["reason"] as? String, "user_hotkey")
            return """
            {
              "ok": true,
              "manual_mode": {
                "active": true,
                "entered_at": "2026-05-10T08:30:00Z",
                "reason": "user_hotkey",
                "updated_at": "2026-05-10T08:30:00Z"
              },
              "transitioned": true,
              "request_id": "req_manual_post"
            }
            """
        }

        let state = try await client.setManualMode(active: true, reason: "user_hotkey")

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(state.active)
        XCTAssertEqual(state.reason, "user_hotkey")
    }

    func testHTTPQueueClientGetsManualMode() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/modes/manual")
            return """
            {
              "manual_mode": {
                "active": false,
                "updated_at": "2026-05-10T08:00:00Z"
              },
              "request_id": "req_manual_get"
            }
            """
        }

        let state = try await client.getManualMode()

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertFalse(state.active)
        XCTAssertNil(state.reason)
    }

    func testHTTPQueueClientFetchesReadingQueue() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/reading-queue")
            return """
            {
              "contexts": [
                {
                  "id": "browser_tab:1",
                  "title": "How agents reshape OS",
                  "url": "https://example.test/agents-os",
                  "captured_at": "2026-05-09T11:55:00Z",
                  "event_id": "evt_capture_tab_1",
                  "source": "browser"
                }
              ],
              "count": 1,
              "request_id": "req_reading_list"
            }
            """
        }

        let result = try await client.fetchReadingQueue()

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result.contexts.first?.id, "browser_tab:1")
        XCTAssertEqual(result.contexts.first?.url, "https://example.test/agents-os")
    }

    func testHTTPQueueClientPromotesReadingQueueContexts() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:4377/reading-queue/promote")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: self.requestBodyData(request)) as? [String: Any])
            XCTAssertEqual(body["actor_id"] as? String, "mac_queue_app")
            XCTAssertEqual(body["context_ids"] as? [String], ["browser_tab:1"])
            return """
            {
              "ok": true,
              "promoted": [
                {
                  "context_id": "browser_tab:1",
                  "queue_item_id": "qit_reading_queue_browser_tab_1",
                  "review_packet_id": "pkt_reading_queue_browser_tab_1",
                  "event_id": "evt_reading_queue_browser_tab_1",
                  "idempotent": false
                }
              ],
              "promoted_count": 1,
              "missing_context_ids": [],
              "request_id": "req_reading_promote"
            }
            """
        }

        let result = try await client.promoteReadingQueueContexts(ids: ["browser_tab:1"])

        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.promotedCount, 1)
        XCTAssertEqual(result.promoted.first?.contextId, "browser_tab:1")
        XCTAssertEqual(result.promoted.first?.queueItemId, "qit_reading_queue_browser_tab_1")
        XCTAssertFalse(result.promoted.first?.idempotent ?? true)
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

    func testContextRestorePlanEnvelopeDecodesShowPaperKind() throws {
        let data = """
        {
          "restore_plan": {
            "kind": "show_paper",
            "side_effect": "local",
            "execute_supported": false,
            "paper": {
              "title": "Quick note",
              "source_kind": "note",
              "body_markdown": "Decide whether to bump pricing for Q3."
            }
          }
        }
        """.data(using: .utf8)!

        let envelope = try QueueCoders.makeDecoder().decode(ContextRestorePlanEnvelope.self, from: data)

        XCTAssertEqual(envelope.restorePlan.kind, "show_paper")
        XCTAssertEqual(envelope.restorePlan.sideEffect, "local")
        XCTAssertEqual(envelope.restorePlan.executeSupported, false)
        XCTAssertEqual(envelope.restorePlan.paper?.title, "Quick note")
        XCTAssertEqual(envelope.restorePlan.paper?.sourceKind, "note")
        XCTAssertEqual(envelope.restorePlan.paper?.bodyMarkdown, "Decide whether to bump pricing for Q3.")
        XCTAssertNil(envelope.restorePlan.url)
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

    func testHTTPQueueClientFetchesTaskWithLayout() async throws {
        let (client, recorder) = makeHTTPClient { request in
            XCTAssertEqual(request.url?.path, "/tasks/task_blog_feedback")
            XCTAssertEqual(request.httpMethod, "GET")
            return """
            {
              "task": {
                "task_id": "task_blog_feedback",
                "primary_anchor_kind": "codex_thread",
                "primary_anchor_id": "thr_blog",
                "created_at": "2026-05-10T12:00:00.000Z",
                "updated_at": "2026-05-10T12:00:00.000Z",
                "auto_paper_idle_seconds": 60
              },
              "layout": {
                "task_id": "task_blog_feedback",
                "layout": {
                  "backend": "aerospace",
                  "windows": [{"id": 1, "app": "Ghostty", "title": "[task:blog]", "workspace": "ws_blog"}],
                  "activeWorkspace": "ws_blog",
                  "focusedWindowId": 1
                },
                "updated_at": "2026-05-10T12:00:01.000Z"
              }
            }
            """
        }
        _ = recorder

        let envelope = try await client.getTaskWithLayout(taskId: "task_blog_feedback")
        XCTAssertEqual(envelope.task.taskId, "task_blog_feedback")
        XCTAssertEqual(envelope.layout?.layout.activeWorkspace, "ws_blog")
        XCTAssertEqual(envelope.layout?.layout.windows.first?.app, "Ghostty")
    }

    func testHTTPCodexForegroundResolverDecodesTitleResolverResponse() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let recorder = HTTPClientRecorder()
        MockURLProtocol.registry.setHandler { request in
            recorder.requests.append(request)
            let body = """
            {"codex_thread_id": null, "ghostty_window_id": "ghost-blog-101", "source": "title_resolver"}
            """
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, body.data(using: .utf8)!)
        }

        let resolver = HTTPCodexForegroundResolver(
            baseURL: URL(string: "http://127.0.0.1:4377")!,
            session: session
        )
        let result = await resolver.resolveForeground()

        XCTAssertEqual(result.codexThreadId, nil)
        XCTAssertEqual(result.ghosttyWindowId, "ghost-blog-101")
        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(recorder.requests.first?.url?.path, "/agents/codex/resolve-foreground")
        XCTAssertEqual(recorder.requests.first?.httpMethod, "POST")
    }

    func testHTTPCodexForegroundResolverDecodesCodexSessionResponse() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.registry.setHandler { request in
            let body = """
            {"codex_thread_id": "thr-aaaa", "ghostty_window_id": "ghost-front", "source": "codex_session"}
            """
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, body.data(using: .utf8)!)
        }

        let resolver = HTTPCodexForegroundResolver(
            baseURL: URL(string: "http://127.0.0.1:4377")!,
            session: session
        )
        let result = await resolver.resolveForeground()

        XCTAssertEqual(result.codexThreadId, "thr-aaaa")
        XCTAssertEqual(result.ghosttyWindowId, "ghost-front")
    }

    func testHTTPCodexForegroundResolverReturnsNoneOnHTTPError() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        MockURLProtocol.registry.setHandler { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 500,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, Data())
        }

        let resolver = HTTPCodexForegroundResolver(
            baseURL: URL(string: "http://127.0.0.1:4377")!,
            session: session
        )
        let result = await resolver.resolveForeground()

        XCTAssertEqual(result, .none)
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

    func testSlugifyTaskNameNormalizesFreeFormTitles() {
        XCTAssertEqual(slugifyTaskName("new task im making to get a good"), "new-task-im-making-to-get-a-good")
        XCTAssertEqual(slugifyTaskName("Hello   World!"), "hello-world")
        XCTAssertEqual(slugifyTaskName("BLOG Feedback ✨"), "blog-feedback")
        XCTAssertEqual(slugifyTaskName("café résumé"), "caf-rsum")
        XCTAssertEqual(slugifyTaskName("--leading-and-trailing--"), "leading-and-trailing")
        XCTAssertEqual(slugifyTaskName("ALL UPPER"), "all-upper")
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
