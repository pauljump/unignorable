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
    let recordArchived: Bool?
    let lastSeen: String?
    let id: String
    let lat: Double
    let lng: Double
    let layer: String?
    let manufacturer: String?
    let count: Int?
    let descriptor: String?
    let address: String?
    let subjectType: String?
    let distinctReportDays: Int?
    let fieldObservationCount: Int?
    let condition: ConditionEstimate?
    let nowcast: NowcastEstimate?
    let locationUncertaintyM: Double?
    let locationMethod: String?
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

struct NowcastEstimate: Codable, Sendable {
    let methodVersion: String?
    let rollout: String?
    let status: String?
    let asOf: String?
    let label: String?
    let uncalibratedScore: Double?
    let scoreRange: [Double]?
    let scoreSemantics: String?
    let rangeSemantics: String?
    let confidenceSemantics: String?
    let liveProbability: Double?
    let currentProbability: Double?
    let probabilityRange: [Double]?
    let confidence: String?
    let features: NowcastFeatures?
    let localTimeWindow: LocalTimeWindow?
    let spatialUncertainty: NowcastSpatialUncertainty?
    let basis: String?
}

struct NowcastFeatures: Codable, Sendable {
    let reportDays7: Int?
    let reportDays14: Int?
    let reportDays30: Int?
    let reportDays90: Int?
    let reportAgeDays: Double?
    let reportCadenceDays: Double?
    let lastReportAt: String?
    let lastDirectCheckAt: String?
}

/// A pattern in when reports arrive. This is deliberately not described as a
/// physical-presence window until a future model has evidence to support that claim.
struct LocalTimeWindow: Codable, Sendable {
    let startHour: Double?
    let endHour: Double?
    let label: String?
    let timezone: String?
    let reportDays: Int?
    let daysInWindow: Int?
    let effectiveDaysInWindow: Double?
    let sampleSize: Int?
    let concentration: Double?
    let strength: String?
    let basis: String?
}

struct NowcastSpatialUncertainty: Codable, Sendable {
    let radiusM: Double?
    let label: String?
    let basis: String?
}

extension MapFeature {
    /// An uncalibrated 0...1 model score. Backend field names are retained for
    /// compatibility, but the client never presents this as an empirical probability.
    var forecastScore: Double? {
        let value = nowcast?.uncalibratedScore ?? nowcast?.currentProbability ?? nowcast?.liveProbability ?? condition?.presenceProbability
        guard let value, value.isFinite, (0...1).contains(value) else { return nil }
        return value
    }

    var forecastScoreRange: ClosedRange<Double>? {
        let values = nowcast?.scoreRange ?? nowcast?.probabilityRange ?? condition?.probabilityRange
        guard let values, values.count == 2,
              values[0].isFinite, values[1].isFinite,
              (0...1).contains(values[0]), (0...1).contains(values[1]) else { return nil }
        return min(values[0], values[1])...max(values[0], values[1])
    }

    var forecastEvidenceStrength: String {
        switch nowcast?.confidence?.lowercased() {
        case "high": "Stronger evidence"
        case "medium": "Moderate evidence"
        default: "Limited evidence"
        }
    }

    var forecastTitle: String {
        guard let score = forecastScore else { return "Encampment condition status uncertain" }
        if score >= 0.74, nowcast?.confidence?.lowercased() != "low" {
            return "Encampment condition likely present"
        }
        if score <= 0.18, nowcast?.confidence?.lowercased() != "low" {
            return "Encampment condition likely absent"
        }
        return "Encampment condition uncertain"
    }

    var isExperimentalForecast: Bool {
        nowcast?.status?.lowercased() == "beta" || nowcast?.rollout?.lowercased() != "live"
    }

    var forecastLocationRadiusM: Double? {
        let value = nowcast?.spatialUncertainty?.radiusM ?? locationUncertaintyM
        guard let value, value.isFinite, value > 0 else { return nil }
        return value
    }

    var reportTimingLabel: String? {
        guard let window = nowcast?.localTimeWindow else { return nil }
        let supplied = window.label?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let supplied, !supplied.isEmpty { return "Historical reports most often arrived \(supplied)" }
        guard let start = Self.localHour(window.startHour), let end = Self.localHour(window.endHour) else { return nil }
        return "Historical reports most often arrived \(start)–\(end)"
    }

    var reportTimingIsStrongEnoughForPrimary: Bool {
        switch nowcast?.localTimeWindow?.strength?.lowercased() {
        case "moderate", "strong": true
        default: false
        }
    }

    private static func localHour(_ value: Double?) -> String? {
        guard let value, value.isFinite, value >= 0, value < 24 else { return nil }
        let minutes = Int((value * 60).rounded()) % (24 * 60)
        var hour = minutes / 60
        let minute = minutes % 60
        let suffix = hour < 12 ? "AM" : "PM"
        hour %= 12
        if hour == 0 { hour = 12 }
        return minute == 0 ? "\(hour) \(suffix)" : String(format: "%d:%02d %@", hour, minute, suffix)
    }
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

struct ConditionLoopResponse: Decodable, Sendable {
    let ok: Bool
    let loop: ConditionLoop
}

struct ConditionLoop: Decodable, Sendable {
    let stage: String
    let stageIndex: Int
    let stages: [ConditionLoopStage]
    let nextAction: ConditionLoopAction
    let checks: ConditionLoopChecks
    let record: ConditionLoopRecord?
    let campaign: ConditionLoopCampaign?
}

struct ConditionLoopStage: Decodable, Identifiable, Sendable {
    let id: String
    let label: String
    let state: String
}

struct ConditionLoopAction: Decodable, Sendable {
    let id: String
    let mode: String
    let label: String
    let href: String?
}

struct ConditionLoopChecks: Decodable, Sendable {
    let total: Int
    let pending: Int
    let reviewed: Int
    let forecastUnchanged: Bool
    let reviewRequired: Bool
}

struct ConditionLoopRecord: Decodable, Sendable {
    let type: String
    let id: String
    let href: String
    let status: String
    let reports: Int
    let cityClosures: Int
    let returnsAfterClosure: Int
    let currentDays: Int
}

struct ConditionLoopCampaign: Decodable, Sendable {
    let active: Bool
    let status: String
    let startedAt: String
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
