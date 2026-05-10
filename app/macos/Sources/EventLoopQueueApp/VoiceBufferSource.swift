import AVFoundation
import Foundation

public protocol VoiceBufferSource: AnyObject {
    var recordingFormat: AVAudioFormat { get }
    func start(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws
    func stop()
}
