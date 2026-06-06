import AppKit
import Foundation

public struct RunningInstance: Equatable {
    public let processIdentifier: Int32
    public let bundleIdentifier: String?
    public let executablePath: String?

    public init(processIdentifier: Int32, bundleIdentifier: String?, executablePath: String? = nil) {
        self.processIdentifier = processIdentifier
        self.bundleIdentifier = bundleIdentifier
        self.executablePath = normalizedExecutablePath(executablePath)
    }
}

public enum SingleInstanceDecision: Equatable {
    case proceed
    case foregroundExisting(processIdentifier: Int32)
}

public func decideSingleInstance(
    currentProcessIdentifier: Int32,
    targetBundleIdentifier: String?,
    targetExecutablePath: String? = nil,
    runningApplications: [RunningInstance]
) -> SingleInstanceDecision {
    let normalizedTargetBundle = normalizedNonEmpty(targetBundleIdentifier)
    let normalizedTargetPath = normalizedExecutablePath(targetExecutablePath)
    guard normalizedTargetBundle != nil || normalizedTargetPath != nil else {
        return .proceed
    }
    let other = runningApplications.first { instance in
        guard instance.processIdentifier != currentProcessIdentifier else {
            return false
        }
        if let target = normalizedTargetBundle, instance.bundleIdentifier == target {
            return true
        }
        if normalizedTargetBundle == nil,
           let target = normalizedTargetPath,
           instance.executablePath == target {
            return true
        }
        return false
    }
    if let other {
        return .foregroundExisting(processIdentifier: other.processIdentifier)
    }
    return .proceed
}

public func enforceSingleInstance(
    currentProcessIdentifier: Int32 = ProcessInfo.processInfo.processIdentifier,
    targetBundleIdentifier: String? = Bundle.main.bundleIdentifier,
    targetExecutablePath: String? = Bundle.main.executableURL?.path,
    runningApplications: [RunningInstance]? = nil,
    activate: (NSRunningApplication) -> Bool = { app in app.activate(options: [.activateIgnoringOtherApps]) },
    exit: (Int32) -> Never = { code in Foundation.exit(code) }
) {
    let instances = runningApplications ?? NSWorkspace.shared.runningApplications.map { app in
        RunningInstance(
            processIdentifier: app.processIdentifier,
            bundleIdentifier: app.bundleIdentifier,
            executablePath: app.executableURL?.path
        )
    }
    let decision = decideSingleInstance(
        currentProcessIdentifier: currentProcessIdentifier,
        targetBundleIdentifier: targetBundleIdentifier,
        targetExecutablePath: targetExecutablePath,
        runningApplications: instances
    )
    if case let .foregroundExisting(pid) = decision {
        if let existing = NSRunningApplication(processIdentifier: pid) {
            _ = activate(existing)
        }
        exit(0)
    }
}

private func normalizedNonEmpty(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
        return nil
    }
    return value
}

private func normalizedExecutablePath(_ path: String?) -> String? {
    guard let path = normalizedNonEmpty(path) else {
        return nil
    }
    return URL(fileURLWithPath: path).standardizedFileURL.path
}
