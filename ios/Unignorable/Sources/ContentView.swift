import MapKit
import SwiftUI

private enum ActiveSheet: Identifiable {
    case account(Bool), feedback, records, planner, controls(RouteOptionFocus), mapContent, directions, feature(MapFeature), reportIssue(ReportIssue)
    var id: String {
        switch self {
        case .account(let saving): "account-\(saving)"
        case .feedback: "feedback"
        case .records: "records"
        case .planner: "planner"
        case .controls(let focus): "controls-\(focus.rawValue)"
        case .mapContent: "map-content"
        case .directions: "directions"
        case .feature(let feature): "feature-\(feature.id)"
        case .reportIssue(let issue): "report-\(issue.id)"
        }
    }
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var model: RouteModel
    @EnvironmentObject private var navigation: AppNavigation
    @StateObject private var reportModel = ReportModel()
    @StateObject private var location = LocationManager()
    @State private var activeSheet: ActiveSheet?
    @State private var highlightedMapMarkerID: String?
    @State private var introductionDismissed = false

    var body: some View {
        ZStack {
            routeMap
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                if model.showingSavedMap, let date = model.mapSavedAt {
                    Text("Saved map · downloaded " + date.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption2).padding(6).background(AppTheme.background, in: Capsule())
                }
                Spacer()
                if let route = model.selectedRoute {
                    routeCard(route)
                } else if !introductionDismissed {
                    launchCard
                } else {
                    predictionHintCard
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { Task { await model.flushWalk() } } }
        .task { await model.load() }
        .onChange(of: navigation.reportFocus) { _, _ in
            Task { await reportModel.load(); applyReportFocus() }
        }
        .onReceive(location.$coordinate) { coordinate in
            guard let coordinate else { return }
            model.select(.init(name: "Current location", lat: coordinate.latitude, lng: coordinate.longitude), asOrigin: true)
        }
        .onReceive(location.$errorMessage) { message in if let message { model.status = message } }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .account(let saving): AccountView(saving: saving, onOpenWalk: { activeSheet = .planner })
            case .feedback: FeedbackView()
            case .records: RecordsView()
            case .planner: WalkingPlannerView(onReportNearby: inspectReportCenter, onControls: { activeSheet = .controls($0) }, onLocate: location.requestLocation)
            case .controls(let focus): ControlsView(focus: focus)
            case .mapContent: mapContentSheet
            case .directions: DirectionsView()
            case .feature(let feature): FeatureDetailView(feature: feature).presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
            case .reportIssue(let issue): ReportIssueDetailView(issue: issue)
            }
        }
    }

    private var routeMap: some View {
        MapReader { proxy in
            Map(position: $model.position, interactionModes: .all) {
                UserAnnotation()
                    .tint(.blue)

                ForEach(model.routes.filter { $0.id != model.selectedRoute?.id }) { route in
                    MapPolyline(coordinates: route.geometry.mapCoordinates)
                        .stroke(.secondary.opacity(0.55), style: .init(lineWidth: 4, lineCap: .round, lineJoin: .round))
                }
                if let route = model.selectedRoute {
                    MapPolyline(coordinates: route.geometry.mapCoordinates)
                        .stroke(AppTheme.coral, style: .init(lineWidth: 7, lineCap: .round, lineJoin: .round))
                }

                if model.selectedRoute != nil, let origin = model.origin {
                    Annotation("Start", coordinate: origin.coordinate) { endpointMarker("A", color: .green) }
                }
                if model.selectedRoute != nil, let destination = model.destination {
                    Annotation("Destination", coordinate: destination.coordinate) { endpointMarker("B", color: .red) }
                }
                if model.selectedRoute != nil, let via = model.via {
                    Annotation("Stop", coordinate: via.coordinate) { endpointMarker("C", color: AppTheme.mint) }
                }

                ForEach(model.visibleFeatures) { feature in
                    Annotation("", coordinate: feature.coordinate) {
                        MapInstanceMarker(onSelect: {
                            highlightMarker("prediction:\(feature.id)")
                            inspectFeature(feature)
                        }, onZoom: { zoomMap(at: feature.coordinate) }) {
                            predictionMarker(feature, highlighted: highlightedMapMarkerID == "prediction:\(feature.id)")
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("prediction-marker-" + feature.id)
                    }
                }

                if model.showCitiBike {
                    ForEach(model.bikes) { station in
                        Annotation(station.name, coordinate: station.coordinate) {
                            MapInstanceMarker(onSelect: { model.chooseBike(station) }, onZoom: { zoomMap(at: station.coordinate) }) {
                                Image(systemName: "bicycle").font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 22, height: 22)
                                .background(.cyan, in: Circle())
                                .overlay(Circle().stroke(.white, lineWidth: 1))
                            }
                            .accessibilityLabel("Add \(station.name) as a stop, \(station.bikes) bikes available")
                        }
                    }
                }

            }
            .highPriorityGesture(SpatialTapGesture(count: 2).onEnded { tap in
                if let coordinate = proxy.convert(tap.location, from: .local) {
                    zoomMap(at: coordinate)
                }
            })
            .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll))
            .mapControls {
                MapCompass()
                MapScaleView()
                MapUserLocationButton()
            }
            .accessibilityIdentifier("unified-map")
            .accessibilityValue(String(model.visibleRegion.span.latitudeDelta))
            .onMapCameraChange(frequency: .onEnd) { context in
                model.visibleRegion = context.region
                reportModel.visibleRegion = context.region
            }
        }
    }

    private func zoomMap(at coordinate: CLLocationCoordinate2D) {
        model.position = .region(.init(center: coordinate, span: .init(
            latitudeDelta: max(0.0002, model.visibleRegion.span.latitudeDelta / 2),
            longitudeDelta: max(0.0002, model.visibleRegion.span.longitudeDelta / 2)
        )))
    }

    private func highlightMarker(_ id: String) {
        withAnimation(.easeOut(duration: 0.16)) {
            highlightedMapMarkerID = id
        }
    }

    private func applyReportFocus() {
        guard !reportModel.issues.isEmpty else { return }
        reportModel.visibleRegion = model.visibleRegion
        guard let focus = navigation.reportFocus else { return }
        model.position = .region(.init(
            center: .init(latitude: focus.lat, longitude: focus.lng),
            span: .init(latitudeDelta: 0.012, longitudeDelta: 0.012)
        ))
        if let issue = reportModel.focus(lat: focus.lat, lng: focus.lng) {
            activeSheet = .reportIssue(issue)
        } else {
            reportModel.status = "No active public record within 450 m of this point."
        }
        navigation.reportFocus = nil
    }

    private func inspectReportCenter() {
        guard !reportModel.issues.isEmpty else {
            model.status = "Loading nearby public records…"
            Task {
                await reportModel.load()
                if reportModel.issues.isEmpty {
                    model.status = reportModel.status ?? "Public records are unavailable."
                } else {
                    inspectReportCenter()
                }
            }
            return
        }
        let center = model.visibleRegion.center
        if let issue = reportModel.focus(lat: center.latitude, lng: center.longitude) {
            activeSheet = .reportIssue(issue)
        } else {
            model.status = "No active public record within 450 m of the map center."
        }
    }

    private func inspectFeature(_ feature: MapFeature) {
        // Put the selected dot in the upper map area, above the medium detail sheet.
        let span = model.visibleRegion.span
        model.position = .region(.init(
            center: .init(latitude: feature.lat - span.latitudeDelta * 0.25, longitude: feature.lng),
            span: span))
        activeSheet = .feature(feature)
    }

    private func zoomReportMarker(_ marker: ReportMarker) {
        let next = max(0.012, model.visibleRegion.span.latitudeDelta / 3)
        model.position = .region(.init(center: marker.coordinate, span: .init(latitudeDelta: next, longitudeDelta: next)))
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 2) {
                    Image("CurbnoteMark").resizable().scaledToFit().frame(width: 38, height: 38).accessibilityHidden(true)
                    Text("curbnote").font(.headline.bold()).lineLimit(1).fixedSize(horizontal: true, vertical: false)
                }
                Text("NYC walks").font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Menu {
                Button("Saved walks", systemImage: "bookmark") { activeSheet = .account(false) }
                Button("Feedback", systemImage: "bubble.left") { activeSheet = .feedback }
                Button("Block records", systemImage: "building.2") { activeSheet = .records }
                Button("Prediction map", systemImage: "square.stack.3d.up") { activeSheet = .mapContent }
            } label: { Image(systemName: "ellipsis.circle").frame(width: 30, height: 30) }
            .accessibilityLabel("Feedback and block records")
            .accessibilityIdentifier("launch-menu")
            Button { introductionDismissed = true; activeSheet = .planner } label: {
                Label("Walk", systemImage: "figure.walk")
                    .font(.subheadline.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(AppTheme.brand)
            .foregroundStyle(AppTheme.background)
            .accessibilityIdentifier("plan-walk-button")
        }
        .padding(10)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 10, y: 4)
        .padding(.horizontal, 10)
        .padding(.top, 4)
    }

    private var launchCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("NYC · FREE EARLY ACCESS").font(.caption.bold()).foregroundStyle(AppTheme.mint)
                Spacer()
                Button { introductionDismissed = true } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Dismiss introduction")
            }
            Text("Know your walk.\nImprove your block.").font(.largeTitle.bold())
            Text("Choose what to walk around. See the dated evidence behind it. Help us learn what changed.")
                .foregroundStyle(.secondary)
            Button { introductionDismissed = true; activeSheet = .planner } label: {
                Label("Plan my walk", systemImage: "figure.walk").frame(maxWidth: .infinity)
            }.buttonStyle(.borderedProminent).tint(AppTheme.brand).foregroundStyle(AppTheme.background).controlSize(.large)
            HStack {
                Button("Block records") { activeSheet = .records }
                Spacer()
                Button("Saved walks") { activeSheet = .account(false) }
                Button("Feedback") { activeSheet = .feedback }
            }
            Text("Reported conditions are approximate, not live safety information.").font(.caption).foregroundStyle(.secondary)
        }
        .padding(20)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 24))
        .padding(10)
    }

    private var predictionHintCard: some View {
        HStack(spacing: 10) {
            Image(systemName: "circle.dotted")
                .foregroundStyle(AppTheme.coral)
            VStack(alignment: .leading, spacing: 2) {
                Text("Prediction map").font(.subheadline.bold())
                Text("Every dot is an approximate condition prediction. Tap one to see the evidence.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(14)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(10)
    }

    private var mapContentSheet: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(LayerDefinition.allCases.filter { $0 != .alpr }) { layer in
                        Toggle(isOn: visibleLayerBinding(layer)) {
                            Label(layer.title, systemImage: layer.symbol)
                        }
                        .accessibilityIdentifier("map-layer-\(layer.rawValue)")
                    }
                } header: {
                    Text("Prediction map")
                } footer: {
                    Text("Every map dot is an approximate condition prediction. Other evidence remains available in Block records and route details.")
                }

                Section("Inspect") {
                    Button { inspectReportCenter() } label: {
                        Label("Open the record nearest map center", systemImage: "exclamationmark.bubble.fill")
                    }
                }

                Section("Data and privacy") {
                    Text("Address searches are sent to the Curbnote service and its public geocoder. Walking-route coordinates are sent to the routing service. The server does not retain trip history.")
                    Text("Precise location is requested only when you choose a location action. A verification coordinate is proximity-checked and discarded; no raw location history is stored.")
                    Link(destination: URL(string: "https://data.cityofnewyork.us/d/erm2-nwe9")!) {
                        Label("NYC 311 source", systemImage: "arrow.up.right.square")
                    }
                }
            }
            .navigationTitle("Prediction map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { activeSheet = nil } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func routeCard(_ route: RouteChoice) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(duration(route.duration)).font(.title2.bold())
                Text(distance(route.distance)).font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                if route.recommended {
                    Text("BEST").font(.caption2.bold()).foregroundStyle(AppTheme.coral)
                }
            }

            if model.routes.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(model.routes) { option in
                            Button { model.selectRoute(option) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(duration(option.duration)).font(.subheadline.bold())
                                    Text(option.selectedIntersections == 0 ? "Avoids selected" : "\(option.selectedIntersections) high-confidence crossed").font(.caption2)
                                }
                                .padding(.horizontal, 11).padding(.vertical, 7)
                                .foregroundStyle(option.id == route.id ? .white : .primary)
                                .background(option.id == route.id ? AppTheme.coral : AppTheme.raised, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            Button("Was this walk useful? Give feedback") { activeSheet = .feedback }
                .font(.subheadline)

            Text(routeOutcome(route))
                .font(.caption).foregroundStyle(.secondary).lineLimit(3)

            HStack(spacing: 8) {
                Button { activeSheet = .directions } label: {
                    Label("Walk with Curbnote", systemImage: "figure.walk").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.brand)
                .foregroundStyle(AppTheme.background)
                .controlSize(.large)
                .accessibilityIdentifier("start-curbnote-walk")


                Button(action: model.fitRoute) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right").frame(width: 32, height: 32)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityLabel("Show route overview")

                Button { openReportNearRoute(route) } label: {
                    Image(systemName: "exclamationmark.bubble.fill").frame(width: 32, height: 32)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityLabel("Report or inspect an issue near this route")
            }
            Button { activeSheet = .account(true) } label: { Label("Save this walk", systemImage: "bookmark") }
                .disabled(model.isRouting)
                .accessibilityIdentifier("save-walk-account-gate")
        }
        .padding(14)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 12, y: -3)
        .padding(10)
    }

    private func endpointMarker(_ label: String, color: Color) -> some View {
        Text(label).font(.caption.bold()).foregroundStyle(.white).frame(width: 28, height: 28)
            .background(color, in: Circle()).overlay(Circle().stroke(.white, lineWidth: 2)).shadow(radius: 3)
    }

    private func openReportNearRoute(_ route: RouteChoice) {
        let points = route.geometry.mapCoordinates
        let coordinate = points.isEmpty ? model.visibleRegion.center : points[points.count / 2]
        navigation.openReport(lat: coordinate.latitude, lng: coordinate.longitude)
    }

    private func predictionMarker(_ feature: MapFeature, highlighted: Bool = false) -> some View {
        IssueDot(color: predictionColor(for: feature.layer), severity: .lower, highlighted: highlighted)
        .accessibilityLabel(feature.forecastTitle)
        .accessibilityValue(feature.address ?? "Approximate mapped area")
    }

    private func predictionColor(for layer: String?) -> Color {
        switch LayerDefinition(rawValue: layer ?? "") {
        case .homelessness: AppTheme.coral
        case .drugs: AppTheme.purple
        case .dumping: .orange
        case .sidewalk: .yellow
        case .street: .blue
        case .signals: AppTheme.mint
        case .alpr, nil: AppTheme.muted
        }
    }

    private func visibleLayerBinding(_ layer: LayerDefinition) -> Binding<Bool> {
        Binding(
            get: { model.visibleLayers.contains(layer) },
            set: { enabled in
                if enabled { model.visibleLayers.insert(layer) } else { model.visibleLayers.remove(layer) }
            }
        )
    }

    private func duration(_ seconds: Double) -> String {
        let minutes = max(1, Int((seconds / 60).rounded()))
        return minutes >= 60 ? "\(minutes / 60) hr \(minutes % 60) min" : "\(minutes) min"
    }

    private func distance(_ meters: Double) -> String {
        let miles = meters / 1609.344
        return miles < 0.1 ? "\(Int((meters * 3.28084).rounded())) ft" : String(format: "%.1f mi", miles)
    }

    private func routeOutcome(_ route: RouteChoice) -> String {
        guard !model.filters.isEmpty else { return "Fastest plausible route · no avoidance selected." }
        if route.selectedIntersections == 0 { return "No high-confidence selected locations are crossed. Lower-confidence observations can still appear nearby." }
        if model.avoidance?.improved == true {
            return "Reduced high-confidence crossings from \(model.avoidance?.baselineIntersections ?? 0) to \(route.selectedIntersections)."
        }
        return "Cleanest reasonable route still passes \(route.selectedIntersections) high-confidence selected location\(route.selectedIntersections == 1 ? "" : "s")."
    }
}
