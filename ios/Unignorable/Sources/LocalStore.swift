import Foundation

struct LocalEnvelope<Value: Codable & Sendable>: Codable, Sendable {
    let version: Int
    let savedAt: Date
    let value: Value
}

/// Serial disk work stays off the UI actor. Private trip data is excluded from backups.
actor LocalStore {
    static let shared = LocalStore()
    let directory: URL
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "CurbnoteLocal")
    }
    func read<T: Codable & Sendable>(_ key: String, as type: T.Type, maxAge: TimeInterval) -> LocalEnvelope<T>? {
        let url = directory.appending(path: key + ".json")
        guard let data = try? Data(contentsOf: url), data.count < 30_000_000,
              let entry = try? JSONDecoder().decode(LocalEnvelope<T>.self, from: data),
              entry.version == 1, entry.savedAt <= Date(), Date().timeIntervalSince(entry.savedAt) < maxAge else { try? FileManager.default.removeItem(at: url); return nil }
        return entry
    }
    func write<T: Codable & Sendable>(_ key: String, value: T) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var folder = directory
            var attributes = URLResourceValues(); attributes.isExcludedFromBackup = true
            try folder.setResourceValues(attributes)
            let data = try JSONEncoder().encode(LocalEnvelope(version: 1, savedAt: Date(), value: value))
            guard data.count < 30_000_000 else { return }
            let url = directory.appending(path: key + ".json")
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch { /* A failed cache write must never prevent a walk. */ }
    }
    func remove(_ key: String) { try? FileManager.default.removeItem(at: directory.appending(path: key + ".json")) }
}

struct LocalWalk: Codable, Sendable {
    let origin: Place
    let destination: Place
    let via: Place?
    let filters: [String]
    let routes: [RouteChoice]
    let avoidance: AvoidanceSummary?
    let selectedRouteID: String?
    let step: Int
    let plannedAt: Date
}
