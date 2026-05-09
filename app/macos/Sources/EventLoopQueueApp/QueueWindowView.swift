import EventLoopQueueCore
import SwiftUI

struct QueueWindowView: View {
    @ObservedObject var viewModel: QueueViewModel
    @State private var workspaceRestoreCandidate: WorkspaceSnapshot?

    private var sidebarSummary: QueueWindowSidebarSummary {
        QueueWindowSidebarSummary(packets: viewModel.packets, state: viewModel.state)
    }

    private var auxiliarySheetBinding: Binding<QueueAuxiliarySheet?> {
        Binding {
            viewModel.auxiliarySheet
        } set: { value in
            viewModel.auxiliarySheet = value
        }
    }

    private var showWorkspaceRestoreConfirmation: Binding<Bool> {
        Binding {
            workspaceRestoreCandidate != nil
        } set: { isPresented in
            if !isPresented {
                workspaceRestoreCandidate = nil
            }
        }
    }

    private var selectedPaperBinding: Binding<String?> {
        Binding {
            viewModel.selectedPacketID
        } set: { packetId in
            guard let packetId else {
                viewModel.selectedPacketID = nil
                return
            }
            Task {
                await viewModel.switchToPaper(packetId: packetId)
            }
        }
    }

    var body: some View {
        NavigationSplitView {
            Group {
                if sidebarSummary.showsPlaceholder {
                    QueuePlaceholder(summary: sidebarSummary) {
                        Task {
                            await viewModel.loadQueue()
                        }
                    }
                    .accessibilityIdentifier("queue-sidebar-placeholder")
                } else {
                    List(selection: selectedPaperBinding) {
                        ForEach(viewModel.packets) { packet in
                            QueueRow(packet: packet)
                                .tag(packet.id)
                                .accessibilityIdentifier("queue-row-\(packet.id)")
                        }
                    }
                    .accessibilityIdentifier("queue-list")
                }
            }
            .navigationTitle("Queue")
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 260)
            .toolbar {
                ToolbarItemGroup {
                    Button {
                        Task {
                            await viewModel.pullNextPaper()
                        }
                    } label: {
                        Label("Pull Next Paper", systemImage: "doc.text.magnifyingglass")
                    }
                    .accessibilityIdentifier("queue-pull-next-paper-button")

                    Button {
                        workspaceRestoreCandidate = viewModel.selectedWorkspaceSnapshot
                    } label: {
                        Label("Restore Workspace", systemImage: "rectangle.3.group")
                    }
                    .disabled(!viewModel.canRestoreSelectedWorkspace)
                    .accessibilityIdentifier("queue-restore-workspace-button")

                    Button {
                        Task {
                            await viewModel.toggleManualModeAndPrepareWorkspaceRestoreIfNeeded()
                        }
                    } label: {
                        Label(viewModel.isManualMode ? "Return to Loop" : "Manual Mode", systemImage: viewModel.isManualMode ? "play.circle" : "pause.circle")
                    }
                    .accessibilityIdentifier("queue-mode-toggle-button")
                    .keyboardShortcut("m", modifiers: [.command, .option, .shift])

                    Button {
                        Task {
                            await viewModel.confirmManualWorkspaceRestore()
                        }
                    } label: {
                        Label("Restore Manual Workspace", systemImage: "arrow.uturn.backward.square")
                    }
                    .disabled(!viewModel.canRestoreManualWorkspace)
                    .accessibilityIdentifier("queue-restore-manual-workspace-button")

                    Button {
                        viewModel.presentMasterCommand()
                    } label: {
                        Label("Master", systemImage: "command")
                    }
                    .accessibilityIdentifier("queue-master-command-button")
                    .keyboardShortcut("k", modifiers: [.command, .option, .shift])

                    Button {
                        viewModel.presentOnboarding()
                        Task {
                            await viewModel.scanOnboarding()
                        }
                    } label: {
                        Label("Scan Desk", systemImage: "rectangle.stack.badge.person.crop")
                    }
                    .accessibilityIdentifier("queue-onboarding-button")

                    Button {
                        Task {
                            await viewModel.promoteReadingQueue()
                        }
                    } label: {
                        Label("Promote Reading Tabs", systemImage: "tray.and.arrow.down")
                    }
                    .help("Turn captured Chrome tabs without a task into queue papers.")
                    .accessibilityIdentifier("queue-promote-reading-button")

                    Button {
                        Task {
                            await viewModel.refreshQueue()
                        }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .accessibilityIdentifier("queue-refresh-button")
                }
            }
        } detail: {
            PacketDetail(
                packet: viewModel.selectedPacket,
                queueCount: viewModel.packets.count,
                placeholderSummary: QueueWindowDetailSummary(
                    selectedPacket: viewModel.selectedPacket,
                    packets: viewModel.packets,
                    state: viewModel.state
                ),
                taskSessions: viewModel.taskSessions,
                selectedTaskSessions: viewModel.selectedTaskSessions,
                taskBindingState: viewModel.taskBindingState,
                queueLineageState: viewModel.queueLineageState,
                canExecuteRecommendedAction: viewModel.canExecuteSelectedRecommendedAction,
                recommendedActionBlockReason: viewModel.selectedRecommendedActionBlockReason
            ) {
                Task {
                    await viewModel.doneAndNext()
                }
            } executeRecommendedAction: {
                Task {
                    await viewModel.executeRecommendedActionAndNext()
                }
            } deferForOneHour: {
                Task {
                    await viewModel.deferSelectedPacketForOneHour()
                }
            } ignorePacket: {
                Task {
                    await viewModel.ignoreSelectedPacket()
                }
            } moveToNext: {
                Task {
                    await viewModel.moveToNext()
                }
            } refreshQueue: {
                Task {
                    await viewModel.refreshQueue()
                }
            } restoreContextResource: { resource in
                Task {
                    await viewModel.requestContextRestore(resource: resource)
                }
            } loadTaskSessions: {
                Task {
                    await viewModel.loadTaskSessions()
                }
            } loadLineage: {
                Task {
                    await viewModel.loadLineageForSelectedPacket()
                }
            } bindTaskSession: { taskSessionId in
                Task {
                    await viewModel.bindSelectedPacket(toTaskSessionId: taskSessionId)
                }
            } bindTerminalRef: { terminalRef in
                Task {
                    await viewModel.bindSelectedTerminalRef(terminalRef)
                }
            }
        }
        .overlay(alignment: .bottomLeading) {
            VStack(alignment: .leading, spacing: 8) {
                StatusBanner(state: viewModel.state)
                WorkspaceRestoreBanner(state: viewModel.workspaceRestoreState)
                ManualWorkspaceCaptureBanner(state: viewModel.manualWorkspaceCaptureState)
                ContextRestoreBanner(state: viewModel.contextRestoreState) {
                    Task {
                        await viewModel.refreshContextRestoreRequest()
                    }
                }
            }
                .padding(12)
        }
        .confirmationDialog(
            "Restore workspace?",
            isPresented: showWorkspaceRestoreConfirmation,
            presenting: workspaceRestoreCandidate
        ) { snapshot in
            Button("Restore Workspace") {
                Task {
                    await viewModel.confirmWorkspaceRestore(snapshot: snapshot)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("eventloopOS will ask the local orchestrator to execute the restore plan for the selected queue context.")
        }
        .sheet(item: auxiliarySheetBinding) { sheet in
            switch sheet {
            case .masterCommand:
                MasterCommandSheet(
                    defaultTaskHint: viewModel.selectedTaskId ?? "",
                    state: viewModel.masterCommandState,
                    packets: viewModel.packets,
                    defaultRerankPacketId: viewModel.selectedPacketID
                ) { text, taskHint in
                    Task {
                        await viewModel.sendMasterCommand(text: text, taskHint: taskHint)
                    }
                } startTask: { text, taskHint, cwd, model in
                    Task {
                        await viewModel.startMasterTask(text: text, taskHint: taskHint, cwd: cwd, model: model)
                    }
                } rerank: { packetId, delta in
                    Task {
                        await viewModel.bumpQueuePaperPriority(packetId: packetId, delta: delta, reason: "master_command_rerank")
                    }
                }
            case .onboarding:
                OnboardingSheet(
                    state: viewModel.onboardingState,
                    rescan: {
                        Task {
                            await viewModel.scanOnboarding()
                        }
                    },
                    approve: { proposalId, queuePaper in
                        Task {
                            await viewModel.approveOnboardingProposal(id: proposalId, queuePaper: queuePaper)
                        }
                    },
                    approveAll: { queuePaper in
                        Task {
                            await viewModel.approveAllOnboardingProposals(queuePaper: queuePaper)
                        }
                    }
                )
            }
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
            viewModel.startAutomaticQueueRefresh()
            viewModel.startAutomaticLeaseRenewal()
            viewModel.startAutomaticContextRestoreRefresh()
        }
        .task(id: viewModel.selectedPacketID) {
            await viewModel.prepareSelectedPacketDetail()
        }
        .task(id: viewModel.selectedTaskId) {
            await viewModel.loadTaskSessionsForSelectedPacketIfNeeded()
        }
        .onDisappear {
            viewModel.stopAutomaticQueueRefresh()
            viewModel.stopAutomaticLeaseRenewal()
            viewModel.stopAutomaticContextRestoreRefresh()
        }
    }
}

private struct OnboardingSheet: View {
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

private enum MasterCommandSheetMode: String, CaseIterable, Identifiable {
    case route
    case startTask
    case rerank

    var id: String { rawValue }

    var label: String {
        switch self {
        case .route:
            "Route to Master"
        case .startTask:
            "Start Task"
        case .rerank:
            "Rerank"
        }
    }
}

private struct MasterCommandSheet: View {
    let defaultTaskHint: String
    let state: MasterCommandState
    let packets: [ReviewPacket]
    let defaultRerankPacketId: String?
    let route: (String, String?) -> Void
    let startTask: (String, String?, String?, String?) -> Void
    let rerank: (String, Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var mode: MasterCommandSheetMode = .route
    @State private var text: String = ""
    @State private var taskHint: String
    @State private var cwd: String = ""
    @State private var model: String = ""
    @State private var rerankPacketId: String
    @State private var rerankDelta: Int = 200

    init(
        defaultTaskHint: String,
        state: MasterCommandState,
        packets: [ReviewPacket] = [],
        defaultRerankPacketId: String? = nil,
        route: @escaping (String, String?) -> Void,
        startTask: @escaping (String, String?, String?, String?) -> Void,
        rerank: @escaping (String, Int) -> Void = { _, _ in }
    ) {
        self.defaultTaskHint = defaultTaskHint
        self.state = state
        self.packets = packets
        self.defaultRerankPacketId = defaultRerankPacketId
        self.route = route
        self.startTask = startTask
        self.rerank = rerank
        _taskHint = State(initialValue: defaultTaskHint)
        _rerankPacketId = State(initialValue: defaultRerankPacketId ?? packets.first?.id ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Master Command")
                        .font(.title2.weight(.semibold))
                    Text("Route a note to the master agent or start a new task session.")
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
                .accessibilityIdentifier("master-command-close-button")
            }

            Picker("Mode", selection: $mode) {
                ForEach(MasterCommandSheetMode.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("master-command-mode-picker")

            if mode != .rerank {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Message")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    TextEditor(text: $text)
                        .font(.body)
                        .frame(minHeight: 110)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(.secondary.opacity(0.25))
                        )
                        .accessibilityIdentifier("master-command-text-editor")
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(mode == .route ? "Task Hint" : "Task Name")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    TextField(mode == .route ? "Current task or routing hint" : "New task name", text: $taskHint)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("master-command-task-hint-field")
                }
            }

            if mode == .startTask {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Working Directory")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        TextField("Optional", text: $cwd)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("master-command-cwd-field")
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Model")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        TextField("Optional", text: $model)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("master-command-model-field")
                    }
                }
            }

            if mode == .rerank {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Paper")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Picker("Paper", selection: $rerankPacketId) {
                        ForEach(packets, id: \.id) { packet in
                            Text("\(packet.priority) — \(packet.title)").tag(packet.id)
                        }
                    }
                    .accessibilityIdentifier("master-command-rerank-packet-picker")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Priority delta")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Button("-100") { rerankDelta -= 100 }
                            .accessibilityIdentifier("master-command-rerank-delta-minus")
                        Stepper(value: $rerankDelta, in: -1000...1000, step: 50) {
                            Text("\(rerankDelta >= 0 ? "+" : "")\(rerankDelta)")
                                .monospacedDigit()
                                .accessibilityIdentifier("master-command-rerank-delta-value")
                        }
                        Button("+100") { rerankDelta += 100 }
                            .accessibilityIdentifier("master-command-rerank-delta-plus")
                    }
                }
            }

            MasterCommandStatusView(state: state)

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
                Button(submitLabel) {
                    switch mode {
                    case .route:
                        route(text, optional(taskHint))
                    case .startTask:
                        startTask(text, optional(taskHint), optional(cwd), optional(model))
                    case .rerank:
                        guard !rerankPacketId.isEmpty, rerankDelta != 0 else { return }
                        rerank(rerankPacketId, rerankDelta)
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(submitDisabled)
                .accessibilityIdentifier("master-command-submit-button")
            }
        }
        .padding(20)
        .frame(width: 520)
        .accessibilityIdentifier("master-command-sheet")
    }

    private func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private var submitLabel: String {
        switch mode {
        case .route: return "Route"
        case .startTask: return "Start Task"
        case .rerank: return "Bump priority"
        }
    }

    private var submitDisabled: Bool {
        if state == .sending { return true }
        switch mode {
        case .route, .startTask:
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .rerank:
            return rerankPacketId.isEmpty || rerankDelta == 0
        }
    }
}

private struct MasterCommandStatusView: View {
    let state: MasterCommandState

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .sending:
            Label("Sending", systemImage: "hourglass")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("master-command-status-sending")
        case let .routed(result):
            Label(masterCommandRoutedText(result), systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
                .accessibilityIdentifier("master-command-status-routed")
        case let .started(started):
            Label("Started \(started.taskSessionId ?? started.taskId)", systemImage: "terminal.fill")
                .font(.caption)
                .foregroundStyle(.green)
                .accessibilityIdentifier("master-command-status-started")
        case let .failed(message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
                .accessibilityIdentifier("master-command-status-failed")
        }
    }

    private func masterCommandRoutedText(_ result: MasterCommandResult) -> String {
        if let targetTaskId = result.targetTaskId {
            return "Routed to \(targetTaskId)"
        }
        if let routeAction = result.routeAction {
            return "Routed: \(routeAction)"
        }
        return "Routed"
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
            Text(packet.taskId ?? packet.reviewPacketId)
                .font(.caption2.monospaced())
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .accessibilityIdentifier("queue-row-identity-\(packet.id)")
        }
        .padding(.vertical, 4)
    }
}

private struct PacketDetail: View {
    let packet: ReviewPacket?
    let queueCount: Int
    let placeholderSummary: QueueWindowDetailSummary
    let taskSessions: [TaskSession]
    let selectedTaskSessions: [TaskSession]
    let taskBindingState: TaskBindingState
    let queueLineageState: QueueLineageState
    let canExecuteRecommendedAction: Bool
    let recommendedActionBlockReason: String?
    let doneAndNext: () -> Void
    let executeRecommendedAction: () -> Void
    let deferForOneHour: () -> Void
    let ignorePacket: () -> Void
    let moveToNext: () -> Void
    let refreshQueue: () -> Void
    let restoreContextResource: (ReviewContextResource) -> Void
    let loadTaskSessions: () -> Void
    let loadLineage: () -> Void
    let bindTaskSession: (String) -> Void
    let bindTerminalRef: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let packet {
                VStack(alignment: .leading, spacing: 8) {
                    PacketIdentityStrip(packet: packet, selectedTaskSessions: selectedTaskSessions)
                    HStack(spacing: 12) {
                        Label("\(queueCount) in stack", systemImage: "tray.full")
                            .font(.callout.weight(.medium))
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("packet-stack-count")
                        Text(packet.source)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .accessibilityIdentifier("packet-source-inline")
                        Spacer()
                    }
                    Text(packet.title)
                        .font(.largeTitle.weight(.semibold))
                        .lineLimit(3)
                        .accessibilityIdentifier("packet-title")
                    Text(packet.summary)
                        .font(.title3)
                        .foregroundStyle(.primary)
                        .accessibilityIdentifier("packet-summary")
                    HStack(spacing: 8) {
                        PacketPill(label: "P\(packet.priority)", accessibilityID: "packet-priority")
                        PacketPill(label: packet.riskLevel, accessibilityID: "packet-risk-level")
                        PacketPill(label: packet.confidence, accessibilityID: "packet-confidence")
                    }
                }

                Divider()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        DetailSection(title: "Decision", systemImage: "questionmark.circle") {
                            Text(packet.decisionNeeded.isEmpty ? packet.recommendedAction : packet.decisionNeeded)
                                .accessibilityIdentifier("packet-decision-needed")
                        }

                        DetailSection(title: "Why This Paper", systemImage: "tray.full") {
                            Text(whyThisPaperSummary(for: packet))
                                .accessibilityIdentifier("packet-why-this-paper")
                        }

                        DetailSection(title: "Action", systemImage: "checkmark.circle") {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(packet.recommendedAction)
                                    .accessibilityIdentifier("packet-recommended-action")
                                if let consequence = actionConsequence(for: packet, selectedTaskSessions: selectedTaskSessions) {
                                    Text(consequence)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .accessibilityIdentifier("packet-action-consequence")
                                }
                            }
                        }

                        if let taskId = packet.taskId {
                            DetailSection(title: "Agent", systemImage: "terminal") {
                                TaskSessionBindingSection(
                                    taskId: taskId,
                                    taskSessions: taskSessions,
                                    selectedTaskSessions: selectedTaskSessions,
                                    state: taskBindingState,
                                    loadTaskSessions: loadTaskSessions,
                                    bindTaskSession: bindTaskSession,
                                    bindTerminalRef: bindTerminalRef
                                )
                            }
                        }

                        DetailSection(title: "Lineage", systemImage: "point.3.connected.trianglepath.dotted") {
                            QueueLineageSection(
                                state: queueLineageState,
                                loadLineage: loadLineage
                            )
                        }

                        if !packet.riskTags.isEmpty {
                            DetailSection(title: "Risk", systemImage: "exclamationmark.triangle") {
                                FlowText(items: packet.riskTags)
                                    .accessibilityIdentifier("packet-risk-tags")
                            }
                        }

                        if !packet.contextResources.isEmpty {
                            DetailSection(title: "Context", systemImage: "link") {
                                VStack(alignment: .leading, spacing: 10) {
                                    ForEach(packet.contextResources) { resource in
                                        ResourceRow(
                                            title: resource.title,
                                            subtitle: resourceSubtitle(resource),
                                            badge: resource.restoreConfidence ?? resource.source ?? resource.kind,
                                            url: resource.url,
                                            restoreAction: {
                                                restoreContextResource(resource)
                                            }
                                        )
                                    }
                                }
                                .accessibilityIdentifier("packet-context-list")
                            }
                        } else {
                            Text(packet.source)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("packet-source")
                        }

                        if !packet.evidence.isEmpty {
                            DetailSection(title: "Evidence", systemImage: "doc.text.magnifyingglass") {
                                VStack(alignment: .leading, spacing: 10) {
                                    ForEach(packet.evidence) { evidence in
                                        ResourceRow(
                                            title: evidence.title,
                                            subtitle: evidence.url ?? evidence.kind,
                                            badge: evidence.kind,
                                            url: evidence.url,
                                            restoreAction: nil
                                        )
                                    }
                                }
                                .accessibilityIdentifier("packet-evidence-list")
                            }
                        }
                    }
                }

                Spacer()

                if let recommendedActionBlockReason {
                    Text(recommendedActionBlockReason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("queue-recommended-action-block-reason")
                }
                if packet.recommendedActionType == "resume_agent", let session = selectedTaskSessions.first {
                    SendBackTargetBanner(session: session)
                }

                HStack {
                    Spacer()
                    if packet.recommendedActionType == "resume_agent" {
                        Button {
                            executeRecommendedAction()
                        } label: {
                            Label("Send to Agent", systemImage: "arrowshape.turn.up.right.circle")
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(!canExecuteRecommendedAction)
                        .help(actionConsequence(for: packet, selectedTaskSessions: selectedTaskSessions) ?? "Send recommended follow-up to bound agent.")
                        .accessibilityIdentifier("queue-execute-recommended-action-button")
                    }
                    Button {
                        deferForOneHour()
                    } label: {
                        Label("Defer 1h", systemImage: "clock")
                    }
                    .controlSize(.large)
                    .help("Hide this paper for one hour, then it returns to the queue.")
                    .accessibilityIdentifier("queue-defer-one-hour-button")

                    Button(role: .destructive) {
                        ignorePacket()
                    } label: {
                        Label("Ignore", systemImage: "trash")
                    }
                    .controlSize(.large)
                    .help("Drop this paper from the queue. It will not return.")
                    .accessibilityIdentifier("queue-ignore-button")

                    Button {
                        moveToNext()
                    } label: {
                        Label("Skip / Next", systemImage: "arrow.right.circle")
                    }
                    .controlSize(.large)
                    .help("Leave this paper in the queue and pull the next paper.")
                    .accessibilityIdentifier("queue-skip-next-button")

                    Button {
                        doneAndNext()
                    } label: {
                        Label("Done / Next", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .help("Save this workspace for the task, mark this paper done, then pull the next paper.")
                    .accessibilityIdentifier("queue-done-next-button")
                }
            } else {
                QueuePlaceholder(summary: placeholderSummary, refreshQueue: refreshQueue)
                    .accessibilityIdentifier("queue-empty-state")
            }
        }
        .padding(24)
        .accessibilityIdentifier("packet-detail")
    }
}

private struct QueueLineageSection: View {
    let state: QueueLineageState
    let loadLineage: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch state {
            case .idle:
                Button {
                    loadLineage()
                } label: {
                    Label("Load history", systemImage: "clock.arrow.circlepath")
                }
                .accessibilityIdentifier("queue-lineage-load-button")
            case .loading:
                ProgressView("Loading history")
                    .accessibilityIdentifier("queue-lineage-loading")
            case let .failed(_, message):
                VStack(alignment: .leading, spacing: 6) {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("queue-lineage-error")
                    Button {
                        loadLineage()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                    }
                }
            case let .loaded(_, lineage):
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        PacketPill(label: "\(lineage.counts.events) events", accessibilityID: "queue-lineage-event-count")
                        PacketPill(label: "\(lineage.counts.activity) activity", accessibilityID: "queue-lineage-activity-count")
                        PacketPill(label: "\(lineage.counts.taskMessages) messages", accessibilityID: "queue-lineage-message-count")
                    }
                    if let summary = recentLineageSummary(for: lineage) {
                        Text(summary)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.primary)
                            .lineLimit(3)
                            .accessibilityIdentifier("queue-lineage-recent-summary")
                    }
                    if let event = lineage.events.first {
                        Text(event.title)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .accessibilityIdentifier("queue-lineage-latest-event")
                    }
                    if let message = lineage.taskMessages.first {
                        Text("Latest message: \(message.status) -> \(message.taskSessionId)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("queue-lineage-latest-message")
                    }
                    if let activity = lineage.activity.first {
                        Text(activity.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .accessibilityIdentifier("queue-lineage-latest-activity")
                    }
                    if !lineage.activity.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(lineage.activity.prefix(3))) { activity in
                                QueueLineageActivityRow(activity: activity)
                            }
                        }
                        .accessibilityIdentifier("packet-lineage-activity-list")
                    }
                    if !lineage.taskMessages.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(lineage.taskMessages.prefix(3))) { message in
                                QueueLineageTaskMessageRow(message: message)
                            }
                        }
                        .accessibilityIdentifier("packet-lineage-task-messages-list")
                    }
                    Button {
                        loadLineage()
                    } label: {
                        Label("Refresh history", systemImage: "arrow.clockwise")
                    }
                    .controlSize(.small)
                }
                .accessibilityIdentifier("queue-lineage-loaded")
            }
        }
        .accessibilityIdentifier("packet-lineage-section")
    }
}

private struct PacketIdentityStrip: View {
    let packet: ReviewPacket
    let selectedTaskSessions: [TaskSession]

    private var presentation: QueuePacketIdentityPresentation {
        QueuePacketIdentityPresentation(packet: packet, selectedTaskSessions: selectedTaskSessions)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Label(presentation.taskLabel, systemImage: presentation.taskId == nil ? "link.badge.plus" : "tag")
                    .lineLimit(1)
                    .accessibilityIdentifier("packet-identity-task")
                Text(presentation.packetId)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("packet-identity-packet")
                Spacer(minLength: 0)
            }
            .font(.caption.weight(.medium))

            HStack(spacing: 8) {
                if let workspaceLabel = presentation.workspaceLabel {
                    Label(workspaceLabel, systemImage: "rectangle.3.group")
                        .accessibilityIdentifier("packet-identity-workspace")
                }
                if let sendBackLabel = presentation.sendBackLabel {
                    Label(sendBackLabel, systemImage: "paperplane")
                        .accessibilityIdentifier("packet-identity-send-back")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .padding(8)
        .background(.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityIdentifier("packet-identity-strip")
    }
}

private struct QueueLineageActivityRow: View {
    let activity: QueueLineageActivity

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(activity.status ?? "activity")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(activity.type)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            Text(activity.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            if let taskSessionId = activity.taskSessionId {
                Text(taskSessionId)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 3)
        .accessibilityIdentifier("packet-lineage-activity-row-\(activity.id)")
    }
}

private struct QueueLineageTaskMessageRow: View {
    let message: QueueLineageTaskMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(message.status)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let origin = message.origin {
                    Text(origin)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            Text(message.taskSessionId)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 8) {
                if let textLength = message.textLength {
                    Text("\(textLength) chars")
                }
                Text("\(message.eventIds.count) events")
                if let error = message.error {
                    Text(error)
                        .lineLimit(1)
                }
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 3)
        .accessibilityIdentifier("packet-lineage-task-message-row-\(message.id)")
    }
}

private protocol QueuePlaceholderSummary {
    var title: String { get }
    var subtitle: String { get }
    var systemImage: String { get }
    var showsProgress: Bool { get }
    var showsRetry: Bool { get }
}

extension QueueWindowSidebarSummary: QueuePlaceholderSummary {}
extension QueueWindowDetailSummary: QueuePlaceholderSummary {}

private struct QueuePlaceholder<Summary: QueuePlaceholderSummary>: View {
    let summary: Summary
    let refreshQueue: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            if summary.showsProgress {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityIdentifier("queue-placeholder-progress")
            } else {
                Image(systemName: summary.systemImage)
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("queue-placeholder-image")
            }
            Text(summary.title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("queue-placeholder-title")
            Text(summary.subtitle)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .accessibilityIdentifier("queue-placeholder-subtitle")
            if summary.showsRetry {
                Button {
                    refreshQueue()
                } label: {
                    Label("Refresh Queue", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("queue-placeholder-refresh")
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct TaskSessionBindingSection: View {
    let taskId: String
    let taskSessions: [TaskSession]
    let selectedTaskSessions: [TaskSession]
    let state: TaskBindingState
    let loadTaskSessions: () -> Void
    let bindTaskSession: (String) -> Void
    let bindTerminalRef: ((String) -> Void)?

    init(
        taskId: String,
        taskSessions: [TaskSession],
        selectedTaskSessions: [TaskSession],
        state: TaskBindingState,
        loadTaskSessions: @escaping () -> Void,
        bindTaskSession: @escaping (String) -> Void,
        bindTerminalRef: ((String) -> Void)? = nil
    ) {
        self.taskId = taskId
        self.taskSessions = taskSessions
        self.selectedTaskSessions = selectedTaskSessions
        self.state = state
        self.loadTaskSessions = loadTaskSessions
        self.bindTaskSession = bindTaskSession
        self.bindTerminalRef = bindTerminalRef
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(taskId)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("packet-task-id")

            if let session = selectedTaskSessions.first {
                TaskSessionTargetCard(session: session)
            } else {
                Text("No matching task session loaded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("packet-no-task-session")
            }

            HStack(spacing: 8) {
                Button {
                    loadTaskSessions()
                } label: {
                    Label("Load Sessions", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("packet-load-task-sessions-button")

                Menu {
                    ForEach(taskSessions) { session in
                        Button(taskSessionLabel(session)) {
                            bindTaskSession(session.id)
                        }
                    }
                } label: {
                    Label("Bind Session", systemImage: "link")
                }
                .disabled(taskSessions.isEmpty)
                .accessibilityIdentifier("packet-bind-task-session-menu")

                if let bindTerminalRef, !selectedTaskSessions.isEmpty {
                    Menu {
                        Button("Front Ghostty window") { bindTerminalRef("ghostty:front") }
                        Button("tmux pane :0") { bindTerminalRef("tmux:%0") }
                    } label: {
                        Label("Bind Terminal", systemImage: "terminal.fill")
                    }
                    .help("Send-to-Agent will keystroke into this terminal.")
                    .accessibilityIdentifier("packet-bind-terminal-menu")
                }
            }

            switch state {
            case .idle:
                EmptyView()
            case .loading:
                Label("Loading task sessions", systemImage: "hourglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("packet-task-binding-loading")
            case .loaded:
                Text("\(taskSessions.count) task sessions loaded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("packet-task-binding-loaded")
            case let .bound(binding):
                Text("Bound \(binding.taskSessionId).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("packet-task-binding-bound")
            case let .failed(message):
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("packet-task-binding-failed")
            }
        }
        .accessibilityIdentifier("packet-task-session-binding")
    }
}

private struct TaskSessionTargetCard: View {
    let session: TaskSession

    private var presentation: TaskSessionTargetPresentation {
        TaskSessionTargetPresentation(session: session)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label("Send-back target", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)
            Text(presentation.title)
                .font(.callout.weight(.medium))
                .lineLimit(1)
                .accessibilityIdentifier("packet-bound-task-session-title")
            Text(presentation.subtitle)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .accessibilityIdentifier("packet-bound-task-session-subtitle")
            if let detail = presentation.detail {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .accessibilityIdentifier("packet-bound-task-session-detail")
            }
        }
        .padding(8)
        .background(.green.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityIdentifier("packet-bound-task-session")
    }
}

func actionConsequence(for packet: ReviewPacket, selectedTaskSessions: [TaskSession]) -> String? {
    switch packet.recommendedActionType {
    case "resume_agent":
        if let session = selectedTaskSessions.first {
            let presentation = TaskSessionTargetPresentation(session: session)
            return "Send to Agent will forward this packet to \(presentation.provider): \(presentation.title), save the current workspace, mark this paper done, then pull the next paper."
        }
        return "Send to Agent is blocked until a task session is bound. Done / Next will save this workspace and move on without sending agent follow-up."
    case "mark_done":
        return "Done / Next will save this workspace for the task and move to the next paper."
    default:
        return nil
    }
}

func recentLineageSummary(for lineage: QueueLineage) -> String? {
    let eventSummary = lineage.events.first.map { event in
        "Latest event: \(event.summary.isEmpty ? event.title : event.summary)"
    }
    let activitySummary = lineage.activity.first.map { activity in
        "Last action: \(activity.summary)"
    }
    let messageSummary = lineage.taskMessages.first.map { message in
        "Agent handoff: \(message.status) to \(message.taskSessionId)"
    }

    let parts = [eventSummary, activitySummary, messageSummary].compactMap { $0 }
    guard !parts.isEmpty else {
        return nil
    }
    return parts.joined(separator: " ")
}

func onboardingProposalPreviewLines(for proposal: OnboardingTaskProposal, limit: Int = 5) -> [String] {
    var lines: [String] = []

    for window in proposal.windows {
        lines.append("Window: \(window.app) - \(window.title)")
    }
    for context in proposal.browserContexts {
        if let url = context.url {
            lines.append("Tab: \(context.title) - \(url)")
        } else {
            lines.append("Tab: \(context.title)")
        }
    }
    for session in proposal.taskSessions {
        let label = session.name ?? session.preview ?? session.cwd ?? session.id
        lines.append("Session: \(session.provider) \(session.status) - \(label)")
    }

    guard lines.count > limit else {
        return lines
    }
    return Array(lines.prefix(limit)) + ["+\(lines.count - limit) more"]
}

func whyThisPaperSummary(for packet: ReviewPacket) -> String {
    var parts: [String] = []
    parts.append("Source: \(packet.source).")
    if let taskId = packet.taskId {
        parts.append("Task: \(taskId).")
    }
    if !packet.priorityReasons.isEmpty {
        parts.append("Priority: \(packet.priorityReasons.joined(separator: ", ")).")
    } else {
        parts.append("Priority score: \(packet.priority).")
    }
    if !packet.contextResources.isEmpty {
        parts.append("Context: \(packet.contextResources.count) resource(s).")
    }
    return parts.joined(separator: " ")
}

private struct SendBackTargetBanner: View {
    let session: TaskSession

    private var presentation: TaskSessionTargetPresentation {
        TaskSessionTargetPresentation(session: session)
    }

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text("Will send to \(presentation.provider): \(presentation.title)")
                    .lineLimit(1)
                Text(presentation.identityLabel)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .accessibilityIdentifier("queue-send-back-target-identity")
            }
        } icon: {
            Image(systemName: "paperplane.circle.fill")
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("queue-send-back-target")
    }
}

private func taskSessionLabel(_ session: TaskSession) -> String {
    if let name = session.name, !name.isEmpty {
        return "\(name) (\(session.id))"
    }
    return session.id
}

private func resourceSubtitle(_ resource: ReviewContextResource) -> String {
    let base = resource.url ?? resource.kind
    guard let reason = resource.details?.confidenceReason, !reason.isEmpty else {
        return base
    }
    return "\(base) • \(confidenceReasonLabel(reason))"
}

private func confidenceReasonLabel(_ reason: String) -> String {
    reason
        .split(separator: "_")
        .map(String.init)
        .joined(separator: " ")
}

private struct PacketPill: View {
    let label: String
    let accessibilityID: String

    var body: some View {
        Text(label)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.secondary.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .accessibilityIdentifier(accessibilityID)
    }
}

private struct DetailSection<Content: View>: View {
    let title: String
    let systemImage: String
    private let content: Content

    init(title: String, systemImage: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            content
                .font(.body)
        }
    }
}

private struct ResourceRow: View {
    let title: String
    let subtitle: String
    let badge: String
    let url: String?
    let restoreAction: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(badge)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .leading)
                .lineLimit(1)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.callout.weight(.medium))
                    .lineLimit(2)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if let restoreAction {
                Button {
                    restoreAction()
                } label: {
                    Image(systemName: "scope")
                        .imageScale(.medium)
                }
                .buttonStyle(.borderless)
                .help("Prepare context restore")
                .accessibilityIdentifier("resource-restore-plan-button")
            }
            if let url, let destination = URL(string: url) {
                Link(destination: destination) {
                    Image(systemName: "arrow.up.right.square")
                        .imageScale(.medium)
                }
                .buttonStyle(.borderless)
                .help("Open resource")
                .accessibilityIdentifier("resource-open-link")
            }
        }
    }
}

private struct ContextRestoreBanner: View {
    let state: ContextRestoreState
    let refresh: () -> Void

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case let .planning(resource):
            Text("Context plan: \(resource.title)")
                .font(.caption)
                .padding(8)
                .background(.secondary.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("context-restore-planning")
        case let .planned(_, plan):
            Text("Context plan: \(planSummary(plan))")
                .font(.caption)
                .padding(8)
                .background(.blue.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("context-restore-planned")
        case let .requested(_, restoreRequest):
            HStack(spacing: 8) {
                Text(restoreRequestSummary(restoreRequest))
                    .font(.caption)
                Button(action: refresh) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Refresh context restore status")
                .accessibilityIdentifier("context-restore-refresh-button")
            }
            .padding(8)
            .background(restoreRequestBackground(restoreRequest))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityIdentifier("context-restore-requested")
        case let .failed(resource, message):
            Text("\(resource.title): \(message)")
                .font(.caption)
                .padding(8)
                .background(.red.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("context-restore-failed")
        }
    }

    private func planSummary(_ plan: ContextRestorePlan) -> String {
        if let target = plan.target {
            return target
        }
        if let url = plan.url {
            return url
        }
        if let path = plan.path {
            return path
        }
        return plan.kind
    }

    private func restoreRequestSummary(_ restoreRequest: ContextRestoreRequest) -> String {
        if restoreRequest.status == "failed" {
            return "Context restore failed"
        }
        if restoreRequest.status == "done" {
            if restoreRequest.result?.ok == false {
                return "Context restore failed"
            }
            if restoreRequest.result?.restoredHighlight == true {
                return "Context restore done + highlighted"
            }
            return "Context restore done"
        }

        return "Context restore queued: \(restoreRequest.status)"
    }

    private func restoreRequestBackground(_ restoreRequest: ContextRestoreRequest) -> Color {
        if restoreRequest.status == "failed" || (restoreRequest.status == "done" && restoreRequest.result?.ok == false) {
            return .red.opacity(0.12)
        }

        return .green.opacity(0.12)
    }
}

private struct FlowText: View {
    let items: [String]

    var body: some View {
        Text(items.joined(separator: "  "))
            .font(.callout)
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

private struct WorkspaceRestoreBanner: View {
    let state: WorkspaceRestoreState

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .skippedManualMode:
            Text("Workspace restore paused")
                .font(.caption)
                .padding(8)
                .background(.secondary.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("workspace-restore-paused")
        case let .planned(plan):
            Text("Workspace plan: \(plan.commands.count) commands")
                .font(.caption)
                .padding(8)
                .background(.blue.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("workspace-restore-planned")
        case let .executed(receipt):
            Text("Workspace restored: \(receipt.commands.count) commands")
                .font(.caption)
                .padding(8)
                .background(.green.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("workspace-restore-executed")
        case let .failed(message):
            Text(message)
                .font(.caption)
                .padding(8)
                .background(.red.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("workspace-restore-failed")
        }
    }
}

private struct ManualWorkspaceCaptureBanner: View {
    let state: ManualWorkspaceCaptureState

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .capturing:
            Text("Capturing manual workspace")
                .font(.caption)
                .padding(8)
                .background(.secondary.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("manual-workspace-capturing")
        case let .captured(snapshot):
            Text("Manual workspace saved: \(snapshot.windows.count) windows")
                .font(.caption)
                .padding(8)
                .background(.green.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("manual-workspace-captured")
        case let .failed(message):
            Text("Manual workspace capture failed: \(message)")
                .font(.caption)
                .padding(8)
                .background(.red.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityIdentifier("manual-workspace-capture-failed")
        }
    }
}
