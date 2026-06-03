// swift-tools-version: 6.0
import PackageDescription

var products: [Product] = [
    .library(name: "EventLoopQueueCore", targets: ["EventLoopQueueCore"])
]

var targets: [Target] = [
    .target(
        name: "EventLoopQueueCore"
    ),
    .testTarget(
        name: "EventLoopQueueCoreTests",
        dependencies: ["EventLoopQueueCore"],
        resources: [
            .process("Resources")
        ]
    ),
]

#if os(macOS)
products.append(.executable(name: "EventLoopQueueApp", targets: ["EventLoopQueueApp"]))
targets.append(
    .executableTarget(
        name: "EventLoopQueueApp",
        dependencies: ["EventLoopQueueCore"]
    )
)
targets.append(
    .testTarget(
        name: "EventLoopQueueAppTests",
        dependencies: ["EventLoopQueueApp"]
    )
)
#endif

let package = Package(
    name: "EventLoopQueue",
    platforms: [
        .macOS(.v13)
    ],
    products: products,
    targets: targets
)
