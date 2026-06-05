import EventLoopQueueCore
import SwiftUI

struct FollowsRulesSheet: View {
    let exclusions: [FollowsWindowExclusion]
    let suggestions: [FollowsWindowSuggestion]
    let state: FollowsRulesState
    let refresh: () -> Void
    let add: (String?, String?) -> Void
    let delete: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var appBundle = ""
    @State private var titleSubstring = ""

    private var canAdd: Bool {
        !appBundle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !titleSubstring.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Follows Rules")
                        .font(.title2.weight(.semibold))
                    Text("Stop shared or noisy windows from following every paper.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("follows-rules-refresh-button")
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("follows-rules-close-button")
            }

            HStack(alignment: .bottom, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("App bundle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("com.tinyspeck.slackmacgap", text: $appBundle)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("follows-rules-app-bundle-field")
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Title contains")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("Screen Sharing", text: $titleSubstring)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("follows-rules-title-substring-field")
                }
                Button {
                    add(appBundle, titleSubstring)
                    appBundle = ""
                    titleSubstring = ""
                } label: {
                    Label("Exclude", systemImage: "plus.circle.fill")
                }
                .disabled(!canAdd || state == .saving)
                .accessibilityIdentifier("follows-rules-add-button")
            }

            switch state {
            case .loading:
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading follows rules")
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("follows-rules-loading")
            case .saving:
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Saving follows rule")
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("follows-rules-saving")
            case let .failed(message):
                Label(userFacingQueueStatusDetail(message), systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("follows-rules-failed")
            case .idle, .loaded:
                EmptyView()
            }

            if !suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Current Desktop")
                        .font(.headline)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(suggestions.prefix(6)) { suggestion in
                            FollowsSuggestionRow(suggestion: suggestion, add: add)
                                .accessibilityIdentifier("follows-rules-suggestion-\(suggestion.id)")
                        }
                    }
                }
                .accessibilityIdentifier("follows-rules-suggestions")
            }

            if exclusions.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "rectangle.3.group")
                        .font(.title)
                        .foregroundStyle(.secondary)
                    Text("No follows exclusions")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 140)
                .accessibilityIdentifier("follows-rules-empty")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(exclusions) { exclusion in
                            FollowsRuleRow(exclusion: exclusion) {
                                delete(exclusion.exclusionId)
                            }
                            .accessibilityIdentifier("follows-rules-row-\(exclusion.exclusionId)")
                        }
                    }
                }
                .accessibilityIdentifier("follows-rules-list")
            }
        }
        .padding(20)
        .frame(width: 640, height: 520)
        .accessibilityIdentifier("follows-rules-sheet")
    }
}

private struct FollowsSuggestionRow: View {
    let suggestion: FollowsWindowSuggestion
    let add: (String?, String?) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "window.badge.exclamationmark")
                .foregroundStyle(.blue)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(suggestion.appName)
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                    if suggestion.isCurrentFollowsCandidate {
                        Text("Currently follows")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.blue)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.blue.opacity(0.10), in: Capsule())
                    }
                }
                HStack(spacing: 6) {
                    if let appBundle = suggestion.appBundle {
                        Text(appBundle)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    if let title = suggestion.title {
                        Text(title)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            Spacer()
            if let appBundle = suggestion.appBundle {
                Button {
                    add(appBundle, nil)
                } label: {
                    Label("Exclude App", systemImage: "app.badge")
                }
                .accessibilityIdentifier("follows-rules-suggestion-app-\(suggestion.id)")
            }
            if let title = suggestion.title {
                Button {
                    add(nil, title)
                } label: {
                    Label("Exclude Title", systemImage: "text.badge.xmark")
                }
                .accessibilityIdentifier("follows-rules-suggestion-title-\(suggestion.id)")
            }
        }
        .padding(.vertical, 4)
    }
}

private struct FollowsRuleRow: View {
    let exclusion: FollowsWindowExclusion
    let delete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "rectangle.slash")
                .foregroundStyle(.orange)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(label)
                    .font(.callout.weight(.medium))
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if let appBundle = exclusion.appBundle {
                        Text(appBundle)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    if let titleSubstring = exclusion.titleSubstring {
                        Text(titleSubstring)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
            Button(role: .destructive) {
                delete()
            } label: {
                Label("Remove", systemImage: "trash")
            }
            .accessibilityIdentifier("follows-rules-delete-\(exclusion.exclusionId)")
        }
        .padding(.vertical, 6)
    }

    private var label: String {
        switch (exclusion.appBundle, exclusion.titleSubstring) {
        case let (.some(appBundle), .some(titleSubstring)):
            "\(appBundle) with title containing \(titleSubstring)"
        case let (.some(appBundle), .none):
            appBundle
        case let (.none, .some(titleSubstring)):
            "Title containing \(titleSubstring)"
        case (.none, .none):
            exclusion.exclusionId
        }
    }
}
