import EventLoopQueueCore
import SwiftUI

struct OnboardingSheet: View {
    let state: OnboardingState
    let rescan: () -> Void
    let approve: (String, Bool) -> Void
    let approveAll: (Bool) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Scan Desk")
                        .font(.title2.weight(.semibold))
                    Text("Review proposed task workbenches from current windows, tabs, and task sessions.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("onboarding-close-button")
            }

            switch state {
            case .idle:
                OnboardingEmptyState(title: "No scan yet", subtitle: "Scan current desk to propose task groups.", systemImage: "rectangle.stack")
            case .scanning:
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Scanning current desk")
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("onboarding-scanning")
            case let .loaded(scan):
                OnboardingScanView(scan: scan, approve: approve, approveAll: approveAll)
            case let .approving(proposalId):
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Approving \(proposalId)")
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("onboarding-approving")
            case let .approved(result):
                VStack(alignment: .leading, spacing: 8) {
                    Label("Approved \(result.taskId)", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityIdentifier("onboarding-approved")
                    if !result.bindings.isEmpty {
                        Text("\(result.bindings.count) task sessions bound.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !result.browserContextBindings.isEmpty {
                        Text("\(result.browserContextBindings.count) browser tabs bound.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let queuedPaper = result.queuedPaper {
                        Text("Queued paper \(queuedPaper.id).")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !result.warnings.isEmpty {
                        FlowText(items: result.warnings)
                    }
                }
            case let .failed(message):
                VStack(alignment: .leading, spacing: 8) {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("onboarding-failed")
                    Button {
                        rescan()
                    } label: {
                        Label("Retry Scan", systemImage: "arrow.clockwise")
                    }
                }
            }

            HStack {
                Spacer()
                Button {
                    rescan()
                } label: {
                    Label("Rescan", systemImage: "arrow.clockwise")
                }
                .disabled(state == .scanning)
                .accessibilityIdentifier("onboarding-rescan-button")
                Button("Done") {
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 680, height: 560)
        .accessibilityIdentifier("onboarding-sheet")
    }
}

private struct OnboardingScanView: View {
    let scan: OnboardingScan
    let approve: (String, Bool) -> Void
    let approveAll: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                HStack(spacing: 8) {
                    PacketPill(label: "\(scan.summary.proposalCount) groups", accessibilityID: "onboarding-proposal-count")
                    PacketPill(label: "\(scan.summary.windowCount) windows", accessibilityID: "onboarding-window-count")
                    PacketPill(label: "\(scan.summary.browserContextCount) tabs", accessibilityID: "onboarding-tab-count")
                    PacketPill(label: "\(scan.summary.taskSessionCount) sessions", accessibilityID: "onboarding-session-count")
                }
                Spacer()
                Button {
                    approveAll(true)
                } label: {
                    Label("Approve All + Queue", systemImage: "tray.and.arrow.down.fill")
                }
                .buttonStyle(.borderedProminent)
                .disabled(scan.proposals.isEmpty)
                .accessibilityIdentifier("onboarding-approve-all-queue-button")
            }

            if !scan.warnings.isEmpty {
                FlowText(items: scan.warnings)
                    .accessibilityIdentifier("onboarding-warnings")
            }

            if scan.proposals.isEmpty {
                OnboardingEmptyState(title: "No task groups found", subtitle: "Add [task:name] to window titles or bind sessions first.", systemImage: "tray")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(scan.proposals) { proposal in
                            OnboardingProposalRow(
                                proposal: proposal,
                                approve: {
                                    approve(proposal.id, false)
                                },
                                approveAndQueue: {
                                    approve(proposal.id, true)
                                }
                            )
                        }
                    }
                }
                .accessibilityIdentifier("onboarding-proposal-list")
            }
        }
    }
}

private struct OnboardingProposalRow: View {
    let proposal: OnboardingTaskProposal
    let approve: () -> Void
    let approveAndQueue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(proposal.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text(proposal.taskId)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                PacketPill(label: proposal.confidence, accessibilityID: "onboarding-proposal-confidence-\(proposal.id)")
                Button {
                    approveAndQueue()
                } label: {
                    Label("Approve + Queue", systemImage: "tray.and.arrow.down")
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("onboarding-approve-queue-\(proposal.id)")
                Button {
                    approve()
                } label: {
                    Label("Approve", systemImage: "checkmark.circle")
                }
                .accessibilityIdentifier("onboarding-approve-\(proposal.id)")
            }
            Text(proposal.reason)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack(spacing: 10) {
                Label("\(proposal.windows.count) windows", systemImage: "macwindow")
                Label("\(proposal.browserContexts.count) tabs", systemImage: "globe")
                Label("\(proposal.taskSessions.count) sessions", systemImage: "terminal")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            let previewLines = onboardingProposalPreviewLines(for: proposal)
            if !previewLines.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(previewLines, id: \.self) { line in
                        Text(line)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }
                .accessibilityIdentifier("onboarding-proposal-preview-\(proposal.id)")
            }
        }
        .padding(10)
        .background(.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityIdentifier("onboarding-proposal-\(proposal.id)")
    }
}

private struct OnboardingEmptyState: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("onboarding-empty-state")
    }
}

