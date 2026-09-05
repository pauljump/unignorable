import SwiftUI

struct RecordsResponse: Decodable, Sendable { let records: [MapFeature]; let total: Int }
struct RecordsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var records: [MapFeature] = []
    @State private var total = 0
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var selected: MapFeature?
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Your block has a history.").font(.title2.bold())
                    Text("Search an NYC street or address. Read the dated evidence, check what changed, and share the same record with a neighbor.")
                    Text("Missing data does not mean a condition is resolved.").font(.footnote).foregroundStyle(.secondary)
                }
                if loading { ProgressView("Finding records…") }
                if let errorMessage { Text(errorMessage); Button("Try again") { Task { await search() } } }
                if !loading && errorMessage == nil && records.isEmpty { Text("No matching records. Try a street name.") }
                ForEach(records) { feature in
                    Button { selected = feature } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(feature.address ?? "NYC block record").font(.headline)
                            Text("Last source report: \(feature.lastSeen?.prefix(10) ?? "unknown")").font(.caption).foregroundStyle(.secondary)
                            if feature.recordArchived == true { Text("Retained history · current status unknown").font(.caption).foregroundStyle(.secondary) }
                            Text("\(feature.count ?? 0) source reports · \(feature.distinctReportDays ?? 0) distinct report days")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if total > records.count { Text("Showing \(records.count) of \(total). Add more of the address to narrow your search.").font(.footnote) }
            }
            .searchable(text: $query, prompt: "Search street or address")
            .onSubmit(of: .search) { Task { await search() } }
            .navigationTitle("Block records")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await search() }
            .sheet(item: $selected) { FeatureDetailView(feature: $0) }
        }
    }
    @MainActor private func search() async {
        loading = true; errorMessage = nil
        defer { loading = false }
        do { let result = try await APIClient().records(query); records = result.records; total = result.total }
        catch { records = []; errorMessage = error.localizedDescription }
    }
}
