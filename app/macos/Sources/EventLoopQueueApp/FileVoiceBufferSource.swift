import AVFoundation
import Foundation

public final class FileVoiceBufferSource: VoiceBufferSource {
    private let url: URL
    private let chunkFrames: AVAudioFrameCount
    private let chunkInterval: TimeInterval
    private let audioFile: AVAudioFile
    private var emitterQueue: DispatchQueue?
    private var stopped = false
    private let stopLock = NSLock()

    public init(url: URL, chunkFrames: AVAudioFrameCount = 1024, chunkInterval: TimeInterval = 0) throws {
        self.url = url
        self.chunkFrames = chunkFrames
        self.chunkInterval = chunkInterval
        self.audioFile = try AVAudioFile(forReading: url)
    }

    public var recordingFormat: AVAudioFormat {
        audioFile.processingFormat
    }

    public func start(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        stopLock.lock()
        stopped = false
        stopLock.unlock()

        let queue = DispatchQueue(label: "FileVoiceBufferSource.emit")
        emitterQueue = queue

        let format = audioFile.processingFormat
        let totalFrames = audioFile.length
        let chunk = chunkFrames
        let interval = chunkInterval
        let file = audioFile

        queue.async { [weak self] in
            guard let self else { return }
            file.framePosition = 0
            var remaining = totalFrames
            while remaining > 0 {
                self.stopLock.lock()
                let isStopped = self.stopped
                self.stopLock.unlock()
                if isStopped { return }

                let frames = AVAudioFrameCount(min(Int64(chunk), remaining))
                guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return }
                do {
                    try file.read(into: buffer, frameCount: frames)
                } catch {
                    return
                }
                if buffer.frameLength == 0 { return }
                onBuffer(buffer)
                remaining -= Int64(buffer.frameLength)
                if interval > 0 {
                    Thread.sleep(forTimeInterval: interval)
                }
            }
        }
    }

    public func stop() {
        stopLock.lock()
        stopped = true
        stopLock.unlock()
    }
}
