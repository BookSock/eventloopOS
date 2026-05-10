import Foundation

public struct ContextRestorePlanEnvelope: Decodable, Equatable, Sendable {
    public let restorePlan: ContextRestorePlan

    public init(restorePlan: ContextRestorePlan) {
        self.restorePlan = restorePlan
    }

    enum CodingKeys: String, CodingKey {
        case restorePlan = "restore_plan"
    }
}

public struct ContextRestorePlan: Codable, Equatable, Sendable {
    public let kind: String
    public let sideEffect: String
    public let executeSupported: Bool
    public let target: String?
    public let message: ContextRestoreMessage?
    public let url: String?
    public let path: String?
    public let line: Int?
    public let column: Int?

    public init(
        kind: String,
        sideEffect: String,
        executeSupported: Bool,
        target: String?,
        message: ContextRestoreMessage?,
        url: String?,
        path: String?,
        line: Int?,
        column: Int?
    ) {
        self.kind = kind
        self.sideEffect = sideEffect
        self.executeSupported = executeSupported
        self.target = target
        self.message = message
        self.url = url
        self.path = path
        self.line = line
        self.column = column
    }

    enum CodingKeys: String, CodingKey {
        case kind
        case sideEffect = "side_effect"
        case executeSupported = "execute_supported"
        case target
        case message
        case url
        case path
        case line
        case column
    }
}

public struct ContextRestoreMessage: Codable, Equatable, Sendable {
    public let type: String
    public let resource: ReviewContextResource

    public init(type: String, resource: ReviewContextResource) {
        self.type = type
        self.resource = resource
    }
}

public enum ContextRestoreState: Equatable, Sendable {
    case idle
    case planning(ReviewContextResource)
    case planned(ReviewContextResource, ContextRestorePlan)
    case requested(ReviewContextResource, ContextRestoreRequest)
    case failed(ReviewContextResource, String)
}

public struct ContextRestoreRequestEnvelope: Decodable, Equatable, Sendable {
    public let restoreRequest: ContextRestoreRequest

    public init(restoreRequest: ContextRestoreRequest) {
        self.restoreRequest = restoreRequest
    }

    enum CodingKeys: String, CodingKey {
        case restoreRequest = "restore_request"
    }
}

public struct ContextRestoreRequest: Codable, Equatable, Sendable {
    public let id: String
    public let status: String
    public let resource: ReviewContextResource
    public let restorePlan: ContextRestorePlan
    public let result: ContextRestoreResult?

    public init(
        id: String,
        status: String,
        resource: ReviewContextResource,
        restorePlan: ContextRestorePlan,
        result: ContextRestoreResult? = nil
    ) {
        self.id = id
        self.status = status
        self.resource = resource
        self.restorePlan = restorePlan
        self.result = result
    }

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case resource
        case restorePlan = "restore_plan"
        case result
    }
}

public struct ContextRestoreResult: Codable, Equatable, Sendable {
    public let ok: Bool?
    public let tabId: Int?
    public let url: String?
    public let restoredScroll: Bool?
    public let restoredHighlight: Bool?
    public let highlightStrategy: String?
    public let error: ContextRestoreError?

    public init(
        ok: Bool?,
        tabId: Int?,
        url: String?,
        restoredScroll: Bool?,
        restoredHighlight: Bool? = nil,
        highlightStrategy: String? = nil,
        error: ContextRestoreError? = nil
    ) {
        self.ok = ok
        self.tabId = tabId
        self.url = url
        self.restoredScroll = restoredScroll
        self.restoredHighlight = restoredHighlight
        self.highlightStrategy = highlightStrategy
        self.error = error
    }
}

public struct ContextRestoreError: Codable, Equatable, Sendable {
    public let code: String?
    public let message: String?

    public init(code: String?, message: String?) {
        self.code = code
        self.message = message
    }
}
