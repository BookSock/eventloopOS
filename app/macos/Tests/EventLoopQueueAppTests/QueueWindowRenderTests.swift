import EventLoopQueueCore
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
}

private enum RenderSmokeError: Error {
    case contextCreationFailed
}
