import PhotosUI
import SwiftUI
import UIKit

struct ReportIssueDetailView: View {
    let issue: ReportIssue
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var routeModel: RouteModel
    @State private var thread: ReportThread?
    @State private var comment = ""
    @State private var selectedStatus: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var photoData: Data?
    @State private var isWorking = false
    @State private var message: String?

    private let api = APIClient()
    private let statuses = [
        ("still_here", "Still here"), ("worse", "Got worse"),
        ("cleaned", "Cleaned up"), ("gone", "Gone now")
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    summary
                    confirmation
                    neighborRecord
                    submission
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle(issue.type)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .task { await loadThread() }
        .onChange(of: photoItem) { _, item in
            Task { photoData = try? await item?.loadTransferable(type: Data.self) }
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(issue.pattern == "persistent" ? "CHRONIC" : issue.status.uppercased())
                    .font(.caption2.bold()).foregroundStyle(issue.severity == .high ? AppTheme.coral : AppTheme.amber)
                Spacer()
                SeverityKey()
            }
            Text(issue.addr ?? "Approximate block location").font(.title3.bold())
            if let borough = issue.borough { Text(borough.capitalized).font(.caption).foregroundStyle(AppTheme.muted) }
            HStack(spacing: 18) {
                fact("\(issue.n.formatted())", "311 reports")
                fact("\(issue.closedN.formatted())", "city closures")
                fact("\(issue.returnedN.formatted())", "came back")
            }
            if let headline = issue.headline { Text(headline).font(.subheadline).foregroundStyle(AppTheme.ink) }
            Link(destination: accountabilityURL) {
                Label("Open accountability record", systemImage: "doc.text.magnifyingglass")
                    .font(.subheadline.bold())
            }
            if avoidanceLayer != nil {
                Button {
                    avoidInRoutes()
                } label: {
                    Label("Avoid this issue type in routes", systemImage: "arrow.triangle.branch")
                        .font(.subheadline.bold())
                }
            }
        }
        .padding(14)
        .background(AppTheme.panel, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(AppTheme.line))
    }

    private var confirmation: some View {
        Button {
            Task { await confirm() }
        } label: {
            HStack {
                Image(systemName: "checkmark.seal.fill")
                Text("Confirm this is here now")
                Spacer()
                Text("\((thread?.corrob ?? issue.seen).formatted())").bold()
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(isWorking)
    }

    private var neighborRecord: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("What neighbors confirm").font(.headline)
            Text(verdictText).font(.subheadline.bold()).foregroundStyle(verdictColor)
            if let posts = thread?.posts, !posts.isEmpty {
                ForEach(posts) { post in
                    VStack(alignment: .leading, spacing: 4) {
                        if let status = post.status { Text(status.replacingOccurrences(of: "_", with: " ").uppercased()).font(.caption2.bold()).foregroundStyle(AppTheme.amber) }
                        if let text = post.text { Text(text).font(.subheadline) }
                        Text(relativeDate(post.ts)).font(.caption2).foregroundStyle(AppTheme.muted)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.raised, in: RoundedRectangle(cornerRadius: 10))
                }
            } else {
                Text("No approved field notes yet.").font(.caption).foregroundStyle(AppTheme.muted)
            }
        }
    }

    private var submission: some View {
        let hasPhoto = photoData != nil
        return VStack(alignment: .leading, spacing: 10) {
            Text("Add what you see").font(.headline)
            TextEditor(text: $comment)
                .frame(minHeight: 80)
                .padding(6)
                .scrollContentBackground(.hidden)
                .background(AppTheme.raised, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppTheme.line))
                .overlay(alignment: .topLeading) {
                    if comment.isEmpty { Text("Describe the condition or public space.").foregroundStyle(AppTheme.muted).padding(14).allowsHitTesting(false) }
                }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(statuses, id: \.0) { status in
                        Button(status.1) { selectedStatus = selectedStatus == status.0 ? nil : status.0 }
                            .buttonStyle(.bordered)
                            .tint(selectedStatus == status.0 ? AppTheme.coral : AppTheme.muted)
                    }
                }
            }

            PhotosPicker(selection: $photoItem, matching: .images) {
                Label(hasPhoto ? "Photo selected" : "Add photo", systemImage: hasPhoto ? "checkmark.circle.fill" : "camera.fill")
            }
            .buttonStyle(.bordered)

            Text("Do not photograph, describe, or characterize people. Document the condition or public space only. A person reviews every update before it is published.")
                .font(.caption).foregroundStyle(AppTheme.muted)

            Button {
                Task { await submit() }
            } label: {
                if isWorking { ProgressView().frame(maxWidth: .infinity) }
                else { Text("Submit for review").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isWorking || (comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && selectedStatus == nil && photoData == nil))

            if let message { Text(message).font(.caption).foregroundStyle(AppTheme.muted) }
        }
    }

    private func fact(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) { Text(value).font(.headline); Text(label).font(.caption2).foregroundStyle(AppTheme.muted) }
    }

    private var accountabilityURL: URL {
        var parts = URLComponents(string: "https://curbnote.polyfeeds.dev/c")!
        parts.queryItems = [.init(name: "t", value: issue.type), .init(name: "id", value: issue.recordID)]
        return parts.url!
    }

    private var avoidanceLayer: LayerDefinition? {
        switch issue.type {
        case "Drug Activity": .drugs
        case "Encampment", "Homeless Person Assistance", "Panhandling": .homelessness
        default: nil
        }
    }

    private func avoidInRoutes() {
        guard let layer = avoidanceLayer else { return }
        routeModel.filters.insert(layer)
        routeModel.visibleLayers.insert(layer)
        routeModel.rebuild()
        dismiss()
    }

    private var verdictText: String {
        switch thread?.verdict {
        case "still_here": "STILL HERE · \(thread?.corrob ?? 0) confirmations"
        case "cleared": "NEIGHBORS SAY THIS IS CLEARED"
        default: "UNVERIFIED"
        }
    }

    private var verdictColor: Color { thread?.verdict == "cleared" ? AppTheme.mint : thread?.verdict == "still_here" ? AppTheme.coral : AppTheme.muted }

    private func relativeDate(_ value: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(.relative(presentation: .named))
    }

    private func loadThread() async {
        do { thread = try await api.reportThread(for: issue) }
        catch { message = error.localizedDescription }
    }

    private func confirm() async {
        isWorking = true
        defer { isWorking = false }
        do { thread = try await api.confirm(issue); message = thread?.duplicate == true ? "Already confirmed from this device." : "Confirmation added." }
        catch { message = error.localizedDescription }
    }

    private func submit() async {
        isWorking = true
        defer { isWorking = false }
        let clean = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            thread = try await api.submitReport(
                for: issue, text: clean.isEmpty ? nil : clean, status: selectedStatus,
                photo: photoData.flatMap(photoDataURL)
            )
            comment = ""; selectedStatus = nil; photoData = nil; photoItem = nil
            message = "Thanks — your update is in review."
        } catch { message = error.localizedDescription }
    }

    private func photoDataURL(_ data: Data) -> String? {
        guard let image = UIImage(data: data) else { return nil }
        let scale = min(1, 1280 / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = resized.jpegData(compressionQuality: 0.72) else { return nil }
        return "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
    }
}
