import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public protocol CodexForegroundResolver: Sendable {
    func resolveForeground() async -> AdvanceForegroundContext
}

public final class FakeCodexForegroundResolver: CodexForegroundResolver, @unchecked Sendable {
    private let lock = NSLock()
    private var nextResult: AdvanceForegroundContext
    private var readDelayNanoseconds: UInt64

    public init(_ initial: AdvanceForegroundContext = .none, readDelayNanoseconds: UInt64 = 0) {
        self.nextResult = initial
        self.readDelayNanoseconds = readDelayNanoseconds
    }

    public func setNext(_ context: AdvanceForegroundContext) {
        lock.withLock { nextResult = context }
    }

    public func setReadDelayNanoseconds(_ delay: UInt64) {
        lock.withLock { readDelayNanoseconds = delay }
    }

    public func resolveForeground() async -> AdvanceForegroundContext {
        let delay = lock.withLock { readDelayNanoseconds }
        if delay > 0 {
            try? await Task.sleep(nanoseconds: delay)
        }
        return lock.withLock { nextResult }
    }
}

public struct NoOpCodexForegroundResolver: CodexForegroundResolver {
    public init() {}
    public func resolveForeground() async -> AdvanceForegroundContext { .none }
}

public final class HTTPCodexForegroundResolver: CodexForegroundResolver, @unchecked Sendable {
    public let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = QueueCoders.makeDecoder()
    }

    public func resolveForeground() async -> AdvanceForegroundContext {
        let url = baseURL.appending(path: "agents/codex/resolve-foreground")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return .none
            }
            let decoded = try decoder.decode(ResolveForegroundResponse.self, from: data)
            return AdvanceForegroundContext(
                codexThreadId: decoded.codexThreadId,
                ghosttyWindowId: decoded.ghosttyWindowId
            )
        } catch {
            return .none
        }
    }

    private struct ResolveForegroundResponse: Decodable {
        let codexThreadId: String?
        let ghosttyWindowId: String?
        let source: String?

        enum CodingKeys: String, CodingKey {
            case codexThreadId = "codex_thread_id"
            case ghosttyWindowId = "ghostty_window_id"
            case source
        }
    }
}
