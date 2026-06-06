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
    private var lastFeedbackSequence = 0
    private var transientFeedback: PaperReminderFeedbackPresentation?
    private var transientFeedbackExpiresAt: Date?
    private var feedbackClearGeneration = 0
    private static let feedbackDisplayDuration: TimeInterval = 3.0
    static let preferredContentSize = NSSize(width: 760, height: 116)

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
        guard enabled, let viewModel else {
            hide()
            return
        }
        updateTransientFeedback(from: viewModel)
        let feedback = activeTransientFeedback()
        let presentation = viewModel.selectedPacket.map {
            QueuePaperReminderPresentation(
                packet: $0,
                selectedTaskSessions: viewModel.selectedTaskSessions
            )
        }
        guard presentation != nil || feedback != nil else {
            hide()
            return
        }
        let window = ensureWindow()
        window.contentView = NSHostingView(rootView: PaperReminderHUDView(presentation: presentation, feedback: feedback))
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
            contentRect: NSRect(origin: .zero, size: Self.preferredContentSize),
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
        let width = min(Self.preferredContentSize.width, max(CGFloat(320), frame.width - 96))
        let height = Self.preferredContentSize.height
        let x = frame.midX - width / 2
        let y = frame.maxY - height - 18
        window.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true)
    }

    private func updateTransientFeedback(from viewModel: QueueViewModel) {
        guard viewModel.feedbackSequence != lastFeedbackSequence else {
            return
        }
        lastFeedbackSequence = viewModel.feedbackSequence
        guard let toast = viewModel.advanceToast else {
            transientFeedback = nil
            transientFeedbackExpiresAt = nil
            return
        }
        transientFeedback = PaperReminderFeedbackPresentation(
            toast: toast,
            queueCount: viewModel.packets.count,
            feedbackSequence: viewModel.feedbackSequence
        )
        transientFeedbackExpiresAt = Date().addingTimeInterval(Self.feedbackDisplayDuration)
        scheduleTransientFeedbackClear()
    }

    private func activeTransientFeedback(now: Date = Date()) -> PaperReminderFeedbackPresentation? {
        guard let transientFeedback, let transientFeedbackExpiresAt, transientFeedbackExpiresAt > now else {
            return nil
        }
        return transientFeedback
    }

    private func scheduleTransientFeedbackClear() {
        feedbackClearGeneration += 1
        let generation = feedbackClearGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.feedbackDisplayDuration) { [weak self] in
            Task { @MainActor in
                guard let self, self.feedbackClearGeneration == generation else {
                    return
                }
                self.transientFeedback = nil
                self.transientFeedbackExpiresAt = nil
                self.refresh()
            }
        }
    }
}

struct PaperReminderHUDView: View {
    let presentation: QueuePaperReminderPresentation?
    let feedback: PaperReminderFeedbackPresentation?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: leadingIcon)
                .font(.title3)
                .foregroundStyle(leadingIconForeground)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                if let presentation {
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
                }
                if let feedback {
                    HStack(spacing: 5) {
                        Image(systemName: feedback.icon)
                            .accessibilityHidden(true)
                        Text(feedback.message)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .font(presentation == nil ? .callout.weight(.medium) : .caption2.weight(.medium))
                    .foregroundStyle(foreground(for: feedback.foregroundRole))
                    .accessibilityIdentifier("paper-reminder-feedback")
                } else if let presentation {
                    Text(presentation.context)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("paper-reminder-context")
                }
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
        .accessibilityLabel(accessibilityLabel)
    }

    private var leadingIcon: String {
        if presentation == nil, let feedback {
            return feedback.icon
        }
        return "doc.text.magnifyingglass"
    }

    private var leadingIconForeground: Color {
        if presentation == nil, let feedback {
            return foreground(for: feedback.foregroundRole)
        }
        return .secondary
    }

    private var accessibilityLabel: String {
        [
            presentation?.accessibilityLabel,
            feedback.map { "Feedback: \($0.message)" },
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " | ")
    }

    private func foreground(for role: AdvanceToastForegroundRole) -> Color {
        switch role {
        case .warning:
            return .orange
        case .muted:
            return .secondary
        case .success:
            return .green
        }
    }
}

struct PaperReminderFeedbackPresentation: Equatable {
    let message: String
    let icon: String
    let foregroundRole: AdvanceToastForegroundRole

    init(toast: AdvanceToast, queueCount: Int, feedbackSequence: Int) {
        let presentation = AdvanceToastBannerPresentation.make(
            toast: toast,
            queueCount: queueCount,
            feedbackSequence: feedbackSequence
        )
        message = presentation.message
        icon = presentation.icon
        foregroundRole = presentation.foregroundRole
    }
}
