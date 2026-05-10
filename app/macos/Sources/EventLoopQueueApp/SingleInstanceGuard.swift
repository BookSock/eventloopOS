import AppKit
import Foundation

public struct RunningInstance: Equatable {
    public let processIdentifier: Int32
    public let bundleIdentifier: String?

    public init(processIdentifier: Int32, bundleIdentifier: String?) {
        self.processIdentifier = processIdentifier
        self.bundleIdentifier = bundleIdentifier
    }
}

public enum SingleInstanceDecision: Equatable {
    case proceed
    case foregroundExisting(processIdentifier: Int32)
}

public func decideSingleInstance(
    currentProcessIdentifier: Int32,
    targetBundleIdentifier: String?,
    runningApplications: [RunningInstance]
) -> SingleInstanceDecision {
    guard let target = targetBundleIdentifier, !target.isEmpty else {
        return .proceed
    }
    let other = runningApplications.first { instance in
        instance.bundleIdentifier == target && instance.processIdentifier != currentProcessIdentifier
    }
    if let other {
        return .foregroundExisting(processIdentifier: other.processIdentifier)
    }
    return .proceed
}

public func enforceSingleInstance(
    currentProcessIdentifier: Int32 = ProcessInfo.processInfo.processIdentifier,
    targetBundleIdentifier: String? = Bundle.main.bundleIdentifier,
    runningApplications: [RunningInstance]? = nil,
    activate: (NSRunningApplication) -> Bool = { app in app.activate(options: [.activateIgnoringOtherApps]) },
    exit: (Int32) -> Never = { code in Foundation.exit(code) }
) {
    let instances = runningApplications ?? NSWorkspace.shared.runningApplications.map { app in
        RunningInstance(processIdentifier: app.processIdentifier, bundleIdentifier: app.bundleIdentifier)
    }
    let decision = decideSingleInstance(
        currentProcessIdentifier: currentProcessIdentifier,
        targetBundleIdentifier: targetBundleIdentifier,
        runningApplications: instances
    )
    if case let .foregroundExisting(pid) = decision {
        if let existing = NSRunningApplication(processIdentifier: pid) {
            _ = activate(existing)
        }
        exit(0)
    }
}
