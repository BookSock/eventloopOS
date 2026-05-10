import Foundation

public protocol CodexForegroundResolver: Sendable {
    func resolveForeground() async -> AdvanceForegroundContext
}

public final class FakeCodexForegroundResolver: CodexForegroundResolver, @unchecked Sendable {
    private let lock = NSLock()
    private var nextResult: AdvanceForegroundContext

    public init(_ initial: AdvanceForegroundContext = .none) {
        self.nextResult = initial
    }

    public func setNext(_ context: AdvanceForegroundContext) {
        lock.withLock { nextResult = context }
    }

    public func resolveForeground() async -> AdvanceForegroundContext {
        lock.withLock { nextResult }
    }
}

public struct NoOpCodexForegroundResolver: CodexForegroundResolver {
    public init() {}
    public func resolveForeground() async -> AdvanceForegroundContext { .none }
}
