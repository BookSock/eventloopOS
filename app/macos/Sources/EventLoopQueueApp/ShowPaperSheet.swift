import EventLoopQueueCore
import SwiftUI

struct ShowPaperSheet: View {
    let paper: ContextRestorePaper
    let markDone: () -> Void
    let deferAction: () -> Void

    @Environment(\.dismiss) private var dismiss

    private var renderedBody: AttributedString {
        guard let body = paper.bodyMarkdown, !body.isEmpty else {
            return AttributedString("")
        }
        if let attributed = try? AttributedString(
            markdown: body,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return attributed
        }
        return AttributedString(body)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Paper")
                        .font(.title2.weight(.semibold))
                    if let title = paper.title, !title.isEmpty {
                        Text(title)
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("show-paper-title")
                    }
                    if let kind = paper.sourceKind, !kind.isEmpty {
                        Text(kind)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .accessibilityIdentifier("show-paper-source-kind")
                    }
                }
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("show-paper-close-button")
            }

            Divider()

            ScrollView {
                Text(renderedBody)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("show-paper-body")
            }
            .frame(minHeight: 200)

            HStack {
                Spacer()
                Button("Defer") {
                    deferAction()
                    dismiss()
                }
                .accessibilityIdentifier("show-paper-defer-button")
                Button("Mark Done") {
                    markDone()
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("show-paper-done-button")
            }
        }
        .padding(20)
        .frame(minWidth: 520, minHeight: 360)
        .accessibilityIdentifier("show-paper-sheet")
    }
}

public enum ShowPaperPresentation {
    public static let kind: String = "show_paper"

    public static func shouldPresent(for state: ContextRestoreState) -> Bool {
        if case let .planned(_, plan) = state, plan.kind == kind, plan.paper != nil {
            return true
        }
        return false
    }

    public static func paper(from state: ContextRestoreState) -> ContextRestorePaper? {
        if case let .planned(_, plan) = state, plan.kind == kind {
            return plan.paper
        }
        return nil
    }
}
