import XCTest
@testable import EventLoopQueueCore

@MainActor
final class QueueViewModelTests: XCTestCase {
    func testLoadQueueSelectsFirstPacket() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))

        await viewModel.loadQueue()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.count, 3)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.selectedPacket?.title, "Review blog feedback draft")
    }

    func testSelectIgnoresUnknownPacket() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        viewModel.select(packetId: "packet-ci-failed")
        viewModel.select(packetId: "missing")

        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testDoneAndNextCompletesSelectedPacketAndAdvances() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()

        await viewModel.doneAndNext()

        XCTAssertEqual(client.completedPacketIds, ["packet-blog-feedback"])
        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.packets.map(\.id), ["packet-ci-failed", "packet-external-send"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-ci-failed")
    }

    func testRenewSelectedLeaseKeepsSelectionLoaded() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        await viewModel.renewSelectedLease()

        XCTAssertEqual(viewModel.state, .loaded)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.packets.count, 3)
    }

    func testAutomaticLeaseRenewalKeepsSelectedPacketLeased() async {
        let client = FakeQueueClient(packets: SeededQueue.packets)
        let viewModel = QueueViewModel(client: client)
        await viewModel.loadQueue()

        viewModel.startAutomaticLeaseRenewal(intervalNanoseconds: 1_000_000, maxRenewals: 2)

        for _ in 0..<50 where client.renewedPacketIds.count < 2 {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        viewModel.stopAutomaticLeaseRenewal()

        XCTAssertEqual(client.renewedPacketIds, ["packet-blog-feedback", "packet-blog-feedback"])
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
    }

    func testManualModePausesWorkspaceRestoreWithoutClearingQueue() async {
        let viewModel = QueueViewModel(client: FakeQueueClient(packets: SeededQueue.packets))
        await viewModel.loadQueue()

        viewModel.enterManualMode()

        XCTAssertEqual(viewModel.mode, .manual)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, false)
        XCTAssertEqual(viewModel.selectedPacketID, "packet-blog-feedback")
        XCTAssertEqual(viewModel.packets.count, 3)

        viewModel.returnToEventLoopMode()

        XCTAssertEqual(viewModel.mode, .eventLoop)
        XCTAssertEqual(viewModel.shouldRestoreWorkspace, true)
    }
}
