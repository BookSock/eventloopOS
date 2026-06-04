import Foundation

public struct FollowsWindowRecord: Decodable, Equatable, Identifiable, Sendable {
    public let windowId: String
    public let knownWorkspaces: [String]
    public let appBundle: String?
    public let titlePrefix: String?
    public let slotWindowIds: [String]

    public var id: String { windowId }

    public init(
        windowId: String,
        knownWorkspaces: [String] = [],
        appBundle: String? = nil,
        titlePrefix: String? = nil,
        slotWindowIds: [String] = []
    ) {
        self.windowId = windowId
        self.knownWorkspaces = knownWorkspaces
        self.appBundle = appBundle
        self.titlePrefix = titlePrefix
        self.slotWindowIds = slotWindowIds
    }

    enum CodingKeys: String, CodingKey {
        case windowId = "window_id"
        case knownWorkspaces = "known_workspaces"
        case appBundle = "app_bundle"
        case titlePrefix = "title_prefix"
        case slotWindowIds = "slot_window_ids"
    }
}

public struct FollowsWindowsListResult: Decodable, Equatable, Sendable {
    public let windows: [FollowsWindowRecord]
    public let count: Int
    public let ttlMs: Int?
    public let requestId: String?

    public init(windows: [FollowsWindowRecord], count: Int? = nil, ttlMs: Int? = nil, requestId: String? = nil) {
        self.windows = windows
        self.count = count ?? windows.count
        self.ttlMs = ttlMs
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case windows
        case count
        case ttlMs = "ttl_ms"
        case requestId = "request_id"
    }
}

public struct FollowsWindowExclusion: Codable, Equatable, Identifiable, Sendable {
    public let exclusionId: String
    public let appBundle: String?
    public let titleSubstring: String?
    public let createdAt: Date

    public var id: String { exclusionId }

    public init(
        exclusionId: String,
        appBundle: String? = nil,
        titleSubstring: String? = nil,
        createdAt: Date = Date(timeIntervalSince1970: 0)
    ) {
        self.exclusionId = exclusionId
        self.appBundle = appBundle
        self.titleSubstring = titleSubstring
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case exclusionId = "exclusion_id"
        case appBundle = "app_bundle"
        case titleSubstring = "title_substring"
        case createdAt = "created_at"
    }
}

public struct FollowsWindowExclusionsListResult: Decodable, Equatable, Sendable {
    public let exclusions: [FollowsWindowExclusion]
    public let count: Int
    public let requestId: String?

    public init(exclusions: [FollowsWindowExclusion], count: Int? = nil, requestId: String? = nil) {
        self.exclusions = exclusions
        self.count = count ?? exclusions.count
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case exclusions
        case count
        case requestId = "request_id"
    }
}

public struct FollowsWindowExclusionMutationResult: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let exclusion: FollowsWindowExclusion
    public let requestId: String?

    public init(ok: Bool = true, exclusion: FollowsWindowExclusion, requestId: String? = nil) {
        self.ok = ok
        self.exclusion = exclusion
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case ok
        case exclusion
        case requestId = "request_id"
    }
}

public struct FollowsWindowExclusionCreateRequest: Encodable, Equatable, Sendable {
    public let appBundle: String?
    public let titleSubstring: String?

    public init(appBundle: String? = nil, titleSubstring: String? = nil) {
        self.appBundle = appBundle
        self.titleSubstring = titleSubstring
    }

    enum CodingKeys: String, CodingKey {
        case appBundle = "app_bundle"
        case titleSubstring = "title_substring"
    }
}

public enum FollowsRulesState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case saving
    case failed(String)
}

public struct FollowsWindowSuggestion: Equatable, Identifiable, Sendable {
    public let id: String
    public let appName: String
    public let appBundle: String?
    public let title: String?
    public let workspace: String
    public let isCurrentFollowsCandidate: Bool

    public init(
        appName: String,
        appBundle: String? = nil,
        title: String? = nil,
        workspace: String,
        isCurrentFollowsCandidate: Bool = false
    ) {
        self.appName = appName
        self.appBundle = appBundle
        self.title = title
        self.workspace = workspace
        self.isCurrentFollowsCandidate = isCurrentFollowsCandidate
        self.id = [
            isCurrentFollowsCandidate ? "follows" : "active",
            appBundle?.lowercased() ?? appName.lowercased(),
            title?.lowercased() ?? "",
            workspace.lowercased(),
        ].joined(separator: "|")
    }
}
