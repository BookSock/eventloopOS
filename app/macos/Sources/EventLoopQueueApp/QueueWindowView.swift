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

    private var pendingTerminalSendBinding: Binding<Bool> {
        Binding {
            viewModel.pendingTerminalSendConfirmation != nil
        } set: { isPresented in
            if !isPresented {
                viewModel.cancelPendingTerminalSend()
            }
        }
    }

    private var promoteReadingTabsLabel: String {
        viewModel.readingQueueUnboundCount > 0
            ? "Promote Reading Tabs (\(viewModel.readingQueueUnboundCount))"
            : "Promote Reading Tabs"
    }

    private var promoteReadingTabsIcon: String {
        viewModel.readingQueueUnboundCount > 0 ? "tray.and.arrow.down.fill" : "tray.and.arrow.down"
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
                            QueueRow(packet: packet, badge: viewModel.changeBadge(for: packet))
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
                        Label(promoteReadingTabsLabel, systemImage: promoteReadingTabsIcon)
                    }
                    .help("Turn captured Chrome tabs without a task into queue papers.")
                    .accessibilityIdentifier("queue-promote-reading-button")

                    Button {
                        viewModel.presentActivity()
                    } label: {
                        Label("Activity", systemImage: "waveform.path.ecg")
                    }
                    .help("See recent system activity: fan-outs, terminal sends, voice reranks, restores.")
                    .accessibilityIdentifier("queue-activity-button")

                    Menu {
                        Button("Auto-bind once") {
                            Task { await viewModel.runCodexAutoBindOnce() }
                        }
                        .accessibilityIdentifier("queue-autobind-once-button")
                        Toggle("Auto-bind continuously", isOn: Binding(
                            get: { viewModel.autoBindContinuousEnabled },
                            set: { viewModel.setAutoBindContinuous($0) }
                        ))
                        .accessibilityIdentifier("queue-autobind-toggle")
                    } label: {
                        Label(
                            viewModel.autoBindContinuousEnabled ? "Auto-bind: on" : "Auto-bind",
                            systemImage: viewModel.autoBindContinuousEnabled ? "link.circle.fill" : "link.circle"
                        )
                    }
                    .help("Bind Ghostty windows whose title contains [task:foo] to matching task sessions.")
                    .accessibilityIdentifier("queue-autobind-menu")

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
        .confirmationDialog(
            "Send keystrokes to terminal?",
            isPresented: pendingTerminalSendBinding,
            presenting: viewModel.pendingTerminalSendConfirmation
        ) { pending in
            Button("Send once") {
                Task {
                    await viewModel.confirmPendingTerminalSendAndProceed(scope: .oneShot)
                }
            }
            .accessibilityIdentifier("queue-terminal-send-once-button")
            Button("Send and remember for this session") {
                Task {
                    await viewModel.confirmPendingTerminalSendAndProceed(scope: .thisSession)
                }
            }
            .accessibilityIdentifier("queue-terminal-send-session-button")
            Button("Always for \(pending.terminalRef)") {
                Task {
                    await viewModel.confirmPendingTerminalSendAndProceed(scope: .rememberForRef)
                }
            }
            .accessibilityIdentifier("queue-terminal-send-remember-button")
            Button("Cancel", role: .cancel) {
                viewModel.cancelPendingTerminalSend()
            }
            .accessibilityIdentifier("queue-terminal-send-cancel-button")
        } message: { pending in
            Text("eventloopOS will type the followup into \(pending.terminalRef) (session \(pending.sessionId)). Pick whether to remember this choice.")
        }
        .sheet(item: auxiliarySheetBinding) { sheet in
            switch sheet {
            case .masterCommand:
                MasterCommandSheet(
                    defaultTaskHint: viewModel.selectedTaskId ?? "",
                    state: viewModel.masterCommandState,
                    packets: viewModel.packets,
                    defaultRerankPacketId: viewModel.selectedPacketID,
                    voiceState: viewModel.voiceCaptureState,
                    voiceCaptureStartedAt: viewModel.voiceCaptureStartedAt,
                    voiceCaptureMaxSeconds: viewModel.voiceCaptureMaxSeconds
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
                } startVoiceCapture: {
                    await viewModel.startVoiceCapture()
                } previewFanOut: { message, selector in
                    let key = "broadcast_preview_\(Date().timeIntervalSince1970)_\(UUID().uuidString)"
                    return await viewModel.previewFanOut(
                        message: message,
                        taskHintSubstring: selector,
                        taskIdPattern: nil,
                        idempotencyKey: key
                    )
                } executeFanOut: { message, selector in
                    let key = "broadcast_\(UUID().uuidString)"
                    return await viewModel.executeFanOut(
                        message: message,
                        taskHintSubstring: selector,
                        taskIdPattern: nil,
                        idempotencyKey: key
                    )
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
            case .activity:
                ActivityFeedSheet(events: viewModel.activityEvents) {
                    Task { await viewModel.refreshActivity() }
                }
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


private struct QueueRow: View {
    let packet: ReviewPacket
    let badge: PacketChangeBadge

    init(packet: ReviewPacket, badge: PacketChangeBadge = .none) {
        self.packet = packet
        self.badge = badge
    }

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
            changeBadgeView
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

    @ViewBuilder
    private var changeBadgeView: some View {
        switch badge {
        case .none:
            EmptyView()
        case .new:
            Label("New", systemImage: "sparkles")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.blue)
                .accessibilityIdentifier("queue-row-badge-new-\(packet.id)")
        case let .priorityIncreased(by):
            Label("+\(by) priority", systemImage: "arrow.up.circle.fill")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.orange)
                .accessibilityIdentifier("queue-row-badge-up-\(packet.id)")
        case let .priorityDecreased(by):
            Label("-\(by) priority", systemImage: "arrow.down.circle")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.gray)
                .accessibilityIdentifier("queue-row-badge-down-\(packet.id)")
        case .priorityReasonsChanged:
            Label("Reason changed", systemImage: "arrow.triangle.2.circlepath")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.indigo)
                .accessibilityIdentifier("queue-row-badge-reasons-\(packet.id)")
        case let .contextChanged(addedResources):
            Label("+\(addedResources) context", systemImage: "plus.circle.fill")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.green)
                .accessibilityIdentifier("queue-row-badge-context-\(packet.id)")
        }
    }
}

struct PacketPill: View {
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

struct DetailSection<Content: View>: View {
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

struct ResourceRow: View {
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

struct ContextRestoreBanner: View {
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

struct FlowText: View {
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
