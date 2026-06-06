import EventLoopQueueCore
import AppKit
import SwiftUI
import XCTest
@testable import EventLoopQueueApp

@MainActor
final class QueueWindowRenderTests: XCTestCase {
    func testQueueWindowRendersSelectedPacket() throws {
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            initialPackets: SeededQueue.packets
        )
        let view = QueueWindowView(viewModel: viewModel)
            .frame(width: 900, height: 540)

        let cgImage = try render(view, width: 900, height: 540)

        XCTAssertGreaterThan(cgImage.width, 800)
        XCTAssertGreaterThan(cgImage.height, 500)
        try assertQueueSurfaceRendered(in: cgImage)
        try writePNGArtifact(cgImage, name: "queue-window-selected-packet.png")
    }

    func testQueueWindowRendersLongPacketWithoutBlanking() async throws {
        let packet = ReviewPacket(
            id: "packet-long-copy",
            taskId: "task_long_copy",
            title: "Review launch coordination packet with very long title that must wrap instead of pushing controls out of the one-paper surface",
            summary: "Slack, GitHub, browser context, and draft copy all changed while agents were working in the background. Human needs one compact decision packet with enough detail to decide quickly without losing the stack or hiding the action buttons.",
            decisionNeeded: "Choose whether launch copy should prioritize onboarding risk, feature velocity, or upcoming event narrative before agent resumes drafting.",
            source: "slack://thread/long-packet",
            priority: 95,
            riskLevel: "high",
            confidence: "medium",
            riskTags: ["external-send", "launch-copy", "agent-handoff"],
            contextResources: [
                ReviewContextResource(
                    id: "resource-long-doc",
                    kind: "browser_tab",
                    title: "Launch narrative doc with long heading",
                    url: "https://docs.example.test/launch-narrative"
                )
            ],
            evidence: [
                ReviewEvidence(
                    id: "evidence-long-slack",
                    kind: "slack_message",
                    title: "Launch detail request",
                    url: "slack://thread/long-packet"
                )
            ],
            recommendedAction: "Send packet back to the bound writing agent with selected narrative priority.",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 1_767_040_000),
            workspaceSnapshot: SeededQueue.blogFeedbackWorkspace
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(
                packets: [packet],
                taskSessions: [
                    TaskSession(
                        id: "codex_thread_launch_copy",
                        taskId: "task_long_copy",
                        provider: "codex",
                        status: "running",
                        name: "Launch copy agent",
                        preview: "Waiting for narrative priority"
                    )
                ]
            ),
            initialPackets: [packet]
        )
        await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        let view = QueueWindowView(viewModel: viewModel)
            .frame(width: 700, height: 560)

        let cgImage = try render(view, width: 700, height: 560)

        XCTAssertEqual(cgImage.width, 700)
        XCTAssertEqual(cgImage.height, 560)
        try assertQueueSurfaceRendered(in: cgImage)
        try writePNGArtifact(cgImage, name: "queue-window-long-packet.png")
    }

    func testQueueWindowRendersLoadedLineageWithoutBlanking() async throws {
        let packet = SeededQueue.packets[0]
        let viewModel = QueueViewModel(
            client: FakeQueueClient(
                packets: [packet],
                queueLineageResult: .success(makeLineage(queueItemId: packet.id))
            ),
            initialPackets: [packet]
        )
        await viewModel.loadLineageForSelectedPacket()
        let view = QueueWindowView(viewModel: viewModel)
            .frame(width: 760, height: 560)

        let cgImage = try render(view, width: 760, height: 560)

        XCTAssertEqual(cgImage.width, 760)
        XCTAssertEqual(cgImage.height, 560)
        try assertQueueSurfaceRendered(in: cgImage)
        try writePNGArtifact(cgImage, name: "queue-window-loaded-lineage.png")
    }

    func testQueueWindowRendersTaskIdentityAndSendBackTargetWithoutBlanking() async throws {
        let packet = ReviewPacket(
            id: "packet-agent-target",
            taskId: "task_blog_feedback",
            title: "Review agent handoff target",
            summary: "Human needs to see exact session before sending back.",
            source: "slack://thread/agent-target",
            priority: 91,
            recommendedAction: "Send selected answer to agent",
            recommendedActionType: "resume_agent",
            createdAt: Date(timeIntervalSince1970: 1_767_040_000),
            workspaceSnapshot: WorkspaceSnapshot(
                windows: [
                    WorkspaceWindow(id: 1, app: "Ghostty", title: "codex [task:blog feedback]", workspace: "eventloop-blog"),
                    WorkspaceWindow(id: 2, app: "Safari", title: "Launch doc", workspace: "eventloop-blog")
                ],
                activeWorkspace: "eventloop-blog"
            )
        )
        let viewModel = QueueViewModel(
            client: FakeQueueClient(
                packets: [packet],
                taskSessions: [
                    TaskSession(
                        id: "codex_thread_blog_feedback",
                        taskId: "task_blog_feedback",
                        provider: "codex",
                        status: "running",
                        name: "Blog feedback agent",
                        preview: "Waiting for send-back decision"
                    )
                ]
            ),
            initialPackets: [packet]
        )
        await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        let view = QueueWindowView(viewModel: viewModel)
            .frame(width: 760, height: 560)

        let cgImage = try render(view, width: 760, height: 560)

        XCTAssertEqual(cgImage.width, 760)
        XCTAssertEqual(cgImage.height, 560)
        try assertQueueSurfaceRendered(in: cgImage)
        try writePNGArtifact(cgImage, name: "queue-window-task-identity.png")
    }

    func testQueueWindowRendersWorkspaceHealthWarningWithoutBlanking() async throws {
        let viewModel = QueueViewModel(
            client: FakeQueueClient(packets: SeededQueue.packets),
            workspaceClient: FakeWorkspaceClient(statusEnvelope: WorkspaceStatusEnvelope(
                status: WorkspaceCapabilityStatus(
                    available: false,
                    backend: "aerospace",
                    reason: "server_unavailable",
                    detail: "AeroSpace app is not running"
                ),
                executeSupported: false
            )),
            initialPackets: SeededQueue.packets
        )
        await viewModel.refreshWorkspaceStatus()
        let view = QueueWindowView(viewModel: viewModel)
            .frame(width: 760, height: 560)

        let cgImage = try render(view, width: 760, height: 560)

        XCTAssertEqual(cgImage.width, 760)
        XCTAssertEqual(cgImage.height, 560)
        try assertQueueSurfaceRendered(in: cgImage)
        try writePNGArtifact(cgImage, name: "queue-window-workspace-health-warning.png")
    }

    func testFollowsRulesSheetRendersExactWindowActionWithoutBlanking() throws {
        let view = FollowsRulesSheet(
            exclusions: [
                FollowsWindowExclusion(
                    exclusionId: "fwex_chrome_staging",
                    appBundle: "com.google.Chrome",
                    titleSubstring: "Staging Report"
                )
            ],
            suggestions: [
                FollowsWindowSuggestion(
                    appName: "Google Chrome",
                    appBundle: "com.google.Chrome",
                    title: "Playwright Report",
                    workspace: "eventloop-customer"
                ),
                FollowsWindowSuggestion(
                    appName: "team-eng | slack",
                    appBundle: "com.tinyspeck.slackmacgap",
                    title: "team-eng | slack",
                    workspace: "eventloop-customer, eventloop-ops",
                    isCurrentFollowsCandidate: true
                ),
            ],
            state: .loaded,
            refresh: {},
            add: { _, _ in },
            delete: { _ in }
        )
        .frame(width: 640, height: 520)

        let cgImage = try render(view, width: 640, height: 520)

        XCTAssertEqual(cgImage.width, 640)
        XCTAssertEqual(cgImage.height, 520)
        try assertQueueSurfaceRendered(in: cgImage)
        try writePNGArtifact(cgImage, name: "follows-rules-exact-window-action.png")
    }

    private func render<Content: View>(_ view: Content, width: CGFloat, height: CGFloat) throws -> CGImage {
        let hostingView = NSHostingView(rootView:
            ZStack {
                Color(nsColor: .windowBackgroundColor)
                view
            }
            .environment(\.colorScheme, .light)
        )
        hostingView.frame = CGRect(x: 0, y: 0, width: width, height: height)
        hostingView.layoutSubtreeIfNeeded()
        guard let bitmap = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds) else {
            throw RenderSmokeError.contextCreationFailed
        }
        hostingView.cacheDisplay(in: hostingView.bounds, to: bitmap)
        guard let image = bitmap.cgImage else {
            throw RenderSmokeError.contextCreationFailed
        }
        return image
    }

    private func assertQueueSurfaceRendered(in image: CGImage) throws {
        let stats = try pixelStats(in: image)
        XCTAssertGreaterThan(stats.nonBlank, 1_000)
        XCTAssertLessThan(
            stats.yellowBackgroundRatio,
            0.5,
            "Render output looks like an SF Symbol fallback placeholder, not the queue UI."
        )
        XCTAssertLessThan(
            stats.redForegroundRatio,
            0.25,
            "Render output looks like an SF Symbol fallback placeholder, not the queue UI."
        )
    }

    private func pixelStats(in image: CGImage) throws -> (nonBlank: Int, yellowBackgroundRatio: Double, redForegroundRatio: Double) {
        let width = image.width
        let height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw RenderSmokeError.contextCreationFailed
        }

        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

        var nonBlank = 0
        var yellowBackground = 0
        var redForeground = 0
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            let red = pixels[offset]
            let green = pixels[offset + 1]
            let blue = pixels[offset + 2]
            let alpha = pixels[offset + 3]
            if alpha > 0 && !(red > 245 && green > 245 && blue > 245) {
                nonBlank += 1
            }
            if alpha > 0 && red > 230 && green > 170 && blue < 40 {
                yellowBackground += 1
            }
            if alpha > 0 && red > 220 && green < 80 && blue < 90 {
                redForeground += 1
            }
        }
        let total = Double(width * height)
        return (nonBlank, Double(yellowBackground) / total, Double(redForeground) / total)
    }

    private func writePNGArtifact(_ image: CGImage, name: String) throws {
        let root = try repoRoot()
        let directory = root.appendingPathComponent("artifacts/screenshots", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw RenderSmokeError.pngEncodingFailed
        }
        try data.write(to: url, options: .atomic)
        XCTAssertGreaterThan(try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? UInt64 ?? 0, 1_000)
    }

    private func repoRoot() throws -> URL {
        var directory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        for _ in 0..<6 {
            if FileManager.default.fileExists(atPath: directory.appendingPathComponent("pnpm-workspace.yaml").path) {
                return directory
            }
            directory.deleteLastPathComponent()
        }
        throw RenderSmokeError.repoRootNotFound
    }

    private func makeLineage(queueItemId: String) -> QueueLineage {
        QueueLineage(
            queueItem: QueueLineageQueueItem(id: queueItemId, state: "ready", taskId: "task_blog_feedback", priorityScore: 90),
            relatedEventIds: ["evt_review_1"],
            events: [
                QueueLineageEvent(
                    id: "evt_review_1",
                    source: "slack",
                    sourceId: "slack:launch",
                    type: "slack_message",
                    title: "Launch feedback",
                    summary: "Blog needs launch detail.",
                    occurredAt: Date(timeIntervalSince1970: 1_767_096_000)
                )
            ],
            activity: [
                QueueLineageActivity(
                    id: "actv_1",
                    type: "task_followup_sent",
                    occurredAt: Date(timeIntervalSince1970: 1_767_096_300),
                    status: "ok",
                    summary: "Task followup sent",
                    eventId: "evt_review_1",
                    taskSessionId: "task_session_blog"
                ),
                QueueLineageActivity(
                    id: "actv_2",
                    type: "queue_item_done",
                    occurredAt: Date(timeIntervalSince1970: 1_767_096_360),
                    status: "ok",
                    summary: "Human marked queue item done after reviewing agent output.",
                    eventId: "evt_review_1",
                    taskSessionId: "task_session_blog"
                ),
                QueueLineageActivity(
                    id: "actv_3",
                    type: "task_followup_failed",
                    occurredAt: Date(timeIntervalSince1970: 1_767_096_420),
                    status: "failed",
                    summary: "Older failed followup stayed visible for debugging.",
                    eventId: "evt_review_1",
                    taskSessionId: "task_session_blog"
                )
            ],
            taskMessages: [
                QueueLineageTaskMessage(
                    id: "task_msg_1",
                    durableId: "task_msg_durable_1",
                    taskSessionId: "task_session_blog",
                    origin: "queue_action",
                    status: "sent",
                    eventIds: ["evt_review_1"],
                    textHash: "abc",
                    textLength: 42
                ),
                QueueLineageTaskMessage(
                    id: "task_msg_2",
                    durableId: "task_msg_durable_2",
                    taskSessionId: "task_session_blog",
                    origin: "event_route",
                    status: "failed",
                    eventIds: ["evt_review_1"],
                    textHash: "def",
                    textLength: 84,
                    error: "runtime failed"
                ),
                QueueLineageTaskMessage(
                    id: "task_msg_3",
                    durableId: "task_msg_durable_3",
                    taskSessionId: "task_session_blog",
                    origin: "voice_command",
                    status: "blocked",
                    eventIds: ["evt_review_1"],
                    textHash: "ghi",
                    textLength: 21,
                    error: "policy blocked"
                )
            ],
            counts: QueueLineageCounts(events: 1, activity: 3, taskMessages: 3)
        )
    }
}

private enum RenderSmokeError: Error {
    case contextCreationFailed
    case pngEncodingFailed
    case repoRootNotFound
}
