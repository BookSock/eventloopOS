import Foundation

public enum TaskAnchorKind: String, Codable, Equatable, Sendable {
    case codexThread = "codex_thread"
    case ghosttyWindow = "ghostty_window"
}

public struct TaskAnchor: Codable, Equatable, Sendable {
    public let kind: TaskAnchorKind
    public let id: String

    public init(kind: TaskAnchorKind, id: String) {
        self.kind = kind
        self.id = id
    }
}

public struct TaskRecord: Codable, Equatable, Identifiable, Sendable {
    public let taskId: String
    public let primaryAnchorKind: TaskAnchorKind
    public let primaryAnchorId: String
    public let aerospaceWorkspaceId: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let lastPaperEmittedAt: Date?
    public let dormantAt: Date?
    public let autoPaperIdleSeconds: Int

    public var id: String { taskId }

    public init(
        taskId: String,
        primaryAnchorKind: TaskAnchorKind,
        primaryAnchorId: String,
        aerospaceWorkspaceId: String? = nil,
        createdAt: Date,
        updatedAt: Date,
        lastPaperEmittedAt: Date? = nil,
        dormantAt: Date? = nil,
        autoPaperIdleSeconds: Int = 60
    ) {
        self.taskId = taskId
        self.primaryAnchorKind = primaryAnchorKind
        self.primaryAnchorId = primaryAnchorId
        self.aerospaceWorkspaceId = aerospaceWorkspaceId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastPaperEmittedAt = lastPaperEmittedAt
        self.dormantAt = dormantAt
        self.autoPaperIdleSeconds = autoPaperIdleSeconds
    }

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case primaryAnchorKind = "primary_anchor_kind"
        case primaryAnchorId = "primary_anchor_id"
        case aerospaceWorkspaceId = "aerospace_workspace_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case lastPaperEmittedAt = "last_paper_emitted_at"
        case dormantAt = "dormant_at"
        case autoPaperIdleSeconds = "auto_paper_idle_seconds"
    }
}

public struct TaskLayoutRecord: Codable, Equatable, Sendable {
    public let taskId: String
    public let layout: WorkspaceSnapshot
    public let updatedAt: Date

    public init(taskId: String, layout: WorkspaceSnapshot, updatedAt: Date) {
        self.taskId = taskId
        self.layout = layout
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case layout
        case updatedAt = "updated_at"
    }
}

public struct CreateTaskResult: Codable, Equatable, Sendable {
    public let task: TaskRecord
    public let layout: TaskLayoutRecord?
    public let created: Bool
    public let current: Bool?

    public init(task: TaskRecord, layout: TaskLayoutRecord?, created: Bool, current: Bool? = nil) {
        self.task = task
        self.layout = layout
        self.created = created
        self.current = current
    }
}

public struct CurrentTaskState: Codable, Equatable, Sendable {
    public let task: TaskRecord?
    public let enteredAt: Date?
    public let updatedAt: Date?

    public init(task: TaskRecord?, enteredAt: Date? = nil, updatedAt: Date? = nil) {
        self.task = task
        self.enteredAt = enteredAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case task
        case enteredAt = "entered_at"
        case updatedAt = "updated_at"
    }
}

public struct TasksListEnvelope: Decodable, Equatable, Sendable {
    public let tasks: [TaskRecord]

    public init(tasks: [TaskRecord]) {
        self.tasks = tasks
    }
}

public struct TaskGetEnvelope: Decodable, Equatable, Sendable {
    public let task: TaskRecord
    public let layout: TaskLayoutRecord?

    public init(task: TaskRecord, layout: TaskLayoutRecord? = nil) {
        self.task = task
        self.layout = layout
    }
}

public struct TaskLayoutUpdateEnvelope: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let task: TaskRecord
    public let layout: TaskLayoutRecord?

    public init(ok: Bool, task: TaskRecord, layout: TaskLayoutRecord? = nil) {
        self.ok = ok
        self.task = task
        self.layout = layout
    }
}
