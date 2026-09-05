import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var model: RouteModel
    @EnvironmentObject private var account: AccountModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var deleteConfirmation = false
    let saving: Bool
    let onOpenWalk: () -> Void
    var body: some View {
        NavigationStack {
            Form {
                if let user = account.account {
                    Section { Text("Signed in as " + user.name).font(.headline) }
                    if saving, let walk = model.localWalk {
                        Section("Save this walk") {
                            TextField("Walk name", text: $name)
                            Text(walk.origin.name + " → " + walk.destination.name).font(.subheadline)
                            Text("Save these addresses, your stop and preferences privately to your account. Opening a saved walk lets you calculate a fresh route.").font(.caption).foregroundStyle(.secondary)
                            Button("Save walk across devices") { Task { await account.save(walk, name: name.isEmpty ? "My walk" : name) } }.disabled(account.busy)
                        }
                    }
                    Section("Your saved walks") {
                        if account.walks.isEmpty { Text("No saved walks yet. Plan a walk, then choose Save.").foregroundStyle(.secondary) }
                        ForEach(account.walks) { walk in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(walk.name).font(.headline)
                                Text(walk.origin.name + " → " + walk.destination.name).font(.caption).foregroundStyle(.secondary)
                                HStack {
                                    Button("Use these addresses") { model.useSavedWalk(walk); onOpenWalk() }
                                    Spacer()
                                    Button("Remove", role: .destructive) { Task { await account.remove(walk) } }
                                }.buttonStyle(.borderless)
                            }.padding(.vertical, 4)
                        }
                    }
                    Section("Account") {
                        Button("Add another passkey") { Task { await account.authenticate(kind: "add", name: user.name) } }
                        Button("Verify sign-in again") { Task { await account.authenticate(kind: "login") } }
                        Text("Keep a passkey in your password manager or add another. There is no email or password reset. Adding a passkey or deleting your account requires a recent sign-in.").font(.caption).foregroundStyle(.secondary)
                        Button("Sign out") { Task { await account.logout() } }
                        Button("Delete account and synced walks", role: .destructive) { deleteConfirmation = true }
                    }
                } else {
                    Section {
                        Image(systemName: "bookmark.fill").font(.largeTitle).foregroundStyle(AppTheme.brand)
                        Text("Keep your favorite walks.").font(.title2.bold())
                        Text("Create an account to save walks across web and iPhone. Planning, walking and local resume stay available without one.")
                        TextField("Name for your account", text: $name).textContentType(.nickname)
                        Button("Create account with a passkey") { Task { await account.authenticate(kind: "register", name: name.isEmpty ? "Curbnote walker" : name) } }
                            .accessibilityIdentifier("create-passkey-account")
                        Button("Sign in with a passkey") { Task { await account.authenticate(kind: "login") } }
                        Button("Keep walking without an account") { dismiss() }
                        Text("Your device or password manager keeps your passkey. Curbnote never receives your Face ID or fingerprint. Only walks you explicitly save are synced.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if account.busy { ProgressView("Waiting for sign-in…") }
                if let message = account.message { Text(message).font(.subheadline).accessibilityIdentifier("account-status") }
                Section("On this device") {
                    Button("Clear recent addresses") { Task { await model.clearLocalHistory() } }
                    Text("Up to 12 recent addresses stay on this phone. Clear them anytime.").font(.caption).foregroundStyle(.secondary)
                }
                Section { Link("Privacy", destination: URL(string: "https://curbnote.polyfeeds.dev/privacy")!) }
            }
            .disabled(account.busy)
            .navigationTitle(saving ? "Save your walk" : "Saved walks")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await account.refresh() }
            .confirmationDialog("Delete your account and all synced walks? This cannot be undone.", isPresented: $deleteConfirmation, titleVisibility: .visible) {
                Button("Delete account", role: .destructive) { Task { await account.deleteAccount() } }
            }
        }
    }
}
