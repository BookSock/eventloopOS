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
    public let errorCode: String?
    public let message: String?
    public let eventId: String?
    public let routeAction: String?
    public let targetTaskId: String?
    public let targetTaskSessionId: String?
    public let queuedPacket: ReviewPacket?
    public let intent: String?
    public let target: String?
    public let targetAppOrTitle: String?
    public let followsWindowExclusion: FollowsWindowExclusion?
    public let triggerTaskId: String?
    public let triggerEventType: String?
    public let triggerBodySubstring: String?
    public let wokeTaskId: String?
    public let deferredCount: Int?
    public let deferredUntil: Date?
    public let rerankDirection: String?
    public let rerankTarget: String?
    public let rerankedPacket: ReviewPacket?
    public let priorityScore: Int?

    public init(
        ok: Bool,
        requestId: String? = nil,
        errorCode: String? = nil,
        message: String? = nil,
        eventId: String? = nil,
        routeAction: String? = nil,
        targetTaskId: String? = nil,
        targetTaskSessionId: String? = nil,
        queuedPacket: ReviewPacket? = nil,
        intent: String? = nil,
        target: String? = nil,
        targetAppOrTitle: String? = nil,
        followsWindowExclusion: FollowsWindowExclusion? = nil,
        triggerTaskId: String? = nil,
        triggerEventType: String? = nil,
        triggerBodySubstring: String? = nil,
        wokeTaskId: String? = nil,
        deferredCount: Int? = nil,
        deferredUntil: Date? = nil,
        rerankDirection: String? = nil,
        rerankTarget: String? = nil,
        rerankedPacket: ReviewPacket? = nil,
        priorityScore: Int? = nil
    ) {
        self.ok = ok
        self.requestId = requestId
        self.errorCode = errorCode
        self.message = message
        self.eventId = eventId
        self.routeAction = routeAction
        self.targetTaskId = targetTaskId
        self.targetTaskSessionId = targetTaskSessionId
        self.queuedPacket = queuedPacket
        self.intent = intent
        self.target = target
        self.targetAppOrTitle = targetAppOrTitle
        self.followsWindowExclusion = followsWindowExclusion
        self.triggerTaskId = triggerTaskId
        self.triggerEventType = triggerEventType
        self.triggerBodySubstring = triggerBodySubstring
        self.wokeTaskId = wokeTaskId
        self.deferredCount = deferredCount
        self.deferredUntil = deferredUntil
        self.rerankDirection = rerankDirection
        self.rerankTarget = rerankTarget
        self.rerankedPacket = rerankedPacket
        self.priorityScore = priorityScore
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case error
        case message
        case intent
        case target
        case targetAppOrTitle = "target_app_or_title"
        case exclusion
        case trigger
        case task
        case deferred
        case dueAt = "due_at"
        case direction
        case queueItemId = "queue_item_id"
        case priorityScore = "priority_score"
        case item
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

    enum TriggerCodingKeys: String, CodingKey {
        case taskId = "task_id"
        case matchEventType = "match_event_type"
        case matchBodySubstring = "match_body_substring"
    }

    enum TaskCodingKeys: String, CodingKey {
        case taskId = "task_id"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.ok = try container.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        self.requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
        self.errorCode = try container.decodeIfPresent(String.self, forKey: .error)
        self.message = try container.decodeIfPresent(String.self, forKey: .message)

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
        self.target = try container.decodeIfPresent(String.self, forKey: .target)
        self.targetAppOrTitle = try container.decodeIfPresent(String.self, forKey: .targetAppOrTitle)
        self.followsWindowExclusion = try container.decodeIfPresent(FollowsWindowExclusion.self, forKey: .exclusion)

        if let trigger = try? container.nestedContainer(keyedBy: TriggerCodingKeys.self, forKey: .trigger) {
            self.triggerTaskId = try trigger.decodeIfPresent(String.self, forKey: .taskId)
            self.triggerEventType = try trigger.decodeIfPresent(String.self, forKey: .matchEventType)
            self.triggerBodySubstring = try trigger.decodeIfPresent(String.self, forKey: .matchBodySubstring)
        } else {
            self.triggerTaskId = nil
            self.triggerEventType = nil
            self.triggerBodySubstring = nil
        }

        if let task = try? container.nestedContainer(keyedBy: TaskCodingKeys.self, forKey: .task) {
            self.wokeTaskId = try task.decodeIfPresent(String.self, forKey: .taskId)
        } else {
            self.wokeTaskId = nil
        }

        if let deferred = try? container.nestedUnkeyedContainer(forKey: .deferred) {
            self.deferredCount = deferred.count
        } else {
            self.deferredCount = nil
        }
        self.deferredUntil = try container.decodeIfPresent(Date.self, forKey: .dueAt)
        self.rerankDirection = try container.decodeIfPresent(String.self, forKey: .direction)
        self.rerankTarget = try container.decodeIfPresent(String.self, forKey: .target)
        self.rerankedPacket = try container.decodeIfPresent(QueueItemDTO.self, forKey: .item)?.packet
        self.priorityScore = try container.decodeIfPresent(Int.self, forKey: .priorityScore)
    }

    public var userFacingStatus: String {
        if !ok {
            if let message, !message.isEmpty {
                return message.hasSuffix(".") ? message : "\(message)."
            }
            if intent == "wake_task", let target {
                return "No matching task for \(target)."
            }
            if let errorCode {
                return "Master command failed: \(errorCode)."
            }
            return "Master command failed."
        }
        if intent == "stop_sharing" {
            let target = targetAppOrTitle
                ?? followsWindowExclusion?.titleSubstring
                ?? followsWindowExclusion?.appBundle
                ?? "window"
            return "Stopped sharing \(target) across papers."
        }
        if intent == "define_trigger" {
            if let triggerEventType, let triggerBodySubstring {
                return "Trigger created: \(triggerEventType) about \(triggerBodySubstring)."
            }
            return "Trigger created for current task."
        }
        if intent == "wake_task" {
            if let wokeTaskId {
                return "Woke task \(wokeTaskId)."
            }
            if let target {
                return "Wake command accepted for \(target)."
            }
        }
        if intent == "defer" || intent == "pause" {
            let count = deferredCount ?? 0
            return intent == "pause"
                ? "Paused \(count) paper\(count == 1 ? "" : "s")."
                : "Deferred \(count) paper\(count == 1 ? "" : "s")."
        }
        if intent == "rerank" {
            let title = rerankedPacket?.title ?? rerankTarget
            if let title, let priorityScore {
                return "Priority updated: \(title) (\(priorityScore))."
            }
            if let title {
                return "Priority updated: \(title)."
            }
            return "Priority updated."
        }
        if let queuedPacket {
            return "Master command queued: \(queuedPacket.title)"
        }
        if let targetTaskId {
            return "Master command routed to \(targetTaskId)."
        }
        if let routeAction {
            return "Master command routed: \(routeAction)."
        }
        return "Master command routed."
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
