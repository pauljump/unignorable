import SwiftUI

struct FeedbackRequest: Encodable {
    let platform = "ios"
    let category: String
    let usefulness: String
    let message: String
}
struct FeedbackReceipt: Decodable, Sendable {
    let id: String
    let status: String
    let reply: String?
}
struct FeedbackView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("feedbackReceipt") private var receiptID = ""
    @State private var category = "route"
    @State private var usefulness = "not_yet"
    @State private var message = ""
    @State private var sending = false
    @State private var status: String?
    @State private var receipt: FeedbackReceipt?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Help shape your next walk.").font(.title2.bold())
                    Text("What worked? What got in your way? Your feedback goes directly into our private product inbox.")
                }
                Section("Your experience") {
                    Picker("Topic", selection: $category) {
                        Text("My walking route").tag("route")
                        Text("Something on the map is wrong").tag("data")
                        Text("Something I wish it did").tag("idea")
                        Text("Something broke").tag("bug")
                    }
                    Picker("Did it help today?", selection: $usefulness) {
                        Text("Haven't tried a walk yet").tag("not_yet")
                        Text("Yes").tag("yes")
                        Text("Partly").tag("partly")
                        Text("No").tag("no")
                    }
                    TextField("I wanted to… but…", text: $message, axis: .vertical)
                        .lineLimit(5...10)
                        .accessibilityIdentifier("feedback-message")
                        .onChange(of: message) { _, value in if value.count > 2000 { message = String(value.prefix(2000)) } }
                    Text("Don't include home addresses, contact details, or descriptions of people. No route coordinates are attached. For a field check, use Check this place on the map.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button(sending ? "Sending…" : "Send feedback") { Task { await submit() } }
                        .disabled(sending || message.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                        .accessibilityIdentifier("feedback-send")
                    if let status { Text(status).accessibilityIdentifier("feedback-status") }
                }
                if let receipt {
                    Section("Your latest feedback") {
                        LabeledContent("Status", value: receipt.status.capitalized)
                        Text(receipt.reply?.isEmpty == false ? receipt.reply! : "No reply yet. Thanks for helping shape Curbnote.")
                        ShareLink("Keep your private receipt", item: URL(string: "https://curbnote.polyfeeds.dev/feedback?receipt=\(receipt.id)")!)
                        Text("Keep this link to see our reply. Anyone with it can read the reply. Feedback expires after 90 days.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Refresh reply") { Task { await refresh() } }
                    }
                }
                Section {
                    Link("Privacy", destination: URL(string: "https://curbnote.polyfeeds.dev/privacy")!)
                    Link("Support", destination: URL(string: "https://curbnote.polyfeeds.dev/support")!)
                }
            }
            .navigationTitle("Feedback")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await refresh() }
        }
    }
    @MainActor private func submit() async {
        sending = true
        defer { sending = false }
        do {
            let result = try await APIClient().submitFeedback(.init(category: category, usefulness: usefulness, message: message))
            receiptID = result.id
            receipt = result
            message = ""
            status = "Saved. Thank you."
        } catch { status = error.localizedDescription }
    }
    @MainActor private func refresh() async {
        guard !receiptID.isEmpty else { return }
        do { receipt = try await APIClient().feedbackReceipt(receiptID) }
        catch { status = error.localizedDescription }
    }
}
