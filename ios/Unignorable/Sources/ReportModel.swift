import Foundation
import MapKit
import SwiftUI

struct ReportMarker: Identifiable, Sendable {
    let id: String
    let lat: Double
    let lng: Double
    let type: String
    let severity: MarkerSeverity
    let issue: ReportIssue?
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

@MainActor
final class ReportModel: ObservableObject {
    @Published var issues: [ReportIssue] = [] { didSet { scheduleMarkers() } }
    @Published var enabledTypes: Set<String> = Set(ReportModel.types) { didSet { scheduleMarkers() } }
    @Published var position: MapCameraPosition = .region(ReportModel.initialRegion)
    @Published var visibleRegion = ReportModel.initialRegion { didSet { scheduleMarkers() } }
    @Published var searchText = ""
    @Published var suggestions: [Place] = []
    @Published var isLoading = false
    @Published var status: String?

    static let types = ["Encampment", "Drug Activity", "Homeless Person Assistance", "Panhandling"]
    static let initialRegion = MKCoordinateRegion(
        center: .init(latitude: 40.735, longitude: -73.98),
        span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12)
    )

    private let api = APIClient()
    private var searchTask: Task<Void, Never>?

    func load() async {
        guard issues.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            if let saved = await LocalStore.shared.read("reports", as: [ReportIssue].self, maxAge: 7 * 86400) { issues = saved.value }
            issues = try await api.reportIssues()
            await LocalStore.shared.write("reports", value: issues)
            status = nil
        } catch {
            status = error.localizedDescription
        }
    }

    func search(_ query: String) {
        searchTask?.cancel()
        guard query.count >= 3 else { suggestions = []; return }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            suggestions = (try? await api.geocode(query)) ?? []
        }
    }

    func select(_ place: Place) {
        searchText = place.name
        suggestions = []
        position = .region(.init(center: place.coordinate, span: .init(latitudeDelta: 0.012, longitudeDelta: 0.012)))
    }

    func showCurrentLocation(_ coordinate: CLLocationCoordinate2D) {
        position = .region(.init(center: coordinate, span: .init(latitudeDelta: 0.012, longitudeDelta: 0.012)))
    }

    func focus(lat: Double, lng: Double) -> ReportIssue? {
        let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        position = .region(.init(center: coordinate, span: .init(latitudeDelta: 0.012, longitudeDelta: 0.012)))
        let target = CLLocation(latitude: lat, longitude: lng)
        var nearest: ReportIssue?
        var nearestDistance = 451.0
        for issue in issues where issue.status == "active" {
            let distance = target.distance(from: CLLocation(latitude: issue.lat, longitude: issue.lng))
            if distance < nearestDistance || (distance == nearestDistance && issue.score > (nearest?.score ?? 0)) {
                nearest = issue
                nearestDistance = distance
            }
        }
        return nearest
    }

    func toggle(_ type: String) {
        if enabledTypes.contains(type) { enabledTypes.remove(type) } else { enabledTypes.insert(type) }
    }

    func zoom(to marker: ReportMarker) {
        let next = max(0.012, visibleRegion.span.latitudeDelta / 3)
        position = .region(.init(center: marker.coordinate, span: .init(latitudeDelta: next, longitudeDelta: next)))
    }

    @Published private(set) var markers: [ReportMarker] = []
    private var markerTask: Task<Void, Never>?
    private func scheduleMarkers() {
        markerTask?.cancel()
        let issues = issues; let enabled = enabledTypes
        let lat = visibleRegion.center.latitude; let lng = visibleRegion.center.longitude
        let latSpan = visibleRegion.span.latitudeDelta; let lngSpan = visibleRegion.span.longitudeDelta
        markerTask = Task {
            let result = await Task.detached(priority: .userInitiated) {
                Self.project(issues: issues, enabledTypes: enabled, lat: lat, lng: lng, latSpan: latSpan, lngSpan: lngSpan)
            }.value
            guard !Task.isCancelled else { return }
            markers = result
        }
    }

    nonisolated static func project(issues: [ReportIssue], enabledTypes: Set<String>, lat: Double, lng: Double, latSpan: Double, lngSpan: Double) -> [ReportMarker] {
        func nearestFirst(_ left: ReportIssue, _ right: ReportIssue) -> Bool {
            let l = pow(left.lat - lat, 2) + pow(left.lng - lng, 2)
            let r = pow(right.lat - lat, 2) + pow(right.lng - lng, 2)
            return l < r
        }
        let latRadius = latSpan * 0.65
        let lngRadius = lngSpan * 0.65
        let visible = issues.filter {
            $0.status == "active" && enabledTypes.contains($0.type)
                && abs($0.lat - lat) <= latRadius
                && abs($0.lng - lng) <= lngRadius
        }
        if latSpan < 0.022 || visible.count <= 180 {
            return visible.sorted(by: nearestFirst).prefix(180).map {
                .init(id: $0.id, lat: $0.lat, lng: $0.lng, type: $0.type, severity: $0.severity, issue: $0)
            }
        }

        let cell = latSpan > 0.18 ? 0.026
            : latSpan > 0.09 ? 0.016
            : latSpan > 0.045 ? 0.009 : 0.004
        struct Aggregate {
            var weightedLat = 0.0
            var weightedLng = 0.0
            var weight = 0.0
            var topCount = -1
            var topType = "Encampment"
            var severity = MarkerSeverity.lower
        }
        var cells: [String: Aggregate] = [:]
        for issue in visible {
            let key = "\(Int((issue.lat / cell).rounded()))_\(Int((issue.lng / cell).rounded()))"
            var aggregate = cells[key] ?? Aggregate()
            let weight = Double(max(1, min(issue.n, 500)))
            aggregate.weightedLat += issue.lat * weight
            aggregate.weightedLng += issue.lng * weight
            aggregate.weight += weight
            if issue.n > aggregate.topCount { aggregate.topCount = issue.n; aggregate.topType = issue.type }
            if issue.severity.rawValue > aggregate.severity.rawValue { aggregate.severity = issue.severity }
            cells[key] = aggregate
        }
        return cells.map { key, value in
            ReportMarker(
                id: "cluster-\(key)", lat: value.weightedLat / value.weight, lng: value.weightedLng / value.weight,
                type: value.topType, severity: value.severity, issue: nil
            )
        }
        .sorted {
            let left = pow($0.lat - lat, 2) + pow($0.lng - lng, 2)
            let right = pow($1.lat - lat, 2) + pow($1.lng - lng, 2)
            return left < right
        }
        .prefix(180)
        .map { $0 }
    }

}
