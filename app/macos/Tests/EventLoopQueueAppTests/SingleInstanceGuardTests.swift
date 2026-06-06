import XCTest
@testable import EventLoopQueueApp

final class SingleInstanceGuardTests: XCTestCase {
    func testProceedsWhenNoOtherInstanceIsRunning() {
        let decision = decideSingleInstance(
            currentProcessIdentifier: 1234,
            targetBundleIdentifier: "dev.eventloopos.queue",
            runningApplications: [
                RunningInstance(processIdentifier: 1234, bundleIdentifier: "dev.eventloopos.queue"),
                RunningInstance(processIdentifier: 9999, bundleIdentifier: "com.apple.finder"),
            ]
        )

        XCTAssertEqual(decision, .proceed)
    }

    func testForegroundsExistingWhenSameBundleAlreadyRunning() {
        let decision = decideSingleInstance(
            currentProcessIdentifier: 1234,
            targetBundleIdentifier: "dev.eventloopos.queue",
            runningApplications: [
                RunningInstance(processIdentifier: 4242, bundleIdentifier: "dev.eventloopos.queue"),
                RunningInstance(processIdentifier: 1234, bundleIdentifier: "dev.eventloopos.queue"),
            ]
        )

        XCTAssertEqual(decision, .foregroundExisting(processIdentifier: 4242))
    }

    func testProceedsWhenBundleIdentifierIsMissing() {
        let decision = decideSingleInstance(
            currentProcessIdentifier: 1234,
            targetBundleIdentifier: nil,
            runningApplications: [
                RunningInstance(processIdentifier: 4242, bundleIdentifier: "dev.eventloopos.queue"),
            ]
        )

        XCTAssertEqual(decision, .proceed)
    }

    func testForegroundsExistingWhenBundleIdentifierIsMissingButExecutableMatches() {
        let decision = decideSingleInstance(
            currentProcessIdentifier: 1234,
            targetBundleIdentifier: nil,
            targetExecutablePath: "/tmp/eventloopOS/.build/debug/EventLoopQueueApp",
            runningApplications: [
                RunningInstance(
                    processIdentifier: 4242,
                    bundleIdentifier: nil,
                    executablePath: "/tmp/eventloopOS/.build/debug/EventLoopQueueApp"
                ),
                RunningInstance(
                    processIdentifier: 1234,
                    bundleIdentifier: nil,
                    executablePath: "/tmp/eventloopOS/.build/debug/EventLoopQueueApp"
                ),
            ]
        )

        XCTAssertEqual(decision, .foregroundExisting(processIdentifier: 4242))
    }

    func testProceedsWhenBundleIdentifierIsMissingAndExecutableDiffers() {
        let decision = decideSingleInstance(
            currentProcessIdentifier: 1234,
            targetBundleIdentifier: nil,
            targetExecutablePath: "/tmp/eventloopOS/.build/debug/EventLoopQueueApp",
            runningApplications: [
                RunningInstance(
                    processIdentifier: 4242,
                    bundleIdentifier: nil,
                    executablePath: "/tmp/other-eventloopOS/.build/debug/EventLoopQueueApp"
                ),
            ]
        )

        XCTAssertEqual(decision, .proceed)
    }
}
