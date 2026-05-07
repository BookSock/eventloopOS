import EventLoopQueueCore
import SwiftUI

@main
struct EventLoopQueueApp: App {
    @StateObject private var viewModel: QueueViewModel
    private let globalHotKeyController: GlobalHotKeyController
    private static let queueWindowID = "eventloop-queue-window"

    init() {
        let configuration = QueueAppConfiguration.parse(arguments: CommandLine.arguments)
        let viewModel = QueueViewModel(
            client: configuration.makeClient(),
            workspaceClient: configuration.makeWorkspaceClient()
        )
        _viewModel = StateObject(wrappedValue: viewModel)
        globalHotKeyController = GlobalHotKeyController {
            Task {
                await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()
            }
        }
        globalHotKeyController.registerToggleManualModeHotKey()
    }

    var body: some Scene {
        MenuBarExtra("eventloopOS Queue", systemImage: "list.bullet.rectangle") {
            QueueMenuView(viewModel: viewModel, windowID: Self.queueWindowID)
        }

        WindowGroup("eventloopOS Queue", id: Self.queueWindowID) {
            QueueWindowView(viewModel: viewModel)
                .frame(minWidth: 760, minHeight: 460)
                .accessibilityIdentifier("queue-window")
        }
        .commands {
            CommandMenu("Queue") {
                Button("Done / Next") {
                    Task {
                        await viewModel.doneAndNext()
                    }
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .accessibilityIdentifier("queue-command-done-next")

                Button(viewModel.isManualMode ? "Return to Event Loop" : "Enter Manual Mode") {
                    Task {
                        await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()
                    }
                }
                .keyboardShortcut("m", modifiers: [.command, .option, .shift])
                .accessibilityIdentifier("queue-command-mode-toggle")
            }
        }
    }
}

private struct QueueMenuView: View {
    @ObservedObject var viewModel: QueueViewModel
    let windowID: String
    @Environment(\.openWindow) private var openWindow

    private var summary: QueueMenuSummary {
        QueueMenuSummary(
            packets: viewModel.packets,
            selectedPacket: viewModel.selectedPacket,
            queueState: viewModel.state,
            mode: viewModel.mode,
            contextRestoreState: viewModel.contextRestoreState
        )
    }

    var body: some View {
        Text(summary.title)
            .font(.headline)
            .accessibilityIdentifier("queue-menu-count")
        Text(summary.subtitle)
            .lineLimit(2)
            .accessibilityIdentifier("queue-menu-selection")
        Text(summary.modeLabel)
            .accessibilityIdentifier("queue-menu-mode")
        if let restoreLabel = summary.restoreLabel {
            Text(restoreLabel)
                .lineLimit(2)
                .accessibilityIdentifier("queue-menu-restore")
        }

        Divider()

        Button("Open Queue") {
            openWindow(id: windowID)
        }
        .keyboardShortcut("o", modifiers: [.command])
        .accessibilityIdentifier("queue-menu-open-window")

        Button("Refresh Queue") {
            Task {
                await viewModel.refreshQueue()
            }
        }
        .accessibilityIdentifier("queue-menu-refresh")

        Button("Done / Next") {
            Task {
                await viewModel.doneAndNext()
            }
        }
        .keyboardShortcut(.return, modifiers: [.command])
        .accessibilityIdentifier("queue-menu-done-next")

        Button(viewModel.isManualMode ? "Return to Event Loop" : "Enter Manual Mode") {
            Task {
                await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()
            }
        }
        .keyboardShortcut("m", modifiers: [.command, .option, .shift])
        .accessibilityIdentifier("queue-menu-mode-toggle")
    }
}
