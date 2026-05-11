import EventLoopQueueCore
import SwiftUI

struct OnboardingSheet: View {
    let state: OnboardingState
    let rescan: () -> Void
    let approve: (OnboardingApprovalRequest) -> Void
    let approveAll: ([OnboardingApprovalRequest]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var dismissOnApproveAllSuccess = false

    private var hasLoadedProposals: Bool {
        if case let .loaded(scan) = state { return !scan.proposals.isEmpty }
        return false
    }

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
                OnboardingScanView(
                    scan: scan,
                    approve: approve,
                    approveAll: { requests in
                        dismissOnApproveAllSuccess = true
                        approveAll(requests)
                    }
                )
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
                if hasLoadedProposals {
                    Text("⌘↵ to approve & queue all")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("onboarding-approve-all-hint")
                }
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
        .onChange(of: state) { newValue in
            if dismissOnApproveAllSuccess, case .approved = newValue {
                dismissOnApproveAllSuccess = false
                dismiss()
            }
        }
    }
}

private struct OnboardingScanView: View {
    let scan: OnboardingScan
    let approve: (OnboardingApprovalRequest) -> Void
    let approveAll: ([OnboardingApprovalRequest]) -> Void

    @State private var drafts: [String: OnboardingProposalDraft] = [:]

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
                    approveAll(approvalRequests(queuePaper: true))
                } label: {
                    Label("Approve All + Queue", systemImage: "tray.and.arrow.down.fill")
                }
                .keyboardShortcut(.return, modifiers: .command)
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
                                draft: binding(for: proposal),
                                approve: approve
                            )
                        }
                    }
                }
                .accessibilityIdentifier("onboarding-proposal-list")
            }
        }
        .onAppear {
            syncDrafts()
        }
        .onChange(of: scan.proposals.map(\.id)) { _ in
            syncDrafts()
        }
    }

    private func binding(for proposal: OnboardingTaskProposal) -> Binding<OnboardingProposalDraft> {
        Binding(
            get: { drafts[proposal.id] ?? OnboardingProposalDraft(proposal: proposal) },
            set: { drafts[proposal.id] = $0 }
        )
    }

    private func syncDrafts() {
        let validIds = Set(scan.proposals.map(\.id))
        drafts = drafts.filter { validIds.contains($0.key) }
        for proposal in scan.proposals where drafts[proposal.id] == nil {
            drafts[proposal.id] = OnboardingProposalDraft(proposal: proposal)
        }
    }

    private func approvalRequests(queuePaper: Bool) -> [OnboardingApprovalRequest] {
        scan.proposals.map { proposal in
            (drafts[proposal.id] ?? OnboardingProposalDraft(proposal: proposal)).approvalRequest(
                proposalId: proposal.id,
                queuePaper: queuePaper
            )
        }
    }
}

private struct OnboardingProposalDraft: Equatable {
    var taskName: String
    var selectedWindowIds: Set<Int>
    var selectedTaskSessionIds: Set<String>
    var selectedBrowserContextIds: Set<String>

    init(proposal: OnboardingTaskProposal) {
        self.taskName = proposal.taskId
        self.selectedWindowIds = Set(proposal.windows.map(\.id))
        self.selectedTaskSessionIds = Set(proposal.taskSessions.map(\.id))
        self.selectedBrowserContextIds = Set(proposal.browserContexts.map(\.id))
    }

    func approvalRequest(proposalId: String, queuePaper: Bool) -> OnboardingApprovalRequest {
        OnboardingApprovalRequest(
            proposalId: proposalId,
            taskId: taskName,
            windowIds: Array(selectedWindowIds).sorted(),
            taskSessionIds: Array(selectedTaskSessionIds).sorted(),
            browserContextIds: Array(selectedBrowserContextIds).sorted(),
            queuePaper: queuePaper
        )
    }
}

private struct OnboardingProposalRow: View {
    private let visibleResourceLimit = 8

    let proposal: OnboardingTaskProposal
    @Binding var draft: OnboardingProposalDraft
    let approve: (OnboardingApprovalRequest) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(proposal.title)
                        .font(.headline)
                        .lineLimit(1)
                    TextField("Task", text: $draft.taskName)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption.monospaced())
                        .accessibilityIdentifier("onboarding-task-name-\(proposal.id)")
                }
                Spacer()
                PacketPill(label: proposal.confidence, accessibilityID: "onboarding-proposal-confidence-\(proposal.id)")
                Button {
                    approveRequest(queuePaper: true)
                } label: {
                    Label("Approve + Queue", systemImage: "tray.and.arrow.down")
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("onboarding-approve-queue-\(proposal.id)")
                Button {
                    approveRequest(queuePaper: false)
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
            resourceToggles
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

    @ViewBuilder
    private var resourceToggles: some View {
        if !proposal.windows.isEmpty || !proposal.browserContexts.isEmpty || !proposal.taskSessions.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(proposal.windows.prefix(visibleResourceLimit))) { window in
                    Toggle(isOn: binding(for: window.id, in: $draft.selectedWindowIds)) {
                        Text("Window \(window.id): \(window.app) · \(window.title)")
                            .lineLimit(1)
                    }
                    .toggleStyle(.checkbox)
                    .accessibilityIdentifier("onboarding-window-\(proposal.id)-\(window.id)")
                }
                overflowLine(total: proposal.windows.count, label: "windows")
                ForEach(Array(proposal.browserContexts.prefix(visibleResourceLimit))) { context in
                    Toggle(isOn: binding(for: context.id, in: $draft.selectedBrowserContextIds)) {
                        Text("Tab: \(context.title)")
                            .lineLimit(1)
                    }
                    .toggleStyle(.checkbox)
                    .accessibilityIdentifier("onboarding-tab-\(proposal.id)-\(context.id)")
                }
                overflowLine(total: proposal.browserContexts.count, label: "tabs")
                ForEach(Array(proposal.taskSessions.prefix(visibleResourceLimit))) { session in
                    Toggle(isOn: binding(for: session.id, in: $draft.selectedTaskSessionIds)) {
                        Text("Session: \(session.name ?? session.id)")
                            .lineLimit(1)
                    }
                    .toggleStyle(.checkbox)
                    .accessibilityIdentifier("onboarding-session-\(proposal.id)-\(session.id)")
                }
                overflowLine(total: proposal.taskSessions.count, label: "sessions")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func overflowLine(total: Int, label: String) -> some View {
        if total > visibleResourceLimit {
            Text("+ \(total - visibleResourceLimit) more \(label) selected by default")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func approveRequest(queuePaper: Bool) {
        approve(draft.approvalRequest(proposalId: proposal.id, queuePaper: queuePaper))
    }

    private func binding<ID: Hashable>(for id: ID, in set: Binding<Set<ID>>) -> Binding<Bool> {
        Binding(
            get: { set.wrappedValue.contains(id) },
            set: { selected in
                if selected {
                    set.wrappedValue.insert(id)
                } else {
                    set.wrappedValue.remove(id)
                }
            }
        )
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
