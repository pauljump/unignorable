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

    func testNestedNowcastAndReportTimingDecodeDefensively() throws {
        let data = #"{"layers":{"homelessness":[{"id":"311-encampment-1","layer":"homelessness","subject_type":"encampment","address":"East 20th Street near Second Avenue","lat":40.74,"lng":-73.98,"location_uncertainty_m":35,"nowcast":{"method_version":"walk-nowcast-v2","rollout":"shadow","status":"beta","as_of":"2026-08-20T12:00:00.000Z","uncalibrated_score":0.82,"score_range":[0.94,0.63],"score_semantics":"uncalibrated_shadow_score","range_semantics":"heuristic_score_range_not_confidence_interval","confidence_semantics":"evidence_strength_not_statistical_confidence","current_probability":0.77,"live_probability":0.75,"probability_range":[0.9,0.6],"confidence":"medium","features":{"report_days_7":3,"report_age_days":1.5},"local_time_window":{"start_hour":7,"end_hour":10,"timezone":"America/New_York","label":"7–10 AM","report_days":24,"days_in_window":15,"effective_days_in_window":14.5,"sample_size":24,"concentration":0.625,"strength":"moderate","basis":"Most eligible report days fall in this local-time window."},"spatial_uncertainty":{"radius_m":42,"label":"About 42 m","basis":"Address-geocoded public reports."}}}]}}"#.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(MapLayersResponse.self, from: data)
        let feature = try XCTUnwrap(response.layers["homelessness"]?.first)

        XCTAssertEqual(feature.forecastScore, 0.82)
        XCTAssertEqual(feature.forecastScoreRange?.lowerBound, 0.63)
        XCTAssertEqual(feature.forecastScoreRange?.upperBound, 0.94)
        XCTAssertEqual(feature.nowcast?.features?.reportDays7, 3)
        XCTAssertEqual(feature.nowcast?.localTimeWindow?.sampleSize, 24)
        XCTAssertEqual(feature.nowcast?.localTimeWindow?.effectiveDaysInWindow, 14.5)
        XCTAssertEqual(feature.nowcast?.scoreSemantics, "uncalibrated_shadow_score")
        XCTAssertEqual(feature.address, "East 20th Street near Second Avenue")
        XCTAssertEqual(feature.forecastLocationRadiusM, 42)
        XCTAssertEqual(feature.reportTimingLabel, "Historical reports most often arrived 7–10 AM")
        XCTAssertTrue(feature.reportTimingIsStrongEnoughForPrimary)
        XCTAssertEqual(feature.forecastTitle, "Encampment condition likely present")
        XCTAssertTrue(feature.isExperimentalForecast)
    }

    func testMissingNowcastFallsBackWithoutInventingReportTiming() throws {
        let data = #"{"layers":{"homelessness":[{"id":"311-encampment-1","layer":"homelessness","subject_type":"encampment","lat":40.74,"lng":-73.98,"condition":{"classification":"uncertain","label":"Uncertain","presence_probability":1.4,"probability_range":[-0.1,1.2]}}]}}"#.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let feature = try XCTUnwrap(try decoder.decode(MapLayersResponse.self, from: data).layers["homelessness"]?.first)

        XCTAssertNil(feature.forecastScore)
        XCTAssertNil(feature.forecastScoreRange)
        XCTAssertNil(feature.reportTimingLabel)
        XCTAssertFalse(feature.reportTimingIsStrongEnoughForPrimary)
        XCTAssertEqual(feature.forecastTitle, "Encampment condition status uncertain")
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
