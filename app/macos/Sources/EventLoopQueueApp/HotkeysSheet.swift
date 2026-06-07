import SwiftUI

struct HotkeysSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Hotkeys")
                        .font(.title2.weight(.semibold))
                    Text("Queue and window commands.")
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
                .accessibilityIdentifier("hotkeys-close-button")
            }

            HStack(alignment: .top, spacing: 16) {
                HotkeySection(title: "Queue", rows: [
                    HotkeyRowModel(label: "Pull next paper", chord: "Ctrl-Option-J", systemImage: "doc.text.magnifyingglass"),
                    HotkeyRowModel(label: "Restore paper", chord: "Ctrl-Option-R", systemImage: "rectangle.3.group"),
                    HotkeyRowModel(label: "Done / next", chord: "Ctrl-Option-E", systemImage: "checkmark.circle"),
                    HotkeyRowModel(label: "Send action", chord: "Ctrl-Option-Return", systemImage: "arrowshape.turn.up.right.circle"),
                    HotkeyRowModel(label: "Defer", chord: "Ctrl-Option-H", systemImage: "clock"),
                    HotkeyRowModel(label: "Master Command", chord: "Ctrl-Option-K", systemImage: "command"),
                    HotkeyRowModel(label: "Manual Mode / Return", chord: "Ctrl-Option-M", systemImage: "pause.circle"),
                    HotkeyRowModel(label: "Keep Current Layout", chord: "Ctrl-Option-Shift-M", systemImage: "arrow.down.right.and.arrow.up.left"),
                ])
                HotkeySection(title: "Windows", rows: [
                    HotkeyRowModel(label: "Left half", chord: "Ctrl-Option-Left", systemImage: "arrow.left.to.line"),
                    HotkeyRowModel(label: "Right half", chord: "Ctrl-Option-Right", systemImage: "arrow.right.to.line"),
                    HotkeyRowModel(label: "Top half", chord: "Ctrl-Option-Up", systemImage: "arrow.up.to.line"),
                    HotkeyRowModel(label: "Bottom half", chord: "Ctrl-Option-Down", systemImage: "arrow.down.to.line"),
                    HotkeyRowModel(label: "Center", chord: "Ctrl-Option-C", systemImage: "scope"),
                    HotkeyRowModel(label: "Maximize", chord: "Ctrl-Option-Shift-Return", systemImage: "arrow.up.left.and.arrow.down.right"),
                ])
            }
        }
        .padding(20)
        .frame(width: 760, height: 430)
        .accessibilityIdentifier("hotkeys-sheet")
    }
}

private struct HotkeySection: View {
    let title: String
    let rows: [HotkeyRowModel]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            VStack(spacing: 0) {
                ForEach(rows) { row in
                    HotkeyRow(row: row)
                    if row.id != rows.last?.id {
                        Divider()
                    }
                }
            }
            .background(.secondary.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .accessibilityIdentifier("hotkeys-section-\(title.lowercased())")
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct HotkeyRow: View {
    let row: HotkeyRowModel

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: row.systemImage)
                .frame(width: 18)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(row.label)
                .font(.callout)
                .lineLimit(1)
            Spacer()
            Text(row.chord)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("hotkeys-row-\(row.id)")
    }
}

private struct HotkeyRowModel: Identifiable, Equatable {
    let label: String
    let chord: String
    let systemImage: String

    var id: String {
        "\(label)-\(chord)"
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
            .replacingOccurrences(of: "/", with: "-")
    }
}
