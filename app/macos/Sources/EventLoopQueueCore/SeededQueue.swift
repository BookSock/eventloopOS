import Foundation

public enum SeededQueue {
    public static let blogFeedbackWorkspace = WorkspaceSnapshot(
        windows: [
            WorkspaceWindow(id: 9, app: "Ghostty", title: "codex", workspace: "eventloop-blog"),
            WorkspaceWindow(id: 10, app: "Google Chrome", title: "Launch doc", workspace: "eventloop-blog")
        ],
        activeWorkspace: "eventloop-blog",
        focusedWindowId: 9
    )

    public static let packets: [ReviewPacket] = [
        ReviewPacket(
            id: "packet-blog-feedback",
            taskId: "task_blog_feedback",
            title: "Review blog feedback draft",
            summary: "Slack feedback changed positioning. Agent needs human judgment before publishing.",
            source: "slack://thread/blog-feedback",
            priority: 90,
            recommendedAction: "Approve revised angle or ask for another pass.",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 1_767_027_600),
            workspaceSnapshot: blogFeedbackWorkspace
        ),
        ReviewPacket(
            id: "packet-ci-failed",
            title: "CI failed on routing PR",
            summary: "GitHub check failed after agent patch. Needs owner decision before retrying.",
            source: "github://pagerfree/eventloopOS/pull/12",
            priority: 75,
            recommendedAction: "Open failure, choose retry or send back to agent.",
            createdAt: Date(timeIntervalSince1970: 1_767_031_200)
        ),
        ReviewPacket(
            id: "packet-external-send",
            title: "Approve external reply",
            summary: "Draft customer-facing response is ready but side effect requires approval.",
            source: "mail://thread/customer-approval",
            priority: 60,
            recommendedAction: "Review language, then approve send.",
            createdAt: Date(timeIntervalSince1970: 1_767_034_800)
        )
    ]
}
