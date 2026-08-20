import XCTest

@MainActor
final class ReportMapGestureTests: XCTestCase {
    func testForecastLocationLeadsWithoutSettingRouteOrigin() throws {
        let app = XCUIApplication()
        app.launch()

        let locationButton = app.buttons["forecast-location-button"]
        XCTAssertTrue(locationButton.waitForExistence(timeout: 5))
        locationButton.tap()

        XCTAssertTrue(app.textFields["forecast-location-search"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Use my location"].exists)
        XCTAssertFalse(app.textFields["Where from?"].exists)
    }

    func testWalkingPlannerIsProgressivelyDisclosed() throws {
        let app = XCUIApplication()
        app.launch()

        let planButton = app.buttons["plan-walk-button"]
        XCTAssertTrue(planButton.waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["Where from?"].exists)

        planButton.tap()
        XCTAssertTrue(app.textFields["Where from?"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.textFields["Where to?"].exists)
    }

    func testUnifiedMapRespondsToPinchZoom() throws {
        let app = XCUIApplication()
        app.launch()

        let map = app.otherElements["unified-map"]
        XCTAssertTrue(map.waitForExistence(timeout: 8))

        let forecastMarker = app.buttons["forecast-map-marker"]
        XCTAssertTrue(forecastMarker.waitForExistence(timeout: 8))
        let before = try XCTUnwrap(Double(map.value as? String ?? ""))

        // The full Map accessibility frame extends under the prediction card. Pinching
        // its center can hit that card; this visible native annotation is guaranteed to
        // sit in the uncovered map canvas and still sends a real MapKit pinch.
        forecastMarker.pinch(withScale: 2.0, velocity: 1.0)

        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                guard let value = Double(map.value as? String ?? "") else { return false }
                return value < before * 0.9
            },
            object: nil
        )
        wait(for: [changed], timeout: 5)
    }
}
