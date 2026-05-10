import AVFoundation
import XCTest
@testable import EventLoopQueueApp

final class VoiceBufferSourceTests: XCTestCase {
    func testFileVoiceBufferSourceEmitsBuffersFromSynthesizedWav() throws {
        let url = try writeSyntheticWav(durationSeconds: 0.25, sampleRate: 16_000)
        defer { try? FileManager.default.removeItem(at: url) }

        let source = try FileVoiceBufferSource(url: url, chunkFrames: 1024)
        XCTAssertEqual(source.recordingFormat.sampleRate, 16_000)

        let collected = NSMutableArray()
        let collectedLock = NSLock()
        let done = expectation(description: "buffers emitted")

        try source.start { buffer in
            collectedLock.lock()
            collected.add(NSNumber(value: buffer.frameLength))
            collectedLock.unlock()
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
            done.fulfill()
        }
        wait(for: [done], timeout: 2.0)
        source.stop()

        collectedLock.lock()
        let counts = (collected as? [NSNumber])?.map { $0.uint32Value } ?? []
        collectedLock.unlock()

        XCTAssertFalse(counts.isEmpty, "FileVoiceBufferSource emitted zero buffers")
        let totalFrames = counts.reduce(UInt32(0), +)
        // 0.25s * 16_000 = 4000 frames; allow slack for chunk alignment.
        XCTAssertGreaterThanOrEqual(totalFrames, 3_500)
        XCTAssertLessThanOrEqual(totalFrames, 4_500)
    }

    func testFileVoiceBufferSourceStopsCleanly() throws {
        let url = try writeSyntheticWav(durationSeconds: 0.25, sampleRate: 16_000)
        defer { try? FileManager.default.removeItem(at: url) }

        let source = try FileVoiceBufferSource(url: url, chunkFrames: 256, chunkInterval: 0.05)
        let calls = NSMutableArray()
        let lock = NSLock()
        try source.start { _ in
            lock.lock()
            calls.add(NSNumber(value: 1))
            lock.unlock()
        }
        Thread.sleep(forTimeInterval: 0.05)
        source.stop()
        Thread.sleep(forTimeInterval: 0.2)
        lock.lock()
        let count = calls.count
        lock.unlock()
        XCTAssertGreaterThan(count, 0)
        XCTAssertLessThan(count, 30, "stop() did not halt emission promptly")
    }

    func testMicVoiceBufferSourceExposesInputNodeFormat() {
        let source = MicVoiceBufferSource()
        let format = source.recordingFormat
        XCTAssertGreaterThan(format.sampleRate, 0)
        XCTAssertGreaterThan(format.channelCount, 0)
    }

    private func writeSyntheticWav(durationSeconds: Double, sampleRate: Double) throws -> URL {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("eventloopos-vbs-\(UUID().uuidString).wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]
        let file = try AVAudioFile(forWriting: tmp, settings: settings)
        let writeFormat = file.processingFormat
        let frameCount = AVAudioFrameCount(durationSeconds * sampleRate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: writeFormat, frameCapacity: frameCount) else {
            throw NSError(domain: "test", code: 2)
        }
        buffer.frameLength = frameCount
        if let floatChannels = buffer.floatChannelData {
            let channel = floatChannels[0]
            for i in 0..<Int(frameCount) {
                let t = Double(i) / sampleRate
                channel[i] = Float(0.2 * sin(2.0 * .pi * 440.0 * t))
            }
        }
        try file.write(from: buffer)
        return tmp
    }
}
