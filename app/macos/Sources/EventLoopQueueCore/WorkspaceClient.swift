import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public protocol WorkspaceClient: Sendable {
    func status() async throws -> WorkspaceStatusEnvelope
    func capture() async throws -> WorkspaceSnapshot
    func restorePlan(snapshot: WorkspaceSnapshot, currentWindows: [WorkspaceWindow]?) async throws -> WorkspaceRestorePlanEnvelope
    func restore(snapshot: WorkspaceSnapshot, currentWindows: [WorkspaceWindow]?, idempotencyKey: String) async throws -> WorkspaceRestoreExecutionEnvelope
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

public struct WorkspaceCaptureEnvelope: Codable, Equatable, Sendable {
    public let snapshot: WorkspaceSnapshot

    public init(snapshot: WorkspaceSnapshot) {
        self.snapshot = snapshot
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
    public let monitorId: Int?
    public let pid: Int?
    public let appBundleId: String?
    public let layout: String?
    public let frame: WorkspaceWindowFrame?

    public init(
        id: Int,
        app: String,
        title: String,
        workspace: String,
        monitorId: Int? = nil,
        pid: Int? = nil,
        appBundleId: String? = nil,
        layout: String? = nil,
        frame: WorkspaceWindowFrame? = nil
    ) {
        self.id = id
        self.app = app
        self.title = title
        self.workspace = workspace
        self.monitorId = monitorId
        self.pid = pid
        self.appBundleId = appBundleId
        self.layout = layout
        self.frame = frame
    }

    enum CodingKeys: String, CodingKey {
        case id
        case app
        case title
        case workspace
        case monitorId
        case pid
        case appBundleId
        case layout
        case frame
    }
}

public struct WorkspaceWindowFrame: Codable, Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
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

public struct WorkspaceRestoreExecutionEnvelope: Codable, Equatable, Sendable {
    public let ok: Bool
    public let plan: WorkspaceRestorePlan
    public let receipt: WorkspaceRestoreReceipt
    public let executeSupported: Bool
    public let idempotencyKey: String

    public init(
        ok: Bool,
        plan: WorkspaceRestorePlan,
        receipt: WorkspaceRestoreReceipt,
        executeSupported: Bool,
        idempotencyKey: String
    ) {
        self.ok = ok
        self.plan = plan
        self.receipt = receipt
        self.executeSupported = executeSupported
        self.idempotencyKey = idempotencyKey
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case plan
        case receipt
        case executeSupported = "execute_supported"
        case idempotencyKey = "idempotency_key"
    }
}

public struct WorkspaceRestoreReceipt: Codable, Equatable, Sendable {
    public let commands: [WorkspaceExecutedCommand]
    public let skipped: [WorkspaceRestoreSkip]

    public init(commands: [WorkspaceExecutedCommand], skipped: [WorkspaceRestoreSkip]) {
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

public struct WorkspaceExecutedCommand: Codable, Equatable, Sendable {
    public let command: String
    public let args: [String]
    public let stdout: String?
    public let stderr: String?

    public init(command: String, args: [String], stdout: String? = nil, stderr: String? = nil) {
        self.command = command
        self.args = args
        self.stdout = stdout
        self.stderr = stderr
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
    case restoring
    case planned(WorkspaceRestorePlan)
    case executed(WorkspaceRestoreReceipt)
    case savedTaskLayout(String)
    case keptCurrentLayout
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
        try validate(data: data, response: response)
        return try decoder.decode(WorkspaceStatusEnvelope.self, from: data)
    }

    public func capture() async throws -> WorkspaceSnapshot {
        let url = baseURL.appending(path: "workspace/capture")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"

        let (data, response) = try await session.data(for: request)
        try validate(data: data, response: response)
        return try decoder.decode(WorkspaceCaptureEnvelope.self, from: data).snapshot
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
        try validate(data: data, response: response)
        return try decoder.decode(WorkspaceRestorePlanEnvelope.self, from: data)
    }

    public func restore(
        snapshot: WorkspaceSnapshot,
        currentWindows: [WorkspaceWindow]? = nil,
        idempotencyKey: String
    ) async throws -> WorkspaceRestoreExecutionEnvelope {
        let url = baseURL.appending(path: "workspace/restore")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try encoder.encode(WorkspaceRestoreRequest(snapshot: snapshot, currentWindows: currentWindows))

        let (data, response) = try await session.data(for: request)
        try validate(data: data, response: response)
        return try decoder.decode(WorkspaceRestoreExecutionEnvelope.self, from: data)
    }

    private func validate(data: Data, response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw QueueClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let detail = HTTPErrorEnvelope.decodeMessage(from: data, decoder: decoder)
            if let detail {
                throw QueueClientError.httpStatusMessage(httpResponse.statusCode, detail)
            }
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

private struct WorkspaceRestoreRequest: Encodable {
    let snapshot: WorkspaceSnapshot
    let currentWindows: [WorkspaceWindow]?
    let confirmExecute = true

    enum CodingKeys: String, CodingKey {
        case snapshot
        case currentWindows = "current_windows"
        case confirmExecute = "confirm_execute"
    }
}

public final class FakeWorkspaceClient: WorkspaceClient, @unchecked Sendable {
    private let lock = NSLock()
    private let statusEnvelope: WorkspaceStatusEnvelope
    private let captureSnapshot: WorkspaceSnapshot
    private let planEnvelope: WorkspaceRestorePlanEnvelope
    private let restoreEnvelope: WorkspaceRestoreExecutionEnvelope
    private let captureDelayNanoseconds: UInt64
    private let restoreDelayNanoseconds: UInt64
    private var captureCount = 0
    private var requestedSnapshots: [WorkspaceSnapshot] = []
    private var restoreSnapshots: [WorkspaceSnapshot] = []
    private var restoreKeys: [String] = []

    public init(
        statusEnvelope: WorkspaceStatusEnvelope = WorkspaceStatusEnvelope(
            status: WorkspaceCapabilityStatus(available: true),
            executeSupported: false
        ),
        captureSnapshot: WorkspaceSnapshot = WorkspaceSnapshot(windows: []),
        planEnvelope: WorkspaceRestorePlanEnvelope = WorkspaceRestorePlanEnvelope(
            plan: WorkspaceRestorePlan(commands: [], skipped: []),
            executeSupported: false
        ),
        restoreEnvelope: WorkspaceRestoreExecutionEnvelope = WorkspaceRestoreExecutionEnvelope(
            ok: true,
            plan: WorkspaceRestorePlan(commands: [], skipped: []),
            receipt: WorkspaceRestoreReceipt(commands: [], skipped: []),
            executeSupported: true,
            idempotencyKey: "idem_fake_workspace_restore"
        ),
        captureDelayNanoseconds: UInt64 = 0,
        restoreDelayNanoseconds: UInt64 = 0
    ) {
        self.statusEnvelope = statusEnvelope
        self.captureSnapshot = captureSnapshot
        self.planEnvelope = planEnvelope
        self.restoreEnvelope = restoreEnvelope
        self.captureDelayNanoseconds = captureDelayNanoseconds
        self.restoreDelayNanoseconds = restoreDelayNanoseconds
    }

    public var workspaceCaptureCount: Int {
        lock.withLock { captureCount }
    }

    public var restorePlanSnapshots: [WorkspaceSnapshot] {
        lock.withLock { requestedSnapshots }
    }

    public var workspaceRestoreSnapshots: [WorkspaceSnapshot] {
        lock.withLock { restoreSnapshots }
    }

    public var restoreIdempotencyKeys: [String] {
        lock.withLock { restoreKeys }
    }

    public func status() async throws -> WorkspaceStatusEnvelope {
        statusEnvelope
    }

    public func capture() async throws -> WorkspaceSnapshot {
        lock.withLock {
            captureCount += 1
        }
        if captureDelayNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: captureDelayNanoseconds)
        }
        return captureSnapshot
    }

    public func restorePlan(snapshot: WorkspaceSnapshot, currentWindows: [WorkspaceWindow]?) async throws -> WorkspaceRestorePlanEnvelope {
        lock.withLock {
            requestedSnapshots.append(snapshot)
        }
        return planEnvelope
    }

    public func restore(
        snapshot: WorkspaceSnapshot,
        currentWindows: [WorkspaceWindow]?,
        idempotencyKey: String
    ) async throws -> WorkspaceRestoreExecutionEnvelope {
        lock.withLock {
            restoreSnapshots.append(snapshot)
            restoreKeys.append(idempotencyKey)
        }
        if restoreDelayNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: restoreDelayNanoseconds)
        }
        return restoreEnvelope
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

    public func capture() async throws -> WorkspaceSnapshot {
        WorkspaceSnapshot(windows: [])
    }

    public func restorePlan(snapshot: WorkspaceSnapshot, currentWindows: [WorkspaceWindow]?) async throws -> WorkspaceRestorePlanEnvelope {
        WorkspaceRestorePlanEnvelope(
            plan: WorkspaceRestorePlan(commands: [], skipped: []),
            executeSupported: false
        )
    }

    public func restore(
        snapshot: WorkspaceSnapshot,
        currentWindows: [WorkspaceWindow]?,
        idempotencyKey: String
    ) async throws -> WorkspaceRestoreExecutionEnvelope {
        WorkspaceRestoreExecutionEnvelope(
            ok: false,
            plan: WorkspaceRestorePlan(commands: [], skipped: []),
            receipt: WorkspaceRestoreReceipt(commands: [], skipped: []),
            executeSupported: false,
            idempotencyKey: idempotencyKey
        )
    }
}
