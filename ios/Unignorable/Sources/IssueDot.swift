import SwiftUI

enum MarkerSeverity: Int, Codable, Sendable {
    case lower, elevated, high
}

struct IssueDot: View {
    let color: Color
    let severity: MarkerSeverity
    let highlighted: Bool

    init(color: Color, severity: MarkerSeverity, highlighted: Bool = false) {
        self.color = color
        self.severity = severity
        self.highlighted = highlighted
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .overlay {
                Circle().stroke(outline, lineWidth: severity == .lower ? 0.75 : 1.5)
            }
            .frame(width: 28, height: 28)
            .overlay {
                if highlighted {
                    Circle()
                        .stroke(AppTheme.brand, lineWidth: 3)
                        .frame(width: 30, height: 30)
                }
            }
            .scaleEffect(highlighted ? 1.35 : 1)
            .shadow(color: highlighted ? AppTheme.brand.opacity(0.7) : .clear, radius: 5)
            .contentShape(Rectangle())
    }

    private var outline: Color {
        switch severity {
        case .lower: AppTheme.line
        case .elevated: AppTheme.amber
        case .high: AppTheme.ink
        }
    }
}

struct SeverityKey: View {
    var body: some View {
        HStack(spacing: 10) {
            key("lower", .lower)
            key("elevated", .elevated)
            key("highest", .high)
        }
        .font(.system(size: 9, weight: .medium))
        .foregroundStyle(AppTheme.muted)
    }

    private func key(_ label: String, _ severity: MarkerSeverity) -> some View {
        HStack(spacing: 3) {
            IssueDot(color: .blue, severity: severity).frame(width: 9, height: 9).clipped()
            Text(label)
        }
    }
}
