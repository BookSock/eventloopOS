import EventLoopQueueCore
import SwiftUI

struct QueueWindowView: View {
    @ObservedObject var viewModel: QueueViewModel
    @State private var workspaceRestoreCandidate: WorkspaceSnapshot?

    private var sidebarSummary: QueueWindowSidebarSummary {
        QueueWindowSidebarSummary(packets: viewModel.packets, state: viewModel.state)
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
                    List(selection: $viewModel.selectedPacketID) {
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

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let packet {
                VStack(alignment: .leading, spacing: 8) {
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

                        DetailSection(title: "Action", systemImage: "checkmark.circle") {
                            Text(packet.recommendedAction)
                                .accessibilityIdentifier("packet-recommended-action")
                        }

                        if let taskId = packet.taskId {
                            DetailSection(title: "Agent", systemImage: "terminal") {
                                TaskSessionBindingSection(
                                    taskId: taskId,
                                    taskSessions: taskSessions,
                                    selectedTaskSessions: selectedTaskSessions,
                                    state: taskBindingState,
                                    loadTaskSessions: loadTaskSessions,
                                    bindTaskSession: bindTaskSession
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
                        .accessibilityIdentifier("queue-execute-recommended-action-button")
                    }
                    Button {
                        deferForOneHour()
                    } label: {
                        Label("Defer 1h", systemImage: "clock")
                    }
                    .controlSize(.large)
                    .accessibilityIdentifier("queue-defer-one-hour-button")

                    Button(role: .destructive) {
                        ignorePacket()
                    } label: {
                        Label("Ignore", systemImage: "trash")
                    }
                    .controlSize(.large)
                    .accessibilityIdentifier("queue-ignore-button")

                    Button {
                        moveToNext()
                    } label: {
                        Label("Skip / Next", systemImage: "arrow.right.circle")
                    }
                    .controlSize(.large)
                    .accessibilityIdentifier("queue-skip-next-button")

                    Button {
                        doneAndNext()
                    } label: {
                        Label("Done / Next", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
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

private struct SendBackTargetBanner: View {
    let session: TaskSession

    private var presentation: TaskSessionTargetPresentation {
        TaskSessionTargetPresentation(session: session)
    }

    var body: some View {
        Label {
            Text("Will send to \(presentation.provider): \(presentation.title)")
                .lineLimit(1)
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
