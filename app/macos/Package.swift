// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EventLoopQueue",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "EventLoopQueueCore", targets: ["EventLoopQueueCore"]),
        .executable(name: "EventLoopQueueApp", targets: ["EventLoopQueueApp"])
    ],
    targets: [
        .target(
            name: "EventLoopQueueCore"
        ),
        .executableTarget(
            name: "EventLoopQueueApp",
            dependencies: ["EventLoopQueueCore"]
        ),
        .testTarget(
            name: "EventLoopQueueCoreTests",
            dependencies: ["EventLoopQueueCore"],
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "EventLoopQueueAppTests",
            dependencies: ["EventLoopQueueApp"]
        )
    ]
)
