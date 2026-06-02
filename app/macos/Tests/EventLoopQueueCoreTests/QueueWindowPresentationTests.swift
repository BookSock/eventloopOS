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
}
