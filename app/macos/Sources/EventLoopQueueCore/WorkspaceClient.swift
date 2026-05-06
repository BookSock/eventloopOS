import Foundation

public protocol WorkspaceClient: Sendable {
    func status() async throws -> WorkspaceStatusEnvelope
    func restorePlan(snapshot: WorkspaceSnapshot, currentWindows: [WorkspaceWindow]?) async throws -> WorkspaceRestorePlanEnvelope
}

public struct WorkspaceStatusEnvelope: Codable, Equatable, Sendable {
    public let status: WorkspaceCapabilityStatus
    public let executeSupported: Bool

    public init(status: WorkspaceCapabilityStatus, executeSupported: Bool) {
        self.status = status
        self.executeSupported = executeSupported
    }

    enum CodingKeys: String, CodingKey {
        case status
        case executeSupported = "execute_supported"
    }
}

public struct WorkspaceCapabilityStatus: Codable, Equatable, Sendable {
    public let available: Bool
    public let backend: String
    public let reason: String?
    public let detail: String?

    public init(available: Bool, backend: String = "aerospace", reason: String? = nil, detail: String? = nil) {
        self.available = available
        self.backend = backend
        self.reason = reason
        self.detail = detail
    }
}

public struct WorkspaceSnapshot: Codable, Equatable, Sendable {
    public let backend: String
    public let windows: [WorkspaceWindow]
    public let activeWorkspace: String?
    public let focusedWindowId: Int?

    public init(
        backend: String = "aerospace",
        windows: [WorkspaceWindow],
        activeWorkspace: String? = nil,
        focusedWindowId: Int? = nil
    ) {
        self.backend = backend
        self.windows = windows
        self.activeWorkspace = activeWorkspace
        self.focusedWindowId = focusedWindowId
    }

    enum CodingKeys: String, CodingKey {
        case backend
        case windows
        case activeWorkspace
        case focusedWindowId
    }
}

public struct WorkspaceWindow: Codable, Equatable, Sendable {
    public let id: Int
    public let app: String
    public let title: String
    public let workspace: String

    public init(id: Int, app: String, title: String, workspace: String) {
        self.id = id
        self.app = app
        self.title = title
        self.workspace = workspace
    }
}

public struct WorkspaceRestorePlanEnvelope: Codable, Equatable, Sendable {
    public let plan: WorkspaceRestorePlan
    public let executeSupported: Bool

    public init(plan: WorkspaceRestorePlan, executeSupported: Bool) {
        self.plan = plan
        self.executeSupported = executeSupported
    }

    enum CodingKeys: String, CodingKey {
        case plan
        case executeSupported = "execute_supported"
    }
}

public struct WorkspaceRestorePlan: Codable, Equatable, Sendable {
    public let commands: [WorkspaceCommand]
    public let skipped: [WorkspaceRestoreSkip]

    public init(commands: [WorkspaceCommand], skipped: [WorkspaceRestoreSkip]) {
        self.commands = commands
        self.skipped = skipped
    }
}

public struct WorkspaceCommand: Codable, Equatable, Sendable {
    public let command: String
    public let args: [String]

    public init(command: String, args: [String]) {
        self.command = command
        self.args = args
    }
}

public struct WorkspaceRestoreSkip: Codable, Equatable, Sendable {
    public let reason: String
    public let windowId: Int
    public let workspace: String

    public init(reason: String, windowId: Int, workspace: String) {
        self.reason = reason
        self.windowId = windowId
        self.workspace = workspace
    }

    enum CodingKeys: String, CodingKey {
        case reason
        case windowId
        case workspace
    }
}

public enum WorkspaceRestoreState: Equatable, Sendable {
    case idle
    case skippedManualMode
    case planned(WorkspaceRestorePlan)
    case failed(String)
}

public struct HTTPWorkspaceClient: WorkspaceClient {
    public let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = QueueCoders.makeDecoder()
        self.encoder = QueueCoders.makeEncoder()
    }

    public func status() async throws -> WorkspaceStatusEnvelope {
        let url = baseURL.appending(path: "workspace/status")
        let (data, response) = try await session.data(from: url)
        try validate(response: response)
        return try decoder.decode(WorkspaceStatusEnvelope.self, from: data)
    }

    public func restorePlan(
        snapshot: WorkspaceSnapshot,
        currentWindows: [WorkspaceWindow]? = nil
    ) async throws -> WorkspaceRestorePlanEnvelope {
        let url = baseURL.appending(path: "workspace/restore-plan")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(WorkspaceRestorePlanRequest(snapshot: snapshot, currentWindows: currentWindows))

        let (data, response) = try await session.data(for: request)
        try validate(response: response)
        return try decoder.decode(WorkspaceRestorePlanEnvelope.self, from: data)
    }

    private func validate(response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw QueueClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw QueueClientError.httpStatus(httpResponse.statusCode)
        }
    }
}

private struct WorkspaceRestorePlanRequest: Encodable {
    let snapshot: WorkspaceSnapshot
    let currentWindows: [WorkspaceWindow]?

    enum CodingKeys: String, CodingKey {
        case snapshot
        case currentWindows = "current_windows"
    }
}

public final class FakeWorkspaceClient: WorkspaceClient, @unchecked Sendable {
    private let lock = NSLock()
    private let statusEnvelope: WorkspaceStatusEnvelope
    private let planEnvelope: WorkspaceRestorePlanEnvelope
    private var requestedSnapshots: [WorkspaceSnapshot] = []

    public init(
        statusEnvelope: WorkspaceStatusEnvelope = WorkspaceStatusEnvelope(
            status: WorkspaceCapabilityStatus(available: true),
            executeSupported: false
        ),
        planEnvelope: WorkspaceRestorePlanEnvelope = WorkspaceRestorePlanEnvelope(
            plan: WorkspaceRestorePlan(commands: [], skipped: []),
            executeSupported: false
        )
    ) {
        self.statusEnvelope = statusEnvelope
        self.planEnvelope = planEnvelope
    }

    public var restorePlanSnapshots: [WorkspaceSnapshot] {
        lock.withLock { requestedSnapshots }
    }

    public func status() async throws -> WorkspaceStatusEnvelope {
        statusEnvelope
    }

    public func restorePlan(snapshot: WorkspaceSnapshot, currentWindows: [WorkspaceWindow]?) async throws -> WorkspaceRestorePlanEnvelope {
        lock.withLock {
            requestedSnapshots.append(snapshot)
        }
        return planEnvelope
    }
}

public struct NoOpWorkspaceClient: WorkspaceClient {
    public init() {}

    public func status() async throws -> WorkspaceStatusEnvelope {
        WorkspaceStatusEnvelope(
            status: WorkspaceCapabilityStatus(available: false, reason: "not_configured"),
            executeSupported: false
        )
    }

    public func restorePlan(snapshot: WorkspaceSnapshot, currentWindows: [WorkspaceWindow]?) async throws -> WorkspaceRestorePlanEnvelope {
        WorkspaceRestorePlanEnvelope(
            plan: WorkspaceRestorePlan(commands: [], skipped: []),
            executeSupported: false
        )
    }
}

