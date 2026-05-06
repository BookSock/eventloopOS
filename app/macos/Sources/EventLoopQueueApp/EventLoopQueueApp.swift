import EventLoopQueueCore
import SwiftUI

@main
struct EventLoopQueueApp: App {
    @StateObject private var viewModel: QueueViewModel
    private let globalHotKeyController: GlobalHotKeyController

    init() {
        let configuration = QueueAppConfiguration.parse(arguments: CommandLine.arguments)
        let viewModel = QueueViewModel(client: configuration.makeClient())
        _viewModel = StateObject(wrappedValue: viewModel)
        globalHotKeyController = GlobalHotKeyController {
            viewModel.toggleManualMode()
        }
        globalHotKeyController.registerToggleManualModeHotKey()
    }

    var body: some Scene {
        MenuBarExtra("eventloopOS Queue", systemImage: "list.bullet.rectangle") {
            Text("\(viewModel.packets.count) queued")
                .accessibilityIdentifier("queue-menu-count")

            Button("Refresh Queue") {
                Task {
                    await viewModel.loadQueue()
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
                viewModel.toggleManualMode()
            }
            .keyboardShortcut("m", modifiers: [.command, .option, .shift])
            .accessibilityIdentifier("queue-menu-mode-toggle")
        }

        WindowGroup("eventloopOS Queue") {
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
                    viewModel.toggleManualMode()
                }
                .keyboardShortcut("m", modifiers: [.command, .option, .shift])
                .accessibilityIdentifier("queue-command-mode-toggle")
            }
        }
    }
}
