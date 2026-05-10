import EventLoopQueueCore
import XCTest
@testable import EventLoopQueueApp

@MainActor
final class PacketActionConsequenceTests: XCTestCase {
    func testResumeAgentActionExplainsBoundSessionConsequence() {
        let packet = ReviewPacket(
            id: "packet_blog",
            taskId: "task_blog",
            title: "Review blog",
            summary: "Needs agent follow-up.",
            source: "manual",
            priority: 700,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 1_778_070_000)
        )
        let session = TaskSession(
            id: "codex_thread_blog",
            taskId: "task_blog",
            provider: "codex",
            status: "running",
            name: "Blog agent"
        )

        let consequence = actionConsequence(for: packet, selectedTaskSessions: [session])

        XCTAssertEqual(
            consequence,
            "Send to Agent will forward this packet to Codex: Blog agent, save the current workspace, mark this paper done, then pull the next paper."
        )
    }

    func testResumeAgentActionExplainsBlockedConsequence() {
        let packet = ReviewPacket(
            id: "packet_blog",
            taskId: "task_blog",
            title: "Review blog",
            summary: "Needs agent follow-up.",
            source: "manual",
            priority: 700,
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 1_778_070_000)
        )

        XCTAssertEqual(
            actionConsequence(for: packet, selectedTaskSessions: []),
            "Send to Agent is blocked until a task session is bound. Use Bind Session in the Agent panel above to pick a Codex thread, or click Done / Next to save this workspace and move on without an agent follow-up."
        )
    }

    func testMarkDoneActionExplainsDoneNextConsequence() {
        let packet = ReviewPacket(
            id: "packet_onboarding",
            taskId: "task_reading",
            title: "Review reading workbench",
            summary: "Approved workbench.",
            source: "onboarding",
            priority: 700,
            recommendedAction: "Work this paper, then Done / Next",
            recommendedActionType: "mark_done",
            createdAt: Date(timeIntervalSince1970: 1_778_070_000)
        )

        XCTAssertEqual(
            actionConsequence(for: packet, selectedTaskSessions: []),
            "Done / Next will save this workspace for the task and move to the next paper."
        )
    }

    func testWhyThisPaperSummaryShowsSourceTaskPriorityAndContext() {
        let packet = ReviewPacket(
            id: "packet_slack",
            taskId: "task_blog",
            title: "Review Slack feedback",
            summary: "Feedback arrived.",
            source: "slack",
            priority: 850,
            priorityReasons: ["human_blocked", "agent_run_waiting"],
            contextResources: [
                ReviewContextResource(
                    id: "ctx_slack",
                    kind: "slack_thread",
                    title: "Slack thread",
                    source: "agent-slack"
                )
            ],
            recommendedAction: "Route to task agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 1_778_070_000)
        )

        XCTAssertEqual(
            whyThisPaperSummary(for: packet),
            "Source: slack. Task: task_blog. Priority: human_blocked, agent_run_waiting. Context: 1 resource(s)."
        )
    }

    func testRecentLineageSummaryShowsEventActionAndAgentHandoff() {
        let lineage = QueueLineage(
            relatedEventIds: ["evt_slack"],
            events: [
                QueueLineageEvent(
                    id: "evt_slack",
                    source: "slack",
                    sourceId: "slack:dm",
                    type: "slack_message",
                    title: "Feedback arrived",
                    summary: "Launch detail must be added.",
                    occurredAt: Date(timeIntervalSince1970: 1_778_070_000)
                )
            ],
            activity: [
                QueueLineageActivity(
                    id: "act_route",
                    type: "route_to_task",
                    occurredAt: Date(timeIntervalSince1970: 1_778_070_010),
                    status: "ok",
                    summary: "Routed Slack feedback to blog task.",
                    eventId: "evt_slack",
                    taskSessionId: "codex_blog"
                )
            ],
            taskMessages: [
                QueueLineageTaskMessage(
                    id: "msg_blog",
                    taskSessionId: "codex_blog",
                    origin: "event_route",
                    status: "sent",
                    eventIds: ["evt_slack"],
                    textLength: 120
                )
            ],
            counts: QueueLineageCounts(events: 1, activity: 1, taskMessages: 1)
        )

        XCTAssertEqual(
            recentLineageSummary(for: lineage),
            "Latest event: Launch detail must be added. Last action: Routed Slack feedback to blog task. Agent handoff: sent to codex_blog"
        )
    }

    func testRecentLineageSummaryFallsBackToEventTitleAndNilWhenEmpty() {
        let titledLineage = QueueLineage(
            relatedEventIds: ["evt_slack"],
            events: [
                QueueLineageEvent(
                    id: "evt_slack",
                    source: "slack",
                    sourceId: "slack:dm",
                    type: "slack_message",
                    title: "Feedback arrived",
                    summary: "",
                    occurredAt: Date(timeIntervalSince1970: 1_778_070_000)
                )
            ],
            activity: [],
            taskMessages: [],
            counts: QueueLineageCounts(events: 1, activity: 0, taskMessages: 0)
        )
        let emptyLineage = QueueLineage(
            relatedEventIds: [],
            activity: [],
            taskMessages: [],
            counts: QueueLineageCounts(events: 0, activity: 0, taskMessages: 0)
        )

        XCTAssertEqual(recentLineageSummary(for: titledLineage), "Latest event: Feedback arrived")
        XCTAssertNil(recentLineageSummary(for: emptyLineage))
    }

    func testOnboardingProposalPreviewLinesShowWindowsTabsAndSessions() {
        let proposal = OnboardingTaskProposal(
            id: "onboard_blog",
            taskId: "task_blog",
            title: "Blog",
            confidence: "medium",
            reason: "current desk",
            windows: [
                OnboardingWindow(id: 101, app: "Ghostty", title: "codex blog", workspace: "blog"),
                OnboardingWindow(id: 102, app: "Google Chrome", title: "Blog draft", workspace: "blog"),
            ],
            browserContexts: [
                OnboardingBrowserContext(
                    id: "browser_tab_7",
                    title: "Launch blog draft",
                    url: "https://example.test/blog",
                    capturedAt: Date(timeIntervalSince1970: 1_778_070_000),
                    restoreConfidence: "high"
                )
            ],
            taskSessions: [
                TaskSession(
                    id: "codex_thread_blog",
                    taskId: "task_blog",
                    provider: "codex",
                    status: "running",
                    name: "Blog agent"
                )
            ],
            suggestedNextAction: "Approve"
        )

        XCTAssertEqual(
            onboardingProposalPreviewLines(for: proposal),
            [
                "Window: Ghostty - codex blog",
                "Window: Google Chrome - Blog draft",
                "Tab: Launch blog draft - https://example.test/blog",
                "Session: codex running - Blog agent",
            ]
        )
    }

    func testOnboardingProposalPreviewLinesCollapseOverflow() {
        let proposal = OnboardingTaskProposal(
            id: "onboard_many",
            taskId: "task_many",
            title: "Many",
            confidence: "low",
            reason: "many windows",
            windows: (1...6).map { index in
                OnboardingWindow(id: index, app: "Google Chrome", title: "Tab \(index)", workspace: "desk")
            },
            suggestedNextAction: "Review"
        )

        XCTAssertEqual(onboardingProposalPreviewLines(for: proposal, limit: 3), [
            "Window: Google Chrome - Tab 1",
            "Window: Google Chrome - Tab 2",
            "Window: Google Chrome - Tab 3",
            "+3 more",
        ])
    }
}
