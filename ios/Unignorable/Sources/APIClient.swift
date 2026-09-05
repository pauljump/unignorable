import Foundation
import CoreLocation

struct APIClient {
    let baseURL: URL
    private let session: URLSession
    private let encoder = JSONEncoder()

    init(baseURL: URL = URL(string: "https://curbnote.polyfeeds.dev")!, session: URLSession? = nil) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 25
        configuration.requestCachePolicy = .useProtocolCachePolicy
        self.session = session ?? URLSession(configuration: configuration)
    }

    func account<T: Decodable & Sendable>(_ path: String, body: Data? = nil, token: String? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: "/api/account/" + path))
        request.setValue("ios", forHTTPHeaderField: "X-Curbnote-Client")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.httpMethod = "POST"; request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try await perform(request)
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

    static func dnsFallback(for request: URLRequest, error: Error) -> URLRequest? {
        guard let urlError = error as? URLError,
              [.cannotFindHost, .dnsLookupFailed].contains(urlError.code),
              let url = request.url, url.scheme == "https",
              url.host == "curbnote.polyfeeds.dev", url.path.hasPrefix("/api/"),
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.host = "unignorable.polyfeeds.dev"
        var fallback = request
        fallback.url = parts.url
        return fallback
    }

    private func get<T: Decodable & Sendable>(_ url: URL) async throws -> T { try await perform(URLRequest(url: url)) }
    private func perform<T: Decodable & Sendable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            guard let fallback = Self.dnsFallback(for: request, error: error) else { throw error }
            // DNS failed before the request reached the service. Retry once through
            // its existing alias; never replay a timeout, HTTP failure or uncertain write.
            (data, response) = try await session.data(for: fallback)
        }
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
