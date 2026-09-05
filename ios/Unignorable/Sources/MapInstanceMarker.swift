import SwiftUI

/// Wait for the native double-tap recognizer before treating a touch as selection.
/// Button's immediate action would present a sheet before the second tap arrives.
struct MapInstanceMarker<Content: View>: View {
    let onSelect: () -> Void
    let onZoom: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .gesture(TapGesture(count: 2).exclusively(before: TapGesture(count: 1)).onEnded { gesture in
                switch gesture {
                case .first: onZoom()
                case .second: onSelect()
                }
            })
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { onSelect() }
    }
}
