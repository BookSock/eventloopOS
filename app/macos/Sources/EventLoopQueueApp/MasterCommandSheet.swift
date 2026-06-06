import EventLoopQueueCore
import SwiftUI

private enum MasterCommandSheetMode: String, CaseIterable, Identifiable {
    case route
    case startTask
    case rerank
    case broadcast

    var id: String { rawValue }

    var label: String {
        switch self {
        case .route:
            "Route to Master"
        case .startTask:
            "Start Task"
        case .rerank:
            "Rerank"
        case .broadcast:
            "Broadcast"
        }
    }
}

struct MasterCommandSheet: View {
    let defaultTaskHint: String
    let state: MasterCommandState
    let packets: [ReviewPacket]
    let defaultRerankPacketId: String?
    let voiceState: VoiceCaptureState
    let route: (String, String?) -> Void
    let startTask: (String, String?, String?, String?) -> Void
    let rerank: (String, Int) -> Void
    let startVoiceCapture: () async -> String?
    let previewFanOut: (String, String) async -> MasterFanOutResult?
    let executeFanOut: (String, String) async -> MasterFanOutResult?
    let voiceCaptureStartedAt: Date?
    let voiceCaptureMaxSeconds: Double

    @Environment(\.dismiss) private var dismiss
    @State private var mode: MasterCommandSheetMode = .route
    @State private var text: String = ""
    @State private var taskHint: String
    @State private var cwd: String = ""
    @State private var model: String = ""
    @State private var rerankPacketId: String
    @State private var rerankDelta: Int = 200
    @State private var broadcastSelector: String = ""
    @State private var broadcastPreview: MasterFanOutResult?

    init(
        defaultTaskHint: String,
        state: MasterCommandState,
        packets: [ReviewPacket] = [],
        defaultRerankPacketId: String? = nil,
        voiceState: VoiceCaptureState = .unavailable,
        voiceCaptureStartedAt: Date? = nil,
        voiceCaptureMaxSeconds: Double = 6.0,
        route: @escaping (String, String?) -> Void,
        startTask: @escaping (String, String?, String?, String?) -> Void,
        rerank: @escaping (String, Int) -> Void = { _, _ in },
        startVoiceCapture: @escaping () async -> String? = { nil },
        previewFanOut: @escaping (String, String) async -> MasterFanOutResult? = { _, _ in nil },
        executeFanOut: @escaping (String, String) async -> MasterFanOutResult? = { _, _ in nil }
    ) {
        self.defaultTaskHint = defaultTaskHint
        self.state = state
        self.packets = packets
        self.defaultRerankPacketId = defaultRerankPacketId
        self.voiceState = voiceState
        self.voiceCaptureStartedAt = voiceCaptureStartedAt
        self.voiceCaptureMaxSeconds = voiceCaptureMaxSeconds
        self.route = route
        self.startTask = startTask
        self.rerank = rerank
        self.startVoiceCapture = startVoiceCapture
        self.previewFanOut = previewFanOut
        self.executeFanOut = executeFanOut
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
                    HStack {
                        Text("Message")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Spacer()
                        if voiceState != .unavailable {
                            Button {
                                Task {
                                    if let transcript = await startVoiceCapture() {
                                        text = text.isEmpty ? transcript : "\(text) \(transcript)"
                                    }
                                }
                            } label: {
                                Label(voiceButtonLabel, systemImage: voiceButtonSystemImage)
                                    .labelStyle(.titleAndIcon)
                            }
                            .controlSize(.small)
                            .disabled(voiceState == .listening)
                            .help(voiceButtonHelp)
                            .accessibilityIdentifier("master-command-voice-button")
                        }
                    }
                    TextEditor(text: $text)
                        .font(.body)
                        .frame(minHeight: 110)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(.secondary.opacity(0.25))
                        )
                        .accessibilityIdentifier("master-command-text-editor")
                    voiceStatusView
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

            if mode == .broadcast {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Selector (substring or task_id pattern)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    TextField("e.g. blog or recruiting", text: $broadcastSelector)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("master-command-broadcast-selector")
                }
                if let preview = broadcastPreview {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Matched \(preview.matchedCount) task(s)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(preview.preview.prefix(6), id: \.taskId) { match in
                            HStack(spacing: 6) {
                                Image(systemName: match.taskSessionId != nil ? "link.circle.fill" : "link.circle")
                                    .foregroundStyle(match.taskSessionId != nil ? .green : .orange)
                                Text(match.taskId).font(.caption.monospaced())
                                if let title = match.matchedPacketTitle {
                                    Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .accessibilityIdentifier("master-command-broadcast-preview-row-\(match.taskId)")
                        }
                        if preview.matchedCount > 6 {
                            Text("+\(preview.matchedCount - 6) more")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(8)
                    .background(.secondary.opacity(0.08))
                    .cornerRadius(6)
                }
                Button("Preview matches") {
                    Task {
                        let trimmedSelector = broadcastSelector.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmedSelector.isEmpty else { return }
                        broadcastPreview = await previewFanOut(text, trimmedSelector)
                    }
                }
                .disabled(state == .sending || broadcastSelector.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("master-command-broadcast-preview-button")
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
                Button("Close") {
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
                    case .broadcast:
                        let trimmedSelector = broadcastSelector.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                              !trimmedSelector.isEmpty else { return }
                        Task {
                            broadcastPreview = await executeFanOut(text, trimmedSelector)
                        }
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
        case .broadcast: return "Broadcast"
        }
    }

    private var submitDisabled: Bool {
        if state == .sending { return true }
        switch mode {
        case .route, .startTask:
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .rerank:
            return rerankPacketId.isEmpty || rerankDelta == 0
        case .broadcast:
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || broadcastSelector.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private var voiceButtonLabel: String {
        switch voiceState {
        case .listening: return "Listening…"
        case .captured: return "Re-record"
        case .failed: return "Retry voice"
        case .idle, .unavailable: return "Voice"
        }
    }

    private var voiceButtonSystemImage: String {
        switch voiceState {
        case .listening: return "waveform.circle"
        case .captured: return "mic.fill"
        case .failed: return "exclamationmark.triangle"
        case .idle, .unavailable: return "mic"
        }
    }

    private var voiceButtonHelp: String {
        switch voiceState {
        case .unavailable:
            return "Voice transcription is not configured."
        case .idle:
            return "Record a short voice note and append it to the message."
        case .listening:
            return "Listening for your voice command…"
        case .captured:
            return "Voice transcript captured. Press to record again."
        case .failed:
            return "Voice capture failed. Press to try again."
        }
    }

    @ViewBuilder
    private var voiceStatusView: some View {
        switch voiceState {
        case .listening:
            VoiceListeningIndicator(
                startedAt: voiceCaptureStartedAt,
                maxSeconds: voiceCaptureMaxSeconds
            )
            .accessibilityIdentifier("master-command-voice-status-listening")
        case let .failed(message):
            Label(userFacingQueueStatusDetail(message), systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
                .accessibilityIdentifier("master-command-voice-status-failed")
        case .captured, .idle, .unavailable:
            EmptyView()
        }
    }
}

private struct VoiceListeningIndicator: View {
    let startedAt: Date?
    let maxSeconds: Double

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1)) { context in
            let elapsed = max(0, startedAt.map { context.date.timeIntervalSince($0) } ?? 0)
            let remaining = max(0, maxSeconds - elapsed)
            let progress = maxSeconds > 0 ? min(1.0, elapsed / maxSeconds) : 0
            HStack(spacing: 8) {
                WaveformDots(elapsed: elapsed)
                    .frame(width: 56)
                    .accessibilityIdentifier("master-command-voice-waveform")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Listening…")
                        .font(.caption.weight(.semibold))
                    Text(String(format: "%.1fs left", remaining))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .frame(maxWidth: 120)
            }
        }
    }
}

private struct WaveformDots: View {
    let elapsed: Double

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<5, id: \.self) { index in
                let phase = elapsed * 4 + Double(index) * 0.7
                let height: CGFloat = 6 + CGFloat(abs(sin(phase))) * 14
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.purple.opacity(0.7))
                    .frame(width: 5, height: height)
            }
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
            Label(userFacingQueueStatusDetail(message), systemImage: "exclamationmark.triangle.fill")
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
