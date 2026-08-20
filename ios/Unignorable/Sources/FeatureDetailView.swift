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

                if feature.nowcast != nil {
                    Section("Current condition model") {
                        LabeledContent("Modeled state", value: feature.forecastTitle)
                        if let score = feature.forecastScore {
                            LabeledContent("Uncalibrated model score", value: "\(Int((score * 100).rounded())) / 100")
                        }
                        if let range = feature.forecastScoreRange {
                            LabeledContent(
                                "Heuristic score range",
                                value: "\(Int((range.lowerBound * 100).rounded()))–\(Int((range.upperBound * 100).rounded())) / 100"
                            )
                        }
                        LabeledContent("Evidence strength", value: feature.forecastEvidenceStrength)
                        if feature.isExperimentalForecast {
                            LabeledContent("Model status", value: "Experimental")
                        }
                        if let value = formatDate(feature.nowcast?.asOf) {
                            LabeledContent("Forecast updated", value: value)
                        }
                        if let basis = feature.nowcast?.basis {
                            Text(basis).foregroundStyle(.secondary)
                        }
                        Text("The score ranks heuristic model output. It is not an empirical probability, and the score range is not a confidence interval.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let window = feature.nowcast?.localTimeWindow, let timing = feature.reportTimingLabel {
                    Section("Report timing") {
                        Text(timing)
                        Text("This is a separate historical reporting pattern. It is not part of the current-condition score and does not say when people will be present.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let strength = window.strength {
                            LabeledContent("Pattern strength", value: strength.capitalized)
                        }
                        if let sample = window.sampleSize {
                            LabeledContent("Eligible report days", value: "\(sample)")
                        }
                        if let basis = window.basis {
                            Text(basis).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }

                if let condition = feature.condition {
                    Section("Routing model") {
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
                    if let meters = feature.forecastLocationRadiusM {
                        Text("This is an approximate area with about a \(Int(meters.rounded())) m radius around a reported coordinate—not an exact point or a live GPS location.")
                    } else {
                        Text("This is an approximate reported area, not an exact point or a live GPS location.")
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
                        Text("Only answer about the mapped condition from the location. Do not photograph, describe, or characterize people. Your proximity is checked; no trip or raw location history is stored.")
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
    private var title: String {
        feature.subjectType == "encampment"
            ? feature.forecastTitle
            : feature.manufacturer ?? feature.descriptor ?? layer.title
    }
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
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return nil }
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
            observationStatus = result.duplicate
                ? "Already submitted today. It is saved for review and does not change this forecast."
                : "Saved for review. This community check does not change the forecast."
        } catch {
            observationStatus = error.localizedDescription
        }
    }
}
