import AppKit
import Combine
import EventLoopQueueCore
import SwiftUI

@MainActor
final class PaperReminderHUDController {
    private weak var viewModel: QueueViewModel?
    private var window: NSPanel?
    private var cancellable: AnyCancellable?
    private let enabled: Bool

    init(viewModel: QueueViewModel, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.viewModel = viewModel
        enabled = Self.shouldEnable(environment: environment)
        guard enabled else {
            return
        }
        cancellable = viewModel.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async {
                self?.refresh()
            }
        }
        refresh()
    }

    func refresh() {
        guard enabled, let viewModel, let packet = viewModel.selectedPacket else {
            hide()
            return
        }
        let presentation = QueuePaperReminderPresentation(
            packet: packet,
            selectedTaskSessions: viewModel.selectedTaskSessions
        )
        let window = ensureWindow()
        window.contentView = NSHostingView(rootView: PaperReminderHUDView(presentation: presentation))
        position(window)
        window.orderFrontRegardless()
    }

    func hide() {
        window?.orderOut(nil)
    }

    static func shouldEnable(environment: [String: String]) -> Bool {
        environment["EVENTLOOPOS_PAPER_REMINDER_DISABLED"] != "1"
    }

    static func configureWindow(_ window: NSPanel) {
        window.identifier = NSUserInterfaceItemIdentifier("eventloopos-paper-reminder-hud")
        window.title = "eventloopOS Paper Reminder"
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.isFloatingPanel = true
        window.hidesOnDeactivate = false
        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.ignoresMouseEvents = true
        window.animationBehavior = .utilityWindow
    }

    private func ensureWindow() -> NSPanel {
        if let window {
            return window
        }
        let window = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 94),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        Self.configureWindow(window)
        self.window = window
        return window
    }

    private func position(_ window: NSWindow) {
        let screen = NSApp.keyWindow?.screen ?? NSApp.mainWindow?.screen ?? NSScreen.main
        guard let frame = screen?.visibleFrame else {
            return
        }
        let width = min(CGFloat(760), max(CGFloat(320), frame.width - 96))
        let height = CGFloat(94)
        let x = frame.midX - width / 2
        let y = frame.maxY - height - 18
        window.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true)
    }
}

struct PaperReminderHUDView: View {
    let presentation: QueuePaperReminderPresentation

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.title3)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(presentation.title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .accessibilityIdentifier("paper-reminder-title")
                Text(presentation.decision)
                    .font(.callout.weight(.medium))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("paper-reminder-decision")
                Text(presentation.context)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .accessibilityIdentifier("paper-reminder-context")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(.secondary.opacity(0.16), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("paper-reminder-hud")
        .accessibilityLabel(presentation.accessibilityLabel)
    }
}
