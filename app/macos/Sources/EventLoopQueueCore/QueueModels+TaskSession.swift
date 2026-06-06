import Foundation

public struct TaskSessionsEnvelope: Decodable, Equatable, Sendable {
    public let sessions: [TaskSession]

    public init(sessions: [TaskSession]) {
        self.sessions = sessions
    }
}

public struct TaskSession: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let taskId: String?
    public let provider: String
    public let status: String
    public let name: String?
    public let preview: String?
    public let cwd: String?
    public let terminalRef: String?
    public let pid: Int?
    public let agentPid: Int?
    public let terminalPid: Int?
    public let rootPid: Int?
    public let pids: [Int]?

    public init(
        id: String,
        taskId: String? = nil,
        provider: String,
        status: String,
        name: String? = nil,
        preview: String? = nil,
        cwd: String? = nil,
        terminalRef: String? = nil,
        pid: Int? = nil,
        agentPid: Int? = nil,
        terminalPid: Int? = nil,
        rootPid: Int? = nil,
        pids: [Int]? = nil
    ) {
        self.id = id
        self.taskId = taskId
        self.provider = provider
        self.status = status
        self.name = name
        self.preview = preview
        self.cwd = cwd
        self.terminalRef = terminalRef
        self.pid = pid
        self.agentPid = agentPid
        self.terminalPid = terminalPid
        self.rootPid = rootPid
        self.pids = pids
    }

    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case provider
        case status
        case name
        case preview
        case cwd
        case terminalRef = "terminal_ref"
        case pid
        case agentPid = "agent_pid"
        case terminalPid = "terminal_pid"
        case rootPid = "root_pid"
        case pids
    }
}

public struct TaskBindingEnvelope: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let binding: TaskBinding

    public init(ok: Bool, binding: TaskBinding) {
        self.ok = ok
        self.binding = binding
    }
}

public struct TaskBinding: Codable, Equatable, Sendable {
    public let ok: Bool
    public let taskSessionId: String
    public let taskId: String
    public let nativeThreadId: String?
    public let session: TaskSession?

    public init(
        ok: Bool,
        taskSessionId: String,
        taskId: String,
        nativeThreadId: String? = nil,
        session: TaskSession? = nil
    ) {
        self.ok = ok
        self.taskSessionId = taskSessionId
        self.taskId = taskId
        self.nativeThreadId = nativeThreadId
        self.session = session
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case taskSessionId = "task_session_id"
        case taskId = "task_id"
        case nativeThreadId = "native_thread_id"
        case session
    }
}

public enum TaskBindingState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case bound(TaskBinding)
    case failed(String)
}

public struct MasterCommandResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let requestId: String?
    public let eventId: String?
    public let routeAction: String?
    public let targetTaskId: String?
    public let targetTaskSessionId: String?
    public let queuedPacket: ReviewPacket?
    public let intent: String?
    public let targetAppOrTitle: String?
    public let followsWindowExclusion: FollowsWindowExclusion?

    public init(
        ok: Bool,
        requestId: String? = nil,
        eventId: String? = nil,
        routeAction: String? = nil,
        targetTaskId: String? = nil,
        targetTaskSessionId: String? = nil,
        queuedPacket: ReviewPacket? = nil,
        intent: String? = nil,
        targetAppOrTitle: String? = nil,
        followsWindowExclusion: FollowsWindowExclusion? = nil
    ) {
        self.ok = ok
        self.requestId = requestId
        self.eventId = eventId
        self.routeAction = routeAction
        self.targetTaskId = targetTaskId
        self.targetTaskSessionId = targetTaskSessionId
        self.queuedPacket = queuedPacket
        self.intent = intent
        self.targetAppOrTitle = targetAppOrTitle
        self.followsWindowExclusion = followsWindowExclusion
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case intent
        case targetAppOrTitle = "target_app_or_title"
        case exclusion
        case requestId = "request_id"
        case event
        case routeDecision = "route_decision"
        case queueItem = "queue_item"
    }

    enum EventCodingKeys: String, CodingKey {
        case id
    }

    enum RouteDecisionCodingKeys: String, CodingKey {
        case action
        case targetTaskId = "target_task_id"
        case targetTaskSessionId = "target_task_session_id"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        self.requestId = try container.decodeIfPresent(String.self, forKey: .requestId)

        if let event = try? container.nestedContainer(keyedBy: EventCodingKeys.self, forKey: .event) {
            self.eventId = try event.decodeIfPresent(String.self, forKey: .id)
        } else {
            self.eventId = nil
        }

        if let routeDecision = try? container.nestedContainer(keyedBy: RouteDecisionCodingKeys.self, forKey: .routeDecision) {
            self.routeAction = try routeDecision.decodeIfPresent(String.self, forKey: .action)
            self.targetTaskId = try routeDecision.decodeIfPresent(String.self, forKey: .targetTaskId)
            self.targetTaskSessionId = try routeDecision.decodeIfPresent(String.self, forKey: .targetTaskSessionId)
        } else {
            self.routeAction = nil
            self.targetTaskId = nil
            self.targetTaskSessionId = nil
        }

        self.queuedPacket = try container.decodeIfPresent(QueueItemDTO.self, forKey: .queueItem)?.packet
        self.intent = try container.decodeIfPresent(String.self, forKey: .intent)
        self.targetAppOrTitle = try container.decodeIfPresent(String.self, forKey: .targetAppOrTitle)
        self.followsWindowExclusion = try container.decodeIfPresent(FollowsWindowExclusion.self, forKey: .exclusion)
    }
}

public struct TaskWorkspaceSnapshotSaveResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let requestId: String?

    public init(ok: Bool, requestId: String? = nil) {
        self.ok = ok
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case requestId = "request_id"
    }
}

public struct TaskSessionStartEnvelope: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let started: TaskSessionStartResult
    public let requestId: String?

    public init(ok: Bool, started: TaskSessionStartResult, requestId: String? = nil) {
        self.ok = ok
        self.started = started
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case started
        case requestId = "request_id"
    }
}

public struct TaskSessionStartResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let taskSessionId: String?
    public let taskId: String
    public let session: TaskSession?

    public init(ok: Bool, taskSessionId: String? = nil, taskId: String, session: TaskSession? = nil) {
        self.ok = ok
        self.taskSessionId = taskSessionId
        self.taskId = taskId
        self.session = session
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case taskSessionId = "task_session_id"
        case taskId = "task_id"
        case session
    }
}

public enum MasterCommandState: Equatable, Sendable {
    case idle
    case sending
    case routed(MasterCommandResult)
    case started(TaskSessionStartResult)
    case failed(String)
}
