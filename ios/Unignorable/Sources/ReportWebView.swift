import MapKit
import SwiftUI

struct ReportMapView: View {
    @EnvironmentObject private var navigation: AppNavigation
    @StateObject private var model = ReportModel()
    @StateObject private var location = LocationManager()
    @State private var selectedIssue: ReportIssue?
    @State private var selectedMarkerID: String?
    @FocusState private var searchFocused: Bool

    var body: some View {
        ZStack {
            Map(position: $model.position, interactionModes: .all, selection: $selectedMarkerID) {
                UserAnnotation()
                ForEach(model.markers) { marker in
                    Annotation("", coordinate: marker.coordinate) {
                        IssueDot(color: color(for: marker.type), severity: marker.severity)
                            .accessibilityLabel(marker.issue == nil ? "Issue cluster; zoom in" : marker.type)
                    }
                    .tag(marker.id)
                }
            }
            .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll))
            .mapControls { MapCompass(); MapScaleView(); MapUserLocationButton() }
            .accessibilityIdentifier("report-map")
            .accessibilityValue(String(model.visibleRegion.span.latitudeDelta))
            .onMapCameraChange(frequency: .onEnd) { model.visibleRegion = $0.region }
            .onChange(of: selectedMarkerID) { _, markerID in
                guard let markerID, let marker = model.markers.first(where: { $0.id == markerID }) else { return }
                selectedMarkerID = nil
                if let issue = marker.issue { selectedIssue = issue } else { model.zoom(to: marker) }
            }
            .ignoresSafeArea()

            VStack(spacing: 0) {
                reportControls
                Spacer()
            }
        }
        .task { await model.load(); applyReportFocus() }
        .onChange(of: navigation.reportFocus) { _, _ in applyReportFocus() }
        .onReceive(location.$coordinate) { coordinate in
            guard let coordinate else { return }
            model.showCurrentLocation(coordinate)
        }
        .onReceive(location.$errorMessage) { message in if let message { model.status = message } }
        .sheet(item: $selectedIssue) { ReportIssueDetailView(issue: $0) }
    }

    private func applyReportFocus() {
        guard let focus = navigation.reportFocus else { return }
        selectedIssue = model.focus(lat: focus.lat, lng: focus.lng)
    }

    private var reportControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(AppTheme.muted)
                TextField("Find your block", text: $model.searchText)
                    .textContentType(.fullStreetAddress)
                    .focused($searchFocused)
                    .onChange(of: model.searchText) { _, value in if searchFocused { model.search(value) } }
                Button { location.requestLocation() } label: {
                    Image(systemName: "location.fill").frame(width: 30, height: 30)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Show my location")
            }

            if searchFocused, !model.suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(model.suggestions.prefix(4)) { place in
                        Button {
                            searchFocused = false
                            model.select(place)
                        } label: {
                            HStack { Text(place.name).font(.caption).lineLimit(2); Spacer() }.padding(.vertical, 7)
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(ReportModel.types, id: \.self) { type in
                        Button { model.toggle(type) } label: {
                            HStack(spacing: 5) {
                                Circle().fill(color(for: type)).frame(width: 7, height: 7)
                                Text(shortTitle(type)).font(.caption.bold())
                            }
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .foregroundStyle(model.enabledTypes.contains(type) ? AppTheme.ink : AppTheme.muted)
                            .background(model.enabledTypes.contains(type) ? AppTheme.raised : AppTheme.background, in: Capsule())
                            .overlay(Capsule().stroke(AppTheme.line))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            HStack {
                SeverityKey()
                Spacer()
                if model.isLoading { ProgressView().controlSize(.small) }
                if let status = model.status { Text(status).font(.caption2).foregroundStyle(AppTheme.muted).lineLimit(1) }
            }
        }
        .padding(11)
        .background(AppTheme.panel.opacity(0.96), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(AppTheme.line))
        .shadow(color: .black.opacity(0.35), radius: 12, y: 5)
        .padding(.horizontal, 10)
        .padding(.top, 4)
    }

    private func color(for type: String) -> Color {
        switch type {
        case "Encampment": AppTheme.coral
        case "Drug Activity": AppTheme.purple
        case "Homeless Person Assistance": AppTheme.mint
        case "Panhandling": AppTheme.amber
        default: AppTheme.muted
        }
    }

    private func shortTitle(_ type: String) -> String {
        type == "Homeless Person Assistance" ? "Homeless assist" : type
    }
}
