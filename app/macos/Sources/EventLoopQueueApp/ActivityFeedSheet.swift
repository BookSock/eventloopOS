import EventLoopQueueCore
import SwiftUI

struct ActivityFeedSheet: View {
    let events: [ActivityEvent]
    let refresh: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Activity")
                        .font(.title2.weight(.semibold))
                    Text("Recent system actions across the orchestrator.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("activity-refresh-button")
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("activity-close-button")
            }

            if events.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "waveform")
                        .font(.title)
                        .foregroundStyle(.secondary)
                    Text("No recent activity yet.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 120)
                .accessibilityIdentifier("activity-empty")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(events) { event in
                            ActivityFeedRow(event: event)
                                .accessibilityIdentifier("activity-row-\(event.id)")
                        }
                    }
                }
            }
        }
        .padding(20)
        .frame(width: 600, height: 540)
        .accessibilityIdentifier("activity-sheet")
    }
}

private struct ActivityFeedRow: View {
    let event: ActivityEvent

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: iconName(for: event.type))
                .frame(width: 16)
                .foregroundStyle(iconColor(for: event.type))
            VStack(alignment: .leading, spacing: 2) {
                Text(event.summary)
                    .font(.callout)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(event.type)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                    Text("•")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(event.occurredAt, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let taskId = event.taskId {
                        Text("•")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        Text(taskId)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func iconName(for type: String) -> String {
        switch type {
        case "master_fan_out": return "antenna.radiowaves.left.and.right"
        case "voice_rerank", "voice_fan_out_detected": return "mic.fill"
        case "terminal_keystroke_attempted": return "terminal.fill"
        case "queue_item_done": return "checkmark.circle.fill"
        case "queue_item_priority_bumped": return "arrow.up.circle.fill"
        case "task_followup_attempted", "task_followup_sent": return "arrowshape.turn.up.right.circle"
        case "reading_queue_promoted", "reading_queue_auto_promoted": return "tray.and.arrow.down.fill"
        case "onboarding_task_approved": return "rectangle.stack.badge.person.crop"
        default: return "bolt.fill"
        }
    }

    private func iconColor(for type: String) -> Color {
        switch type {
        case "master_fan_out": return .indigo
        case "voice_rerank", "voice_fan_out_detected": return .purple
        case "terminal_keystroke_attempted": return .orange
        case "queue_item_done": return .green
        case "queue_item_priority_bumped": return .orange
        case "task_followup_attempted", "task_followup_sent": return .blue
        default: return .secondary
        }
    }
}
