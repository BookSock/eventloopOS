import XCTest
@testable import EventLoopQueueCore

final class QueueWindowPresentationTests: XCTestCase {
    func testSidebarShowsLoadingPlaceholderWhenQueueEmpty() {
        let summary = QueueWindowSidebarSummary(packets: [], state: .loading)

        XCTAssertEqual(summary.title, "Loading queue")
        XCTAssertEqual(summary.subtitle, "Waiting for orchestrator.")
        XCTAssertEqual(summary.systemImage, "arrow.clockwise")
        XCTAssertTrue(summary.showsProgress)
        XCTAssertFalse(summary.showsRetry)
        XCTAssertTrue(summary.showsPlaceholder)
    }

    func testSidebarKeepsExistingListVisibleWhileRefreshing() {
        let summary = QueueWindowSidebarSummary(packets: SeededQueue.packets, state: .loading)

        XCTAssertEqual(summary.title, "Loading queue")
        XCTAssertEqual(summary.subtitle, "Refreshing current work.")
        XCTAssertTrue(summary.showsProgress)
        XCTAssertFalse(summary.showsPlaceholder)
    }

    func testSidebarShowsRetryWhenEmptyQueueLoaded() {
        let summary = QueueWindowSidebarSummary(packets: [], state: .loaded)

        XCTAssertEqual(summary.title, "No queued work")
        XCTAssertEqual(summary.subtitle, "No human review needed right now.")
        XCTAssertEqual(summary.systemImage, "tray")
        XCTAssertFalse(summary.showsProgress)
        XCTAssertTrue(summary.showsRetry)
        XCTAssertTrue(summary.showsPlaceholder)
    }

    func testSidebarShowsErrorPlaceholderWhenNoPacketsRemain() {
        let summary = QueueWindowSidebarSummary(packets: [], state: .failed("offline"))

        XCTAssertEqual(summary.title, "Queue unavailable")
        XCTAssertEqual(summary.subtitle, "Orchestrator unavailable. Start dev dogfood with pnpm dev:dogfood or set EVENTLOOPOS_ORCHESTRATOR_URL, then refresh. Detail: offline")
        XCTAssertEqual(summary.systemImage, "exclamationmark.triangle")
        XCTAssertFalse(summary.showsProgress)
        XCTAssertTrue(summary.showsRetry)
        XCTAssertTrue(summary.showsPlaceholder)
    }

    func testDetailShowsSelectedPacketSummary() {
        let packet = SeededQueue.packets[0]
        let summary = QueueWindowDetailSummary(
            selectedPacket: packet,
            packets: SeededQueue.packets,
            state: .loaded
        )

        XCTAssertEqual(summary.title, packet.title)
        XCTAssertEqual(summary.subtitle, packet.summary)
        XCTAssertEqual(summary.systemImage, "checklist")
        XCTAssertFalse(summary.showsProgress)
        XCTAssertFalse(summary.showsRetry)
    }

    func testDetailShowsActionableEmptyState() {
        let summary = QueueWindowDetailSummary(selectedPacket: nil, packets: [], state: .loaded)

        XCTAssertEqual(summary.title, "No human review needed")
        XCTAssertEqual(summary.subtitle, "Agents can keep working in background.")
        XCTAssertEqual(summary.systemImage, "tray")
        XCTAssertFalse(summary.showsProgress)
        XCTAssertTrue(summary.showsRetry)
    }

    func testDetailShowsErrorWithRetry() {
        let summary = QueueWindowDetailSummary(selectedPacket: nil, packets: [], state: .failed("HTTP 500"))

        XCTAssertEqual(summary.title, "Queue unavailable")
        XCTAssertEqual(summary.subtitle, "Orchestrator returned a server error. Check dogfood logs, run pnpm readiness:summary, then refresh. Detail: HTTP 500")
        XCTAssertEqual(summary.systemImage, "exclamationmark.triangle")
        XCTAssertFalse(summary.showsProgress)
        XCTAssertTrue(summary.showsRetry)
    }

    func testUserFacingQueueStatusDetailStripsHTTPClientPrefix() {
        XCTAssertEqual(
            userFacingQueueStatusDetail("Queue request failed with HTTP 409: idempotency_conflict: duplicate idempotency key"),
            "Request already handled or still running. Wait a second, then try again."
        )
        XCTAssertEqual(
            userFacingQueueStatusDetail("Queue request failed with HTTP 409: manual_mode_active: queue is paused while manual mode is active"),
            "Manual Mode active. Press Ctrl-Option-M to return."
        )
        XCTAssertEqual(
            userFacingQueueStatusDetail("Workspace request failed with HTTP 422: schema_error: snapshot is required"),
            "schema_error: snapshot is required"
        )
        XCTAssertEqual(
            userFacingQueueStatusDetail("Queue request failed with HTTP 503"),
            "HTTP 503"
        )
        XCTAssertEqual(
            userFacingQueueStatusDetail("Queue request failed with HTTP 409"),
            "Queue paused. Try again."
        )
    }

    func testActionableFailureMessageUsesCleanHTTPDetail() {
        XCTAssertEqual(
            actionableQueueFailureMessage("Queue request failed with HTTP 503: database is down"),
            "Orchestrator returned a server error. Check dogfood logs, run pnpm readiness:summary, then refresh. Detail: database is down"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("Queue request failed with HTTP 409: idempotency_conflict: duplicate idempotency key"),
            "Request already handled or still running. Wait a second, then try again."
        )
    }

    func testActionableQueueFailureMessageMapsMissingPermissions() {
        XCTAssertEqual(
            actionableQueueFailureMessage("AeroSpace app is not running"),
            "AeroSpace unavailable. Launch AeroSpace, grant Accessibility in System Settings > Privacy & Security, then refresh. Detail: AeroSpace app is not running"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("Warning: AeroSpace client/server versions don't match. CLI/app hashes: aaa / bbb."),
            "AeroSpace version mismatch. Restart AeroSpace, then refresh. If it still fails, reinstall AeroSpace so the CLI and app bundle match. Detail: Warning: AeroSpace client/server versions don't match. CLI/app hashes: aaa / bbb."
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("launchservices_server_ready=false; direct binary launch only proved the binary can start"),
            "AeroSpace launch needs approval. Run pnpm setup:prompt, re-grant AeroSpace Accessibility, open AeroSpace normally, then refresh. Detail: launchservices_server_ready=false; direct binary launch only proved the binary can start"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("could not create image from display"),
            "Screen Recording missing. Run pnpm macos:permission-prompt, approve Terminal/eventloopOS in Screen & System Audio Recording, then refresh. Detail: could not create image from display"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("System Events is not allowed assistive access"),
            "Accessibility missing. Run pnpm macos:permission-prompt, approve Terminal/eventloopOS/AeroSpace in Accessibility, then refresh. Detail: System Events is not allowed assistive access"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("Codex login not configured"),
            "Codex is not ready. Run pnpm codex:status-proof, then codex login if auth is missing. Detail: Codex login not configured"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("Codex thread not found after restart"),
            "Codex thread is stale. Replace or rebind the task session, then send the followup again. Detail: Codex thread not found after restart"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("Tailscale/VNC disconnected; Remote Login unreachable"),
            "Remote lab disconnected. Open Tailscale on the lab Mac, verify Remote Login and Screen Sharing, then run pnpm lab:wait-online:quick. Detail: Tailscale/VNC disconnected; Remote Login unreachable"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("Postgres migration mismatch"),
            "Postgres unavailable or schema mismatch. Start the configured database or run the migration repair proof, then refresh. Detail: Postgres migration mismatch"
        )
        XCTAssertEqual(
            actionableQueueFailureMessage("Ghostty cleanup failure: terminate running processes prompt is still open"),
            "Terminal cleanup needs attention. Close stuck Ghostty/Terminal prompts, then rerun cleanup or product readiness. Detail: Ghostty cleanup failure: terminate running processes prompt is still open"
        )
    }

    func testTaskSessionTargetPresentationShowsProviderStatusAndIdentity() {
        let summary = TaskSessionTargetPresentation(
            session: TaskSession(
                id: "codex_thread_abc",
                taskId: "task_blog_feedback",
                provider: "codex",
                status: "running",
                name: "Blog launch agent",
                preview: "Editing launch paragraph",
                cwd: "/tmp/eventloop"
            )
        )

        XCTAssertEqual(summary.title, "Blog launch agent")
        XCTAssertEqual(summary.provider, "Codex")
        XCTAssertEqual(summary.status, "Running")
        XCTAssertEqual(summary.sessionId, "codex_thread_abc")
        XCTAssertEqual(summary.subtitle, "Codex | Running | codex_thread_abc")
        XCTAssertEqual(summary.identityLabel, "task_blog_feedback | Codex Running | codex_thread_abc")
        XCTAssertEqual(summary.detail, "Editing launch paragraph")
    }

    func testTaskSessionTargetPresentationIncludesTerminalBindingLabel() {
        let summary = TaskSessionTargetPresentation(
            session: TaskSession(
                id: "codex_thread_term",
                taskId: "task_blog_feedback",
                provider: "codex",
                status: "running",
                name: "Blog launch agent",
                terminalRef: "ghostty:front"
            )
        )

        XCTAssertEqual(summary.terminalLabel, "Ghostty (front window)")
        XCTAssertTrue(summary.identityLabel.contains("Ghostty (front window)"))
    }

    func testTaskSessionTargetPresentationFallsBackToCwdWhenNoPreview() {
        let summary = TaskSessionTargetPresentation(
            session: TaskSession(
                id: "claude_session_123",
                taskId: "task_blog_feedback",
                provider: "claude",
                status: "idle",
                cwd: "/Users/jason/project"
            )
        )

        XCTAssertEqual(summary.title, "claude_session_123")
        XCTAssertEqual(summary.subtitle, "Claude Code | Idle | claude_session_123")
        XCTAssertEqual(summary.detail, "/Users/jason/project")
    }

    func testPacketIdentityPresentationShowsTaskWorkspaceAndSendBackTarget() {
        let packet = ReviewPacket(
            id: "packet-review-1",
            reviewPacketId: "review_packet_1",
            taskId: "task_blog_feedback",
            title: "Review feedback",
            summary: "Needs human call.",
            source: "slack://thread/1",
            priority: 90,
            recommendedAction: "Send back",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0),
            workspaceSnapshot: WorkspaceSnapshot(
                windows: [
                    WorkspaceWindow(id: 1, app: "Ghostty", title: "codex", workspace: "eventloop-blog"),
                    WorkspaceWindow(id: 2, app: "Safari", title: "Blog", workspace: "eventloop-blog")
                ],
                activeWorkspace: "eventloop-blog"
            )
        )
        let summary = QueuePacketIdentityPresentation(
            packet: packet,
            selectedTaskSessions: [
                TaskSession(
                    id: "codex_thread_abc",
                    taskId: "task_blog_feedback",
                    provider: "codex",
                    status: "running",
                    name: "Blog launch agent"
                )
            ]
        )

        XCTAssertEqual(summary.packetId, "review_packet_1")
        XCTAssertEqual(summary.taskLabel, "task_blog_feedback")
        XCTAssertEqual(summary.workspaceLabel, "eventloop-blog | 2 windows")
        XCTAssertEqual(summary.sendBackLabel, "task_blog_feedback | Codex Running | codex_thread_abc")
    }

    func testPacketIdentityPresentationShowsMissingSession() {
        let packet = ReviewPacket(
            id: "packet-review-1",
            taskId: "task_blog_feedback",
            title: "Review feedback",
            summary: "Needs human call.",
            source: "manual://review",
            priority: 90,
            recommendedAction: "Send back",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let summary = QueuePacketIdentityPresentation(packet: packet)

        XCTAssertEqual(summary.taskLabel, "task_blog_feedback")
        XCTAssertEqual(summary.sendBackLabel, "Waiting for bound session | task_blog_feedback")
        XCTAssertNil(summary.workspaceLabel)
    }

    func testPaperBriefingPrefersDecisionAndShowsBoundSessionContext() {
        let packet = ReviewPacket(
            id: "packet-review-1",
            taskId: "task_blog_feedback",
            title: "Review feedback",
            summary: "Needs human call.",
            decisionNeeded: "Decide whether to send the draft now or wait for owner review.",
            source: "slack://thread/1",
            priority: 90,
            riskLevel: "medium",
            recommendedAction: "Send selected answer to agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let briefing = QueuePaperBriefingPresentation(
            packet: packet,
            selectedTaskSessions: [
                TaskSession(
                    id: "codex_thread_abc",
                    taskId: "task_blog_feedback",
                    provider: "codex",
                    status: "running",
                    name: "Blog feedback agent"
                )
            ]
        )

        XCTAssertEqual(briefing.title, "Review feedback")
        XCTAssertEqual(briefing.decision, "Decide whether to send the draft now or wait for owner review.")
        XCTAssertEqual(briefing.action, "Send selected answer to agent")
        XCTAssertEqual(briefing.context, "Needs human call. | task_blog_feedback | P90 | medium | Source: slack://thread/1 | Codex | Running | codex_thread_abc")
    }

    func testPaperBriefingFallsBackToRecommendedActionAndMissingSessionHint() {
        let packet = ReviewPacket(
            id: "packet-review-1",
            taskId: "task_blog_feedback",
            title: "Review feedback",
            summary: "Needs human call.",
            source: "slack://thread/1",
            priority: 90,
            riskLevel: "medium",
            recommendedAction: "Send selected answer to agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let briefing = QueuePaperBriefingPresentation(packet: packet)

        XCTAssertEqual(briefing.decision, "Send selected answer to agent")
        XCTAssertEqual(briefing.context, "Needs human call. | task_blog_feedback | P90 | medium | Source: slack://thread/1 | Waiting for bound session")
    }

    func testPaperBriefingUsesSummaryWhenActionIsGeneric() {
        let packet = ReviewPacket(
            id: "packet-waiting-1",
            taskId: "task_checkout",
            title: "Review Codex session waiting on task_checkout",
            summary: "Codex session waiting for human input on task_checkout.",
            source: "eventloopos://task-sessions/session_checkout",
            priority: 700,
            riskLevel: "medium",
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0),
            workspaceSnapshot: WorkspaceSnapshot(
                windows: [
                    WorkspaceWindow(id: 91, app: "Ghostty", title: "codex checkout", workspace: "demo-checkout")
                ],
                activeWorkspace: "demo-checkout",
                focusedWindowId: 91
            )
        )

        let briefing = QueuePaperBriefingPresentation(
            packet: packet,
            selectedTaskSessions: [
                TaskSession(
                    id: "session_checkout",
                    taskId: "task_checkout",
                    provider: "codex",
                    status: "waiting_approval",
                    preview: "Approve shell command",
                    terminalRef: "ghostty:win-91"
                )
            ]
        )

        XCTAssertEqual(briefing.decision, "Codex session waiting for human input on task_checkout.")
        XCTAssertEqual(
            briefing.context,
            "task_checkout | P700 | medium | demo-checkout, 1 windows | Source: eventloopos://task-sessions/session_checkout | Codex | Waiting Approval | session_checkout | Approve shell command"
        )
    }

    func testPaperReminderMirrorsBriefingForDesktopHud() {
        let packet = ReviewPacket(
            id: "packet-review-1",
            taskId: "task_blog_feedback",
            title: "Review feedback",
            summary: "Needs human call.",
            decisionNeeded: "Decide whether to send the draft now or wait for owner review.",
            source: "slack://thread/1",
            priority: 90,
            riskLevel: "medium",
            recommendedAction: "Send selected answer to agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let reminder = QueuePaperReminderPresentation(
            packet: packet,
            selectedTaskSessions: [
                TaskSession(
                    id: "codex_thread_abc",
                    taskId: "task_blog_feedback",
                    provider: "codex",
                    status: "running"
                )
            ]
        )

        XCTAssertEqual(reminder.title, "Review feedback")
        XCTAssertEqual(reminder.decision, "Decide whether to send the draft now or wait for owner review.")
        XCTAssertEqual(reminder.focusHint, "Return target: Codex Running | codex_thread_abc")
        XCTAssertEqual(reminder.context, "Needs human call. | task_blog_feedback | P90 | medium | Source: slack://thread/1 | Codex | Running | codex_thread_abc")
        XCTAssertEqual(
            reminder.accessibilityLabel,
            "Review feedback | Decide whether to send the draft now or wait for owner review. | Return target: Codex Running | codex_thread_abc | Needs human call. | task_blog_feedback | P90 | medium | Source: slack://thread/1 | Codex | Running | codex_thread_abc"
        )
    }

    func testPaperReminderShowsMissingAgentSessionReturnTarget() {
        let packet = ReviewPacket(
            id: "packet-review-1",
            taskId: "task_blog_feedback",
            title: "Review feedback",
            summary: "Needs human call.",
            source: "slack://thread/1",
            priority: 90,
            riskLevel: "medium",
            recommendedAction: "Send selected answer to agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let reminder = QueuePaperReminderPresentation(packet: packet)

        XCTAssertEqual(reminder.focusHint, "Return target: bind an agent session for task_blog_feedback")
        XCTAssertTrue(reminder.accessibilityLabel.contains("Return target: bind an agent session for task_blog_feedback"))
    }

    func testPaperReminderReturnTargetIncludesTerminalAndPreview() {
        let packet = ReviewPacket(
            id: "packet-waiting-1",
            taskId: "task_checkout",
            title: "Review Codex session waiting on task_checkout",
            summary: "Codex session waiting for human input on task_checkout.",
            source: "eventloopos://task-sessions/session_checkout",
            priority: 700,
            riskLevel: "medium",
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let reminder = QueuePaperReminderPresentation(
            packet: packet,
            selectedTaskSessions: [
                TaskSession(
                    id: "session_checkout",
                    taskId: "task_checkout",
                    provider: "codex",
                    status: "waiting_approval",
                    preview: "Approve shell command",
                    terminalRef: "ghostty:win-91"
                )
            ]
        )

        XCTAssertEqual(
            reminder.focusHint,
            "Return target: Codex Waiting Approval | session_checkout | Ghostty terminal win-91 | Approve shell command"
        )
    }
}
