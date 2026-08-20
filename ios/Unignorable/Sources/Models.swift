import Foundation
import CoreLocation

struct Place: Codable, Identifiable, Equatable, Sendable {
    var id: String { "\(lat),\(lng),\(name)" }
    let name: String
    let lat: Double
    let lng: Double
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

struct RouteRequest: Encodable, Sendable {
    let origin: Place
    let destination: Place
    let via: Place?
    let profile: String
    let filters: [String]
}

struct LineGeometry: Codable, Sendable {
    let type: String
    let coordinates: [[Double]]
    var mapCoordinates: [CLLocationCoordinate2D] {
        coordinates.compactMap { $0.count >= 2 ? .init(latitude: $0[1], longitude: $0[0]) : nil }
    }
}

struct RouteStep: Codable, Identifiable, Sendable {
    var id: String { "\(instruction)-\(distance)-\(duration)" }
    let instruction: String
    let distance: Double
    let duration: Double
    let type: String?
    let modifier: String?
    let location: RouteStepLocation?
}

struct RouteStepLocation: Codable, Sendable {
    let lat: Double
    let lng: Double
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

struct RouteExport: Codable, Sendable {
    let apple: URL
    let google: URL
    let shapingWaypoints: Int?
    let externalWaypoints: Int?
    let includesVia: Bool?
}

struct RouteChoice: Codable, Identifiable, Sendable {
    let id: String
    let distance: Double
    let duration: Double
    let geometry: LineGeometry
    let recommended: Bool
    let selectedIntersections: Int
    let selectedRisk: Double?
    let steps: [RouteStep]?
    let metrics: [String: Double]
    let export: RouteExport?
}

struct AvoidanceSummary: Codable, Sendable {
    let baselineIntersections: Int
    let remainingIntersections: Int
    let improved: Bool
    let excludedAreas: Int?
    let remainingRisk: Double?
    let passes: Int?
}

struct RouteResponse: Codable, Sendable {
    let routes: [RouteChoice]
    let avoidance: AvoidanceSummary
    let profile: String
    let via: Place?
    let cacheHit: Bool?
}

struct MapFeature: Codable, Identifiable, Sendable {
    let id: String
    let lat: Double
    let lng: Double
    let layer: String?
    let manufacturer: String?
    let count: Int?
    let descriptor: String?
    let subjectType: String?
    let distinctReportDays: Int?
    let fieldObservationCount: Int?
    let condition: ConditionEstimate?
    let locationUncertaintyM: Double?
    let locationMethod: String?
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

struct ConditionEstimate: Codable, Sendable {
    let classification: String
    let label: String
    let presenceProbability: Double?
    let probabilityRange: [Double]?
    let routingLevel: String?
    let hardExclusion: Bool?
    let reportDaysLast14: Int?
    let lastEvidenceAt: String?
    let lastReportAt: String?
    let lastObservedAt: String?
    let lastNotObservedAt: String?
    let lastCheckedAt: String?
    let lastFieldObservedAt: String?
    let basis: String?
    let methodVersion: String?
}

struct MapLayersResponse: Codable, Sendable { let layers: [String: [MapFeature]] }

struct ConditionObservationRequest: Encodable, Sendable {
    let featureId: String
    let state: String
    let lat: Double
    let lng: Double
}

struct ConditionObservationResponse: Decodable, Sendable {
    let ok: Bool
    let accepted: Bool
    let duplicate: Bool
}

struct CitiBikeStation: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let lat: Double
    let lng: Double
    let bikes: Int
    let docks: Int
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
    var place: Place { .init(name: name, lat: lat, lng: lng) }
}
struct CitiBikeResponse: Codable, Sendable { let stations: [CitiBikeStation] }

struct ReportIssue: Codable, Identifiable, Sendable {
    let type: String
    let recordID: String
    let n: Int
    let lat: Double
    let lng: Double
    let addr: String?
    let borough: String?
    let status: String
    let pattern: String
    let score: Double
    let currentDays: Int?
    let lastSeen: String?
    let headline: String?
    let seen: Int
    let closedN: Int
    let returnedN: Int

    var id: String { "\(type)|\(recordID)" }
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
    var severity: MarkerSeverity {
        if pattern == "persistent" || score >= 65 { return .high }
        if score >= 52 { return .elevated }
        return .lower
    }

    enum CodingKeys: String, CodingKey {
        case type, n, lat, lng, addr, borough, status, pattern, score, headline, seen
        case recordID = "id"
        case currentDays, lastSeen, closedN, returnedN
    }
}

struct ReportPost: Codable, Identifiable, Sendable {
    let id: Int
    let ts: String
    let kind: String
    let text: String?
    let status: String?
    let photo: String?
}

struct ReportThread: Codable, Sendable {
    let posts: [ReportPost]
    let verdict: String
    let corrob: Int
    let lastTs: String?
    let duplicate: Bool?
}

struct IssueIdentityRequest: Encodable, Sendable { let type: String; let id: String }
struct IssuePostRequest: Encodable, Sendable {
    let type: String
    let id: String
    let text: String?
    let status: String?
    let photo: String?
}

enum LayerDefinition: String, CaseIterable, Identifiable, Sendable {
    case alpr, homelessness, drugs, dumping, sidewalk, street, signals
    var id: String { rawValue }
    var title: String { switch self {
        case .alpr: "License plate cameras"; case .homelessness: "Homeless / encampment reports"
        case .drugs: "Drug activity"; case .dumping: "Illegal dumping"
        case .sidewalk: "Broken sidewalks"; case .street: "Bad roads"; case .signals: "Broken lights / signals" }
    }
    var symbol: String { switch self {
        case .alpr: "camera.fill"; case .homelessness: "tent.fill"; case .drugs: "pills.fill"
        case .dumping: "trash.fill"; case .sidewalk: "figure.walk.motion"; case .street: "road.lanes"
        case .signals: "light.beacon.max.fill" }
    }
}
