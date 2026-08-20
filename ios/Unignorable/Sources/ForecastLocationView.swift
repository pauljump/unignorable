import SwiftUI

struct ForecastLocationView: View {
    @EnvironmentObject private var model: RouteModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var location = LocationManager()
    @State private var query = ""
    @State private var suggestions: [Place] = []
    @State private var status: String?
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Address or place", text: $query)
                        .textContentType(.fullStreetAddress)
                        .textInputAutocapitalization(.words)
                        .focused($searchFocused)
                        .accessibilityIdentifier("forecast-location-search")

                    Button {
                        status = "Finding your location…"
                        location.requestLocation()
                    } label: {
                        Label("Use my location", systemImage: "location.fill")
                    }

                    if let status {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Forecast for")
                } footer: {
                    Text("The forecast follows the map center. Choosing a place does not set or save a walking-route address.")
                }

                if !suggestions.isEmpty {
                    Section("Places") {
                        ForEach(suggestions) { place in
                            Button {
                                model.focusForecast(at: place.coordinate)
                                dismiss()
                            } label: {
                                Label(place.name, systemImage: "mappin.and.ellipse")
                                    .foregroundStyle(.primary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Choose location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task(id: query) {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count >= 3 else {
                suggestions = []
                return
            }
            do {
                try await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                suggestions = await model.forecastPlaces(matching: trimmed)
                status = suggestions.isEmpty ? "No NYC places found." : nil
            } catch { }
        }
        .onReceive(location.$coordinate) { coordinate in
            guard let coordinate else { return }
            model.focusForecast(at: coordinate)
            dismiss()
        }
        .onReceive(location.$errorMessage) { message in
            if let message { status = message }
        }
        .onAppear { searchFocused = true }
    }
}
