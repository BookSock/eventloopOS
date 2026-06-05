import EventLoopQueueCore
import SwiftUI

struct PacketDetail: View {
    let packet: ReviewPacket?
    let queueCount: Int
    let placeholderSummary: QueueWindowDetailSummary
    let taskSessions: [TaskSession]
    let selectedTaskSessions: [TaskSession]
    let taskBindingState: TaskBindingState
    let queueLineageState: QueueLineageState
    let canExecuteRecommendedAction: Bool
    let recommendedActionBlockReason: String?
    let paperActionInFlight: Bool
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
                        if !canExecuteRecommendedAction && selectedTaskSessions.isEmpty {
                            Menu {
                                if taskSessions.isEmpty {
                                    Button("Load Sessions") { loadTaskSessions() }
                                } else {
                                    ForEach(taskSessions) { session in
                                        Button(taskSessionLabel(session)) {
                                            bindTaskSession(session.id)
                                        }
                                    }
                                }
                            } label: {
                                Label("Bind Session", systemImage: "link")
                            }
                            .controlSize(.large)
                            .help("Bind a Codex session before sending. Send to Agent stays disabled until a session is bound.")
                            .accessibilityIdentifier("queue-bind-session-shortcut")
                        }
                        Button {
                            executeRecommendedAction()
                        } label: {
                            Label("Send to Agent", systemImage: "arrowshape.turn.up.right.circle")
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(!canExecuteRecommendedAction || paperActionInFlight)
                        .help(actionConsequence(for: packet, selectedTaskSessions: selectedTaskSessions) ?? "Send recommended follow-up to bound agent.")
                        .accessibilityIdentifier("queue-execute-recommended-action-button")
                    }
                    Button {
                        deferForOneHour()
                    } label: {
                        Label("Defer 1h", systemImage: "clock")
                    }
                    .controlSize(.large)
                    .disabled(paperActionInFlight)
                    .help("Hide this paper for one hour, then it returns to the queue.")
                    .accessibilityIdentifier("queue-defer-one-hour-button")

                    Button(role: .destructive) {
                        ignorePacket()
                    } label: {
                        Label("Ignore", systemImage: "trash")
                    }
                    .controlSize(.large)
                    .disabled(paperActionInFlight)
                    .help("Drop this paper from the queue. It will not return.")
                    .accessibilityIdentifier("queue-ignore-button")

                    Button {
                        moveToNext()
                    } label: {
                        Label("Skip / Next", systemImage: "arrow.right.circle")
                    }
                    .controlSize(.large)
                    .disabled(paperActionInFlight)
                    .help("Leave this paper in the queue and pull the next paper.")
                    .accessibilityIdentifier("queue-skip-next-button")

                    Button {
                        doneAndNext()
                    } label: {
                        Label("Done / Next", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(paperActionInFlight)
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
            if let recoveryHint = message.recoveryHint {
                Text(recoveryHint)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 3)
        .accessibilityIdentifier("packet-lineage-task-message-row-\(message.id)")
    }
}

protocol QueuePlaceholderSummary {
    var title: String { get }
    var subtitle: String { get }
    var systemImage: String { get }
    var showsProgress: Bool { get }
    var showsRetry: Bool { get }
}

extension QueueWindowSidebarSummary: QueuePlaceholderSummary {}
extension QueueWindowDetailSummary: QueuePlaceholderSummary {}

struct QueuePlaceholder<Summary: QueuePlaceholderSummary>: View {
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
        return "Send to Agent is blocked until a task session is bound. Use Bind Session in the Agent panel above to pick a Codex thread, or click Done / Next to save this workspace and move on without an agent follow-up."
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
