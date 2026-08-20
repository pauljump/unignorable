import SwiftUI
import CoreLocation

struct FeatureDetailView: View {
    let feature: MapFeature
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigation: AppNavigation
    @StateObject private var location = LocationManager()
    @State private var pendingObservation: String?
    @State private var observationStatus: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Layer", value: layer.title)
                    if let manufacturer = feature.manufacturer, !manufacturer.isEmpty {
                        LabeledContent("Manufacturer", value: manufacturer)
                    }
                    if let count = feature.count {
                        LabeledContent("311 reports at site", value: "\(count)")
                    }
                    if let days = feature.distinctReportDays {
                        LabeledContent("Distinct report days", value: "\(days)")
                    }
                }

                if let condition = feature.condition {
                    Section("Current estimate") {
                        if let probability = condition.presenceProbability {
                            LabeledContent("Estimated present", value: probability.formatted(.percent.precision(.fractionLength(0))))
                        }
                        if let range = condition.probabilityRange, range.count == 2 {
                            LabeledContent("Uncertainty range", value: "\(range[0].formatted(.percent.precision(.fractionLength(0))))–\(range[1].formatted(.percent.precision(.fractionLength(0))))")
                        }
                        LabeledContent("Routing use", value: routingText(condition.routingLevel))
                    }
                    Section("Evidence") {
                        if let value = formatDate(condition.lastObservedAt) { LabeledContent("Agency saw it", value: value) }
                        if let value = formatDate(condition.lastCheckedAt) { LabeledContent("Last agency check", value: value) }
                        if let value = formatDate(condition.lastFieldObservedAt) { LabeledContent("Last app check", value: value) }
                        if let value = formatDate(condition.lastReportAt) { LabeledContent("Last 311 report", value: value) }
                        if let basis = condition.basis { Text(basis).foregroundStyle(.secondary) }
                    }
                }

                Section("Location accuracy") {
                    if let meters = feature.locationUncertaintyM {
                        Text("Reported coordinate is approximate (about \(Int(meters.rounded())) m), not a live GPS location.")
                    } else {
                        Text("Public report coordinates are approximate, not live GPS locations.")
                    }
                }

                if layer != .alpr {
                    Section("Report & accountability") {
                        Button {
                            dismiss()
                            navigation.openReport(lat: feature.lat, lng: feature.lng)
                        } label: {
                            Label("Open nearby public record", systemImage: "exclamationmark.bubble.fill")
                        }
                        Link(destination: webReportURL) {
                            Label("Open the web record", systemImage: "safari")
                        }
                    }
                }

                if feature.subjectType == "encampment" {
                    Section("Check this location") {
                        Text("Only answer from the location. Your proximity is checked; no trip or raw location history is stored.")
                            .font(.footnote).foregroundStyle(.secondary)
                        HStack {
                            observationButton("Still here", state: "present", color: .pink)
                            observationButton("Gone", state: "absent", color: .green)
                            observationButton("Can't tell", state: "uncertain", color: .secondary)
                        }
                        if let observationStatus { Text(observationStatus).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
        .onReceive(location.$coordinate) { coordinate in
            guard let coordinate, let state = pendingObservation else { return }
            pendingObservation = nil
            Task { await submit(state, coordinate: coordinate) }
        }
    }

    private var layer: LayerDefinition { LayerDefinition(rawValue: feature.layer ?? "") ?? .alpr }
    private var title: String { feature.condition?.label ?? feature.manufacturer ?? feature.descriptor ?? layer.title }
    private var webReportURL: URL {
        var parts = URLComponents(string: "https://unignorable.polyfeeds.dev/")!
        parts.queryItems = [
            .init(name: "mode", value: "report"),
            .init(name: "lat", value: String(feature.lat)),
            .init(name: "lng", value: String(feature.lng)),
            .init(name: "z", value: "17"),
        ]
        return parts.url!
    }

    private func routingText(_ value: String?) -> String {
        switch value {
        case "hard": "Avoided"
        case "soft": "Soft route penalty"
        default: "Not used for avoidance"
        }
    }

    private func formatDate(_ value: String?) -> String? {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return nil }
        return date.formatted(.relative(presentation: .named))
    }

    private func observationButton(_ title: String, state: String, color: Color) -> some View {
        Button(title) {
            observationStatus = "Checking your proximity…"
            if let coordinate = location.coordinate {
                Task { await submit(state, coordinate: coordinate) }
            } else {
                pendingObservation = state
                location.requestLocation()
            }
        }
        .buttonStyle(.bordered)
        .tint(color)
        .disabled(pendingObservation != nil)
    }

    @MainActor
    private func submit(_ state: String, coordinate: CLLocationCoordinate2D) async {
        do {
            let result = try await APIClient().submitConditionObservation(feature: feature, state: state, coordinate: coordinate)
            observationStatus = result.duplicate ? "Already counted today." : "Thanks — saved for the next model calibration."
        } catch {
            observationStatus = error.localizedDescription
        }
    }
}
