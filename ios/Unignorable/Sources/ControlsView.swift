import SwiftUI

enum RouteOptionFocus: String {
    case avoid
    case onTheWay
}

struct ControlsView: View {
    @EnvironmentObject private var model: RouteModel
    @Environment(\.dismiss) private var dismiss
    let focus: RouteOptionFocus
    @State private var isLoadingStops = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    Section {
                        ForEach(LayerDefinition.allCases) { layer in
                            Toggle(isOn: filterToggle(layer)) {
                                Label(layer.title, systemImage: layer.symbol)
                            }
                        }
                    } header: {
                        Text("Avoid on this walk")
                    } footer: {
                        Text("High-confidence selected locations become street exclusions where the walking network allows it. Changes update an existing route automatically.")
                    }
                    .id(RouteOptionFocus.avoid.rawValue)

                    Section {
                        if let via = model.via {
                            HStack {
                                Label(via.name, systemImage: "mappin.circle.fill")
                                    .lineLimit(2)
                                Spacer()
                                Button("Remove") { model.clearVia() }
                                    .foregroundStyle(AppTheme.coral)
                            }
                        }

                        Toggle(isOn: $model.showCitiBike) {
                            Label("Available Citi Bikes", systemImage: "bicycle")
                        }
                        .onChange(of: model.showCitiBike) { _, enabled in
                            Task { await refreshStops(enabled: enabled) }
                        }

                        if isLoadingStops {
                            HStack { ProgressView(); Text("Finding stops near this walk…").foregroundStyle(.secondary) }
                        } else if model.showCitiBike {
                            ForEach(model.bikes.prefix(6)) { station in
                                Button {
                                    model.chooseBike(station)
                                    dismiss()
                                } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(station.name).foregroundStyle(.primary).lineLimit(1)
                                            Text("\(station.bikes) bikes · \(station.docks) open docks")
                                                .font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text("Go by").font(.caption.bold()).foregroundStyle(AppTheme.mint)
                                    }
                                }
                            }
                        }
                    } header: {
                        Text("Go by on the way")
                    } footer: {
                        Text("Choose a useful stop and Curbnote will shape the walk near it without changing your final destination.")
                    }
                    .id(RouteOptionFocus.onTheWay.rawValue)

                }
                .onAppear {
                    proxy.scrollTo(focus.rawValue, anchor: .top)
                    if focus == .onTheWay, model.showCitiBike, model.bikes.isEmpty {
                        Task { await refreshStops(enabled: true) }
                    }
                }
            }
            .navigationTitle("Walking preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func refreshStops(enabled: Bool) async {
        guard enabled else { model.bikes = []; return }
        isLoadingStops = true
        await model.loadBikes()
        isLoadingStops = false
    }

    private func filterToggle(_ layer: LayerDefinition) -> Binding<Bool> {
        Binding(
            get: { model.filters.contains(layer) },
            set: { enabled in
                if enabled {
                    model.filters.insert(layer)
                    model.visibleLayers.insert(layer)
                } else {
                    model.filters.remove(layer)
                }
                model.rebuild()
            }
        )
    }

}
