import SwiftUI

struct ReportFocus: Identifiable, Equatable {
    let id = UUID()
    let lat: Double
    let lng: Double
}

@MainActor
final class AppNavigation: ObservableObject {
    @Published var reportFocus: ReportFocus?

    func openReport(lat: Double, lng: Double) {
        reportFocus = ReportFocus(lat: lat, lng: lng)
    }
}

struct AppRootView: View {
    var body: some View {
        ContentView()
            .tint(AppTheme.coral)
            .preferredColorScheme(.dark)
    }
}
