import XCTest
@testable import Unignorable

final class LocalStoreTests: XCTestCase {
    func testDiskRoundTripExpirationAndCorruption() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStore(directory: directory)
        let places = [Place(name: "A", lat: 40.74, lng: -73.99)]
        await store.write("places", value: places)
        let saved = await store.read("places", as: [Place].self, maxAge: 60)
        XCTAssertEqual(saved?.value, places)
        let expired = await store.read("places", as: [Place].self, maxAge: -1)
        XCTAssertNil(expired)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appending(path: "places.json").path))
        try Data("broken".utf8).write(to: directory.appending(path: "map.json"))
        let corrupt = await store.read("map", as: MapLayersResponse.self, maxAge: 60)
        XCTAssertNil(corrupt)
    }

    @MainActor
    func testActiveWalkRestoresOfflineWithClampedProgressAndClearsAfterAddressChange() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStore(directory: directory)
        let route = try JSONDecoder().decode(RouteChoice.self, from: Data(#"{"id":"a","distance":100,"duration":90,"geometry":{"type":"LineString","coordinates":[[-73.99,40.74],[-73.98,40.75]]},"recommended":true,"selectedIntersections":0,"metrics":{},"steps":[{"instruction":"Walk east","distance":90,"duration":80},{"instruction":"Arrive","distance":0,"duration":0}]}"#.utf8))
        let a = Place(name: "A", lat: 40.74, lng: -73.99), b = Place(name: "B", lat: 40.75, lng: -73.98)
        let walk = LocalWalk(origin: a, destination: b, via: nil, filters: ["sidewalk"], routes: [route], avoidance: nil, selectedRouteID: "a", step: 99, plannedAt: Date())
        await store.write("walk", value: walk)
        await store.write("places", value: [a, b])
        let model = RouteModel(local: store)
        await model.loadLocalState()
        XCTAssertEqual(model.origin, a); XCTAssertEqual(model.destination, b)
        XCTAssertEqual(model.walkingStepIndex, 1)
        XCTAssertEqual(model.filters, [.sidewalk]); XCTAssertEqual(model.recentPlaces, [a,b])
        model.selectWalkingStep(0); await model.flushWalk()
        let resumed = RouteModel(local: store); await resumed.loadLocalState()
        XCTAssertEqual(resumed.walkingStepIndex, 0)
        resumed.clearAddress(asOrigin: true); await resumed.flushWalk()
        let removed = await store.read("walk", as: LocalWalk.self, maxAge: 60)
        XCTAssertNil(removed)
        await resumed.clearLocalHistory()
        let history = await store.read("places", as: [Place].self, maxAge: 60)
        XCTAssertNil(history)
    }

    @MainActor
    func testCachedMarkersLoadWithoutNetworkAndRecentPlacesAreBounded() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStore(directory: directory)
        let data = Data(#"{"layers":{"sidewalk":[{"id":"pavement","lat":40.724,"lng":-73.965,"layer":"sidewalk"}]}}"#.utf8)
        await store.write("map", value: try JSONDecoder().decode(MapLayersResponse.self, from: data))
        let model = RouteModel(local: store)
        await model.loadLocalState()
        model.visibleLayers = [.sidewalk]
        await model.waitForMapUpdate()
        XCTAssertEqual(model.visibleFeatures.map(\.id), ["pavement"])
        XCTAssertTrue(model.showingSavedMap); XCTAssertNotNil(model.mapSavedAt)
        for i in 0..<20 { model.select(Place(name: "Place \(i)", lat: 40.74, lng: -73.99), asOrigin: true) }
        XCTAssertEqual(model.recentPlaces.count, 12)
        XCTAssertEqual(model.recentMatches("Place 19").first?.name, "Place 19")
        model.select(Place(name: "Current location", lat: 40.74, lng: -73.99), asOrigin: true)
        XCTAssertFalse(model.recentPlaces.contains { $0.name == "Current location" })
    }
}
