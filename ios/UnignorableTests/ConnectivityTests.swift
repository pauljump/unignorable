import XCTest
@testable import Unignorable

private final class DNSFailureProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.host == "curbnote.polyfeeds.dev" {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
        } else {
            let data = #"[{"name":"247 Third Avenue","lat":40.737,"lng":-73.984}]"#.data(using: .utf8)!
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}

final class ConnectivityTests: XCTestCase {
    func testDNSFailureUsesExistingBackendAndDecodesResponse() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DNSFailureProtocol.self]
        let client = APIClient(session: URLSession(configuration: configuration))
        let places = try await client.geocode("247 Third Avenue")
        XCTAssertEqual(places.first?.name, "247 Third Avenue")
    }

    func testDNSFallbackPreservesRequestBodyAndQuery() throws {
        var request = URLRequest(url: URL(string: "https://curbnote.polyfeeds.dev/api/routes?test=1")!)
        request.httpMethod = "POST"
        request.httpBody = Data("walking request".utf8)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let fallback = try XCTUnwrap(APIClient.dnsFallback(for: request, error: URLError(.dnsLookupFailed)))
        XCTAssertEqual(fallback.url?.absoluteString, "https://unignorable.polyfeeds.dev/api/routes?test=1")
        XCTAssertEqual(fallback.httpMethod, "POST")
        XCTAssertEqual(fallback.httpBody, request.httpBody)
        XCTAssertEqual(fallback.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testFallbackDoesNotReplayAmbiguousFailuresOrOtherHosts() {
        let request = URLRequest(url: URL(string: "https://curbnote.polyfeeds.dev/api/feedback")!)
        for code: URLError.Code in [.timedOut, .networkConnectionLost, .cancelled, .secureConnectionFailed, .notConnectedToInternet] {
            XCTAssertNil(APIClient.dnsFallback(for: request, error: URLError(code)))
        }
        for url in ["https://example.com/api/routes", "https://unignorable.polyfeeds.dev/api/routes", "https://curbnote.polyfeeds.dev/privacy", "http://curbnote.polyfeeds.dev/api/routes"] {
            XCTAssertNil(APIClient.dnsFallback(for: URLRequest(url: URL(string: url)!), error: URLError(.cannotFindHost)))
        }
    }

    @MainActor
    func testClearingOrSelectingAddressClearsPendingSuggestions() {
        let model = RouteModel()
        let place = Place(name: "247 Third Avenue", lat: 40.737, lng: -73.984)
        model.suggestions = [place]
        model.isSearching = true
        model.searchStatus = "Old error"
        model.clearAddress(asOrigin: true)
        XCTAssertTrue(model.suggestions.isEmpty)
        XCTAssertFalse(model.isSearching)
        XCTAssertNil(model.searchStatus)
        model.suggestions = [place]
        model.select(place, asOrigin: false)
        XCTAssertEqual(model.destination?.name, place.name)
        XCTAssertTrue(model.suggestions.isEmpty)
    }
}
