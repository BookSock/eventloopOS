import AppKit
import EventLoopQueueCore
import SwiftUI

@main
struct EventLoopQueueApp: App {
    @NSApplicationDelegateAdaptor(QueueAppDelegate.self) private var appDelegate
    @StateObject private var viewModel: QueueViewModel
    @Environment(\.openWindow) private var openWindow
    private let globalHotKeyController: GlobalHotKeyController
    private static let queueWindowID = "eventloop-queue-window"

    init() {
        let configuration = QueueAppConfiguration.parse(arguments: CommandLine.arguments)
        let voiceService: VoiceTranscriptionService?
        if ProcessInfo.processInfo.environment["EVENTLOOPOS_VOICE_DISABLED"] == "1" {
            voiceService = nil
        } else {
            voiceService = AppleSpeechVoiceTranscriptionService()
        }
        let viewModel = QueueViewModel(
            client: configuration.makeClient(),
            workspaceClient: configuration.makeWorkspaceClient(),
            aeroSpaceClient: configuration.makeAeroSpaceClient(),
            codexForegroundResolver: configuration.makeCodexForegroundResolver(),
            voiceTranscriptionService: voiceService
        )
        _viewModel = StateObject(wrappedValue: viewModel)
        globalHotKeyController = GlobalHotKeyController(
            pullNextPaper: {
                NSApp.activate(ignoringOtherApps: true)
                Task {
                    await viewModel.advance()
                }
            },
            toggleManualMode: {
                Task {
                    await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()
                }
            },
            masterCommand: {
                NSApp.activate(ignoringOtherApps: true)
                NotificationCenter.default.post(name: .eventLoopQueueMasterCommandRequested, object: nil)
            }
        )
        appDelegate.viewModel = viewModel
        globalHotKeyController.registerHotKeys()
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
                Button("Pull Next Paper") {
                    Task {
                        await viewModel.pullNextPaper()
                    }
                }
                .keyboardShortcut("j", modifiers: [.command, .option, .shift])
                .accessibilityIdentifier("queue-command-pull-next-paper")

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
                .disabled(viewModel.selectedPacket == nil)
                .accessibilityIdentifier("queue-command-done-next")

                Button("Defer 1 Hour") {
                    Task {
                        await viewModel.deferSelectedPacketForOneHour()
                    }
                }
                .keyboardShortcut("d", modifiers: [.command, .option])
                .disabled(viewModel.selectedPacket == nil)
                .accessibilityIdentifier("queue-command-defer-one-hour")

                Button("Ignore Item", role: .destructive) {
                    Task {
                        await viewModel.ignoreSelectedPacket()
                    }
                }
                .disabled(viewModel.selectedPacket == nil)
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
                .disabled(viewModel.selectedPacket == nil)
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

                Divider()

                Button("Master Command") {
                    openWindow(id: Self.queueWindowID)
                    viewModel.presentMasterCommand()
                }
                .keyboardShortcut("k", modifiers: [.command, .option, .shift])
                .accessibilityIdentifier("queue-command-master-command")

                Button("Scan Desk") {
                    openWindow(id: Self.queueWindowID)
                    viewModel.presentOnboarding()
                    Task {
                        await viewModel.scanOnboarding()
                    }
                }
                .accessibilityIdentifier("queue-command-scan-desk")
            }
        }
    }
}

@MainActor
final class QueueAppDelegate: NSObject, NSApplicationDelegate {
    weak var viewModel: QueueViewModel?
    private var terminationRestoreInFlight = false

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationRestoreInFlight, viewModel?.canRestoreManualWorkspace == true else {
            return .terminateNow
        }

        terminationRestoreInFlight = true
        Task { @MainActor in
            await restoreManualWorkspaceBeforeTermination()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    @discardableResult
    func restoreManualWorkspaceBeforeTermination() async -> Bool {
        guard let viewModel, viewModel.canRestoreManualWorkspace else {
            return false
        }
        await viewModel.confirmManualWorkspaceRestore()
        return true
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

            Button("Master Command") {
                openWindow(id: windowID)
                viewModel.presentMasterCommand()
            }
            .keyboardShortcut("k", modifiers: [.command, .option, .shift])
            .accessibilityIdentifier("queue-menu-master-command")

            Button("Scan Desk") {
                openWindow(id: windowID)
                viewModel.presentOnboarding()
                Task {
                    await viewModel.scanOnboarding()
                }
            }
            .accessibilityIdentifier("queue-menu-scan-desk")

            Divider()

            Button("Pull Next Paper") {
                Task {
                    await viewModel.pullNextPaper()
                }
            }
            .keyboardShortcut("j", modifiers: [.command, .option, .shift])
            .accessibilityIdentifier("queue-menu-pull-next-paper")

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
            .disabled(viewModel.selectedPacket == nil)
            .accessibilityIdentifier("queue-menu-done-next")

            Button("Defer 1 Hour") {
                Task {
                    await viewModel.deferSelectedPacketForOneHour()
                }
            }
            .keyboardShortcut("d", modifiers: [.command, .option])
            .disabled(viewModel.selectedPacket == nil)
            .accessibilityIdentifier("queue-menu-defer-one-hour")

            Button("Ignore Item", role: .destructive) {
                Task {
                    await viewModel.ignoreSelectedPacket()
                }
            }
            .disabled(viewModel.selectedPacket == nil)
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
            .disabled(viewModel.selectedPacket == nil)
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
                await viewModel.bootstrap()
            }
            await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        }
        .task(id: viewModel.selectedTaskId) {
            await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: .eventLoopQueueMasterCommandRequested)) { _ in
            openWindow(id: windowID)
            viewModel.presentMasterCommand()
        }
    }
}

private extension Notification.Name {
    static let eventLoopQueueMasterCommandRequested = Notification.Name("eventLoopQueueMasterCommandRequested")
}
