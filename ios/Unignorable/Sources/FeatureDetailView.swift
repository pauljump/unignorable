import SwiftUI
import CoreLocation

struct FeatureDetailView: View {
    let feature: MapFeature
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigation: AppNavigation
    @StateObject private var location = LocationManager()
    @State private var pendingObservation: String?
    @State private var observationStatus: String?
    @State private var conditionLoop: ConditionLoop?

    var body: some View {
        NavigationStack {
            List {
                Section("Share this dot") {
                    ShareLink(
                        item: webReportURL,
                        subject: Text(shareSubject),
                        message: Text(shareMessage)
                    ) {
                        Label("Share this dot", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.brand)
                    .foregroundStyle(AppTheme.background)
                    .controlSize(.large)
                    .accessibilityIdentifier("share-dot-button")
                    Text("Send the map point to X, Messages, or any other app. The link keeps the evidence and uncertainty attached.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if feature.recordArchived == true {
                    Section("Retained history") {
                        Text("This record is from an earlier refresh. Current status is unknown; leaving the forecast map does not establish resolution.")
                    }
                }
                if let lastSeen = feature.lastSeen { LabeledContent("Last source report", value: String(lastSeen.prefix(10))) }

                if feature.subjectType == "encampment" {
                    Section("One condition · one loop") {
                        if let conditionLoop {
                            HStack(spacing: 5) {
                                ForEach(conditionLoop.stages) { stage in
                                    VStack(spacing: 4) {
                                        Capsule()
                                            .fill(loopColor(stage.state))
                                            .frame(height: 4)
                                        Text(stage.label)
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(stage.state == "next" ? .secondary : .primary)
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                            }
                            Text(loopSummary(conditionLoop))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button {
                                if conditionLoop.nextAction.mode == "record" {
                                    dismiss()
                                    navigation.openReport(lat: feature.lat, lng: feature.lng)
                                } else {
                                    observationStatus = "Choose Still here, Gone, or Can't tell under Check this location."
                                }
                            } label: {
                                Label(conditionLoop.nextAction.label, systemImage: conditionLoop.nextAction.mode == "record" ? "megaphone.fill" : "location.viewfinder")
                            }
                            if let record = conditionLoop.record {
                                Text("\(record.reports) reports · \(record.cityClosures) city closures · \(record.returnsAfterClosure) returns after closure")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            ProgressView("Connecting forecast, checks, action, and outcome…")
                        }
                    }
                }

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
        .task(id: feature.id) { await refreshConditionLoop() }
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
        if feature.subjectType == "encampment" {
            var record = URLComponents(string: "https://curbnote.polyfeeds.dev/f")!
            record.queryItems = [.init(name: "id", value: feature.id)]
            return record.url!
        }
        var parts = URLComponents(string: "https://curbnote.polyfeeds.dev/")!
        parts.queryItems = [
            .init(name: "mode", value: "report"),
            .init(name: "lat", value: String(feature.lat)),
            .init(name: "lng", value: String(feature.lng)),
            .init(name: "z", value: "17"),
        ]
        return parts.url!
    }

    private var shareSubject: String {
        "Curbnote · \(title)"
    }

    private var shareMessage: String {
        let location = feature.address?.trimmingCharacters(in: .whitespacesAndNewlines)
        let place = location.flatMap { $0.isEmpty ? nil : $0 } ?? "an approximate NYC block"
        return "👀 Worth a closer look near \(place). Curbnote’s map evidence is approximate—not live proof."
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

    private func loopColor(_ state: String) -> Color {
        switch state {
        case "complete": .teal
        case "current": .pink
        default: Color.secondary.opacity(0.3)
        }
    }

    private func loopSummary(_ loop: ConditionLoop) -> String {
        switch loop.stage {
        case "detected": "Public evidence found a recurring condition. A nearby check is the highest-value next step."
        case "checked": loop.checks.pending > 0
            ? "\(loop.checks.pending) nearby check\(loop.checks.pending == 1 ? " is" : "s are") awaiting review. The permanent record is ready for action."
            : "A nearby check now connects this forecast to the permanent accountability record."
        case "action": "The accountability record is active. Keep escalating until someone confirms the outcome."
        default: "An outcome was reported. A fresh nearby check determines whether it held."
        }
    }

    @MainActor
    private func refreshConditionLoop() async {
        conditionLoop = try? await APIClient().conditionLoop(for: feature)
    }

    @MainActor
    private func submit(_ state: String, coordinate: CLLocationCoordinate2D) async {
        do {
            let result = try await APIClient().submitConditionObservation(feature: feature, state: state, coordinate: coordinate)
            observationStatus = result.duplicate
                ? "Already submitted today. It is saved for review and does not change this forecast."
                : "Saved for review. This community check does not change the forecast."
            await refreshConditionLoop()
        } catch {
            observationStatus = error.localizedDescription
        }
    }
}
