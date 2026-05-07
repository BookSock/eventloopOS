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
            .toolbar {
                ToolbarItemGroup {
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
                placeholderSummary: QueueWindowDetailSummary(
                    selectedPacket: viewModel.selectedPacket,
                    packets: viewModel.packets,
                    state: viewModel.state
                )
            ) {
                Task {
                    await viewModel.doneAndNext()
                }
            } refreshQueue: {
                Task {
                    await viewModel.refreshQueue()
                }
            } restoreContextResource: { resource in
                Task {
                    await viewModel.requestContextRestore(resource: resource)
                }
            }
        }
        .overlay(alignment: .bottomLeading) {
            VStack(alignment: .leading, spacing: 8) {
                StatusBanner(state: viewModel.state)
                WorkspaceRestoreBanner(state: viewModel.workspaceRestoreState)
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
            await viewModel.prepareSelectedWorkspaceRestore()
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
    let placeholderSummary: QueueWindowDetailSummary
    let doneAndNext: () -> Void
    let refreshQueue: () -> Void
    let restoreContextResource: (ReviewContextResource) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let packet {
                VStack(alignment: .leading, spacing: 8) {
                    Text(packet.title)
                        .font(.title2.weight(.semibold))
                        .accessibilityIdentifier("packet-title")
                    Text(packet.summary)
                        .font(.body)
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
                                            subtitle: resource.url ?? resource.kind,
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

                HStack {
                    Spacer()
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
                    .lineLimit(1)
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
        if restoreRequest.status == "done" {
            if restoreRequest.result?.ok == false {
                return "Context restore failed"
            }
            return "Context restore done"
        }

        return "Context restore queued: \(restoreRequest.status)"
    }

    private func restoreRequestBackground(_ restoreRequest: ContextRestoreRequest) -> Color {
        if restoreRequest.status == "done", restoreRequest.result?.ok == false {
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
