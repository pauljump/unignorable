import Foundation
import MapKit
import SwiftUI

@MainActor
final class RouteModel: NSObject, ObservableObject, @preconcurrency MKLocalSearchCompleterDelegate {
    @Published var originText = ""
    @Published var destinationText = ""
    @Published var origin: Place?
    @Published var destination: Place?
    @Published var via: Place?
    @Published var suggestions: [Place] = []
    @Published var completions: [MKLocalSearchCompletion] = []
    @Published var isSearching = false
    @Published var searchStatus: String?
    private var completer: MKLocalSearchCompleter?
    @Published var routes: [RouteChoice] = []
    @Published var avoidance: AvoidanceSummary?
    @Published var walkingStepIndex = 0 { didSet { persistWalk() } }
    @Published var selectedRouteID: String? {
        didSet { if oldValue != selectedRouteID { walkingStepIndex = 0 }; persistWalk() }
    }
    @Published var filters: Set<LayerDefinition> = []
    // The launch map shows modeled condition predictions across every civic
    // category. Historical or unresolved evidence is filtered at projection.
    @Published var visibleLayers: Set<LayerDefinition> = Set(LayerDefinition.allCases.filter { $0 != .alpr }) { didSet { scheduleProjection() } }
    @Published var mapFeatures: [String: [MapFeature]] = [:] { didSet { scheduleProjection() } }
    @Published var bikes: [CitiBikeStation] = []
    @Published var showCitiBike = false
    @Published var isRouting = false
    @Published var status: String?
    @Published var position: MapCameraPosition = .region(.init(center: .init(latitude: 40.724, longitude: -73.965), span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12)))
    @Published var visibleRegion = MKCoordinateRegion(center: .init(latitude: 40.724, longitude: -73.965), span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12)) { didSet { scheduleProjection() } }

    let api = APIClient()
    private var routeTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var resolveTask: Task<Void, Never>?
    private var routeGeneration: UUID?

    var selectedRoute: RouteChoice? { routes.first(where: { $0.id == selectedRouteID }) ?? routes.first }

    @Published private(set) var visibleFeatures: [MapFeature] = []
    @Published private(set) var recentPlaces: [Place] = []
    @Published private(set) var mapSavedAt: Date?
    @Published private(set) var showingSavedMap = false
    @Published private(set) var plannedAt = Date()
    private let local: LocalStore
    private var projectionTask: Task<Void, Never>?
    private var persistTask: Task<Void, Never>?
    private var loaded = false
    private var restoring = false
    private var userChangedWalk = false

    init(local: LocalStore = .shared) { self.local = local; super.init() }

    func load() async {
        guard !loaded else { return }; loaded = true
        await loadLocalState()
        do {
            let response = try await api.mapLayers()
            mapFeatures = response.layers; mapSavedAt = Date(); showingSavedMap = false
            await local.write("map", value: response)
        } catch { showingSavedMap = !mapFeatures.isEmpty }
    }

    func loadLocalState() async {
        if let saved = await local.read("map", as: MapLayersResponse.self, maxAge: 7 * 86400) {
            mapFeatures = saved.value.layers; mapSavedAt = saved.savedAt; showingSavedMap = true
        }
        if let saved = await local.read("places", as: [Place].self, maxAge: 30 * 86400) { recentPlaces = saved.value }
        if let saved = await local.read("walk", as: LocalWalk.self, maxAge: 2 * 86400), !userChangedWalk, routes.isEmpty {
            restoreWalk(saved.value)
        }
    }

    func restoreWalk(_ walk: LocalWalk) {
        guard !walk.routes.isEmpty, Date().timeIntervalSince(walk.plannedAt) < 2 * 86400 else { return }
        restoring = true
        origin = walk.origin; destination = walk.destination; via = walk.via
        originText = walk.origin.name; destinationText = walk.destination.name
        filters = Set(walk.filters.compactMap(LayerDefinition.init(rawValue:)))
        routes = walk.routes; avoidance = walk.avoidance; selectedRouteID = walk.selectedRouteID
        plannedAt = walk.plannedAt; selectWalkingStep(walk.step)
        restoring = false
        status = "Saved walk · planned " + walk.plannedAt.formatted(date: .abbreviated, time: .shortened)
        fitRoute()
    }

    var localWalk: LocalWalk? {
        guard !isRouting, let origin, let destination, !routes.isEmpty else { return nil }
        return LocalWalk(origin: origin, destination: destination, via: via, filters: filters.map(\.rawValue), routes: routes, avoidance: avoidance, selectedRouteID: selectedRouteID, step: walkingStepIndex, plannedAt: plannedAt)
    }
    func persistWalk() {
        guard !restoring else { return }
        persistTask?.cancel()
        let walk = localWalk; let local = local
        persistTask = Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            if let walk { await local.write("walk", value: walk) } else { await local.remove("walk") }
        }
    }
    func flushWalk() async {
        persistTask?.cancel()
        if let walk = localWalk { await local.write("walk", value: walk) } else { await local.remove("walk") }
    }
    func clearLocalHistory() async {
        recentPlaces = []; await local.remove("places")
    }
    private func remember(_ place: Place) {
        // A live location is not a saved address unless the person explicitly saves a walk.
        guard place.name != "Current location" else { return }
        recentPlaces.removeAll { $0.id == place.id }; recentPlaces.insert(place, at: 0)
        recentPlaces = Array(recentPlaces.prefix(12))
        let places = recentPlaces
        Task { await local.write("places", value: places) }
    }
    func recentMatches(_ query: String) -> [Place] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return Array(recentPlaces.filter { q.isEmpty || $0.name.localizedCaseInsensitiveContains(q) }.prefix(4))
    }
    func waitForMapUpdate() async { await projectionTask?.value }
    private func scheduleProjection() {
        projectionTask?.cancel()
        let features = mapFeatures; let layers = visibleLayers.map(\.rawValue)
        let lat = visibleRegion.center.latitude; let lng = visibleRegion.center.longitude
        let latSpan = visibleRegion.span.latitudeDelta; let lngSpan = visibleRegion.span.longitudeDelta
        projectionTask = Task {
            let result = await Task.detached(priority: .userInitiated) {
                Self.project(features: features, layers: layers, lat: lat, lng: lng, latSpan: latSpan, lngSpan: lngSpan)
            }.value
            guard !Task.isCancelled else { return }
            visibleFeatures = result
        }
    }
    nonisolated static func project(features: [String: [MapFeature]], layers: [String], lat: Double, lng: Double, latSpan: Double, lngSpan: Double) -> [MapFeature] {
        func distance(_ feature: MapFeature) -> Double { pow(feature.lat - lat, 2) + pow((feature.lng - lng) * cos(lat * .pi / 180), 2) }
        // Do not let dense supporting layers crowd known encampment dots out
        // of a broad map view. Nearby filtering keeps this bounded at close
        // zoom; the higher ceiling preserves every current prediction in the
        // normal NYC launch viewport.
        let limit = latSpan > 0.08 ? 1000 : latSpan > 0.03 ? 600 : 1000
        let all: [MapFeature] = layers.flatMap { features[$0] ?? [] }.filter { $0.isLikelyPresent }
        let nearby: [MapFeature] = all.filter {
            abs($0.lat - lat) <= max(latSpan * 0.65, 0.008) && abs($0.lng - lng) <= max(lngSpan * 0.65, 0.008)
        }
        let visible = nearby.sorted { distance($0) < distance($1) }
        return Array(visible.prefix(limit))
    }

    func search(_ query: String) {
        searchTask?.cancel()
        suggestions = []
        completions = []
        searchStatus = nil
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 3 else { cancelSearch(); return }
        isSearching = true
        // Keep one completer while typing so MapKit can debounce query fragments.
        let searchCompleter = completer ?? MKLocalSearchCompleter()
        searchCompleter.region = MKCoordinateRegion(center: .init(latitude: 40.7128, longitude: -74.0060), span: .init(latitudeDelta: 0.55, longitudeDelta: 0.55))
        searchCompleter.resultTypes = [.address, .pointOfInterest]
        if #available(iOS 18.0, *) { searchCompleter.regionPriority = .required }
        searchCompleter.delegate = self
        completer = searchCompleter
        searchCompleter.queryFragment = query
        // MapKit may stall without a delegate error on a poor connection.
        fallbackSearch(query, delay: true)
    }

    func cancelSearch() {
        searchTask?.cancel()
        completer?.delegate = nil
        completer?.cancel()
        completer = nil
        suggestions = []
        completions = []
        isSearching = false
        searchStatus = nil
    }

    func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        guard self.completer === completer else { return }
        searchTask?.cancel()
        suggestions = []
        searchStatus = nil
        completions = Array(completer.results.prefix(5))
        isSearching = false
        if completions.isEmpty { fallbackSearch(completer.queryFragment) }
    }

    func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        guard self.completer === completer else { return }
        fallbackSearch(completer.queryFragment)
    }

    private func fallbackSearch(_ query: String, delay: Bool = false) {
        searchTask?.cancel()
        isSearching = true
        searchTask = Task {
            do {
                if delay { try await Task.sleep(for: .seconds(3)) }
                try Task.checkCancellation()
                let results = try await api.geocode(query)
                guard !Task.isCancelled else { return }
                suggestions = results
                isSearching = false
                searchStatus = results.isEmpty ? "No NYC addresses found. Try a street number and name." : nil
            } catch {
                guard !Task.isCancelled else { return }
                isSearching = false
                searchStatus = "Address search couldn't connect. Edit the address to retry."
            }
        }
    }

    func selectCompletion(_ completion: MKLocalSearchCompletion, asOrigin: Bool) {
        cancelSearch()
        status = "Checking address…"
        searchTask = Task {
            let request = MKLocalSearch.Request(completion: completion)
            let result = try? await MKLocalSearch(request: request).start()
            guard !Task.isCancelled else { return }
            if let item = result?.mapItems.first,
               (40.45...40.95).contains(item.placemark.coordinate.latitude),
               (-74.30 ... -73.65).contains(item.placemark.coordinate.longitude) {
                select(Place(name: item.placemark.title ?? completion.title, lat: item.placemark.coordinate.latitude, lng: item.placemark.coordinate.longitude), asOrigin: asOrigin)
            } else {
                let places = (try? await api.geocode(completion.title + ", " + completion.subtitle)) ?? []
                guard !Task.isCancelled else { return }
                if let place = places.first { select(place, asOrigin: asOrigin) }
                else { status = "Couldn't resolve that NYC address. Try again." }
            }
        }
    }

    func select(_ place: Place, asOrigin: Bool) {
        cancelSearch()
        remember(place)
        if asOrigin { origin = place; originText = place.name } else { destination = place; destinationText = place.name }
        suggestions = []
        invalidateRoute()
    }

    func swap() {
        cancelSearch()
        (origin, destination) = (destination, origin)
        (originText, destinationText) = (destinationText, originText)
        invalidateRoute()
    }

    func clearAddress(asOrigin: Bool) {
        cancelSearch()
        if asOrigin {
            origin = nil
            originText = ""
        } else {
            destination = nil
            destinationText = ""
        }
        invalidateRoute()
    }

    func addressTextChanged(asOrigin: Bool) {
        if asOrigin { origin = nil } else { destination = nil }
        invalidateRoute()
    }

    func createWalkingRoute() {
        cancelSearch()
        resolveTask?.cancel()
        routeTask?.cancel()
        let originQuery = originText.trimmingCharacters(in: .whitespacesAndNewlines)
        let destinationQuery = destinationText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !originQuery.isEmpty, !destinationQuery.isEmpty else {
            status = "Add a starting point and destination."
            return
        }
        isRouting = true
        status = "Checking addresses…"
        resolveTask = Task {
            let resolvedOrigin: Place?
            if let origin { resolvedOrigin = origin } else { resolvedOrigin = await places(matching: originQuery).first }
            guard !Task.isCancelled else { return }
            guard let resolvedOrigin else {
                isRouting = false
                status = "Choose a starting address from the suggestions."
                return
            }
            let resolvedDestination: Place?
            if let destination { resolvedDestination = destination } else { resolvedDestination = await places(matching: destinationQuery).first }
            guard !Task.isCancelled else { return }
            guard let resolvedDestination else {
                isRouting = false
                status = "Choose a destination from the suggestions."
                return
            }
            remember(resolvedOrigin); remember(resolvedDestination)
            origin = resolvedOrigin
            destination = resolvedDestination
            originText = resolvedOrigin.name
            destinationText = resolvedDestination.name
            startRoute(origin: resolvedOrigin, destination: resolvedDestination, delay: false)
        }
    }

    func rebuild() {
        guard !routes.isEmpty, let origin, let destination else { return }
        startRoute(origin: origin, destination: destination, delay: true)
    }

    private func startRoute(origin: Place, destination: Place, delay: Bool) {
        routeTask?.cancel()
        let generation = UUID()
        let requestedVia = via
        let requestedFilters = filters
        routeGeneration = generation
        isRouting = true
        status = "Finding your walking route…"
        routeTask = Task {
            defer { if routeGeneration == generation { isRouting = false } }
            do {
                if delay { try await Task.sleep(for: .milliseconds(180)) }
                let response = try await api.walkingRoutes(origin: origin, destination: destination, via: requestedVia, filters: requestedFilters)
                guard !Task.isCancelled, routeGeneration == generation else { return }
                plannedAt = Date()
                walkingStepIndex = 0
                routes = response.routes
                avoidance = response.avoidance
                selectedRouteID = response.routes.first(where: \.recommended)?.id ?? response.routes.first?.id
                isRouting = false
                status = response.cacheHit == true ? "Route ready · instant refresh" : "Route ready"
                fitRoute()
                persistWalk()
            } catch is CancellationError { } catch {
                guard routeGeneration == generation else { return }
                routes = []
                avoidance = nil
                selectedRouteID = nil
                persistWalk()
                status = error.localizedDescription
            }
        }
    }

    private func invalidateRoute() {
        userChangedWalk = true
        routeTask?.cancel()
        resolveTask?.cancel()
        routeGeneration = nil
        walkingStepIndex = 0
        routes = []
        avoidance = nil
        selectedRouteID = nil
        isRouting = false
        status = origin != nil && destination != nil ? "Ready to create your walking route." : nil
    }

    private func places(matching query: String) async -> [Place] {
        if let recent = recentPlaces.first(where: { $0.name.caseInsensitiveCompare(query) == .orderedSame }) { return [recent] }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060),
            span: MKCoordinateSpan(latitudeDelta: 0.55, longitudeDelta: 0.55)
        )
        request.resultTypes = [.address, .pointOfInterest]
        if let response = try? await MKLocalSearch(request: request).start() {
            let results = response.mapItems.compactMap { item -> Place? in
                let coordinate = item.placemark.coordinate
                guard (40.45...40.95).contains(coordinate.latitude), (-74.30 ... -73.65).contains(coordinate.longitude) else { return nil }
                let title = item.placemark.title ?? item.name ?? query
                return Place(name: title, lat: coordinate.latitude, lng: coordinate.longitude)
            }
            let unique = Dictionary(grouping: results, by: { "\(String(format: "%.5f", $0.lat)),\(String(format: "%.5f", $0.lng))" })
                .compactMap(\.value.first)
                .prefix(6)
                .map { $0 }
            if !unique.isEmpty { return unique }
        }
        return (try? await api.geocode(query)) ?? []
    }

    func fitRoute() {
        guard let points = selectedRoute?.geometry.mapCoordinates, !points.isEmpty else { return }
        let lats = points.map(\.latitude), lngs = points.map(\.longitude)
        let center = CLLocationCoordinate2D(latitude: (lats.min()! + lats.max()!) / 2, longitude: (lngs.min()! + lngs.max()!) / 2)
        position = .region(.init(center: center, span: .init(latitudeDelta: max(0.012, (lats.max()! - lats.min()!) * 1.45), longitudeDelta: max(0.012, (lngs.max()! - lngs.min()!) * 1.45))))
    }

    func focusForecast(_ feature: MapFeature) {
        focusForecast(at: feature.coordinate)
    }

    func focusForecast(at coordinate: CLLocationCoordinate2D) {
        let region = MKCoordinateRegion(
            center: coordinate,
            span: .init(latitudeDelta: 0.012, longitudeDelta: 0.012)
        )
        visibleRegion = region
        position = .region(region)
    }

    func forecastPlaces(matching query: String) async -> [Place] {
        await places(matching: query)
    }

    func loadBikes() async {
        guard showCitiBike else { bikes = []; return }
        let routePoints = selectedRoute?.geometry.mapCoordinates ?? []
        let midpoint = routePoints.isEmpty ? nil : routePoints[routePoints.count / 2]
        let center = midpoint.map { Place(name: "Route midpoint", lat: $0.latitude, lng: $0.longitude) }
            ?? destination ?? origin ?? Place(name: "Map center", lat: 40.724, lng: -73.965)
        do { bikes = try await api.citiBike(near: center) } catch { status = error.localizedDescription }
    }

    func useSavedWalk(_ walk: SavedWalk) {
        cancelSearch(); invalidateRoute()
        origin = walk.origin; destination = walk.destination; via = walk.via
        originText = walk.origin.name; destinationText = walk.destination.name
        filters = Set(walk.filters.compactMap(LayerDefinition.init(rawValue:)))
        status = "Saved addresses ready. Open Walk to calculate a fresh route."
    }

    func selectRoute(_ route: RouteChoice) {
        selectedRouteID = route.id
        fitRoute()
    }

    func chooseBike(_ station: CitiBikeStation) {
        via = station.place
        rebuild()
    }

    func clearVia() {
        via = nil
        rebuild()
    }

    func selectWalkingStep(_ index: Int) {
        let count = selectedRoute?.steps?.count ?? 0
        walkingStepIndex = min(max(0, index), max(0, count - 1))
    }

    func focus(_ step: RouteStep) {
        guard let coordinate = step.location?.coordinate else { return }
        position = .region(.init(center: coordinate, span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006)))
    }
}
