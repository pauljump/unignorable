import XCTest

final class ReportMapGestureTests: XCTestCase {
    func testUnifiedMapRespondsToPinchZoom() throws {
        let app = XCUIApplication()
        app.launch()

        let map = app.otherElements["unified-map"]
        XCTAssertTrue(map.waitForExistence(timeout: 8))
        sleep(3) // Let the dense report annotations arrive before testing their hit areas.

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
