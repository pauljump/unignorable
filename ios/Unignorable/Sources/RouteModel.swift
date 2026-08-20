import Foundation
import MapKit
import SwiftUI

@MainActor
final class RouteModel: ObservableObject {
    @Published var originText = ""
    @Published var destinationText = ""
    @Published var origin: Place?
    @Published var destination: Place?
    @Published var via: Place?
    @Published var suggestions: [Place] = []
    @Published var routes: [RouteChoice] = []
    @Published var avoidance: AvoidanceSummary?
    @Published var selectedRouteID: String?
    @Published var filters: Set<LayerDefinition> = []
    @Published var visibleLayers: Set<LayerDefinition> = []
    @Published var mapFeatures: [String: [MapFeature]] = [:]
    @Published var bikes: [CitiBikeStation] = []
    @Published var showCitiBike = false
    @Published var isRouting = false
    @Published var status: String?
    @Published var position: MapCameraPosition = .region(.init(center: .init(latitude: 40.724, longitude: -73.965), span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12)))
    @Published var visibleRegion = MKCoordinateRegion(center: .init(latitude: 40.724, longitude: -73.965), span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12))

    let api = APIClient()
    private var routeTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var resolveTask: Task<Void, Never>?
    private var routeGeneration: UUID?
    private var searchCache: [String: [Place]] = [:]

    var selectedRoute: RouteChoice? { routes.first(where: { $0.id == selectedRouteID }) ?? routes.first }

    func load() async {
        if let response = try? await api.mapLayers() { mapFeatures = response.layers }
    }

    func search(_ query: String) {
        searchTask?.cancel()
        let key = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard key.count >= 3 else { suggestions = []; return }
        if let cached = searchCache[key] { suggestions = cached; return }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            let results = await places(matching: query)
            guard !Task.isCancelled else { return }
            searchCache[key] = results
            if searchCache.count > 50 { searchCache.removeValue(forKey: searchCache.keys.first!) }
            suggestions = results
        }
    }

    func select(_ place: Place, asOrigin: Bool) {
        if asOrigin { origin = place; originText = place.name } else { destination = place; destinationText = place.name }
        suggestions = []
        invalidateRoute()
    }

    func swap() {
        (origin, destination) = (destination, origin)
        (originText, destinationText) = (destinationText, originText)
        invalidateRoute()
    }

    func clearAddress(asOrigin: Bool) {
        searchTask?.cancel()
        suggestions = []
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
                routes = response.routes
                avoidance = response.avoidance
                selectedRouteID = response.routes.first(where: \.recommended)?.id ?? response.routes.first?.id
                status = response.cacheHit == true ? "Route ready · instant refresh" : "Route ready"
                fitRoute()
            } catch is CancellationError { } catch {
                guard routeGeneration == generation else { return }
                routes = []
                avoidance = nil
                status = error.localizedDescription
            }
        }
    }

    private func invalidateRoute() {
        routeTask?.cancel()
        resolveTask?.cancel()
        routeGeneration = nil
        routes = []
        avoidance = nil
        selectedRouteID = nil
        isRouting = false
        status = origin != nil && destination != nil ? "Ready to create your walking route." : nil
    }

    private func places(matching query: String) async -> [Place] {
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

    func loadBikes() async {
        guard showCitiBike else { bikes = []; return }
        let routePoints = selectedRoute?.geometry.mapCoordinates ?? []
        let midpoint = routePoints.isEmpty ? nil : routePoints[routePoints.count / 2]
        let center = midpoint.map { Place(name: "Route midpoint", lat: $0.latitude, lng: $0.longitude) }
            ?? destination ?? origin ?? Place(name: "Map center", lat: 40.724, lng: -73.965)
        do { bikes = try await api.citiBike(near: center) } catch { status = error.localizedDescription }
    }

    var visibleFeatures: [MapFeature] {
        let latitudeRadius = max(visibleRegion.span.latitudeDelta * 0.65, 0.008)
        let longitudeRadius = max(visibleRegion.span.longitudeDelta * 0.65, 0.008)
        let markerLimit = visibleRegion.span.latitudeDelta > 0.08 ? 40
            : visibleRegion.span.latitudeDelta > 0.03 ? 120 : 250
        return visibleLayers
            .flatMap { mapFeatures[$0.rawValue] ?? [] }
            .filter {
                abs($0.lat - visibleRegion.center.latitude) <= latitudeRadius
                    && abs($0.lng - visibleRegion.center.longitude) <= longitudeRadius
            }
            .sorted {
                let left = pow($0.lat - visibleRegion.center.latitude, 2) + pow($0.lng - visibleRegion.center.longitude, 2)
                let right = pow($1.lat - visibleRegion.center.latitude, 2) + pow($1.lng - visibleRegion.center.longitude, 2)
                return left < right
            }
            .prefix(markerLimit)
            .map { $0 }
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

    func focus(_ step: RouteStep) {
        guard let coordinate = step.location?.coordinate else { return }
        position = .region(.init(center: coordinate, span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006)))
    }
}
