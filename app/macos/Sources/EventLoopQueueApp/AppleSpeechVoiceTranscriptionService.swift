import AVFoundation
import EventLoopQueueCore
import Foundation
import Speech

public final class AppleSpeechVoiceTranscriptionService: VoiceTranscriptionService, @unchecked Sendable {
    private let recognizer: SFSpeechRecognizer
    private let audioEngine: AVAudioEngine
    private let maxRecordingSeconds: Double

    public init?(locale: Locale = .current, maxRecordingSeconds: Double = 6.0) {
        guard let recognizer = SFSpeechRecognizer(locale: locale) else { return nil }
        self.recognizer = recognizer
        self.audioEngine = AVAudioEngine()
        self.maxRecordingSeconds = maxRecordingSeconds
    }

    public func transcribeOneUtterance() async throws -> String {
        let authStatus = await Self.requestAuthorization()
        guard authStatus == .authorized else {
            throw NSError(domain: "AppleSpeech", code: Int(authStatus.rawValue), userInfo: [
                NSLocalizedDescriptionKey: "Speech recognition not authorized: \(authStatus.rawValue)"
            ])
        }
        guard recognizer.isAvailable else {
            throw NSError(domain: "AppleSpeech", code: -1, userInfo: [NSLocalizedDescriptionKey: "Speech recognizer is not available right now."])
        }

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true

            let inputNode = self.audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            var hasResumed = false
            let resumeLock = NSLock()

            func cleanup() {
                self.audioEngine.stop()
                inputNode.removeTap(onBus: 0)
            }

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
                request.append(buffer)
            }

            self.audioEngine.prepare()
            do {
                try self.audioEngine.start()
            } catch {
                inputNode.removeTap(onBus: 0)
                continuation.resume(throwing: error)
                return
            }

            var recognitionTask: SFSpeechRecognitionTask?
            recognitionTask = self.recognizer.recognitionTask(with: request) { result, error in
                resumeLock.lock()
                if hasResumed { resumeLock.unlock(); return }
                if let error {
                    hasResumed = true
                    resumeLock.unlock()
                    cleanup()
                    continuation.resume(throwing: error)
                    return
                }
                if let result, result.isFinal {
                    hasResumed = true
                    resumeLock.unlock()
                    cleanup()
                    continuation.resume(returning: result.bestTranscription.formattedString)
                    return
                }
                resumeLock.unlock()
            }

            DispatchQueue.global().asyncAfter(deadline: .now() + self.maxRecordingSeconds) {
                request.endAudio()
                resumeLock.lock()
                if hasResumed { resumeLock.unlock(); return }
                resumeLock.unlock()
                // Allow up to 1.5s for the recognizer to finalize after endAudio.
                DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) {
                    resumeLock.lock()
                    if hasResumed { resumeLock.unlock(); return }
                    hasResumed = true
                    resumeLock.unlock()
                    cleanup()
                    recognitionTask?.cancel()
                    continuation.resume(throwing: NSError(
                        domain: "AppleSpeech",
                        code: -2,
                        userInfo: [NSLocalizedDescriptionKey: "Speech recognition timed out without a final result."]
                    ))
                }
            }
        }
    }

    public static func isConfigured() -> Bool {
        SFSpeechRecognizer(locale: .current) != nil
    }

    private static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }
}
