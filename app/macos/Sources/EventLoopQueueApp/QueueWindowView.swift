import EventLoopQueueCore
import SwiftUI

struct QueueWindowView: View {
    @ObservedObject var viewModel: QueueViewModel

    var body: some View {
        NavigationSplitView {
            List(selection: $viewModel.selectedPacketID) {
                ForEach(viewModel.packets) { packet in
                    QueueRow(packet: packet)
                        .tag(packet.id)
                        .accessibilityIdentifier("queue-row-\(packet.id)")
                }
            }
            .accessibilityIdentifier("queue-list")
            .navigationTitle("Queue")
            .toolbar {
                ToolbarItemGroup {
                    Button {
                        viewModel.toggleManualMode()
                    } label: {
                        Label(viewModel.isManualMode ? "Return to Loop" : "Manual Mode", systemImage: viewModel.isManualMode ? "play.circle" : "pause.circle")
                    }
                    .accessibilityIdentifier("queue-mode-toggle-button")
                    .keyboardShortcut("m", modifiers: [.command, .option, .shift])

                    Button {
                        Task {
                            await viewModel.loadQueue()
                        }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .accessibilityIdentifier("queue-refresh-button")
                }
            }
        } detail: {
            PacketDetail(packet: viewModel.selectedPacket) {
                Task {
                    await viewModel.doneAndNext()
                }
            }
        }
        .overlay(alignment: .bottomLeading) {
            StatusBanner(state: viewModel.state)
                .padding(12)
        }
        .overlay(alignment: .topTrailing) {
            if viewModel.isManualMode {
                Text("Manual Mode")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.secondary.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .padding(12)
                    .accessibilityIdentifier("queue-manual-mode-indicator")
            }
        }
        .task {
            await viewModel.loadQueue()
            viewModel.startAutomaticLeaseRenewal()
        }
        .onDisappear {
            viewModel.stopAutomaticLeaseRenewal()
        }
    }
}

private struct QueueRow: View {
    let packet: ReviewPacket

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(packet.title)
                    .font(.headline)
                    .lineLimit(2)
                Spacer()
                Text("\(packet.priority)")
                    .font(.caption)
                    .monospacedDigit()
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            Text(packet.source)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }
}

private struct PacketDetail: View {
    let packet: ReviewPacket?
    let doneAndNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let packet {
                VStack(alignment: .leading, spacing: 8) {
                    Text(packet.title)
                        .font(.title2.weight(.semibold))
                        .accessibilityIdentifier("packet-title")
                    Text(packet.summary)
                        .font(.body)
                        .accessibilityIdentifier("packet-summary")
                    Text(packet.source)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("packet-source")
                }

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Text("Recommended Action")
                        .font(.headline)
                    Text(packet.recommendedAction)
                        .accessibilityIdentifier("packet-recommended-action")
                }

                Spacer()

                HStack {
                    Spacer()
                    Button {
                        doneAndNext()
                    } label: {
                        Label("Done / Next", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .accessibilityIdentifier("queue-done-next-button")
                }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "tray")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No queue packet")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("queue-empty-state")
            }
        }
        .padding(24)
        .accessibilityIdentifier("packet-detail")
    }
}

private struct StatusBanner: View {
    let state: QueueState

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .loading:
            ProgressView()
                .controlSize(.small)
                .accessibilityIdentifier("queue-loading-indicator")
        case .loaded:
            EmptyView()
        case let .failed(message):
            Text(message)
                .font(.caption)
                .padding(8)
                .background(.red.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("queue-error-message")
        }
    }
}
