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
        if !CommandLine.arguments.contains("--test-mode"),
           ProcessInfo.processInfo.environment["EVENTLOOP_QUEUE_TEST_MODE"] != "1",
           ProcessInfo.processInfo.environment["EVENTLOOPOS_SINGLE_INSTANCE_DISABLED"] != "1" {
            enforceSingleInstance()
        }
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
            advance: {
                Task {
                    await viewModel.advance()
                }
            },
            doneNext: {
                Task {
                    await viewModel.doneAndNext()
                }
            },
            executeRecommendedAction: {
                Task {
                    await viewModel.executeRecommendedActionAndNext()
                }
            },
            deferOneHour: {
                Task {
                    await viewModel.deferSelectedPacketForOneHour()
                }
            },
            restoreWorkspace: {
                Task {
                    await viewModel.confirmSelectedWorkspaceRestore()
                }
            },
            returnHere: {
                Task {
                    await viewModel.returnToEventLoopModeKeepingCurrentLayout()
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
            },
            hotkeys: {
                NSApp.activate(ignoringOtherApps: true)
                NotificationCenter.default.post(name: .eventLoopQueueHotkeysRequested, object: nil)
            }
        )
        appDelegate.viewModel = viewModel
        globalHotKeyController.registerHotKeys()
    }

    var body: some Scene {
        MenuBarExtra("eventloopOS Queue", systemImage: "list.bullet.rectangle") {
            QueueMenuView(viewModel: viewModel, openQueueWindow: openQueueWindow)
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
                .keyboardShortcut("j", modifiers: [.control, .option])
                .disabled(viewModel.paperActionInFlight)
                .accessibilityIdentifier("queue-command-pull-next-paper")

                Button(viewModel.selectedPacket?.recommendedAction ?? "Run Recommended Action") {
                    Task {
                        await viewModel.executeRecommendedActionAndNext()
                    }
                }
                .keyboardShortcut(.return, modifiers: [.control, .option])
                .disabled(viewModel.paperActionInFlight)
                .accessibilityIdentifier("queue-command-execute-recommended-action")

                Button("Done / Next") {
                    Task {
                        await viewModel.doneAndNext()
                    }
                }
                .keyboardShortcut("e", modifiers: [.control, .option])
                .disabled(viewModel.paperActionInFlight)
                .accessibilityIdentifier("queue-command-done-next")

                Button("Defer 1 Hour") {
                    Task {
                        await viewModel.deferSelectedPacketForOneHour()
                    }
                }
                .keyboardShortcut("h", modifiers: [.control, .option])
                .disabled(viewModel.paperActionInFlight)
                .accessibilityIdentifier("queue-command-defer-one-hour")

                Button("Ignore Item", role: .destructive) {
                    Task {
                        await viewModel.ignoreSelectedPacket()
                    }
                }
                .disabled(viewModel.paperActionInFlight)
                .accessibilityIdentifier("queue-command-ignore")

                Button("Restore Queue Workspace") {
                    Task {
                        await viewModel.confirmSelectedWorkspaceRestore()
                    }
                }
                .keyboardShortcut("r", modifiers: [.control, .option])
                .disabled(viewModel.paperActionInFlight)
                .accessibilityIdentifier("queue-command-restore-queue-workspace")

                Button("Skip / Next Item") {
                    Task {
                        await viewModel.moveToNext()
                    }
                }
                .keyboardShortcut(.return, modifiers: [.command, .option])
                .disabled(viewModel.paperActionInFlight)
                .accessibilityIdentifier("queue-command-skip-next")

                if viewModel.isManualMode {
                    Button("Return + Restore") {
                        Task {
                            await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()
                        }
                    }
                    .keyboardShortcut("m", modifiers: [.control, .option])
                    .accessibilityIdentifier("queue-command-return-restore")

                    Button("Keep Current Layout") {
                        Task {
                            await viewModel.returnToEventLoopModeKeepingCurrentLayout()
                        }
                    }
                    .keyboardShortcut("m", modifiers: [.control, .option, .shift])
                    .accessibilityIdentifier("queue-command-return-here")
                } else {
                    Button("Enter Manual Mode") {
                        Task {
                            await viewModel.enterManualModeAndRestoreSavedWorkspaceIfAvailable()
                        }
                    }
                    .keyboardShortcut("m", modifiers: [.control, .option])
                    .accessibilityIdentifier("queue-command-mode-toggle")
                }

                Button("Restore Manual Workspace") {
                    Task {
                        await viewModel.confirmManualWorkspaceRestore()
                    }
                }
                .disabled(!viewModel.canRestoreManualWorkspace)
                .accessibilityIdentifier("queue-command-restore-manual-workspace")

                Divider()

                Button("Master Command") {
                    openQueueWindow()
                    viewModel.presentMasterCommand()
                }
                .keyboardShortcut("k", modifiers: [.control, .option])
                .accessibilityIdentifier("queue-command-master-command")

                Button("Scan Desk") {
                    openQueueWindow()
                    viewModel.presentOnboarding()
                    Task {
                        await viewModel.scanOnboarding()
                    }
                }
                .accessibilityIdentifier("queue-command-scan-desk")

                Button("Follows Rules") {
                    openQueueWindow()
                    viewModel.presentFollowsRules()
                }
                .accessibilityIdentifier("queue-command-follows-rules")

                Button("Hotkeys") {
                    openQueueWindow()
                    viewModel.presentHotkeys()
                }
                .keyboardShortcut("/", modifiers: [.control, .option])
                .accessibilityIdentifier("queue-command-hotkeys")
            }
        }
    }

    private func openQueueWindow() {
        if appDelegate.focusExistingQueueWindow() {
            return
        }
        openWindow(id: Self.queueWindowID)
    }
}

@MainActor
final class QueueAppDelegate: NSObject, NSApplicationDelegate {
    weak var viewModel: QueueViewModel?
    private var terminationRestoreInFlight = false
    private var harnessWindow: NSWindow?
    private var paperReminderHUD: PaperReminderHUDController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleMasterCommandRequested(_:)),
            name: .eventLoopQueueMasterCommandRequested,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleHotkeysRequested(_:)),
            name: .eventLoopQueueHotkeysRequested,
            object: nil
        )
        openHarnessWindowIfRequested()
        openPaperReminderHUDIfAvailable()
    }

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

    @objc
    private func handleMasterCommandRequested(_ notification: Notification) {
        _ = presentMasterCommandFromGlobalHotkey()
    }

    @objc
    private func handleHotkeysRequested(_ notification: Notification) {
        _ = presentHotkeysFromGlobalHotkey()
    }

    @discardableResult
    func presentMasterCommandFromGlobalHotkey() -> Bool {
        let opened = openFloatingQueueWindow()
        if !opened {
            NSApp.activate(ignoringOtherApps: true)
        }
        viewModel?.presentMasterCommand()
        return opened && viewModel != nil
    }

    @discardableResult
    func presentHotkeysFromGlobalHotkey() -> Bool {
        let opened = openFloatingQueueWindow()
        if !opened {
            NSApp.activate(ignoringOtherApps: true)
        }
        viewModel?.presentHotkeys()
        return opened && viewModel != nil
    }

    @discardableResult
    func openHarnessWindowIfRequested(
        arguments: [String] = CommandLine.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
        guard Self.shouldOpenHarnessWindow(arguments: arguments, environment: environment) else {
            return false
        }
        return openFloatingQueueWindow()
    }

    static func shouldOpenHarnessWindow(
        arguments: [String],
        environment: [String: String]
    ) -> Bool {
        arguments.contains("--harness-window") ||
            environment["EVENTLOOPOS_QUEUE_APP_HARNESS_WINDOW"] == "1"
    }

    @discardableResult
    func openFloatingQueueWindow() -> Bool {
        guard let viewModel else {
            return false
        }
        if let harnessWindow {
            harnessWindow.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return true
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        Self.configureHarnessWindow(window)
        window.contentViewController = NSHostingController(rootView: QueueWindowView(viewModel: viewModel)
            .frame(minWidth: 760, minHeight: 460))
        window.center()
        window.makeKeyAndOrderFront(nil)
        harnessWindow = window
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    @discardableResult
    func openPaperReminderHUDIfAvailable(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
        guard let viewModel else {
            return false
        }
        guard PaperReminderHUDController.shouldEnable(environment: environment) else {
            paperReminderHUD?.hide()
            paperReminderHUD = nil
            return false
        }
        paperReminderHUD = PaperReminderHUDController(viewModel: viewModel, environment: environment)
        return true
    }

    static func configureHarnessWindow(_ window: NSWindow) {
        window.title = "eventloopOS Queue"
        window.identifier = NSUserInterfaceItemIdentifier("eventloopos-queue-harness-window")
        window.level = .floating
        window.minSize = NSSize(width: 760, height: 460)
    }

    @discardableResult
    func focusExistingQueueWindow() -> Bool {
        if let harnessWindow {
            focus(window: harnessWindow)
            return true
        }

        guard let app = NSApp,
              let window = app.windows.first(where: { window in
            window.identifier?.rawValue == "eventloopos-queue-harness-window" ||
                window.title == "eventloopOS Queue"
        }) else {
            return false
        }
        focus(window: window)
        return true
    }

    private func focus(window: NSWindow) {
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp?.activate(ignoringOtherApps: true)
    }
}

private struct QueueMenuView: View {
    @ObservedObject var viewModel: QueueViewModel
    let openQueueWindow: () -> Void

    private var summary: QueueMenuSummary {
        QueueMenuSummary(
            packets: viewModel.packets,
            selectedPacket: viewModel.selectedPacket,
            queueState: viewModel.state,
            mode: viewModel.mode,
            contextRestoreState: viewModel.contextRestoreState,
            workspaceHealthState: viewModel.workspaceHealthState,
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
            if let workspaceHealthLabel = summary.workspaceHealthLabel {
                Text(workspaceHealthLabel)
                    .lineLimit(3)
                    .accessibilityIdentifier("queue-menu-workspace-health")
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
                openQueueWindow()
            }
            .keyboardShortcut("o", modifiers: [.command])
            .accessibilityIdentifier("queue-menu-open-window")

            Button("Refresh Queue") {
                Task {
                    await viewModel.refreshWorkspaceStatus()
                    await viewModel.refreshQueue()
                }
            }
            .accessibilityIdentifier("queue-menu-refresh")

            Button("Master Command") {
                openQueueWindow()
                viewModel.presentMasterCommand()
            }
            .keyboardShortcut("k", modifiers: [.control, .option])
            .accessibilityIdentifier("queue-menu-master-command")

            Button("Hotkeys") {
                openQueueWindow()
                viewModel.presentHotkeys()
            }
            .keyboardShortcut("/", modifiers: [.control, .option])
            .accessibilityIdentifier("queue-menu-hotkeys")

            Button("Scan Desk") {
                openQueueWindow()
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
            .keyboardShortcut("j", modifiers: [.control, .option])
            .disabled(viewModel.paperActionInFlight)
            .accessibilityIdentifier("queue-menu-pull-next-paper")

            Button(viewModel.selectedPacket?.recommendedAction ?? "Run Recommended Action") {
                Task {
                    await viewModel.executeRecommendedActionAndNext()
                }
            }
            .keyboardShortcut(.return, modifiers: [.control, .option])
            .disabled(viewModel.paperActionInFlight)
            .accessibilityIdentifier("queue-menu-execute-recommended-action")

            Button("Done / Next") {
                Task {
                    await viewModel.doneAndNext()
                }
            }
            .keyboardShortcut("e", modifiers: [.control, .option])
            .disabled(viewModel.paperActionInFlight)
            .accessibilityIdentifier("queue-menu-done-next")

            Button("Defer 1 Hour") {
                Task {
                    await viewModel.deferSelectedPacketForOneHour()
                }
            }
            .keyboardShortcut("h", modifiers: [.control, .option])
            .disabled(viewModel.paperActionInFlight)
            .accessibilityIdentifier("queue-menu-defer-one-hour")

            Button("Ignore Item", role: .destructive) {
                Task {
                    await viewModel.ignoreSelectedPacket()
                }
            }
            .disabled(viewModel.paperActionInFlight)
            .accessibilityIdentifier("queue-menu-ignore")

            Button("Restore Queue Workspace") {
                Task {
                    await viewModel.confirmSelectedWorkspaceRestore()
                }
            }
            .keyboardShortcut("r", modifiers: [.control, .option])
            .disabled(viewModel.paperActionInFlight)
            .accessibilityIdentifier("queue-menu-restore-queue-workspace")

            Button("Skip / Next Item") {
                Task {
                    await viewModel.moveToNext()
                }
            }
            .keyboardShortcut(.return, modifiers: [.command, .option])
            .disabled(viewModel.paperActionInFlight)
            .accessibilityIdentifier("queue-menu-skip-next")

            if viewModel.isManualMode {
                Button("Return + Restore") {
                    Task {
                        await viewModel.returnToEventLoopModeAndPrepareWorkspaceRestore()
                    }
                }
                .keyboardShortcut("m", modifiers: [.control, .option])
                .accessibilityIdentifier("queue-menu-return-restore")

                Button("Keep Current Layout") {
                    Task {
                        await viewModel.returnToEventLoopModeKeepingCurrentLayout()
                    }
                }
                .keyboardShortcut("m", modifiers: [.control, .option, .shift])
                .accessibilityIdentifier("queue-menu-return-here")
            } else {
                Button("Enter Manual Mode") {
                    Task {
                        await viewModel.enterManualModeAndRestoreSavedWorkspaceIfAvailable()
                    }
                }
                .keyboardShortcut("m", modifiers: [.control, .option])
                .accessibilityIdentifier("queue-menu-mode-toggle")
            }

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
    }
}

private extension Notification.Name {
    static let eventLoopQueueMasterCommandRequested = Notification.Name("eventLoopQueueMasterCommandRequested")
    static let eventLoopQueueHotkeysRequested = Notification.Name("eventLoopQueueHotkeysRequested")
}
