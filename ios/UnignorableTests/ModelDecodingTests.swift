import XCTest
@testable import Unignorable

final class ModelDecodingTests: XCTestCase {
    func testRouteResponseDecodesSnakeCaseFields() throws {
        let data = #"{"profile":"walking","via":{"name":"Bike stop","lat":40.745,"lng":-73.985},"cache_hit":true,"avoidance":{"baseline_intersections":3,"remaining_intersections":1,"improved":true,"excluded_areas":2,"remaining_risk":0.8,"passes":1},"routes":[{"id":"route-1","distance":1609.344,"duration":900,"geometry":{"type":"LineString","coordinates":[[-73.99,40.75],[-73.98,40.74]]},"recommended":true,"selected_intersections":1,"selected_risk":0.8,"steps":[{"instruction":"Turn right","distance":80,"duration":30,"type":"turn","modifier":"right","location":{"lat":40.75,"lng":-73.99}}],"metrics":{"alpr":1},"export":{"apple":"https://maps.apple.com/directions","google":"https://www.google.com/maps/dir/?api=1","shaping_waypoints":2,"external_waypoints":3,"includes_via":true}}]}"#.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(RouteResponse.self, from: data)
        XCTAssertEqual(response.routes.first?.selectedIntersections, 1)
        XCTAssertEqual(response.routes.first?.steps?.first?.instruction, "Turn right")
        XCTAssertEqual(response.routes.first?.steps?.first?.modifier, "right")
        XCTAssertEqual(response.routes.first?.steps?.first?.location?.lat, 40.75)
        XCTAssertEqual(response.routes.first?.geometry.mapCoordinates.count, 2)
        XCTAssertEqual(response.routes.first?.export?.includesVia, true)
        XCTAssertEqual(response.via?.name, "Bike stop")
        XCTAssertEqual(response.cacheHit, true)
    }

    func testConditionEstimateDecodesWithoutRawDescriptorLabels() throws {
        let data = #"{"layers":{"homelessness":[{"id":"311-encampment-1","layer":"homelessness","subject_type":"encampment","lat":40.74,"lng":-73.98,"count":12,"descriptor":"Likely encampment present","distinct_report_days":7,"location_uncertainty_m":35,"condition":{"classification":"likely_present","label":"Likely encampment present","presence_probability":0.81,"probability_range":[0.67,0.95],"routing_level":"hard","hard_exclusion":true,"last_observed_at":"2026-08-07T01:50:00.000Z","method_version":"encampment-presence-v2"}}]}}"#.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(MapLayersResponse.self, from: data)
        let feature = try XCTUnwrap(response.layers["homelessness"]?.first)
        XCTAssertEqual(feature.id, "311-encampment-1")
        XCTAssertEqual(feature.condition?.presenceProbability, 0.81)
        XCTAssertEqual(feature.condition?.routingLevel, "hard")
        XCTAssertEqual(feature.locationUncertaintyM, 35)
    }

    func testCompactReportIssueDecodesAndUsesOutlineSeverity() throws {
        let data = #"{"type":"Encampment","id":"40.736,-73.983","n":189,"lat":40.736,"lng":-73.983,"addr":"335 2 AVENUE","borough":"MANHATTAN","status":"active","pattern":"persistent","score":68.4,"current_days":297,"last_seen":"2026-08-10","headline":"Still active","seen":2,"closed_n":169,"returned_n":44}"#.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let issue = try decoder.decode(ReportIssue.self, from: data)
        XCTAssertEqual(issue.id, "Encampment|40.736,-73.983")
        XCTAssertEqual(issue.severity, .high)
        XCTAssertEqual(issue.closedN, 169)
    }
}
