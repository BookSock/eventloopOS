import Foundation

public enum QueueClientMode: Equatable, Sendable {
    case fake
    case http(URL)
}

public struct QueueAppConfiguration: Equatable, Sendable {
    public let clientMode: QueueClientMode

    public init(clientMode: QueueClientMode) {
        self.clientMode = clientMode
    }

    public static func parse(arguments: [String], environment: [String: String] = ProcessInfo.processInfo.environment) -> QueueAppConfiguration {
        if arguments.contains("--test-mode") || environment["EVENTLOOP_QUEUE_TEST_MODE"] == "1" {
            return QueueAppConfiguration(clientMode: .fake)
        }

        if let explicitURL = value(after: "--orchestrator-url", in: arguments), let url = URL(string: explicitURL) {
            return QueueAppConfiguration(clientMode: .http(url))
        }

        if let envURL = environment["EVENTLOOP_ORCHESTRATOR_URL"], let url = URL(string: envURL) {
            return QueueAppConfiguration(clientMode: .http(url))
        }

        return QueueAppConfiguration(clientMode: .http(URL(string: "http://127.0.0.1:4317")!))
    }

    public func makeClient() -> any QueueClient {
        switch clientMode {
        case .fake:
            FakeQueueClient()
        case let .http(url):
            HTTPQueueClient(baseURL: url)
        }
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag) else {
            return nil
        }
        let valueIndex = arguments.index(after: index)
        guard valueIndex < arguments.endIndex else {
            return nil
        }
        return arguments[valueIndex]
    }
}
