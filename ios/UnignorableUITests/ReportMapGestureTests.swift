import XCTest

@MainActor
final class ReportMapGestureTests: XCTestCase {
    func testAddressAutocompleteAndWalkingRouteConnect() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-curbnote-ui-reset"]
        app.launch()
        app.buttons["plan-walk-button"].tap()
        let origin = app.textFields["Where from?"]
        XCTAssertTrue(origin.waitForExistence(timeout: 5))
        origin.tap()
        origin.typeText("350 5th Ave")
        let suggestion = app.buttons["address-suggestion-0"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 20))
        XCTAssertTrue(suggestion.isHittable, "Suggestions must remain visible above the keyboard")
        let search = XCTAttachment(screenshot: app.screenshot())
        search.name = "Native address autocomplete"
        search.lifetime = .keepAlways
        add(search)
        suggestion.tap()
        let resolved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !(app.staticTexts["Checking address…"].exists)
        }, object: nil)
        wait(for: [resolved], timeout: 20)
        let destination = app.textFields["Where to?"]
        destination.tap()
        destination.typeText("247 3rd Ave")
        XCTAssertTrue(suggestion.waitForExistence(timeout: 20))
        XCTAssertTrue(suggestion.isHittable)
        suggestion.tap()
        let ready = app.buttons["Create walking route"]
        XCTAssertTrue(ready.waitForExistence(timeout: 5))
        ready.tap()
        let routeReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Route ready")).firstMatch.exists
        }, object: nil)
        wait(for: [routeReady], timeout: 45)
        let route = XCTAttachment(screenshot: app.screenshot())
        route.name = "Walking route connected"
        route.lifetime = .keepAlways
        add(route)
        XCTAssertFalse(app.staticTexts["A server with the specified hostname could not be found."].exists)
        app.buttons["Done"].tap()
        let startWalk = app.buttons["start-curbnote-walk"]
        XCTAssertTrue(startWalk.waitForExistence(timeout: 5))
        startWalk.tap()
        let progress = app.staticTexts["walking-step-progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        XCTAssertTrue(progress.label.hasPrefix("Step 1 of"))
        XCTAssertFalse(app.buttons["walking-step-back"].isEnabled)
        let next = app.buttons["walking-step-next"]
        if !next.isHittable { app.swipeUp() }
        next.tap()
        XCTAssertTrue(progress.label.hasPrefix("Step 2 of"))
        app.buttons["walking-step-back"].tap()
        XCTAssertTrue(progress.label.hasPrefix("Step 1 of"))
        let guide = XCTAttachment(screenshot: app.screenshot())
        guide.name = "Curbnote walking guide"
        guide.lifetime = .keepAlways
        add(guide)

        // Signup is offered only after choosing Save; the walking guide remains anonymous.
        app.buttons["Done"].tap()
        let save = app.buttons["save-walk-account-gate"]
        XCTAssertTrue(save.waitForExistence(timeout: 5)); save.tap()
        XCTAssertTrue(app.buttons["create-passkey-account"].waitForExistence(timeout: 5))
        let signup = XCTAttachment(screenshot: app.screenshot()); signup.name = "Optional passkey signup"; signup.lifetime = .keepAlways; add(signup)
        app.buttons["Keep walking without an account"].tap()
        startWalk.tap(); app.buttons["walking-step-next"].tap()
        app.buttons["Done"].tap()
        app.terminate()
        app.launchArguments = []; app.launch()
        XCTAssertTrue(app.buttons["start-curbnote-walk"].waitForExistence(timeout: 8))
        app.buttons["start-curbnote-walk"].tap()
        XCTAssertTrue(app.staticTexts["walking-step-progress"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["walking-step-progress"].label.hasPrefix("Step 2 of"))

    }

    func testLaunchOffersNativeFeedbackAndRecords() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-curbnote-ui-reset"]
        app.launch()
        XCTAssertTrue(app.buttons["Plan my walk"].waitForExistence(timeout: 5))
        let launch = XCTAttachment(screenshot: app.screenshot())
        launch.name = "Curbnote launch"
        launch.lifetime = .keepAlways
        add(launch)
        app.buttons["Feedback"].tap()
        XCTAssertTrue(app.buttons["feedback-send"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["feedback-send"].isEnabled)
        let feedback = XCTAttachment(screenshot: app.screenshot())
        feedback.name = "Native feedback"
        feedback.lifetime = .keepAlways
        add(feedback)
        app.buttons["Done"].tap()
        app.buttons["Block records"].tap()
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 3))
    }

    func testForecastLocationLeadsWithoutSettingRouteOrigin() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-curbnote-ui-reset"]
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
        app.launchArguments = ["-curbnote-ui-reset"]
        app.launch()

        let planButton = app.buttons["plan-walk-button"]
        XCTAssertTrue(planButton.waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["Where from?"].exists)

        planButton.tap()
        XCTAssertTrue(app.textFields["Where from?"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.textFields["Where to?"].exists)
    }

    func testDoubleTapZoomsInsteadOfOpeningDetails() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-curbnote-ui-reset"]
        app.launch()
        let map = app.otherElements["unified-map"]
        XCTAssertTrue(map.waitForExistence(timeout: 8))
        let dismiss = app.buttons["Dismiss introduction"]
        if dismiss.exists { dismiss.tap() }
        let before = try XCTUnwrap(Double(map.value as? String ?? ""))
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).doubleTap()
        let zoomed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (Double(map.value as? String ?? "") ?? before) < before * 0.9
        }, object: nil)
        wait(for: [zoomed], timeout: 6)
        XCTAssertFalse(app.buttons["Done"].exists, "Double tapping a marker must not open its details")

        // Use exposed map below the toolbar, above the forecast card.
        let background = map.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.23))
        let backgroundFrame = XCTAttachment(screenshot: app.screenshot())
        backgroundFrame.name = "Map before background double tap"
        backgroundFrame.lifetime = .keepAlways
        add(backgroundFrame)
        background.tap()
        XCTAssertFalse(app.buttons["Done"].exists, "A background tap must not select the nearest record")
        let afterMarkerZoom = try XCTUnwrap(Double(map.value as? String ?? ""))
        background.doubleTap()
        let backgroundZoomed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (Double(map.value as? String ?? "") ?? afterMarkerZoom) < afterMarkerZoom * 0.9
        }, object: nil)
        wait(for: [backgroundZoomed], timeout: 6)
        XCTAssertFalse(app.buttons["Done"].exists)

        let why = app.buttons["Why / verify"]
        XCTAssertTrue(why.waitForExistence(timeout: 5))
        why.tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5), "A map-point detail must open its popup")
        XCTAssertTrue(app.buttons["share-dot-button"].waitForExistence(timeout: 3), "Every dot detail must offer sharing")
        let detail = XCTAttachment(screenshot: app.screenshot())
        detail.name = "Single marker tap opens details after double-tap zoom"
        detail.lifetime = .keepAlways
        add(detail)
    }

    func testUnifiedMapRespondsToPinchZoom() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-curbnote-ui-reset"]
        app.launch()

        let map = app.otherElements["unified-map"]
        XCTAssertTrue(map.waitForExistence(timeout: 8))

        let dismiss = app.buttons["Dismiss introduction"]
        if dismiss.exists { dismiss.tap() }
        let before = try XCTUnwrap(Double(map.value as? String ?? ""))

        map.pinch(withScale: 2.0, velocity: 1.0)

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
