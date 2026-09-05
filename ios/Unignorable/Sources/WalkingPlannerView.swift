import MapKit
import SwiftUI

private enum SearchField: Hashable { case origin, destination }

/// The presented view owns its focus state; a focus binding on the map's parent
/// does not reliably follow the text fields across the sheet presentation boundary.
struct WalkingPlannerView: View {
    @EnvironmentObject private var model: RouteModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: SearchField?
    let onReportNearby: () -> Void
    let onControls: (RouteOptionFocus) -> Void
    let onLocate: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView { planner.padding(.bottom, 24) }
                .background(AppTheme.background)
                .navigationTitle("Plan a walking route")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        .presentationDetents([.large])
        .onDisappear { model.cancelSearch() }
    }

    private var planner: some View {
        VStack(spacing: 8) {
            HStack {
                Label("Walking route", systemImage: "figure.walk").font(.headline)
                Spacer()
                Text("curbnote").font(.caption.bold()).foregroundStyle(AppTheme.muted)
                Button { onReportNearby() } label: {
                    Label("Report nearby", systemImage: "exclamationmark.bubble.fill")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityIdentifier("report-nearby-button")
            }

            HStack(spacing: 8) {
                VStack(spacing: 0) {
                    addressField(label: "A", placeholder: "Where from?", text: $model.originText, field: .origin)
                    Divider().padding(.leading, 42)
                    addressField(label: "B", placeholder: "Where to?", text: $model.destinationText, field: .destination)
                }

                Button(action: model.swap) {
                    Image(systemName: "arrow.up.arrow.down")
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Swap start and destination")
            }

            if focusedField != nil {
                VStack(alignment: .leading, spacing: 0) {
                    let matches = model.recentMatches(focusedField == .origin ? model.originText : model.destinationText)
                    if !matches.isEmpty {
                        Text("Recent · on this device").font(.caption).foregroundStyle(.secondary)
                        ForEach(matches) { place in
                            Button { let isOrigin = focusedField == .origin; focusedField = nil; model.select(place, asOrigin: isOrigin) } label: {
                                Label(place.name, systemImage: "clock").font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10)
                            }.buttonStyle(.plain)
                        }
                    }
                    if model.isSearching { ProgressView("Finding addresses…").font(.caption).padding(.vertical, 8) }
                    if let message = model.searchStatus { Text(message).font(.caption).foregroundStyle(.secondary).padding(.vertical, 8) }
                    ForEach(Array(model.completions.enumerated()), id: \.offset) { index, completion in
                        Button {
                            let isOrigin = focusedField == .origin
                            focusedField = nil
                            model.selectCompletion(completion, asOrigin: isOrigin)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(completion.title).font(.subheadline)
                                Text(completion.subtitle).font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("address-suggestion-\(index)")
                        Divider()
                    }
                    ForEach(Array(model.suggestions.prefix(5).enumerated()), id: \.element.id) { index, place in
                        Button {
                            let isOrigin = focusedField == .origin
                            focusedField = nil
                            model.select(place, asOrigin: isOrigin)
                        } label: {
                            Text(place.name).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("address-suggestion-\(index)")
                        Divider()
                    }
                }
                .padding(.horizontal, 8)
            }

            HStack(spacing: 8) {
                routePreferenceButton(
                    title: "Avoid",
                    detail: model.filters.isEmpty ? "Nothing" : "\(model.filters.count) selected",
                    symbol: "shield.slash.fill"
                ) { onControls(.avoid) }

                routePreferenceButton(
                    title: "Go by",
                    detail: model.via?.name ?? "Add a stop",
                    symbol: "mappin.and.ellipse"
                ) { onControls(.onTheWay) }
            }

            HStack(spacing: 8) {
                Button {
                    focusedField = nil
                    model.createWalkingRoute()
                } label: {
                    HStack(spacing: 8) {
                        if model.isRouting { ProgressView().tint(.white).controlSize(.small) }
                        Text(model.routes.isEmpty ? "Create walking route" : "Update walking route")
                    }
                    .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.brand)
                .disabled(model.isRouting || model.originText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.destinationText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button { onLocate() } label: {
                    Image(systemName: "location.fill").frame(width: 30, height: 30)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Use current location as starting point")
            }

            if let via = model.via {
                HStack(spacing: 8) {
                    Text("C").font(.caption.bold()).foregroundStyle(.white)
                        .frame(width: 22, height: 22).background(AppTheme.mint, in: Circle())
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Stop on the way").font(.caption2).foregroundStyle(.secondary)
                        Text(via.name).font(.caption.bold()).lineLimit(1)
                    }
                    Spacer()
                    Button(action: model.clearVia) { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .accessibilityLabel("Remove stop")
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(AppTheme.raised, in: RoundedRectangle(cornerRadius: 10))
            }

            if model.isRouting || model.status != nil {
                HStack(spacing: 7) {
                    if model.isRouting { ProgressView().controlSize(.small) }
                    Text(model.status ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                }
            }


        }
        .padding(10)
        .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 12, y: 5)
        .padding(.horizontal, 10)
        .padding(.top, 4)
    }

    private func addressField(label: String, placeholder: String, text: Binding<String>, field: SearchField) -> some View {
        HStack(spacing: 9) {
            Text(label)
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(field == .origin ? .green : .red, in: Circle())
            TextField(placeholder, text: text)
                .textContentType(.fullStreetAddress)
                .textInputAutocapitalization(.words)
                .submitLabel(field == .origin ? .next : .route)
                .focused($focusedField, equals: field)
                .onChange(of: text.wrappedValue) { _, value in
                    guard focusedField == field else { return }
                    model.addressTextChanged(asOrigin: field == .origin)
                    model.search(value)
                }
                .onSubmit { if field == .origin { focusedField = .destination; model.search(model.destinationText) } }
                .onChange(of: focusedField) { _, focus in
                    if focus == field { model.search(text.wrappedValue) }
                }
            if !text.wrappedValue.isEmpty {
                Button {
                    model.clearAddress(asOrigin: field == .origin)
                    focusedField = field
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(field == .origin ? "Clear starting point" : "Clear destination")
            }
        }
        .frame(minHeight: 42)
    }

    private func routePreferenceButton(title: String, detail: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol).foregroundStyle(AppTheme.mint)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.caption.bold())
                    Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 38)
            .padding(.horizontal, 10)
            .background(AppTheme.raised, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(detail)")
    }

}
