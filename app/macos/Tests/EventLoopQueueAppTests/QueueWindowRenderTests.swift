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

        let renderer = ImageRenderer(content: view)
        renderer.scale = 1

        guard let cgImage = renderer.cgImage else {
            XCTFail("QueueWindowView did not render an image")
            return
        }

        XCTAssertGreaterThan(cgImage.width, 800)
        XCTAssertGreaterThan(cgImage.height, 500)
        XCTAssertGreaterThan(try countNonBlankPixels(in: cgImage), 1_000)
        try writePNGArtifact(cgImage, name: "queue-window-selected-packet.png")
    }

    func testQueueWindowRendersLongPacketWithoutBlanking() throws {
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
            client: FakeQueueClient(packets: [packet]),
            initialPackets: [packet]
        )
        let view = QueueWindowView(viewModel: viewModel)
            .frame(width: 700, height: 560)

        let renderer = ImageRenderer(content: view)
        renderer.scale = 1

        guard let cgImage = renderer.cgImage else {
            XCTFail("QueueWindowView did not render a long-content image")
            return
        }

        XCTAssertEqual(cgImage.width, 700)
        XCTAssertEqual(cgImage.height, 560)
        XCTAssertGreaterThan(try countNonBlankPixels(in: cgImage), 1_000)
        try writePNGArtifact(cgImage, name: "queue-window-long-packet.png")
    }

    private func countNonBlankPixels(in image: CGImage) throws -> Int {
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
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            let red = pixels[offset]
            let green = pixels[offset + 1]
            let blue = pixels[offset + 2]
            let alpha = pixels[offset + 3]
            if alpha > 0 && !(red > 245 && green > 245 && blue > 245) {
                nonBlank += 1
            }
        }
        return nonBlank
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
}

private enum RenderSmokeError: Error {
    case contextCreationFailed
    case pngEncodingFailed
    case repoRootNotFound
}
