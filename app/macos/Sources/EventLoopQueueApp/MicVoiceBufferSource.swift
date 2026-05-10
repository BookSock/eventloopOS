import AVFoundation
import Foundation

public final class MicVoiceBufferSource: VoiceBufferSource {
    private let audioEngine: AVAudioEngine
    private let bus: AVAudioNodeBus
    private let bufferSize: AVAudioFrameCount

    public init(audioEngine: AVAudioEngine = AVAudioEngine(), bus: AVAudioNodeBus = 0, bufferSize: AVAudioFrameCount = 1024) {
        self.audioEngine = audioEngine
        self.bus = bus
        self.bufferSize = bufferSize
    }

    public var recordingFormat: AVAudioFormat {
        audioEngine.inputNode.outputFormat(forBus: bus)
    }

    public func start(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: bus)
        inputNode.installTap(onBus: bus, bufferSize: bufferSize, format: format) { buffer, _ in
            onBuffer(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            inputNode.removeTap(onBus: bus)
            throw error
        }
    }

    public func stop() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: bus)
    }
}
