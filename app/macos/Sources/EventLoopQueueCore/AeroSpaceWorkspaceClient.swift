import Foundation

public protocol AeroSpaceWorkspaceClient: Sendable {
    func focusedWorkspace() async throws -> String
    func switchTo(workspace: String) async throws
}

public enum AeroSpaceWorkspaceClientError: Error, LocalizedError {
    case binaryMissing
    case commandFailed(String)
    case unsafeWorkspaceId(String)

    public var errorDescription: String? {
        switch self {
        case .binaryMissing:
            return "AeroSpace CLI not found on PATH"
        case let .commandFailed(detail):
            return "AeroSpace CLI failed: \(detail)"
        case let .unsafeWorkspaceId(id):
            return "Unsafe AeroSpace workspace id: \(id)"
        }
    }
}

public struct ProcessAeroSpaceWorkspaceClient: AeroSpaceWorkspaceClient {
    public init() {}

    public func focusedWorkspace() async throws -> String {
        let output = try await runAeroSpace(args: ["list-workspaces", "--focused"])
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            throw AeroSpaceWorkspaceClientError.commandFailed("empty focused-workspace output")
        }
        return trimmed
    }

    public func switchTo(workspace: String) async throws {
        try assertSafeWorkspaceId(workspace)
        _ = try await runAeroSpace(args: ["workspace", workspace])
    }

    private func runAeroSpace(args: [String]) async throws -> String {
        try await Task.detached { () throws -> String in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["aerospace"] + args
            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr
            do {
                try process.run()
            } catch {
                throw AeroSpaceWorkspaceClientError.binaryMissing
            }
            process.waitUntilExit()
            let out = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let err = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            if process.terminationStatus != 0 {
                throw AeroSpaceWorkspaceClientError.commandFailed(err.isEmpty ? "exit \(process.terminationStatus)" : err)
            }
            return out
        }.value
    }

    private func assertSafeWorkspaceId(_ id: String) throws {
        let pattern = #"^[A-Za-z0-9._:-]+$"#
        if id.range(of: pattern, options: .regularExpression) == nil {
            throw AeroSpaceWorkspaceClientError.unsafeWorkspaceId(id)
        }
    }
}

public final class FakeAeroSpaceWorkspaceClient: AeroSpaceWorkspaceClient, @unchecked Sendable {
    private let lock = NSLock()
    private var focused: String
    private var switchHistory: [String] = []
    private var switchError: Error?

    public init(focused: String = "1") {
        self.focused = focused
    }

    public var switchedWorkspaces: [String] {
        lock.withLock { switchHistory }
    }

    public func setFocused(_ workspace: String) {
        lock.withLock { focused = workspace }
    }

    public func setSwitchError(_ error: Error?) {
        lock.withLock { switchError = error }
    }

    public func focusedWorkspace() async throws -> String {
        lock.withLock { focused }
    }

    public func switchTo(workspace: String) async throws {
        try lock.withLock {
            if let switchError { throw switchError }
            switchHistory.append(workspace)
            focused = workspace
        }
    }
}

public struct NoOpAeroSpaceWorkspaceClient: AeroSpaceWorkspaceClient {
    public init() {}
    public func focusedWorkspace() async throws -> String { "1" }
    public func switchTo(workspace _: String) async throws {}
}
