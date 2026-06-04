import Foundation

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
