import Foundation
import CoreLocation

struct APIClient {
    let baseURL: URL
    private let session: URLSession
    private let encoder = JSONEncoder()

    init(baseURL: URL = URL(string: "https://curbnote.polyfeeds.dev")!) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 25
        configuration.requestCachePolicy = .useProtocolCachePolicy
        self.session = URLSession(configuration: configuration)
    }

    func submitFeedback(_ feedback: FeedbackRequest) async throws -> FeedbackReceipt {
        var request = URLRequest(url: baseURL.appending(path: "/api/feedback"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(feedback)
        return try await perform(request)
    }
    func feedbackReceipt(_ id: String) async throws -> FeedbackReceipt { try await get(baseURL.appending(path: "/api/feedback/\(id)")) }
    func records(_ query: String) async throws -> RecordsResponse {
        var parts = URLComponents(url: baseURL.appending(path: "/api/records"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [.init(name: "q", value: query)]
        return try await get(parts.url!)
    }

    func geocode(_ query: String) async throws -> [Place] {
        var parts = URLComponents(url: baseURL.appending(path: "/api/geocode"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [.init(name: "q", value: query)]
        return try await get(parts.url!)
    }

    func walkingRoutes(origin: Place, destination: Place, via: Place?, filters: Set<LayerDefinition>) async throws -> RouteResponse {
        var request = URLRequest(url: baseURL.appending(path: "/api/routes")); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(RouteRequest(origin: origin, destination: destination, via: via, profile: "walking", filters: filters.map(\.rawValue)))
        return try await perform(request)
    }

    func mapLayers() async throws -> MapLayersResponse { try await get(baseURL.appending(path: "/api/map-layers")) }

    func reportIssues() async throws -> [ReportIssue] { try await get(baseURL.appending(path: "/api/report-issues")) }

    func reportThread(for issue: ReportIssue) async throws -> ReportThread {
        var parts = URLComponents(url: baseURL.appending(path: "/api/thread"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [.init(name: "type", value: issue.type), .init(name: "id", value: issue.recordID)]
        return try await get(parts.url!)
    }

    func confirm(_ issue: ReportIssue) async throws -> ReportThread {
        var request = URLRequest(url: baseURL.appending(path: "/api/seen")); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(IssueIdentityRequest(type: issue.type, id: issue.recordID))
        return try await perform(request)
    }

    func submitReport(for issue: ReportIssue, text: String?, status: String?, photo: String?) async throws -> ReportThread {
        var request = URLRequest(url: baseURL.appending(path: "/api/post")); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(IssuePostRequest(type: issue.type, id: issue.recordID, text: text, status: status, photo: photo))
        return try await perform(request)
    }

    func submitConditionObservation(feature: MapFeature, state: String, coordinate: CLLocationCoordinate2D) async throws -> ConditionObservationResponse {
        var request = URLRequest(url: baseURL.appending(path: "/api/condition-observations")); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(ConditionObservationRequest(
            featureId: feature.id, state: state, lat: coordinate.latitude, lng: coordinate.longitude
        ))
        return try await perform(request)
    }

    func conditionLoop(for feature: MapFeature) async throws -> ConditionLoop {
        var parts = URLComponents(url: baseURL.appending(path: "/api/condition-loop"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [.init(name: "feature_id", value: feature.id)]
        let response: ConditionLoopResponse = try await get(parts.url!)
        return response.loop
    }

    func citiBike(near place: Place) async throws -> [CitiBikeStation] {
        var parts = URLComponents(url: baseURL.appending(path: "/api/discover/citibike"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [.init(name: "lat", value: String(place.lat)), .init(name: "lng", value: String(place.lng))]
        let response: CitiBikeResponse = try await get(parts.url!); return response.stations
    }

    private func get<T: Decodable & Sendable>(_ url: URL) async throws -> T { try await perform(URLRequest(url: url)) }
    private func perform<T: Decodable & Sendable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError(message ?? "The route service is unavailable.")
        }
        return try await Task.detached(priority: .userInitiated) {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try decoder.decode(T.self, from: data)
        }.value
    }
}

struct APIError: LocalizedError { let message: String; init(_ message: String) { self.message = message }; var errorDescription: String? { message } }
