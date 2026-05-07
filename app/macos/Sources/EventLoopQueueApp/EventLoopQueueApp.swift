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
                Button(viewModel.selectedPacket?.recommendedAction ?? "Run Recommended Action") {
                    Task {
                        await viewModel.executeRecommendedActionAndNext()
                    }
                }
                .keyboardShortcut(.return, modifiers: [.command, .shift])
                .disabled(!viewModel.canExecuteSelectedRecommendedAction)
                .accessibilityIdentifier("queue-command-execute-recommended-action")

                Button("Done / Next") {
                    Task {
                        await viewModel.doneAndNext()
                    }
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .accessibilityIdentifier("queue-command-done-next")

                Button("Defer 1 Hour") {
                    Task {
                        await viewModel.deferSelectedPacketForOneHour()
                    }
                }
                .keyboardShortcut("d", modifiers: [.command, .option])
                .disabled(!viewModel.hasPackets)
                .accessibilityIdentifier("queue-command-defer-one-hour")

                Button("Ignore Item", role: .destructive) {
                    Task {
                        await viewModel.ignoreSelectedPacket()
                    }
                }
                .disabled(!viewModel.hasPackets)
                .accessibilityIdentifier("queue-command-ignore")

                Button("Restore Queue Workspace") {
                    Task {
                        await viewModel.confirmSelectedWorkspaceRestore()
                    }
                }
                .keyboardShortcut("r", modifiers: [.command, .option])
                .disabled(!viewModel.canRestoreSelectedWorkspace)
                .accessibilityIdentifier("queue-command-restore-queue-workspace")

                Button("Skip / Next Item") {
                    Task {
                        await viewModel.moveToNext()
                    }
                }
                .keyboardShortcut(.return, modifiers: [.command, .option])
                .disabled(!viewModel.hasPackets)
                .accessibilityIdentifier("queue-command-skip-next")

                Button(viewModel.isManualMode ? "Return to Event Loop" : "Enter Manual Mode") {
                    Task {
                        await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()
                    }
                }
                .keyboardShortcut("m", modifiers: [.command, .option, .shift])
                .accessibilityIdentifier("queue-command-mode-toggle")

                Button("Restore Manual Workspace") {
                    Task {
                        await viewModel.confirmManualWorkspaceRestore()
                    }
                }
                .disabled(!viewModel.canRestoreManualWorkspace)
                .accessibilityIdentifier("queue-command-restore-manual-workspace")
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
            contextRestoreState: viewModel.contextRestoreState,
            workspaceRestoreState: viewModel.workspaceRestoreState,
            manualWorkspaceCaptureState: viewModel.manualWorkspaceCaptureState,
            recommendedActionBlockReason: viewModel.selectedRecommendedActionBlockReason
        )
    }

    var body: some View {
        Group {
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
            if let workspaceRestoreLabel = summary.workspaceRestoreLabel {
                Text(workspaceRestoreLabel)
                    .lineLimit(2)
                    .accessibilityIdentifier("queue-menu-workspace-restore")
            }
            if let manualWorkspaceLabel = summary.manualWorkspaceLabel {
                Text(manualWorkspaceLabel)
                    .lineLimit(2)
                    .accessibilityIdentifier("queue-menu-manual-workspace")
            }
            if let blockReason = summary.recommendedActionBlockReason {
                Text(blockReason)
                    .lineLimit(2)
                    .accessibilityIdentifier("queue-menu-recommended-action-block-reason")
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

            Button(viewModel.selectedPacket?.recommendedAction ?? "Run Recommended Action") {
                Task {
                    await viewModel.executeRecommendedActionAndNext()
                }
            }
            .keyboardShortcut(.return, modifiers: [.command, .shift])
            .disabled(!viewModel.canExecuteSelectedRecommendedAction)
            .accessibilityIdentifier("queue-menu-execute-recommended-action")

            Button("Done / Next") {
                Task {
                    await viewModel.doneAndNext()
                }
            }
            .keyboardShortcut(.return, modifiers: [.command])
            .accessibilityIdentifier("queue-menu-done-next")

            Button("Defer 1 Hour") {
                Task {
                    await viewModel.deferSelectedPacketForOneHour()
                }
            }
            .keyboardShortcut("d", modifiers: [.command, .option])
            .disabled(!viewModel.hasPackets)
            .accessibilityIdentifier("queue-menu-defer-one-hour")

            Button("Ignore Item", role: .destructive) {
                Task {
                    await viewModel.ignoreSelectedPacket()
                }
            }
            .disabled(!viewModel.hasPackets)
            .accessibilityIdentifier("queue-menu-ignore")

            Button("Restore Queue Workspace") {
                Task {
                    await viewModel.confirmSelectedWorkspaceRestore()
                }
            }
            .keyboardShortcut("r", modifiers: [.command, .option])
            .disabled(!viewModel.canRestoreSelectedWorkspace)
            .accessibilityIdentifier("queue-menu-restore-queue-workspace")

            Button("Skip / Next Item") {
                Task {
                    await viewModel.moveToNext()
                }
            }
            .keyboardShortcut(.return, modifiers: [.command, .option])
            .disabled(!viewModel.hasPackets)
            .accessibilityIdentifier("queue-menu-skip-next")

            Button(viewModel.isManualMode ? "Return to Event Loop" : "Enter Manual Mode") {
                Task {
                    await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()
                }
            }
            .keyboardShortcut("m", modifiers: [.command, .option, .shift])
            .accessibilityIdentifier("queue-menu-mode-toggle")

            Button("Restore Manual Workspace") {
                Task {
                    await viewModel.confirmManualWorkspaceRestore()
                }
            }
            .disabled(!viewModel.canRestoreManualWorkspace)
            .accessibilityIdentifier("queue-menu-restore-manual-workspace")
        }
        .task {
            if viewModel.state == .idle {
                await viewModel.loadQueue()
            }
            await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        }
        .task(id: viewModel.selectedTaskId) {
            await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        }
    }
}
