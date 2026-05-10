import AVFoundation
import EventLoopQueueCore
import Foundation
import Speech

public final class AppleSpeechVoiceTranscriptionService: VoiceTranscriptionService, @unchecked Sendable {
    private let recognizer: SFSpeechRecognizer
    private let bufferSource: VoiceBufferSource
    public let maxRecordingSeconds: Double

    public init?(
        locale: Locale = .current,
        maxRecordingSeconds: Double = 6.0,
        bufferSource: VoiceBufferSource? = nil
    ) {
        guard let recognizer = SFSpeechRecognizer(locale: locale) else { return nil }
        self.recognizer = recognizer
        self.bufferSource = bufferSource ?? MicVoiceBufferSource()
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

            var hasResumed = false
            let resumeLock = NSLock()
            let source = self.bufferSource

            func cleanup() {
                source.stop()
            }

            do {
                try source.start { buffer in
                    request.append(buffer)
                }
            } catch {
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
